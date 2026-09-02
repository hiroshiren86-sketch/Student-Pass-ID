import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInAnonymously,
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken } from 'firebase/app-check';
import { 
  getFirestore, 
  initializeFirestore,
  collection, 
  doc, 
  setDoc,
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
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

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

// ===== Ronda 18: Gobernanza de roles (cierra la escalada de privilegios) =====
/**
 * Lista EXACTA de correos que nacen ADMIN al crear su primer perfil.
 * NUNCA usar heurísticas tipo email.includes('admin'): cualquier persona con un
 * Gmail "superadmin123@gmail.com" se convertiría en administrador. Un nuevo ADMIN
 * legítimo se agrega AQUÍ (despliegue) o promoviendo manualmente su documento
 * users/{uid} desde la Consola de Firebase (el rol persistido prevalece al iniciar
 * sesión). Registro público vía Email/Password siempre nace DOCENTE.
 */
export const ADMIN_EMAILS: readonly string[] = [
  'hiroshiren86@gmail.com'
];

export function resolveInitialRole(email: string | null | undefined, existingRole?: UserRole): UserRole {
  if (existingRole) return existingRole; // rol persistido en users/{uid} prevalece
  const normalized = (email || '').trim().toLowerCase();
  return ADMIN_EMAILS.includes(normalized) ? 'ADMIN' : 'DOCENTE';
}

export interface FirebaseUserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: UserRole;
  linkedTeacherId?: string;
  linkedStudentCode?: string;
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
   * Sign in with Google Popup
   */
  static async loginWithGoogle(): Promise<{ user: FirebaseUser; profile?: FirebaseUserProfile }> {
    try {
      const auth = getFirebaseAuth();
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      // Check or create user profile in Firestore
      // Ronda 18: NUNCA auto-promover por heurística de texto del email (escala de
      // privilegios). Rol = perfil persistido; si no existe, SOLO la allowlist exacta.
      let profile = await this.getUserProfile(user.uid);
      if (!profile) {
        profile = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || user.email?.split('@')[0] || 'Usuario Google',
          photoURL: user.photoURL,
          role: resolveInitialRole(user.email)
        };

        await this.saveUserProfile(profile);
      }

      return { user, profile };
    } catch (error: any) {
      console.error('Error logging in with Google:', error);
      throw error;
    }
  }

  /**
   * Sign in with Email and Password
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
   * Register with Email and Password
   * Ronda 18 (multi-admin): el rol YA NO lo elige el cliente — cualquier registro
   * público nace DOCENTE, salvo que el correo esté en la allowlist institucional
   * (ADMIN_EMAILS). El rol de administradores adicionales se otorga promoviendo su
   * documento users/{uid} desde la Consola de Firebase (procedimiento en AGENTS.md).
   */
  static async registerWithEmail(email: string, pass: string, _requestedRole: UserRole, displayName: string): Promise<{ user: FirebaseUser; profile: FirebaseUserProfile }> {
    try {
      const auth = getFirebaseAuth();
      const result = await createUserWithEmailAndPassword(auth, email, pass);
      const profile: FirebaseUserProfile = {
        uid: result.user.uid,
        email: result.user.email,
        displayName: displayName,
        photoURL: null,
        role: resolveInitialRole(result.user.email) // ignora _requestedRole (cerrado por seguridad)
      };
      await this.saveUserProfile(profile);
      return { user: result.user, profile };
    } catch (error: any) {
      console.error('Error in email registration:', error);
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
   * Get user profile
   */
  static async getUserProfile(uid: string): Promise<FirebaseUserProfile | null> {
    try {
      const db = getFirebaseFirestore();
      const docRef = doc(db, 'users', uid);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as FirebaseUserProfile;
      }
      return null;
    } catch (e) {
      console.warn('Firestore offline / user read failed:', e);
      return null;
    }
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
      // (nunca se descartan en silencio; consistencia con cloudflareSync).
      // Nota: aquí NO se persiste la versión comprimida (backupAllToFirestore recibe
      // una copia de datos y firebase.ts no importa attendanceStorage para evitar
      // dependencia circular); la auto-sanación local la realiza el push a Cloudflare.
      let photosOmitted = 0;
      for (const st of data.students) {
        const stData = { ...st };
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

      // 3. Teachers
      for (const tc of data.teachers) {
        await setDoc(doc(db, 'teachers', tc.id), tc, { merge: true });
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
