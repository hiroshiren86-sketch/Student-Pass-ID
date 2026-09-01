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
  Wifi,
  ExternalLink,
  BookOpen,
  UserCheck2,
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
import { LoginScreen } from './components/LoginScreen';
import { SettingsModal } from './components/SettingsModal';
import { useTheme } from './context/ThemeContext';
import { SchoolSettings, Student, Teacher, UserRole } from './types/attendance';
import { AttendanceStorageService } from './services/attendanceStorage';
import { CloudflareSyncService } from './services/cloudflareSync';

export type ActiveTab = 'scan' | 'students' | 'teachers' | 'schedules' | 'cards' | 'attendance' | 'ai-grades' | 'teacher' | 'portal';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [currentRole, setCurrentRole] = useState<UserRole>('ADMIN');
  const [activeTab, setActiveTab] = useState<ActiveTab>('students');
  const [loggedUser, setLoggedUser] = useState<{ teacher?: Teacher; student?: Student; username: string }>({
    username: 'Rectoría / Administrador General'
  });

  const { theme, toggleTheme } = useTheme();
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    AttendanceStorageService.ensureActiveTemplateConsistency(); // Ronda 8 (B4): realinea plantilla activa vs slots
    AttendanceStorageService.initCloudSettingsSync();
    CloudflareSyncService.initAutoSync();
    const unsubscribe = AttendanceStorageService.subscribe(() => {
      setSettings(AttendanceStorageService.getSettings());
    });
    return unsubscribe;
  }, []);

  // Ronda 4 (F3): Cierre Automático de Jornada — evaluación perezosa e idempotente cada 60s.
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await AttendanceStorageService.maybeAutoCloseDay();
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

  // Handle successful login
  const handleLoginSuccess = (role: UserRole, userPayload?: { teacher?: Teacher; student?: Student; username: string }) => {
    setCurrentRole(role);
    setIsAuthenticated(true);
    if (userPayload) {
      setLoggedUser(userPayload);
    } else {
      setLoggedUser({ username: role });
    }

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
    setIsAuthenticated(false);
  };

  // Set default active tab when role changes from in-app switcher (Admin only)
  const switchRole = (role: UserRole) => {
    setCurrentRole(role);
    setShowRoleModal(false);
    setIsUserMenuOpen(false);
    if (role === 'DOCENTE') {
      setActiveTab('teacher');
      const firstTeacher = AttendanceStorageService.getTeachers()[0];
      setLoggedUser({ teacher: firstTeacher, username: firstTeacher?.fullName || 'Prof. Juan Pablo Pérez' });
    } else if (role === 'ESTUDIANTE_ACUDIENTE') {
      setActiveTab('portal');
      const firstStudent = AttendanceStorageService.getStudents()[0];
      setLoggedUser({ student: firstStudent, username: `${firstStudent?.firstName} ${firstStudent?.lastName}` });
    } else if (role === 'ADMIN') {
      setActiveTab('students');
      setLoggedUser({ username: 'Rectoría / Administrador General' });
    }
  };

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

  const navItems = [
    { id: 'scan' as ActiveTab, label: 'Escanear Asistencia', icon: ScanLine, badge: 'En vivo', primary: true, roles: ['ADMIN', 'DOCENTE'] },
    { id: 'students' as ActiveTab, label: 'Directorio Estudiantes', icon: Users, badge: 'Matrícula', primary: true, roles: ['ADMIN', 'DOCENTE'] },
    { id: 'schedules' as ActiveTab, label: 'Horarios Escolares', icon: Calendar, badge: 'Plantillas', primary: true, roles: ['ADMIN'] },
    { id: 'teachers' as ActiveTab, label: 'Gestión Docentes', icon: Key, badge: 'Credenciales', primary: false, roles: ['ADMIN'] },
    { id: 'teacher' as ActiveTab, label: 'Portal Docente (Aula)', icon: BookOpen, badge: 'Clases', primary: true, roles: ['ADMIN', 'DOCENTE'] },
    { id: 'cards' as ActiveTab, label: 'Generador de Carnés PDF', icon: CreditCard, badge: 'CR80 PVC', primary: false, roles: ['ADMIN'] },
    { id: 'attendance' as ActiveTab, label: 'Planilla de Asistencia', icon: FileSpreadsheet, badge: 'Reportes', primary: false, roles: ['ADMIN', 'DOCENTE'] },
    { id: 'ai-grades' as ActiveTab, label: 'Analítica e IA por Grado', icon: BrainCircuit, badge: 'IA Global', primary: false, roles: ['ADMIN', 'DOCENTE'] },
    { id: 'portal' as ActiveTab, label: 'Portal Estudiante / Acudiente', icon: UserCheck, badge: 'Consulta', primary: false, roles: ['ADMIN', 'ESTUDIANTE_ACUDIENTE'] },
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col antialiased selection:bg-indigo-500 selection:text-white transition-colors duration-200">
      {/* Modern Top Header / Linear Style Navigation */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo & School Identity */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/25 shrink-0">
              <School className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-black tracking-tight text-slate-900 dark:text-white truncate max-w-[180px] sm:max-w-[280px] md:max-w-md" title={settings.schoolName}>
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
            {/* Active Role Selector Badge (Admin can switch; other roles locked to authenticated account) */}
            {currentRole === 'ADMIN' ? (
              <button
                onClick={() => setShowRoleModal(true)}
                className={`px-3 py-1.5 rounded-2xl border text-xs font-bold transition-all flex items-center gap-1.5 ${roleConfig[currentRole].color} shadow-xs hover:opacity-90`}
                title="Cambiar Perfil de Usuario (Rectoría / Docente / Portería / Estudiante)"
              >
                {React.createElement(roleConfig[currentRole].icon, { className: 'w-3.5 h-3.5' })}
                <span className="hidden sm:inline">{roleConfig[currentRole].label}</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
            ) : (
              <div
                className={`px-3 py-1.5 rounded-2xl border text-xs font-bold flex items-center gap-1.5 ${roleConfig[currentRole].color} shadow-xs cursor-default`}
                title={`Rol activo: ${roleConfig[currentRole].label}`}
              >
                {React.createElement(roleConfig[currentRole].icon, { className: 'w-3.5 h-3.5' })}
                <span className="hidden sm:inline">{roleConfig[currentRole].label}</span>
              </div>
            )}

            {/* Primary Action Buttons based on Role */}
            <div className="hidden lg:flex items-center bg-slate-100 dark:bg-slate-800/70 p-1 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
              {visibleNavItems.slice(0, 4).map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                      isActive
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Dropdown Menu for All Visible Modules */}
            {visibleNavItems.length > 2 && (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className={`px-3 py-2 rounded-2xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                    isMenuOpen
                      ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">Módulos</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Floating Dropdown Drawer */}
                {isMenuOpen && (
                  <div className="absolute right-0 mt-2 w-72 p-2 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl z-50 animate-fadeIn space-y-1">
                    <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Módulos Disponibles ({roleConfig[currentRole].label})
                    </div>

                    {visibleNavItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
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
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 shadow-xs'
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
                <div className="absolute right-0 mt-2 w-72 p-2.5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl z-50 animate-fadeIn space-y-2">
                  {/* User Profile Header */}
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-100 dark:border-slate-800 space-y-1">
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

                  {/* Settings & Preferences */}
                  <div className="space-y-1 pt-1">
                    {currentRole === 'ADMIN' && (
                      <button
                        onClick={() => {
                          setShowRoleModal(true);
                          setIsUserMenuOpen(false);
                        }}
                        className="w-full p-2 rounded-xl text-left flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <UserCheck2 className="w-4 h-4 text-indigo-500" />
                          <span>Cambiar Rol / Perfil</span>
                        </div>
                        <span className="text-[10px] text-slate-400">4 roles</span>
                      </button>
                    )}

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
                  </div>

                  {/* Sync Status Badge */}
                  <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Wifi className="w-3 h-3 text-emerald-500" />
                      <span>Cloudflare D1 & Sync</span>
                    </div>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">Activo</span>
                  </div>

                  {/* Secure Logout Action */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
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

      {/* Main View Display */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'scan' && <ScanHubView />}
        {activeTab === 'students' && <StudentsManagerView currentRole={currentRole} onGenerateCard={() => setActiveTab('cards')} />}
        {activeTab === 'schedules' && <ScheduleBuilderView />}
        {activeTab === 'teachers' && <TeachersManagerView />}
        {activeTab === 'teacher' && <TeacherClassroomView teacher={loggedUser.teacher} teacherName={loggedUser.username} />}
        {activeTab === 'cards' && <CardsManagerView />}
        {activeTab === 'attendance' && <AttendanceReportsView />}
        {activeTab === 'ai-grades' && <GradeAiSummaryView />}
        {activeTab === 'portal' && <StudentPortalView activeStudentCode={loggedUser.student?.code} />}
      </main>

      {/* Role Selection Modal (Accessible by Admin) */}
      {showRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full space-y-6">
            <div className="text-center space-y-1.5">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 mx-auto flex items-center justify-center font-black">
                <School className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                Cambio Rápido de Perfil de Acceso
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Cambie instantáneamente entre los 3 perfiles de acceso institucional.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 1. Admin / Rectoría */}
              <button
                onClick={() => switchRole('ADMIN')}
                className={`p-4 rounded-2xl border text-left transition-all space-y-2 ${
                  currentRole === 'ADMIN'
                    ? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/40 shadow-md ring-2 ring-purple-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-950'
                }`}
              >
                <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-300 flex items-center justify-center">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-900 dark:text-white">
                    1. Rectoría / Admin
                  </h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    Control total, directorio, horarios, gestión docente, carnés CR80, reportes e IA.
                  </p>
                </div>
              </button>

              {/* 2. Docente / Aula */}
              <button
                onClick={() => switchRole('DOCENTE')}
                className={`p-4 rounded-2xl border text-left transition-all space-y-2 ${
                  currentRole === 'DOCENTE'
                    ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 shadow-md ring-2 ring-emerald-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-950'
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
                    Llamado a lista por bloques, escáner en vivo, subrol de Director de Grupo y Representantes.
                  </p>
                </div>
              </button>

              {/* 3. Estudiante / Acudiente */}
              <button
                onClick={() => switchRole('ESTUDIANTE_ACUDIENTE')}
                className={`p-4 rounded-2xl border text-left transition-all space-y-2 ${
                  currentRole === 'ESTUDIANTE_ACUDIENTE'
                    ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/40 shadow-md ring-2 ring-sky-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-950'
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
                    Consulta individual de historial de asistencia, asignaturas y modo Representante de Salón.
                  </p>
                </div>
              </button>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowRoleModal(false)}
                className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold hover:bg-slate-200 transition-all"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modern Compact Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800/80 py-4 bg-white/50 dark:bg-slate-950/50 text-[11px] text-slate-500">
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
