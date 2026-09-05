import { initializeApp, getApps, getApp, deleteApp, FirebaseApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signInAnonymously,
  signOut, 
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  User as FirebaseUser
} from 'firebase/auth';
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken } from 'firebase/app-check';
import { 
  getFirestore, 
  initializeFirestore,
  collection, 
  doc, 
  setDoc,
  updateDoc,
  deleteDoc, 
  getDoc, 
  getDocs, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  Firestore,
  serverTimestamp
} from 'firebase/firestore';
import firebaseConfigData from '../../firebase-applet-config.json';
import { Student, Teacher, AttendanceRecord, ClassScheduleAssignment, SchoolSettings, UserRole } from '../types/attendance';
import { compressDataUrl, PHOTO_DATAURL_SOFT_LIMIT } from '../utils/imageCompressor';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const auth = authInstance;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
      tenantId: auth?.currentUser?.tenantId || null,
      providerInfo: auth?.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.warn('Firestore Notice / Operation details:', JSON.stringify(errInfo));
  return errInfo;
}

// Safe initialization
let firebaseApp: FirebaseApp | null = null;
let authInstance: ReturnType<typeof getAuth> | null = null;
let firestoreDb: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!firebaseApp) {
    if (getApps().length > 0) {
      firebaseApp = getApp();
    } else {
      firebaseApp = initializeApp({
        apiKey: firebaseConfigData.apiKey,
        authDomain: firebaseConfigData.authDomain,
        projectId: firebaseConfigData.projectId,
        storageBucket: firebaseConfigData.storageBucket,
        messagingSenderId: firebaseConfigData.messagingSenderId,
        appId: firebaseConfigData.appId
      });

      // ===== Ronda 18: Firebase App Check (estándar 2026 contra clientes no autorizados) =====
      // Se activa SOLO si el propietario registra la app en Firebase Console → App Check
      // (reCAPTCHA v3) y pega la site key en firebase-applet-config.json → recaptchaSiteKey.
      // Hoy la clave está vacía ⇒ este bloque es un NO-OP (cero riesgo de regresión).
      // Pasos de activación documentados en AGENTS.md → "Endurecimiento definitivo".
      const recaptchaSiteKey = (firebaseConfigData as any).recaptchaSiteKey as string | undefined;
      if (recaptchaSiteKey) {
        try {
          initializeAppCheck(firebaseApp, {
            provider: new ReCaptchaV3Provider(recaptchaSiteKey),
            isTokenAutoRefreshEnabled: true
          });
        } catch (e) {
          console.warn('[Firebase] App Check no pudo inicializarse (se continúa sin él):', e);
        }
      }
    }
  }
  return firebaseApp;
}

export function getFirebaseAuth() {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
  }
  return authInstance;
}

export function getFirebaseFirestore(): Firestore {
  if (!firestoreDb) {
    const app = getFirebaseApp();
    const dbId = firebaseConfigData.firestoreDatabaseId && firebaseConfigData.firestoreDatabaseId !== '(default)'
      ? firebaseConfigData.firestoreDatabaseId
      : undefined;

    try {
      firestoreDb = initializeFirestore(app, {
        experimentalForceLongPolling: true,
      }, dbId);
    } catch {
      firestoreDb = dbId ? getFirestore(app, dbId) : getFirestore(app);
    }
  }
  return firestoreDb;
}

// ===== Ronda 33 (M2): provisión de cuentas reales desde Rectoría =====
/**
 * Espejo en la nube de la ficha docente (colección teachers). Lo escribe la sesión
 * de Rectoría (rol ADMIN según users/{uid}); NO incluye credenciales — jamás se
 * suben contraseñas a Firestore (Ronda 16/33).
 */
export interface TeacherCloudMirror {
  authEmail?: string;
  authUid?: string;
  hasFirebaseAccount?: boolean;
}

export interface FirebaseUserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: UserRole;
  linkedTeacherId?: string;
  linkedStudentCode?: string;
  /** Ronda 33 (M2): el primer ingreso exige definir contraseña personal. */
  mustChangePassword?: boolean;
  createdAt?: any;
}

export class FirebaseService {
  /**
   * Ronda 18: autenticación anónima del terminal CON ESPERA CONTROLADA.
   *
   * Anonymous ya está habilitado en la consola (verificado por REST el 02/09/2026:
   * accounts:signUp → 200 con idToken anónimo), y las reglas endurecidas de
   * Firestore exigen `isAuthenticated()` — por eso TODAS las rutas que tocan
   * Firestore (sync de settings al arranque, respaldo, escrituras) esperan esta
   * promesa antes de leer/escribir.
   *
   * Garantías:
   *  - Singleton: una sola promesa por carga de página (sin carreras de signIn).
   *  - Restaura la sesión persistida (IndexedDB) si ya existía de una visita previa
   *    (el primer evento de onAuthStateChanged llega tras el restore del SDK).
   *  - Si no hay sesión, crea la anónima UNA vez.
   *  - JAMÁS rechaza ni bloquea más de ANON_AUTH_TIMEOUT_MS (fire-and-forget seguro:
   *    sin red o con el proveedor deshabilitado, resuelve y la app sigue offline-first).
   */
  private static anonymousAuthPromise: Promise<void> | null = null;
  private static readonly ANON_AUTH_TIMEOUT_MS = 6000;

  static ensureAnonymousAuth(): Promise<void> {
    if (!this.anonymousAuthPromise) {
      this.anonymousAuthPromise = (async () => {
        const auth = getFirebaseAuth();
        if (!auth) return;
        if (auth.currentUser) return; // sesión existente (Google/email/anónima)

        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => { if (!settled) { settled = true; resolve(); } };
          // El primer evento del listener llega tras restaurar la sesión persistida
          const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) { unsubscribe(); finish(); }
          });
          // No había sesión persistida (o aún llega null): crear la anónima una vez
          signInAnonymously(auth)
            .then(() => console.info('[Firebase] Sesión anónima del terminal establecida.'))
            .catch((e) => {
              console.warn('[Firebase] No se pudo crear sesión anónima (la app continúa offline-first):', typeof e === 'object' ? (e?.code || e?.message) : e);
            })
            .finally(() => { unsubscribe(); finish(); });
          setTimeout(finish, this.ANON_AUTH_TIMEOUT_MS); // cinturón de seguridad
        });
      })().catch(() => {}); // jamás rechaza
    }
    return this.anonymousAuthPromise;
  }

  /**
   * Sign in with Email and Password (M1/M2 — el estándar de Ronda 33).
   * Devuelve también el perfil users/{uid}: el ROL se decide por el documento
   * persistido en Firestore (jamás por el correo ni por un check embebido).
   */
  static async loginWithEmail(email: string, pass: string): Promise<{ user: FirebaseUser; profile?: FirebaseUserProfile }> {
    try {
      const auth = getFirebaseAuth();
      const result = await signInWithEmailAndPassword(auth, email, pass);
      const profile = await this.getUserProfile(result.user.uid);
      return { user: result.user, profile: profile || undefined };
    } catch (error: any) {
      console.error('Error in email login:', error);
      throw error;
    }
  }

  /**
   * Mapea códigos de Firebase Auth a mensajes honestos y sin fugas de información
   * (jamás revelan si el correo existe o no — anti enumeración de usuarios).
   */
  static mapAuthError(error: unknown): string {
    const code = (error && typeof error === 'object' && 'code' in error) ? String((error as any).code) : '';
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
      case 'auth/invalid-login-credentials':
        return 'Credenciales incorrectas. Verifique su correo y contraseña.';
      case 'auth/invalid-email':
        return 'El correo electrónico no tiene un formato válido.';
      case 'auth/too-many-requests':
        return 'Demasiados intentos fallidos. Espere unos minutos e intente de nuevo.';
      case 'auth/network-request-failed':
        return 'No hay conexión con el servidor de acceso. Verifique su internet e intente de nuevo.';
      case 'auth/unauthorized-domain':
        return 'Este dominio no está autorizado para el acceso. Contacte a Rectoría.';
      case 'auth/operation-not-allowed':
        return 'El acceso por correo y contraseña está deshabilitado en Firebase. Contacte a Rectoría.';
      case 'auth/user-disabled':
        return 'Esta cuenta está deshabilitada. Contacte a Rectoría.';
      case 'auth/email-already-in-use':
        return 'Ya existe una cuenta con ese correo. Use "Crear cuenta" solo para docentes sin acceso.';
      default:
        return 'No se pudo iniciar sesión. Intente de nuevo o contacte a Rectoría.';
    }
  }

  /**
   * Ronda 33 (M2): crea la cuenta REAL de Firebase Auth de un docente desde la
   * sesión de Rectoría, SIN cerrar la sesión de Rectoría.
   *
   * Técnica oficial (documentación Firebase): instancia secundaria de la app —
   * createUserWithEmailAndPassword sobre un initializeApp con nombre propio crea la
   * cuenta y SOLO inicia sesión en esa instancia secundaria, que se destruye al
   * terminar. La sesión principal (Rectoría) queda intacta.
   *
   * El nuevo usuario escribe su propio perfil users/{uid} (role DOCENTE,
   * linkedTeacherId, mustChangePassword=true — el primer ingreso exigirá definir
   * contraseña personal) y se firma el espejo en teachers/{id} con la sesión de
   * Rectoría.
   */
  static async provisionTeacherAccount(email: string, tempPassword: string, teacherId: string, displayName: string): Promise<{ uid: string; email: string }> {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('El docente necesita un correo institucional válido para crear su cuenta de acceso.');
    }
    const secondaryApp = initializeApp({
      apiKey: firebaseConfigData.apiKey,
      authDomain: firebaseConfigData.authDomain,
      projectId: firebaseConfigData.projectId,
      storageBucket: firebaseConfigData.storageBucket,
      messagingSenderId: firebaseConfigData.messagingSenderId,
      appId: firebaseConfigData.appId
    }, `inas-provisioner-${Date.now()}`);
    try {
      const secondaryAuth = getAuth(secondaryApp);
      const dbId = firebaseConfigData.firestoreDatabaseId && firebaseConfigData.firestoreDatabaseId !== '(default)'
        ? firebaseConfigData.firestoreDatabaseId
        : undefined;
      // Ronda 33: Firestore debe ser el de la INSTANCIA SECUNDARIA — así el write
      // de users/{uid} viaja con el idToken del usuario NUEVO (dueño del documento,
      // permitido por las reglas). Usar la instancia principal enviaría el token de
      // Rectoría y las reglas lo denegarían (request.auth.uid ≠ userId).
      const secondaryDb = dbId ? getFirestore(secondaryApp, dbId) : getFirestore(secondaryApp);
      let cred;
      try {
        cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, tempPassword);
      } catch (e: any) {
        // Recuperación honesta de huérfanos: si el correo ya existe pero la clave
        // temporal sigue siendo válida (intento anterior falló a mitad de camino),
        // reanudamos la provisión con ESA cuenta en lugar de abandonar al docente.
        const code = (e && typeof e === 'object' && 'code' in e) ? String((e as any).code) : '';
        if (code !== 'auth/email-already-in-use') throw e;
        cred = await signInWithEmailAndPassword(secondaryAuth, cleanEmail, tempPassword);
      }
      const profile: FirebaseUserProfile = {
        uid: cred.user.uid,
        email: cleanEmail,
        displayName: displayName || cleanEmail.split('@')[0],
        photoURL: null,
        role: 'DOCENTE',
        linkedTeacherId: teacherId,
        mustChangePassword: true
      };
      await setDoc(doc(secondaryDb, 'users', cred.user.uid), {
        ...profile,
        updatedAt: serverTimestamp()
      }, { merge: true });
      await this.mirrorTeacherCloud(teacherId, { authEmail: cleanEmail, authUid: cred.user.uid, hasFirebaseAccount: true });
      await signOut(secondaryAuth);
      return { uid: cred.user.uid, email: cleanEmail };
    } finally {
      try {
        const idx = getApps().findIndex(a => a.name === secondaryApp.name);
        if (idx >= 0) await deleteApp(getApps()[idx]);
      } catch { /* la limpieza del provisioner jamás bloquea el flujo principal */ }
    }
  }

  /** Espejo nube de la ficha docente (escrito por la sesión ADMIN de Rectoría). */
  static async mirrorTeacherCloud(teacherId: string, mirror: TeacherCloudMirror): Promise<void> {
    try {
      await setDoc(doc(getFirebaseFirestore(), 'teachers', teacherId), {
        ...mirror,
        cloudSyncedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn('Firestore: espejo de docente diferido (offline):', e);
    }
  }

  /**
   * Ronda 33 (M2): restablecimiento de contraseña del docente por correo (flujo
   * estándar de Firebase, sin SDK admin). Rectoría lo dispara desde Gestión
   * Docentes cuando el docente olvidó su clave; el docente define una nueva desde
   * el enlace del correo institucional.
   */
  static async sendPasswordResetTo(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), (email || '').trim());
    } catch (error: any) {
      console.error('Error sending password reset:', error);
      throw error;
    }
  }

  /**
   * Ronda 33 (M2): cambio de contraseña propia del DOCENTE con cuenta real.
   *  1) Re-autenticación OBLIGATORIA con la contraseña actual (Firebase exige sesión
   *     reciente; además prueba que quien pide el cambio conoce la clave vigente).
   *  2) updatePassword en Firebase Auth (la autoridad).
   *  3) mustChangePassword=false en users/{uid} (documento propio — reglas lo permiten).
   * Devuelve el uid por si el llamador actualiza espejos locales.
   */
  static async changeOwnPassword(currentPassword: string, newPassword: string): Promise<string> {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user || user.isAnonymous || !user.email) {
      throw new Error('No hay una cuenta de acceso activa. Inicie sesión con su correo institucional.');
    }
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    try {
      await reauthenticateWithCredential(user, credential);
    } catch (e: any) {
      const code = (e && typeof e === 'object' && 'code' in e) ? String((e as any).code) : '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/user-mismatch' || code === 'auth/invalid-login-credentials') {
        throw new Error('La contraseña actual ingresada es incorrecta.');
      }
      if (code === 'auth/too-many-requests') {
        throw new Error('Demasiados intentos. Espere unos minutos e intente de nuevo.');
      }
      throw new Error('No se pudo verificar su identidad. Intente de nuevo.');
    }
    try {
      await updatePassword(user, newPassword);
    } catch (e: any) {
      const code = (e && typeof e === 'object' && 'code' in e) ? String((e as any).code) : '';
      if (code === 'auth/weak-password') {
        throw new Error('La nueva contraseña es demasiado débil. Use al menos 6 caracteres.');
      }
      if (code === 'auth/requires-recent-login') {
        throw new Error('Por seguridad debe volver a iniciar sesión y repetir el cambio.');
      }
      throw new Error('No se pudo actualizar la contraseña en Firebase. Intente de nuevo.');
    }
    try {
      await updateDoc(doc(getFirebaseFirestore(), 'users', user.uid), {
        mustChangePassword: false,
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      // La marca de primer ingreso queda pendiente en la nube; el cambio REAL ya ocurrió.
      console.warn('Firestore: no se pudo limpiar mustChangePassword (offline):', e);
    }
    return user.uid;
  }

  /**
   * Update current user's password in Firebase Auth (caso directo sin re-autenticación)
   */
  static async updateUserPassword(newPassword: string): Promise<void> {
    try {
      const auth = getFirebaseAuth();
      if (!auth.currentUser) {
        throw new Error('No hay usuario autenticado en Firebase.');
      }
      await updatePassword(auth.currentUser, newPassword);
    } catch (error: any) {
      console.error('Error updating password in Firebase:', error);
      throw error;
    }
  }

  /**
   * Sign out
   */
  static async logout(): Promise<void> {
    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }

  /**
   * Save user profile
   */
  static async saveUserProfile(profile: FirebaseUserProfile): Promise<void> {
    try {
      const db = getFirebaseFirestore();
      const docRef = doc(db, 'users', profile.uid);
      await setDoc(docRef, {
        ...profile,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn('Firestore offline / user save skipped:', e);
    }
  }

  /**
   * Get user profile.
   * Ronda 33: reintento corto ante la CARRERA de token de Firestore — justo después
   * de signInWithEmailAndPassword, la instancia de Firestore puede aún llevar el
   * token ANÓNIMO del arranque mientras Auth ya es el usuario real; esa primera
   * lectura da permission-denied espurio. Se reintentan 3 lecturas (0/350/900ms):
   * es eventually-consistency del binding Auth→Firestore, no un fallback silencioso
   * (si el perfil no existe, devuelve null con normalidad).
   */
  static async getUserProfile(uid: string): Promise<FirebaseUserProfile | null> {
    const delays = [0, 350, 900];
    let lastErr: unknown = null;
    for (const delay of delays) {
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      try {
        const db = getFirebaseFirestore();
        const docRef = doc(db, 'users', uid);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          return snap.data() as FirebaseUserProfile;
        }
        return null; // el documento no existe — no hay nada que reintentar
      } catch (e) {
        lastErr = e;
        console.warn('Firestore: lectura de perfil diferida (token aún propagando):', e);
      }
    }
    console.warn('Firestore: perfil no legible tras reintentos:', lastErr);
    return null;
  }

  /**
   * Sync an attendance record to Firestore
   */
  static async syncAttendanceRecord(record: AttendanceRecord): Promise<void> {
    try {
      await this.ensureAnonymousAuth(); // Ronda 18: las reglas exigen isAuthenticated()
      const db = getFirebaseFirestore();
      const docRef = doc(db, 'attendance_records', record.id);
      await setDoc(docRef, {
        ...record,
        syncedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.warn('Firestore sync failed (offline fallback active):', error);
    }
  }

  /**
   * Sync all local data to Cloud Firestore (Backup / Migration)
   */
  static async backupAllToFirestore(data: {
    students: Student[];
    teachers: Teacher[];
    settings: SchoolSettings;
    records: AttendanceRecord[];
    assignments: ClassScheduleAssignment[];
  }): Promise<{ success: boolean; count: number; message: string }> {
    try {
      await this.ensureAnonymousAuth(); // Ronda 18: las reglas exigen isAuthenticated()
      const db = getFirebaseFirestore();
      let count = 0;

      // 1. Settings (sin secretos — ver saveSchoolSettings)
      const {
        qrSecret: _qrSecret,
        sessionSecret: _sessionSecret,
        cloudflareApiToken: _cfToken,
        customAiApiKey: _aiKey,
        ...safeSettings
      } = data.settings;
      await setDoc(doc(db, 'school_settings', 'main'), {
        ...safeSettings,
        lastCloudSync: new Date().toISOString()
      }, { merge: true });
      count++;

      // 2. Students — Ronda 18: fotos heredadas grandes se COMPRIMEN on-the-fly
      //    (nunca se descartan en silencio; consistencia con cloudflareSync).
      //    Ronda 33 (M6): la copia en nube JAMÁS lleva credenciales — tempPassword
      //    se elimina del espejo (antes viajaba en texto plano legible por cualquier
      //    sesión anónima).
      let photosOmitted = 0;
      for (const st of data.students) {
        const stData = { ...st };
        delete stData.tempPassword;
        if (stData.photoUrl && stData.photoUrl.length > PHOTO_DATAURL_SOFT_LIMIT) {
          const compressed = await compressDataUrl(stData.photoUrl);
          if (compressed) {
            stData.photoUrl = compressed;
          } else {
            delete stData.photoUrl;
            photosOmitted++;
          }
        }
        await setDoc(doc(db, 'students', st.code), stData, { merge: true });
        count++;
      }

      // 3. Teachers — Ronda 33 (M6): sin credenciales en la nube (tempPassword,
      //    password y passwordHash se eliminan del espejo; authEmail/authUid sí viajan
      //    porque no son secretos).
      for (const tc of data.teachers) {
        const { tempPassword: _tp, password: _p, passwordHash: _ph, ...safeTeacher } = tc;
        await setDoc(doc(db, 'teachers', tc.id), safeTeacher, { merge: true });
        count++;
      }

      // 4. Assignments
      for (const asgn of data.assignments) {
        await setDoc(doc(db, 'schedule_assignments', asgn.id), asgn, { merge: true });
        count++;
      }

      // 5. Recent records
      for (const rec of data.records.slice(0, 100)) {
        await setDoc(doc(db, 'attendance_records', rec.id), rec, { merge: true });
        count++;
      }

      return {
        success: true,
        count,
        message: `Sincronización exitosa con Firebase Firestore (${count} documentos respaldados en la nube).`
          + (photosOmitted > 0 ? ` ⚠ ${photosOmitted} foto(s) omitidas por ser irrecuperables; vuelve a subirlas desde el carné.` : '')
      };
    } catch (error: any) {
      console.error('Error syncing to Firestore:', error);
      return {
        success: false,
        count: 0,
        message: `Error al conectar con Firestore: ${error.message || error}`
      };
    }
  }

  /**
   * Save School Settings to Firestore (Cloud-backed persistence across devices and sessions)
   */

  static async saveSchoolSettings(settings: SchoolSettings): Promise<void> {
    try {
      await this.ensureAnonymousAuth(); // Ronda 18: las reglas exigen isAuthenticated()
      const db = getFirebaseFirestore();
      const docRef = doc(db, 'school_settings', 'main');
      // Ronda 16 (auditoría): NUNCA subir secretos a Firestore. Antes se subían
      // qrSecret, sessionSecret, tokens de Cloudflare y la clave IA personal del admin.
      // La nube solo necesita valores de ruta/configuración; los secretos viven y
      // permanecen en el localStorage del dispositivo que los generó.
      const {
        qrSecret: _qrSecret,
        sessionSecret: _sessionSecret,
        cloudflareApiToken: _cfToken,
        customAiApiKey: _aiKey,
        ...safeSettings
      } = settings;
      await setDoc(docRef, {
        ...safeSettings,
        updatedAt: serverTimestamp(),
        lastCloudSync: new Date().toISOString()
      }, { merge: true });

      // If user is logged in, link settings copy to user profile
      const auth = getFirebaseAuth();
      const currentUser = auth?.currentUser;
      if (currentUser) {
        const userDocRef = doc(db, 'users', currentUser.uid);
        await setDoc(userDocRef, {
          savedSettings: {
            // Ronda 16: solo valores de ruta — sin tokens ni claves personales
            cloudflareWorkerUrl: settings.cloudflareWorkerUrl,
            schoolCode: settings.schoolCode,
            schoolName: settings.schoolName,
            aiProvider: settings.aiProvider,
            aiModel: settings.aiModel
          },
          lastActive: serverTimestamp()
        }, { merge: true });
      }
    } catch (e) {
      console.warn('Firestore offline / school settings cloud save deferred:', e);
    }
  }

  /**
   * Load School Settings from Firestore
   */
  static async loadSchoolSettings(): Promise<SchoolSettings | null> {
    try {
      const db = getFirebaseFirestore();
      const docRef = doc(db, 'school_settings', 'main');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data && (data.schoolName || data.cloudflareWorkerUrl)) {
          return data as SchoolSettings;
        }
      }

      // If not in main, check current user's profile
      const auth = getFirebaseAuth();
      const currentUser = auth?.currentUser;
      if (currentUser) {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const uData = userSnap.data();
          if (uData?.savedSettings) {
            return uData.savedSettings as SchoolSettings;
          }
        }
      }
      return null;
    } catch (e) {
      console.warn('Firestore load school settings offline/skipped:', e);
      return null;
    }
  }

  /**
   * Listen to real-time changes in School Settings from Firestore
   */
  static onSchoolSettingsChange(callback: (settings: Partial<SchoolSettings>) => void) {
    try {
      const db = getFirebaseFirestore();
      const docRef = doc(db, 'school_settings', 'main');
      return onSnapshot(docRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data) {
            callback(data as SchoolSettings);
          }
        }
      }, (error) => {
        console.warn('School settings real-time listener notice:', error.message);
      });
    } catch (e) {
      return () => {};
    }
  }

  /**
   * Listen to auth state changes
   */
  static onAuthStateChange(callback: (user: FirebaseUser | null) => void) {
    try {
      const auth = getFirebaseAuth();
      return onAuthStateChanged(auth, callback);
    } catch (e) {
      console.warn('Firebase Auth listener fallback:', e);
      return () => {};
    }
  }
}
