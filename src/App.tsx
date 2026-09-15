import React, { useState, useRef, useEffect } from 'react';
import { 
  ScanLine, 
  BarChart3, 
  Users, 
  CreditCard, 
  ShieldCheck, 
  UserCheck, 
  Settings as SettingsIcon,
  Sun,
  Moon,
  School,
  Sparkles,
  BrainCircuit,
  FileSpreadsheet,
  ChevronDown,
  Layers,
  ArrowRight,
  ArrowLeft,
  Search,
  Wifi,
  ExternalLink,
  BookOpen,
  Shield,
  GraduationCap,
  Calendar,
  Key,
  LogOut
} from 'lucide-react';
import { ScanHubView } from './components/ScanHubView';
import { AttendanceReportsView } from './components/AttendanceReportsView';
import { StudentsManagerView } from './components/StudentsManagerView';
import { CardsManagerView } from './components/CardsManagerView';
import { GradeAiSummaryView } from './components/GradeAiSummaryView';
import { StudentPortalView } from './components/StudentPortalView';
import { TeacherClassroomView } from './components/TeacherClassroomView';
import { TeachersManagerView } from './components/TeachersManagerView';
import { ScheduleBuilderView } from './components/ScheduleBuilderView';
import { ExcusesInboxView } from './components/ExcusesInboxView'; // Ronda 21: buzón de justificaciones (Rectoría)
import { LoginScreen } from './components/LoginScreen';
import { SettingsModal } from './components/SettingsModal';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { PushOnboardingBanner } from './components/PushOnboardingBanner'; // Ronda 24: onboarding visible de notificaciones
import { FirstWelcomeTour, FirstWelcomeTourService } from './components/FirstWelcomeTour'; // Ronda 29: asistente de primer ingreso
import { useExcusesBadge } from './hooks/useExcusesBadge'; // Ronda 24: punto rojo de excusas pendientes
import { useTheme } from './context/ThemeContext';
import { SchoolSettings, Student, Teacher, UserSession, UserRole } from './types/attendance';
// R69 (RC-8): el Escudito busca con la misma lógica inteligente del Directorio
// (insensible a tildes, tokens en cualquier orden, documento/código/curso) y filtra
// por curso canónico. Antes usaba `.toLowerCase().includes(q)`: "gomez" no encontraba
// a "Gómez" y no había forma de acotar 180 estudiantes por curso en la demostración.
import { matchStudentFuzzy, matchTeacherFuzzy, matchesGradeFilter } from './utils/searchHelper';
import { canonicalGrade, compareGrades, gradeOptionLabel } from './utils/gradeCatalog';
import { AttendanceStorageService } from './services/attendanceStorage';
import { CloudflareSyncService } from './services/cloudflareSync';
import { FirebaseService } from './services/firebase';

export type ActiveTab = 'scan' | 'students' | 'teachers' | 'schedules' | 'cards' | 'attendance' | 'ai-grades' | 'teacher' | 'portal' | 'excuses';

export default function App() {
  // Ronda 30 (H-30-1): la app ya NO arranca como Rectoría implícita. Todo dispositivo
  // abre en la pantalla de login; solo un login real (o la restauración de una sesión
  // vigente nacida de un login real, ver boot effect) entra a la aplicación.
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentRole, setCurrentRole] = useState<UserRole>('ADMIN');
  const [activeTab, setActiveTab] = useState<ActiveTab>('students');
  const [loggedUser, setLoggedUser] = useState<{ teacher?: Teacher; student?: Student; username: string }>({
    username: ''
  });

  const { theme, toggleTheme } = useTheme();
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  // Ronda 33 (M2): cambio de contraseña OBLIGATORIO (primer ingreso docente con
  // contraseña temporal). En modo forzado el modal no se puede cerrar sin completar.
  const [forcedPasswordChange, setForcedPasswordChange] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  // R64 (Fix B): selector explícito de identidad — el Escudito ya NO impersona al
  // primer estudiante/docente del catálogo ([0]). Al elegir Docente o Estudiante se
  // abre un BUSCADOR de la persona concreta; sin selección no hay cambio de rol.
  const [rolePicker, setRolePicker] = useState<'DOCENTE' | 'ESTUDIANTE_ACUDIENTE' | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  // R69 (RC-8) — Escudito 100% dinámico desde el catálogo de la nube:
  //  · `catalogVersion` fuerza el re-render cuando llega un pull. ANTES el suscriptor
  //    de App sólo hacía `setSettings(getSettings())`, y con el cache de lectura (F-10)
  //    un pull que actualizaba ÚNICAMENTE estudiantes devolvía la MISMA referencia de
  //    settings → React hacía bail-out → la lista del Escudito quedaba congelada en el
  //    catálogo previo (eso es lo que se percibía como "lista estática/hardcodeada").
  //  · `pickerGrade` acota el listado por curso (imprescindible con la matrícula
  //    completa de 6°1 a 11°3 en la exposición).
  //  · `pickerRefreshing`/`pickerNotice` hacen visible de dónde vienen los datos y si
  //    la nube respondió (transparencia: nunca se finge un catálogo fresco).
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [pickerGrade, setPickerGrade] = useState<string>('all');
  const [pickerRefreshing, setPickerRefreshing] = useState(false);
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);
  const pickerRefreshInFlight = useRef(false);
  // Ronda 29: asistente de primer ingreso (guía por perfil, una sola vez por dispositivo)
  const [showWelcomeTour, setShowWelcomeTour] = useState(false);
  const [isTourManualReopen, setIsTourManualReopen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Ronda 24: punto rojo de excusas pendientes (Rectoría) — sondeo 30s, verdad = Worker
  const { pendingCount, refresh: refreshExcuseBadge } = useExcusesBadge(currentRole, activeTab, isAuthenticated);

  // Ronda 29: asistente de primer ingreso — se dispara al cambiar de perfil/sesión si
  // este dispositivo nunca ha visto la guía de ese perfil (bandera localStorage).
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!FirstWelcomeTourService.isSeen(currentRole)) {
      setIsTourManualReopen(false);
      setShowWelcomeTour(true);
    }
  }, [isAuthenticated, currentRole]);

  useEffect(() => {
    AttendanceStorageService.ensureActiveTemplateConsistency(); // Ronda 8 (B4): realinea plantilla activa vs slots
    // R68 (fix RC-4 — cuentas anónimas): RETIRADA la creación automática de
    // sesión anónima en el arranque (Ronda 16). Cada navegador limpio generaba
    // una cuenta anónima nueva (993 órfanos en la auditoría R67) y el
    // signInAnonymously en vuelo podía resolverse DESPUÉS de un login real y
    // trocar currentUser → el auto-sync siguiente perdía su ID token (401).
    // Nada en la pantalla pre-login la requiere: la lectura de settings de
    // Firestore pre-login ya era rechazada por las reglas desplegadas (R38
    // H-38-4) y el pull del Worker es el canal canónico. ensureAnonymousAuth
    // queda SOLO para el respaldo manual de Rectoría (no-op si hay sesión real).
    AttendanceStorageService.initCloudSettingsSync();
    CloudflareSyncService.initAutoSync();
    // Ronda 30 (H-30-1): arranque con PUERTA DE LOGIN. Se intenta restaurar
    // ÚNICAMENTE una sesión nacida de un login real (authAt) y no expirada (TTL 12h);
    // si no existe, el dispositivo se queda en LoginScreen. Sustituye al arranque
    // como Rectoría implícita de la Ronda 24 (cualquiera que abriera la URL en un
    // dispositivo entraba a Rectoría sin autenticarse).
    const restored = AttendanceStorageService.restoreValidSession();
    if (restored) {
      applyRestoredSession(restored);
    } else {
      try { localStorage.removeItem('inas_push_role_v1'); } catch {}
    }
    const unsubscribe = AttendanceStorageService.subscribe(() => {
      setSettings(AttendanceStorageService.getSettings());
      // R69 (RC-8): contador monotónico — garantiza re-render ante CUALQUIER escritura
      // del catálogo (pull, alta, "Hacer rep", cascada), sin depender de que la
      // referencia de settings cambie.
      setCatalogVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  // Ronda 4 (F3) + Ronda 58 (F-9): Cierre Automático de Jornada — evaluación perezosa
  // e idempotente cada 60s, PERO SOLO en sesión de Rectoría (ADMIN). Antes corría en
  // CUALQUIER dispositivo con la app abierta (docentes, portales de estudiantes):
  // N dispositivos → N series de registros AUSENTE con IDs aleatorios que el merge
  // de la nube SUMABA en vez de deduplicar (planillas infladas). Ahora hay UN solo
  // escritor del cierre (el terminal de Rectoría) y además los registros de
  // auto-cierre llevan ID determinista (rec-autoclose-<fecha>-<bloque>-<estudiante>),
  // así que incluso un cierre concurrente converge en el merge por id.
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const session = AttendanceStorageService.getCurrentSession();
        if (session?.role === 'ADMIN') {
          await AttendanceStorageService.maybeAutoCloseDay();
        }
      } catch (err) {
        console.error('Auto-cierre de jornada falló (reintentará):', err);
      } finally {
        running = false;
      }
    };
    tick();
    const intervalId = window.setInterval(tick, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Ronda 24 (fix crítico) + Ronda 30 (H-30-1): persistir la sesión SOLO en logins
  // reales (llamado exclusivamente desde handleLoginSuccess). La sesión lleva `authAt`
  // (estampa del login) que habilita su restauración por < 12h al recargar. La píldora
  // de cambio de perfil ya NO pasa por aquí (era el agujero: al recargar tras cambiar
  // de perfil, el dispositivo "renacía" como Docente/Estudiante sin autenticarse).
  const persistSession = (role: UserRole, payload?: { teacher?: Teacher; student?: Student; username: string; uid?: string; email?: string; mustChangePassword?: boolean }) => {
    try {
      AttendanceStorageService.saveCurrentSession({
        username: payload?.username || role,
        role,
        token: 'local-session',
        authAt: Date.now(),
        // Ronda 33 (M4): la sesión arrastra la identidad Firebase real (uid/email)
        // y la marca de cambio forzado de contraseña del primer ingreso docente.
        uid: payload?.uid,
        email: payload?.email,
        mustChangePassword: role === 'DOCENTE' ? payload?.mustChangePassword === true : undefined,
        studentCode: role === 'ESTUDIANTE_ACUDIENTE' ? payload?.student?.code : undefined,
        teacherId: role === 'DOCENTE' ? payload?.teacher?.id : undefined
      });
      localStorage.setItem('inas_push_role_v1', role === 'ADMIN' ? 'RECTORIA' : 'PORTAL');
    } catch { /* prescindible: el push degrada a PORTAL */ }
  };

  // Ronda 30 (H-30-1): aplica una sesión restaurada (login real con menos de 12h) al
  // estado de la app. Si el docente/estudiante referenciado ya no existe en la BD local
  // (fue borrado mientras la sesión estaba guardada), la sesión se invalida y se
  // muestra LoginScreen — nunca se restaura un rol fantasma.
  const applyRestoredSession = (session: UserSession) => {
    const invalidate = () => {
      AttendanceStorageService.clearSession();
      try { localStorage.removeItem('inas_push_role_v1'); } catch {}
    };

    let userPayload: { teacher?: Teacher; student?: Student; username: string };

    if (session.role === 'DOCENTE') {
      const teacher = AttendanceStorageService.getTeachers().find(t => t.id === session.teacherId);
      if (!teacher) { invalidate(); return; }
      userPayload = { teacher, username: teacher.fullName };
      setActiveTab('teacher');
      // Ronda 52: el cambio de contraseña es OPCIONAL — una sesión restaurada ya no
      // arrastra el forzado del modal; el docente entra con la clave temporal vigente.
    } else if (session.role === 'ESTUDIANTE_ACUDIENTE') {
      const student = AttendanceStorageService.getStudents().find(s => s.code === session.studentCode);
      if (!student) { invalidate(); return; }
      userPayload = { student, username: `${student.firstName} ${student.lastName}` };
      setActiveTab('portal');
    } else {
      userPayload = { username: session.username || 'Rectoría / Administrador General' };
      setActiveTab('students');
    }

    setCurrentRole(session.role);
    setLoggedUser(userPayload);
    setIsAuthenticated(true);
  };

  // Handle successful login
  const handleLoginSuccess = (role: UserRole, userPayload?: { teacher?: Teacher; student?: Student; username: string; uid?: string; email?: string; mustChangePassword?: boolean }) => {
    setCurrentRole(role);
    setIsAuthenticated(true);
    persistSession(role, userPayload);
    if (userPayload) {
      setLoggedUser(userPayload);
    } else {
      setLoggedUser({ username: role });
    }

    // Ronda 52: el cambio de contraseña es OPCIONAL. La clave temporal del carné
    // (o la que el propio docente defina) sirve para entrar directamente; NO se
    // obliga a cambiarla en el primer ingreso. El botón "Cambiar Mi Contraseña"
    // del menú sigue disponible para quien quiera hacerlo por su cuenta.
    // (Antes, mustChangePassword=true forzaba el modal y el cambio.)
    setForcedPasswordChange(false);
    setShowChangePasswordModal(false);

    // Default landing tab per role
    if (role === 'DOCENTE') {
      setActiveTab('teacher');
    } else if (role === 'ESTUDIANTE_ACUDIENTE') {
      setActiveTab('portal');
    } else if (role === 'ADMIN') {
      setActiveTab('students');
    }
  };

  const handleLogout = () => {
    setIsUserMenuOpen(false);
    // Ronda 30 (H-30-1): logout REAL. Antes solo se ocultaba la app (isAuthenticated
    //=false) dejando la sesión en localStorage — cualquier persona que abriera el
    // navegador del dispositivo heredaba el rol autenticado. Ahora la sesión se
    // destruye, la bandera de enrutamiento push se limpia y el dispositivo vuelve
    // a la pantalla de login.
    // Ronda 33 (M4): el logout también destruye la sesión de Firebase Auth —
    // dejarla viva mantendría una identidad válida en el SDK tras el logout UI.
    FirebaseService.logout().catch(() => {});
    AttendanceStorageService.clearSession();
    try { localStorage.removeItem('inas_push_role_v1'); } catch {}
    setCurrentRole('ADMIN');
    setActiveTab('students');
    setLoggedUser({ username: '' });
    setIsAuthenticated(false);
  };

  // Set default active tab when role changes from in-app switcher (Rectoría only)
  // R64 (Fix B): switchRole exige un OBJETIVO EXPLÍCITO para Docente/Estudiante —
  // fin de la impersonación ciega al primer elemento del catálogo (getStudents()[0],
  // "el estudiante genérico" siempre igual). Rectoría sigue siendo un VISTA PREVIA
  // dentro de su sesión (R30): la sesión persistida no se toca, solo el rol activo.
  const switchRole = (role: UserRole, target?: { teacher?: Teacher; student?: Student }) => {
    if (role === 'DOCENTE') {
      const t = target?.teacher;
      if (!t) return; // sin docente seleccionado NO hay cambio (el picker exige elegir)
      setCurrentRole(role);
      setShowRoleModal(false);
      setRolePicker(null);
      setIsUserMenuOpen(false);
      try { localStorage.setItem('inas_push_role_v1', 'PORTAL'); } catch {}
      setActiveTab('teacher');
      setLoggedUser({ teacher: t, username: t.fullName });
      return;
    }
    if (role === 'ESTUDIANTE_ACUDIENTE') {
      const s = target?.student;
      if (!s) return; // sin estudiante seleccionado NO hay cambio
      setCurrentRole(role);
      setShowRoleModal(false);
      setRolePicker(null);
      setIsUserMenuOpen(false);
      try { localStorage.setItem('inas_push_role_v1', 'PORTAL'); } catch {}
      setActiveTab('portal');
      setLoggedUser({ student: s, username: `${s.firstName} ${s.lastName}` });
      return;
    }
    // ADMIN: retorno a Rectoría (fin de la vista previa — la sesión real nunca cambió)
    setCurrentRole('ADMIN');
    setShowRoleModal(false);
    setRolePicker(null);
    setIsUserMenuOpen(false);
    try { localStorage.setItem('inas_push_role_v1', 'RECTORIA'); } catch {}
    setActiveTab('students');
    setLoggedUser({ username: 'Rectoría / Administrador General' });
  };

  /**
   * R69 (RC-8) — Refresco del catálogo desde la nube al abrir el Escudito.
   *
   * La lista del selector SIEMPRE se leyó del almacenamiento local (nunca fue
   * hardcodeada), pero ese almacenamiento es la CACHÉ del pull: en un terminal recién
   * abierto puede estar vacío o viejo. Por eso al abrir el selector se dispara un PULL
   * explícito (Rectoría, snapshot completo) y la UI dice qué pasó. Si la nube no
   * responde, se muestra el catálogo local con un aviso honesto — jamás una lista
   * inventada ni un fallo silencioso.
   */
  const refreshCatalogFromCloud = async (reason: 'escudito') => {
    if (pickerRefreshInFlight.current) return;
    const session = AttendanceStorageService.getCurrentSession();
    const workerUrl = (AttendanceStorageService.getSettings().cloudflareWorkerUrl || '').trim();
    if (session?.role !== 'ADMIN' || !workerUrl) return; // sin Rectoría o sin Worker no hay pull
    pickerRefreshInFlight.current = true;
    setPickerRefreshing(true);
    setPickerNotice(null);
    try {
      const result = await CloudflareSyncService.pullFromCloudflare();
      const students = AttendanceStorageService.getStudents().length;
      const teachers = AttendanceStorageService.getTeachers().length;
      if (result?.success) {
        setPickerNotice(`Catálogo actualizado desde la nube: ${students} estudiantes · ${teachers} docentes.`);
      } else {
        setPickerNotice(`La nube no respondió (${result?.message || 'sin conexión'}). Se lista el catálogo local: ${students} estudiantes · ${teachers} docentes.`);
      }
    } catch (err: any) {
      setPickerNotice(`No se pudo actualizar el catálogo desde la nube (${err?.message || 'error de red'}). Se lista el catálogo local.`);
      console.error('[Escudito] refresco del catálogo falló:', err);
    } finally {
      pickerRefreshInFlight.current = false;
      setPickerRefreshing(false);
    }
    void reason;
  };

  const openRoleSwitcher = () => {
    setShowRoleModal(true);
    setRolePicker(null);
    setPickerSearch('');
    setPickerGrade('all');
    setPickerNotice(null);
    void refreshCatalogFromCloud('escudito'); // R69 (RC-8): datos frescos de la nube al abrir
  };

  // R64 (Fix B): ¿hay una sesión REAL de Rectoría debajo del rol activo? (Vista previa)
  // La píldora es clickeable en ese caso desde CUALQUIER rol — el "bloqueo" del que
  // informaba el propietario (cambiar a estudiante y no poder volver) era porque la
  // píldora solo respondía con currentRole==='ADMIN'. Para un docente/estudiante con
  // sesión PROPIA (sin Rectoría debajo) la píldora sigue fija: su identidad es la
  // autenticada y no debe poder saltar a la de otro.
  const hasUnderlyingAdminSession = AttendanceStorageService.getCurrentSession()?.role === 'ADMIN';
  const canOpenRoleSwitcher = currentRole === 'ADMIN' || hasUnderlyingAdminSession;

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Ronda 25 (P3-B del informe QA externo): orden por FRECUENCIA DE USO — los 2 workflows
  // calientes primero (Planilla y Buzón de Justificaciones para Rectoría; la decision de
  // excusas es el flujo estrella). El badge rojo del Buzón viaja con el item, no con la posición.
  // `short` = etiqueta compacta para la barra segmentada del header (el dropdown mantiene
  // el nombre completo); libera espacio y evita exprimir el nombre del colegio (P5.1).
  const navItems = [
    { id: 'attendance' as ActiveTab, label: 'Planilla de Asistencia', short: 'Planilla', icon: FileSpreadsheet, badge: 'Reportes', primary: false, roles: ['ADMIN', 'DOCENTE'] },
    { id: 'excuses' as ActiveTab, label: 'Buzón de Justificaciones', short: 'Buzón', icon: ShieldCheck, badge: 'Excusas', primary: false, roles: ['ADMIN'] },
    { id: 'scan' as ActiveTab, label: 'Escanear Asistencia', short: 'Escanear', icon: ScanLine, badge: 'En vivo', primary: true, roles: ['ADMIN', 'DOCENTE'] },
    { id: 'students' as ActiveTab, label: 'Directorio Estudiantes', short: 'Directorio', icon: Users, badge: 'Matrícula', primary: true, roles: ['ADMIN', 'DOCENTE'] },
    { id: 'schedules' as ActiveTab, label: 'Horarios Escolares', short: 'Horarios', icon: Calendar, badge: 'Plantillas', primary: true, roles: ['ADMIN'] },
    { id: 'teachers' as ActiveTab, label: 'Gestión Docentes', short: 'Docentes', icon: Key, badge: 'Credenciales', primary: false, roles: ['ADMIN'] },
    { id: 'cards' as ActiveTab, label: 'Generador de Carnés PDF', short: 'Carnés', icon: CreditCard, badge: 'CR80 PVC', primary: false, roles: ['ADMIN'] },
    { id: 'teacher' as ActiveTab, label: 'Portal Docente (Aula)', short: 'Aula', icon: BookOpen, badge: 'Clases', primary: true, roles: ['DOCENTE'] },
    { id: 'ai-grades' as ActiveTab, label: 'Analítica e IA por Grado', short: 'IA', icon: BrainCircuit, badge: 'IA Global', primary: false, roles: ['ADMIN', 'DOCENTE'] },
    { id: 'portal' as ActiveTab, label: 'Portal Estudiante / Acudiente', short: 'Portal', icon: UserCheck, badge: 'Consulta', primary: false, roles: ['ESTUDIANTE_ACUDIENTE'] },
  ];

  const visibleNavItems = navItems.filter(item => item.roles.includes(currentRole));

  const roleConfig = {
    ADMIN: { label: 'Rectoría / Admin', icon: Shield, color: 'bg-purple-50 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300 border-purple-200 dark:border-purple-800' },
    DOCENTE: { label: 'Docente (Aula)', icon: BookOpen, color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' },
    ESTUDIANTE_ACUDIENTE: { label: 'Estudiante / Acudiente', icon: GraduationCap, color: 'bg-sky-50 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300 border-sky-200 dark:border-sky-800' },
  };

  // If user is not authenticated, render Login Screen
  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-slate-100 flex flex-col antialiased selection:bg-indigo-500 selection:text-white transition-colors duration-200">
      {/* Modern Top Header / Linear Style Navigation */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl border-b border-slate-200/80 dark:border-zinc-800/50">
        {/* Ronda 25 (P5.1): fluido en lg+ — a 1440px el max-w-7xl exprimía el nombre del
            colegio ~30px (medido: client 307 vs scroll 330); el truncado sigue como red
            de seguridad en pantallas menores y para nombres más largos. */}
        <div className="max-w-7xl lg:max-w-none mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo & School Identity */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/25 shrink-0">
              <School className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {/* Ronda 25 (P5.1): el nombre completo cabe en pantallas grandes (lg) sin
                    recortarse; el truncado sigue protegiendo móviles/tablets. */}
                <h1 className="text-sm sm:text-base font-black tracking-tight text-slate-900 dark:text-white truncate max-w-[180px] sm:max-w-[280px] md:max-w-md lg:max-w-xl" title={settings.schoolName}>
                  {settings.schoolName}
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
                  2026
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden md:block truncate">
                Control Escolar • Horarios, Aula y Carnetización Criptográfica
              </p>
            </div>
          </div>

          {/* Clean Segmented Navigation & Role Switcher */}
          <div className="flex items-center gap-2">
            {/* Active Role Selector Badge ("Escudito") — R64 (Fix B): clickeable
                desde CUALQUIER rol MIENTRAS haya una sesión real de Rectoría debajo
                (vista previa): se puede volver a Rectoría o cambiar de identidad sin
                recargar. Los roles con sesión propia (docente/estudiante autenticados)
                quedan fijos a su identidad. */}
            {canOpenRoleSwitcher ? (
              <button
                data-testid="escudito"
                onClick={openRoleSwitcher}
                className={`px-3 py-1.5 rounded-2xl border text-xs font-bold transition-all flex items-center gap-1.5 ${roleConfig[currentRole].color} shadow-xs hover:opacity-90`}
                title="Cambiar Perfil de Usuario (Rectoría / Docente / Estudiante)"
              >
                {React.createElement(roleConfig[currentRole].icon, { className: 'w-3.5 h-3.5' })}
                <span className="hidden sm:inline">{roleConfig[currentRole].label}</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
            ) : (
              <div
                className={`px-3 py-1.5 rounded-2xl border text-xs font-bold flex items-center gap-1.5 ${roleConfig[currentRole].color} shadow-xs cursor-default`}
                title={`Rol activo: ${roleConfig[currentRole].label} (sesión autenticada)`}
              >
                {React.createElement(roleConfig[currentRole].icon, { className: 'w-3.5 h-3.5' })}
                <span className="hidden sm:inline">{roleConfig[currentRole].label}</span>
              </div>
            )}

              {/* Primary Action Buttons based on Role */}
            <div className="hidden lg:flex items-center bg-slate-100 dark:bg-slate-800/70 p-1 rounded-2xl border border-slate-200/80 dark:border-zinc-800/80">
              {visibleNavItems.slice(0, 4).map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`relative px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                      isActive
                        ? 'bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {/* Ronda 25 (P3-B/P5.1): etiqueta compacta en la barra segmentada */}
                    <span>{item.short ?? item.label}</span>
                    {/* Ronda 24: punto rojo distintivo — excusas esperando revisión (Rectoría) */}
                    {item.id === 'excuses' && pendingCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center ring-2 ring-slate-100 dark:ring-zinc-800 animate-pulse" aria-label={`${pendingCount} excusas pendientes`}>
                        {pendingCount > 9 ? '9+' : pendingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Dropdown Menu for All Visible Modules */}
            {visibleNavItems.length > 2 && (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className={`relative px-3 py-2 rounded-2xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                    isMenuOpen
                      ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                      : 'bg-white dark:bg-zinc-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-zinc-800/50 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">Módulos</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
                  {/* Ronda 24: el punto rojo vive también en el disparador del menú — visible mientras uno navega, sin abrir nada */}
                  {pendingCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center ring-2 ring-white dark:ring-zinc-900 shadow-sm animate-pulse" aria-label={`${pendingCount} excusas pendientes de revisión`}>
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                </button>

                {/* Floating Dropdown Drawer */}
                {isMenuOpen && (
                  <div className="absolute right-0 mt-2 w-72 p-2 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl z-50 animate-fadeIn space-y-1">
                    <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Módulos Disponibles ({roleConfig[currentRole].label})
                    </div>

                    {visibleNavItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          data-testid={`nav-${item.id}`}
                          onClick={() => {
                            setActiveTab(item.id);
                            setIsMenuOpen(false);
                          }}
                          className={`w-full p-2.5 rounded-2xl text-left flex items-center justify-between transition-all text-xs font-bold ${
                            isActive
                              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-indigo-500'}`} />
                            <span>{item.label}</span>
                            {/* Ronda 24: punto rojo junto al módulo Buzón de Justificaciones */}
                            {item.id === 'excuses' && pendingCount > 0 && (
                              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center animate-pulse" aria-label={`${pendingCount} excusas pendientes`}>
                                {pendingCount > 9 ? '9+' : pendingCount}
                              </span>
                            )}
                          </div>
                          <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${
                            isActive ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          }`}>
                            {item.badge}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* User Account & System Menu Dropdown */}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className={`p-1.5 sm:px-3 sm:py-1.5 rounded-2xl border text-xs font-bold transition-all flex items-center gap-2 ${
                  isUserMenuOpen
                    ? 'bg-slate-100 dark:bg-slate-800 border-indigo-400 text-indigo-600 dark:text-indigo-300'
                    : 'bg-white dark:bg-zinc-950 border-slate-200 dark:border-zinc-800/50 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 shadow-xs'
                }`}
                title="Menú de Usuario, Ajustes y Sesión"
              >
                <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center text-xs font-black shrink-0 shadow-xs">
                  {loggedUser.username[0]?.toUpperCase() || 'U'}
                </div>
                <div className="text-left hidden sm:block max-w-[120px] md:max-w-[150px]">
                  <p className="text-[11px] font-black truncate text-slate-900 dark:text-white leading-tight">
                    {loggedUser.username}
                  </p>
                  <p className="text-[9px] text-slate-400 font-medium truncate uppercase tracking-wider">
                    {roleConfig[currentRole].label}
                  </p>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Floating User & Settings Menu */}
              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-72 p-2.5 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl z-50 animate-fadeIn space-y-2">
                  {/* User Profile Header */}
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-black/70 border border-slate-100 dark:border-zinc-800/50 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Sesión Activa</span>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                        En Línea
                      </span>
                    </div>
                    <p className="text-xs font-black text-slate-900 dark:text-white truncate">
                      {loggedUser.username}
                    </p>
                    <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">
                      Rol: {roleConfig[currentRole].label}
                    </p>
                  </div>

                  {/* Settings & Preferences — Ronda 25 P4 (fix espejo): el cambio de rol vive SOLO en la píldora
                      de la barra (único camino); se retiró la entrada duplicada del menú de sesión junto con
                      su texto obsoleto "4 roles" ( UserRole = ADMIN | DOCENTE | ESTUDIANTE_ACUDIENTE ). */}
                  <div className="space-y-1 pt-1">
                    <button
                      onClick={toggleTheme}
                      className="w-full p-2 rounded-xl text-left flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {theme === 'light' ? <Moon className="w-4 h-4 text-indigo-500" /> : <Sun className="w-4 h-4 text-amber-400" />}
                        <span>Tema Visual</span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 capitalize">
                        {theme === 'light' ? 'Claro' : 'Oscuro'}
                      </span>
                    </button>

                    {/* Ronda 33 (M2): el autoservicio de contraseña opera sobre la cuenta REAL
                        de Firebase Auth del docente (hasFirebaseAccount): re-autenticación +
                        updatePassword + limpieza de mustChangePassword. Sin cuenta real el botón
                        no se muestra — jamás un flujo que no termina en un cambio verdadero. */}
                    {currentRole === 'DOCENTE' && loggedUser.teacher?.hasFirebaseAccount && (
                      <button
                        onClick={() => {
                          setShowChangePasswordModal(true);
                          setIsUserMenuOpen(false);
                        }}
                        className="w-full p-2 rounded-xl text-left flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Key className="w-4 h-4 text-emerald-500" />
                        <span>Cambiar Mi Contraseña</span>
                      </button>
                    )}

                    {currentRole === 'ADMIN' && (
                      <button
                        onClick={() => {
                          setShowSettingsModal(true);
                          setIsUserMenuOpen(false);
                        }}
                        className="w-full p-2 rounded-xl text-left flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <SettingsIcon className="w-4 h-4 text-purple-500" />
                          <span>Configuración & Motores IA</span>
                        </div>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 uppercase">
                          {settings.aiProvider || 'Groq'}
                        </span>
                      </button>
                    )}

                    {/* Ronda 29: reapertura manual de la guía de primer ingreso (no toca la bandera) */}
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        setIsTourManualReopen(true);
                        setShowWelcomeTour(true);
                      }}
                      className="w-full p-2 rounded-xl text-left flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      <span>Guía rápida</span>
                    </button>
                  </div>

                  {/* Sync Status Badge */}
                  <div className="p-2 rounded-xl bg-slate-50 dark:bg-black border border-slate-100 dark:border-zinc-800/50 text-[10px] text-slate-500 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Wifi className="w-3 h-3 text-emerald-500" />
                      <span>Cloudflare D1 & Sync</span>
                    </div>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">Activo</span>
                  </div>

                  {/* Secure Logout Action */}
                  <div className="pt-2 border-t border-slate-100 dark:border-zinc-800/50">
                    <button
                      onClick={handleLogout}
                      className="w-full p-2 rounded-xl text-left flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Cerrar Sesión</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Ronda 24: onboarding de notificaciones push (Rectoría y Portal) — el navegador exige gesto del usuario */}
      {(currentRole === 'ADMIN' || currentRole === 'ESTUDIANTE_ACUDIENTE') && (
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4">
          <PushOnboardingBanner variant={currentRole === 'ADMIN' ? 'rectoria' : 'portal'} />
        </div>
      )}

      {/* Main View Display */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'scan' && <ScanHubView />}
        {activeTab === 'students' && <StudentsManagerView currentRole={currentRole} onGenerateCard={() => setActiveTab('cards')} />}
        {activeTab === 'schedules' && <ScheduleBuilderView />}
        {activeTab === 'teachers' && <TeachersManagerView />}
        {activeTab === 'teacher' && <TeacherClassroomView teacher={loggedUser.teacher} teacherName={loggedUser.username} />}
        {activeTab === 'cards' && <CardsManagerView />}
        {activeTab === 'attendance' && <AttendanceReportsView currentRole={currentRole} reviewedBy={loggedUser.username} />}
        {activeTab === 'excuses' && <ExcusesInboxView reviewedBy={loggedUser.username} />}
        {activeTab === 'ai-grades' && <GradeAiSummaryView />}
        {activeTab === 'portal' && <StudentPortalView activeStudentCode={loggedUser.student?.code} onLogout={() => { if (currentRole !== 'ADMIN' && hasUnderlyingAdminSession) { switchRole('ADMIN'); } else { handleLogout(); } }} />}
      </main>

      {/* Ronda 29: Asistente de primer ingreso (una vez por perfil/dispositivo) */}
      {showWelcomeTour && (
        <FirstWelcomeTour
          role={currentRole}
          isManualReopen={isTourManualReopen}
          onClose={() => setShowWelcomeTour(false)}
          onNavigate={(tab) => {
            setShowWelcomeTour(false);
            setActiveTab(tab as ActiveTab);
          }}
        />
      )}

      {/* Role Selection Modal (Escudito) — R64 (Fix B/C): consolidación de la
          navegación. El Escudito es EL ÚNICO punto de cambio de identidad: elegir
          Docente o Estudiante abre un BUSCADOR de la persona concreta (antes
          impersonaba SIEMPRE al primer elemento del catálogo — "el estudiante
          genérico" del bug del propietario), y desde cualquier vista previa se
          puede VOLVER a Rectoría sin recargar ni cerrar sesión. Los accesos
          directos duplicados ("Portal Estudiante"/"Portal Docente (Aula)" en la
          navegación de Rectoría) fueron retirados (Fix C): solo el Escudito. */}
      {showRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-lg w-full space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="text-center space-y-1.5">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 mx-auto flex items-center justify-center font-black">
                <School className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                {rolePicker === 'DOCENTE' ? 'Elegir Docente' : rolePicker === 'ESTUDIANTE_ACUDIENTE' ? 'Elegir Estudiante / Acudiente' : 'Cambio Rápido de Perfil de Acceso'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {rolePicker
                  ? 'Busque por nombre, código o documento y seleccione la persona cuya vista desea abrir.'
                  : 'Cambie entre los perfiles de acceso institucional. Docente y Estudiante exigen elegir la persona concreta.'}
              </p>
            </div>

            {/* R69 (RC-8) — franja de estado del catálogo: visible en las dos
                pantallas del modal (selección de perfil y buscador), para que siempre
                se sepa de dónde viene la lista y si la nube respondió. */}
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold">
              <span className="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                {AttendanceStorageService.getStudents().length} estudiantes · {AttendanceStorageService.getTeachers().length} docentes · catálogo en la nube
              </span>
              {pickerRefreshing && (
                <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-zinc-700 animate-pulse">
                  Actualizando desde la nube…
                </span>
              )}
              {pickerNotice && !pickerRefreshing && (
                <span className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-black text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-zinc-800">
                  {pickerNotice}
                </span>
              )}
            </div>

            {!rolePicker && (
              <>
                {currentRole !== 'ADMIN' && hasUnderlyingAdminSession && (
                  <button
                    data-testid="escudito-volver-rectoria"
                    onClick={() => switchRole('ADMIN')}
                    className="w-full p-3.5 rounded-2xl border-2 border-purple-500 bg-purple-50/60 dark:bg-purple-950/40 text-left transition-all flex items-center justify-between shadow-md"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-300 flex items-center justify-center">
                        <ArrowLeft className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-slate-900 dark:text-white">Volver a Rectoría / Admin</h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Regresar a la administración completa (fin de la vista previa).</p>
                      </div>
                    </div>
                    <span className="text-[9px] font-black px-2 py-1 rounded-full bg-purple-600 text-white">ACTIVO AL SALIR</span>
                  </button>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* 1. Admin / Rectoría */}
                  {currentRole === 'ADMIN' ? (
                    <div className="p-4 rounded-2xl border-2 border-purple-500 bg-purple-50/50 dark:bg-purple-950/40 shadow-md ring-2 ring-purple-500/20 space-y-2">
                      <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-300 flex items-center justify-center">
                        <Shield className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-slate-900 dark:text-white">1. Rectoría / Admin</h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">Perfil activo: control total, directorio, horarios, carnés, reportes e IA.</p>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => switchRole('ADMIN')}
                      className="p-4 rounded-2xl border text-left transition-all space-y-2 border-slate-200 dark:border-zinc-800/50 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-black"
                    >
                      <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-300 flex items-center justify-center">
                        <Shield className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-slate-900 dark:text-white">1. Rectoría / Admin</h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">Control total, directorio, horarios, gestión docente, carnés CR80, reportes e IA.</p>
                      </div>
                    </button>
                  )}

                  {/* 2. Docente / Aula */}
                  <button
                    data-testid="escudito-rol-docente"
                    onClick={() => { setRolePicker('DOCENTE'); setPickerSearch(''); setPickerGrade('all'); }}
                    className={`p-4 rounded-2xl border text-left transition-all space-y-2 ${
                      currentRole === 'DOCENTE'
                        ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 shadow-md ring-2 ring-emerald-500/20'
                        : 'border-slate-200 dark:border-zinc-800/50 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-black'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-300 flex items-center justify-center">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-slate-900 dark:text-white">
                        2. Docente (Aula y Horarios)
                      </h4>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                        Llamado a lista por bloques, escáner en vivo y tarjetas QR. {currentRole === 'DOCENTE' ? '(perfil activo — elija otro docente para cambiar)' : 'Elija el docente concreto →'}
                      </p>
                    </div>
                  </button>

                  {/* 3. Estudiante / Acudiente */}
                  <button
                    data-testid="escudito-rol-estudiante"
                    onClick={() => { setRolePicker('ESTUDIANTE_ACUDIENTE'); setPickerSearch(''); setPickerGrade('all'); }}
                    className={`p-4 rounded-2xl border text-left transition-all space-y-2 ${
                      currentRole === 'ESTUDIANTE_ACUDIENTE'
                        ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/40 shadow-md ring-2 ring-sky-500/20'
                        : 'border-slate-200 dark:border-zinc-800/50 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-black'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-sky-100 dark:bg-sky-900/60 text-sky-600 dark:text-sky-300 flex items-center justify-center">
                      <GraduationCap className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-slate-900 dark:text-white">
                        3. Estudiante / Acudiente
                      </h4>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                        Historial de asistencia, carné digital y modo Representante. {currentRole === 'ESTUDIANTE_ACUDIENTE' ? '(perfil activo — elija otro estudiante para cambiar)' : 'Elija el estudiante concreto →'}
                      </p>
                    </div>
                  </button>
                </div>
              </>
            )}

            {rolePicker && (() => {
              /* R69 (RC-8) — LISTADO 100% DINÁMICO DEL CATÁLOGO.
                 Se re-lee el almacenamiento en cada render (el contador
                 `catalogVersion` garantiza que un pull produzca render) y la búsqueda
                 usa las mismas utilidades inteligentes del Directorio. Nada aquí está
                 hardcodeado: si la nube trae 230 estudiantes, el selector lista 230. */
              const isTeacherPicker = rolePicker === 'DOCENTE';
              const allStudents = AttendanceStorageService.getStudents().filter(Boolean) as Student[];
              const allTeachers = AttendanceStorageService.getTeachers().filter(Boolean) as Teacher[];
              const studentCatalog = AttendanceStorageService.getGradeCatalog();
              const query = pickerSearch;

              const students = allStudents
                .filter(s => matchesGradeFilter(s.grade, pickerGrade) && matchStudentFuzzy(s, query))
                .sort((a, b) =>
                  compareGrades(String(a.grade ?? ''), String(b.grade ?? '')) ||
                  `${a.lastName ?? ''} ${a.firstName ?? ''}`.localeCompare(`${b.lastName ?? ''} ${b.firstName ?? ''}`, 'es')
                );
              const teachers = allTeachers
                .filter(t => matchTeacherFuzzy(t, query))
                .sort((a, b) => String(a.fullName ?? '').localeCompare(String(b.fullName ?? ''), 'es'));

              const initials = (first?: string | null, last?: string | null) =>
                `${String(first ?? '?').trim().charAt(0) || '?'}${String(last ?? '').trim().charAt(0)}`.toUpperCase();

              return (
              <div className="space-y-3" data-catalog-version={catalogVersion}>
                {/* Estado del catálogo: de dónde vienen los datos y si la nube respondió */}
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold">
                  <span data-testid="escudito-catalogo" className="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    {isTeacherPicker ? `${allTeachers.length} docentes` : `${allStudents.length} estudiantes`} · catálogo en la nube
                  </span>
                  {pickerRefreshing && (
                    <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-zinc-700 animate-pulse">
                      Actualizando desde la nube…
                    </span>
                  )}
                  {pickerNotice && !pickerRefreshing && (
                    <span data-testid="escudito-aviso" className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-black text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-zinc-800">
                      {pickerNotice}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      autoFocus
                      data-testid="escudito-buscador"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder={isTeacherPicker ? 'Buscar docente por nombre, documento, correo o asignatura…' : 'Buscar estudiante por nombre, código, documento o curso…'}
                      aria-label={isTeacherPicker ? 'Buscar docente' : 'Buscar estudiante'}
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <button
                    data-testid="escudito-atras"
                    onClick={() => { setRolePicker(null); setPickerSearch(''); setPickerGrade('all'); }}
                    className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all flex items-center gap-1.5"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Atrás</span>
                  </button>
                </div>

                {/* Filtro por curso (sólo estudiantes): con la matrícula completa de
                    6°1 a 11°3 el buscador solo no basta en una exposición. */}
                {!isTeacherPicker && studentCatalog.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="escudito-grade" className="text-[10px] font-black uppercase text-slate-400">Curso</label>
                    <select
                      id="escudito-grade"
                      data-testid="escudito-grado"
                      value={pickerGrade}
                      onChange={(e) => setPickerGrade(e.target.value)}
                      className="flex-1 px-3 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="all">Todos los cursos ({allStudents.length})</option>
                      {studentCatalog.map(entry => (
                        <option key={entry.grade} value={entry.grade}>{gradeOptionLabel(entry)}</option>
                      ))}
                    </select>
                    <button
                      data-testid="escudito-actualizar"
                      onClick={() => void refreshCatalogFromCloud('escudito')}
                      disabled={pickerRefreshing}
                      title="Descargar el catálogo actualizado de la nube"
                      className="px-3 py-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-xl text-[10px] font-black hover:bg-indigo-100 transition-all disabled:opacity-50"
                    >
                      {pickerRefreshing ? 'Actualizando…' : 'Actualizar'}
                    </button>
                  </div>
                )}

                {isTeacherPicker ? (
                  teachers.length === 0 ? (
                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 text-xs text-slate-500 text-center">
                      {allTeachers.length === 0
                        ? 'El catálogo no tiene docentes en este dispositivo. Descargue los datos de la nube (Pull) o regístrelos en Gestión Docentes.'
                        : 'Ningún docente coincide con la búsqueda. Pruebe sin tildes o por correo/asignatura.'}
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                      {teachers.map((t) => (
                        <button
                          key={t.id}
                          data-testid={`escudito-docente-${t.id}`}
                          onClick={() => switchRole('DOCENTE', { teacher: t })}
                          className={`w-full p-3 rounded-2xl border text-left transition-all flex items-center justify-between ${
                            loggedUser.teacher?.id === t.id
                              ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/40'
                              : 'border-slate-200 dark:border-zinc-800/50 hover:border-emerald-300 dark:hover:border-emerald-800 bg-white dark:bg-black hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-black text-xs shrink-0">
                              {initials(String(t.fullName ?? '').split(' ')[0], String(t.fullName ?? '').split(' ').slice(1).join(' '))}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-black text-slate-900 dark:text-white truncate">{t.fullName}</p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                {(t.subjects || []).slice(0, 3).join(' · ') || 'Sin asignaturas'}
                                {(t.assignedGrades || []).length > 0 ? ` · ${(t.assignedGrades || []).slice(0, 3).join(', ')}` : ''}
                                {t.isGroupDirector ? ' · ⭐ Dirección de Grupo' : ''}
                              </p>
                            </div>
                          </div>
                          {loggedUser.teacher?.id === t.id && (
                            <span className="text-[9px] font-black px-2 py-1 rounded-full bg-emerald-600 text-white shrink-0">ACTIVO</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )
                ) : students.length === 0 ? (
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 text-xs text-slate-500 text-center">
                    {allStudents.length === 0
                      ? 'El catálogo no tiene estudiantes en este dispositivo. Descargue los datos de la nube (Pull) o matricule en el Directorio.'
                      : pickerGrade !== 'all' && !query.trim()
                        ? `El curso ${pickerGrade} no tiene estudiantes en el catálogo descargado. Elija otro curso o actualice desde la nube.`
                        : 'Ningún estudiante coincide con la búsqueda. Pruebe sin tildes, por código o por documento.'}
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {students.map((s) => (
                      <button
                        key={s.code}
                        data-testid={`escudito-estudiante-${s.code}`}
                        onClick={() => switchRole('ESTUDIANTE_ACUDIENTE', { student: s })}
                        className={`w-full p-3 rounded-2xl border text-left transition-all flex items-center justify-between ${
                          loggedUser.student?.code === s.code
                            ? 'border-sky-500 bg-sky-50/60 dark:bg-sky-950/40'
                            : 'border-slate-200 dark:border-zinc-800/50 hover:border-sky-300 dark:hover:border-sky-800 bg-white dark:bg-black hover:bg-sky-50/40 dark:hover:bg-sky-950/20'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 flex items-center justify-center font-black text-xs shrink-0">
                            {initials(s.firstName, s.lastName)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-black text-slate-900 dark:text-white truncate">
                              {s.firstName} {s.lastName} {s.isRepresentative && <span title="Representante de salón">★</span>}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-mono">
                              {canonicalGrade(s.grade) ?? s.grade} · {s.code}
                              {s.hasFirebaseAccount ? ' · cuenta activa' : ''}
                            </p>
                          </div>
                        </div>
                        {loggedUser.student?.code === s.code && (
                          <span className="text-[9px] font-black px-2 py-1 rounded-full bg-sky-600 text-white shrink-0">ACTIVO</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              );
            })()}

            <div className="flex justify-end">
              <button
                onClick={() => { setShowRoleModal(false); setRolePicker(null); setPickerSearch(''); setPickerGrade('all'); setPickerNotice(null); }}
                className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold hover:bg-slate-200 transition-all"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de cambio de contraseña — Ronda 33 (M2): autoservicio real con cuenta
          Firebase (re-autenticación + updatePassword). El botón del menú exige
          hasFirebaseAccount y este segundo guard defiende en profundidad. En modo
          forzado (primer ingreso) no se puede cerrar sin completar el cambio. */}
      {showChangePasswordModal && loggedUser.teacher && (
        <ChangePasswordModal
          onClose={() => {
            setShowChangePasswordModal(false);
            setForcedPasswordChange(false);
          }}
          teacher={loggedUser.teacher}
          role="DOCENTE"
          username={loggedUser.username || 'Usuario'}
          forced={forcedPasswordChange}
        />
      )}

      {/* Modern Compact Footer */}
      <footer className="border-t border-slate-200 dark:border-zinc-800/50 py-4 bg-white/50 dark:bg-black/50 text-[11px] text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            <strong>{settings.schoolName}:</strong> Terminal de asistencia por lector óptico y carné escolar CR80 con firma HMAC-SHA256.
          </div>
          <div className="font-mono text-[10px]">
            Soporte 100% Offline • Ley 1581
          </div>
        </div>
      </footer>

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal onClose={() => setShowSettingsModal(false)} />
      )}
    </div>
  );
}
