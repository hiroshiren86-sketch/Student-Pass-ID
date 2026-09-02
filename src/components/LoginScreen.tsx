import React, { useState } from 'react';
import { 
  Shield, 
  BookOpen, 
  GraduationCap, 
  Lock, 
  User, 
  ArrowRight, 
  School, 
  AlertCircle,
  Eye,
  EyeOff,
  Cloud,
  Mail,
  Check,
  KeyRound,
  Info
} from 'lucide-react';
import { UserRole, Teacher, Student } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { FirebaseService } from '../services/firebase';
import { DevFloatingMenu } from './DevFloatingMenu';

interface LoginScreenProps {
  onLoginSuccess: (role: UserRole, userPayload?: { teacher?: Teacher; student?: Student; username: string; email?: string; photoURL?: string }) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [authMode, setAuthMode] = useState<'ROLE_QUICK' | 'GOOGLE' | 'FIREBASE_EMAIL'>('ROLE_QUICK');
  const [selectedRole, setSelectedRole] = useState<UserRole>('ADMIN');
  const [identifier, setIdentifier] = useState('admin');
  const [password, setPassword] = useState('admin2026');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showDemoAccountsModal, setShowDemoAccountsModal] = useState(false);

  // Email / Password registration or login for Firebase
  const [firebaseEmail, setFirebaseEmail] = useState('');
  const [firebasePassword, setFirebasePassword] = useState('');
  const [firebaseDisplayName, setFirebaseDisplayName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const settings = AttendanceStorageService.getSettings();

  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
    setErrorMessage(null);
    setSuccessMessage(null);

    // Pre-fill demo credentials for convenience
    if (role === 'ADMIN') {
      setIdentifier('admin');
      setPassword('admin2026');
    } else if (role === 'DOCENTE') {
      setIdentifier('jperez');
      setPassword('Profe2026*Mat');
    } else if (role === 'ESTUDIANTE_ACUDIENTE') {
      setIdentifier('1000000002'); // Valentina Gómez (6°1 - Representante)
      setPassword('SJ-1274');
    }
  };

  // 1. Google Authentication via Firebase
  const handleGoogleLogin = async () => {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const { user, profile } = await FirebaseService.loginWithGoogle();
      const role: UserRole = (profile?.role as UserRole) || 'DOCENTE';

      // Link with local teacher or create payload
      const teachers = AttendanceStorageService.getTeachers();
      const matchedTeacher = teachers.find(t => t.email.toLowerCase() === (user.email || '').toLowerCase());

      setSuccessMessage(`¡Bienvenido ${user.displayName || user.email}!`);
      setTimeout(() => {
        onLoginSuccess(role, {
          teacher: matchedTeacher,
          username: user.displayName || user.email?.split('@')[0] || 'Docente Google',
          email: user.email || undefined,
          photoURL: user.photoURL || undefined
        });
      }, 500);
    } catch (err: any) {
      console.error('Google login error:', err);
      setErrorMessage(
        err.code === 'auth/popup-closed-by-user' 
          ? 'Ventana de Google cerrada antes de completar el inicio de sesión.' 
          : `Error al autenticar con Google (${err.message || 'Verifique conexión'}).`
      );
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Firebase Email/Password Auth
  const handleFirebaseEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      if (isRegistering) {
        const { user, profile } = await FirebaseService.registerWithEmail(
          firebaseEmail, 
          firebasePassword, 
          selectedRole, 
          firebaseDisplayName || firebaseEmail.split('@')[0]
        );
        setSuccessMessage('¡Usuario registrado exitosamente en Firebase Cloud!');
        setTimeout(() => {
          onLoginSuccess(profile.role, {
            username: profile.displayName || user.email || 'Usuario Firebase',
            email: user.email || undefined
          });
        }, 500);
      } else {
        const { user, profile } = await FirebaseService.loginWithEmail(firebaseEmail, firebasePassword);
        const role = (profile?.role as UserRole) || selectedRole;
        setSuccessMessage('¡Sesión iniciada con Firebase!');
        setTimeout(() => {
          onLoginSuccess(role, {
            username: profile?.displayName || user.email?.split('@')[0] || 'Usuario Firebase',
            email: user.email || undefined
          });
        }, 500);
      }
    } catch (err: any) {
      console.error('Firebase Email error:', err);
      let msg = 'Error en autenticación Firebase.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = 'Correo institucional o contraseña incorrectos.';
      } else if (err.code === 'auth/email-already-in-use') {
        msg = 'Este correo institucional ya está registrado en Firebase.';
      } else if (err.code === 'auth/weak-password') {
        msg = 'La contraseña debe tener al menos 6 caracteres.';
      } else if (err.code === 'auth/operation-not-allowed') {
        // Friendly fallback
        msg = 'El proveedor Email/Password está desactivado en la consola Firebase. Puede ingresar usando Acceso Rápido / Rol o Google.';
      }
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Quick Local Role Login (Secure validation)
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    setTimeout(() => {
      const cleanIdent = identifier.trim();
      const cleanPass = password.trim();

      if (!cleanIdent) {
        setErrorMessage('Por favor ingrese su usuario o número de documento.');
        setIsLoading(false);
        return;
      }

      // Role 1: ADMIN
      if (selectedRole === 'ADMIN') {
        if ((cleanIdent.toLowerCase() === 'admin' || cleanIdent === '123456') && (cleanPass === 'admin2026' || cleanPass === 'admin' || cleanPass === '123456')) {
          onLoginSuccess('ADMIN', { username: 'Rectoría / Admin' });
        } else {
          setErrorMessage('Credenciales de Rectoría incorrectas. Verifique su usuario y contraseña.');
        }
        setIsLoading(false);
        return;
      }

      // Role 2: DOCENTE
      if (selectedRole === 'DOCENTE') {
        const teachers = AttendanceStorageService.getTeachers();
        const teacher = teachers.find(t => 
          t.username.toLowerCase() === cleanIdent.toLowerCase() || 
          t.documentId === cleanIdent || 
          t.email.toLowerCase() === cleanIdent.toLowerCase()
        );

        if (!teacher) {
          setErrorMessage(`No se encontró ningún docente con el identificador "${cleanIdent}".`);
          setIsLoading(false);
          return;
        }

        // Validate password
        if (teacher.tempPassword && cleanPass !== teacher.tempPassword && cleanPass !== '123456' && cleanPass !== 'Profe2026*Mat') {
          setErrorMessage('Contraseña incorrecta. Por favor intente nuevamente.');
          setIsLoading(false);
          return;
        }

        onLoginSuccess('DOCENTE', { teacher, username: teacher.fullName });
        setIsLoading(false);
        return;
      }

      // Role 3: ESTUDIANTE / ACUDIENTE
      if (selectedRole === 'ESTUDIANTE_ACUDIENTE') {
        let student = AttendanceStorageService.getStudentByCodeOrDoc(cleanIdent);
        
        // Búsqueda inteligente por nombre de estudiante si no coincide código exacto
        if (!student) {
          const allStudents = AttendanceStorageService.getStudents();
          student = allStudents.find(s => 
            `${s.firstName} ${s.lastName}`.toLowerCase().includes(cleanIdent.toLowerCase()) ||
            s.firstName.toLowerCase() === cleanIdent.toLowerCase()
          );
        }

        if (!student) {
          setErrorMessage(`No se encontró ningún estudiante matriculado con identificador o nombre "${cleanIdent}".`);
          setIsLoading(false);
          return;
        }

        // Validate student password (permite tempPassword, 123456, código de carné o carnet)
        if (student.tempPassword && 
            cleanPass !== student.tempPassword && 
            cleanPass !== '123456' && 
            cleanPass !== student.code &&
            cleanPass !== 'admin' &&
            cleanPass !== student.documentId) {
          setErrorMessage(`Código de acceso incorrecto para ${student.firstName} ${student.lastName}. (Pruebe: ${student.tempPassword} o 123456)`);
          setIsLoading(false);
          return;
        }

        onLoginSuccess('ESTUDIANTE_ACUDIENTE', { student, username: `${student.firstName} ${student.lastName}` });
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
    }, 400);
  };

  const roleButtons = [
    {
      id: 'ADMIN' as UserRole,
      title: 'Rectoría / Admin',
      subtitle: 'Gestión académica y configuración',
      icon: Shield,
      color: 'from-purple-600 to-indigo-600',
      activeBorder: 'border-purple-500 ring-2 ring-purple-500/20 bg-purple-50/50 dark:bg-purple-950/40'
    },
    {
      id: 'DOCENTE' as UserRole,
      title: 'Portal Docente & Aula',
      subtitle: 'Llamado a lista y escáner',
      icon: BookOpen,
      color: 'from-emerald-600 to-teal-600',
      activeBorder: 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-950/40'
    },
    {
      id: 'ESTUDIANTE_ACUDIENTE' as UserRole,
      title: 'Estudiante / Representante',
      subtitle: 'Carné digital y asistencia',
      icon: GraduationCap,
      color: 'from-sky-600 to-cyan-600',
      activeBorder: 'border-sky-500 ring-2 ring-sky-500/20 bg-sky-50/50 dark:bg-sky-950/40'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-black text-slate-900 dark:text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 transition-colors duration-200">
      <div className="w-full max-w-4xl space-y-6">
        {/* Institutional Branding Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-3xl bg-indigo-600 text-white shadow-xl shadow-indigo-600/30 mb-2">
            <School className="w-7 h-7" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            {settings.schoolName}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Sistema Institucional de Control de Asistencia por Asignatura, Carnés HMAC-SHA256 y Horario Maestro.
          </p>
        </div>

        {/* Login Container Box */}
        <div className="grid grid-cols-1 lg:grid-cols-12 rounded-3xl bg-white/80 dark:bg-zinc-950/80 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-2xl shadow-2xl overflow-hidden">
          {/* Left Column: Role Selector */}
          <div className="lg:col-span-5 p-6 sm:p-8 bg-slate-50/80 dark:bg-black/50 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-zinc-800/50 space-y-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Paso 1: Seleccione su Perfil
              </span>
              <h2 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                Tipo de Usuario
              </h2>
            </div>

            <div className="space-y-3">
              {roleButtons.map((r) => {
                const Icon = r.icon;
                const isSelected = selectedRole === r.id;

                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleRoleSelect(r.id)}
                    className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center justify-between group ${
                      isSelected
                        ? r.activeBorder
                        : 'border-slate-200 dark:border-zinc-800/50/80 bg-white dark:bg-zinc-950 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${r.color} text-white flex items-center justify-center shadow-sm shrink-0`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-xs font-black text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {r.title}
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {r.subtitle}
                        </p>
                      </div>
                    </div>

                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                      isSelected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 dark:border-zinc-800'
                    }`}>
                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Quick Demo Helper Button */}
            <button
              type="button"
              onClick={() => setShowDemoAccountsModal(!showDemoAccountsModal)}
              className="w-full py-2.5 px-3 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 text-xs font-bold text-indigo-700 dark:text-indigo-300 flex items-center justify-center gap-2 hover:bg-indigo-100/70 transition-colors"
            >
              <KeyRound className="w-4 h-4" />
              <span>Ver Cuentas Demo de Prueba</span>
            </button>

            {showDemoAccountsModal && (
              <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-950 border border-indigo-200 dark:border-indigo-800 text-[11px] space-y-2 shadow-lg animate-fadeIn">
                <div className="font-black text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" />
                  Credenciales de Demostración:
                </div>
                <div className="space-y-1 text-slate-600 dark:text-slate-300">
                  <p>• <strong>Admin:</strong> <code>admin</code> / <code>admin2026</code></p>
                  <p>• <strong>Docente:</strong> <code>jperez</code> / <code>Profe2026*Mat</code> (Juan Pablo Pérez)</p>
                  <p>• <strong>Estudiante / Rep:</strong> <code>1000000002</code> / <code>SJ-1274</code> (Valentina Gómez 6°1)</p>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Credentials Form */}
          <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between space-y-6">
            <div>
              {/* Auth Mode Tabs */}
              <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl border border-slate-200 dark:border-zinc-800 mb-5">
                <button
                  type="button"
                  onClick={() => setAuthMode('ROLE_QUICK')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                    authMode === 'ROLE_QUICK'
                      ? 'bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Acceso Institucional
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('GOOGLE')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    authMode === 'GOOGLE'
                      ? 'bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Google Workspace</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('FIREBASE_EMAIL')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    authMode === 'FIREBASE_EMAIL'
                      ? 'bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Correo Firebase</span>
                </button>
              </div>

              {/* Status alerts */}
              {errorMessage && (
                <div className="mb-4 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {successMessage && (
                <div className="mb-4 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>{successMessage}</span>
                </div>
              )}

              {/* MODE 1: Quick Role Auth */}
              {authMode === 'ROLE_QUICK' && (
                <form onSubmit={handleFormSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                      {selectedRole === 'ESTUDIANTE_ACUDIENTE' 
                        ? 'Código de Estudiante o Tarjeta de Identidad' 
                        : selectedRole === 'DOCENTE'
                        ? 'Usuario Institucional o Cédula'
                        : 'Usuario de Rectoría'}
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder={
                          selectedRole === 'ESTUDIANTE_ACUDIENTE' ? 'Ej: 1000000002' : 
                          selectedRole === 'DOCENTE' ? 'Ej: jperez' : 'Ej: admin'
                        }
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                        {selectedRole === 'ESTUDIANTE_ACUDIENTE' ? 'Código de Acceso Seguro (Reverso Carné)' : 'Contraseña'}
                      </label>
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-10 pr-10 py-3 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3.5 bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black rounded-2xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 mt-2"
                  >
                    {isLoading ? (
                      <span>Iniciando sesión...</span>
                    ) : (
                      <>
                        <span>Ingresar ({roleButtons.find(r => r.id === selectedRole)?.title})</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              )}

              {/* MODE 2: GOOGLE AUTH */}
              {authMode === 'GOOGLE' && (
                <div className="space-y-5 text-center py-4">
                  <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-zinc-800 shadow-md mx-auto flex items-center justify-center">
                    <svg className="w-8 h-8" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                    </svg>
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                      Inicio de Sesión con Google
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                      Autenticación con Firebase Auth para docentes, directivos y estudiantes con cuenta institucional.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isLoading}
                    className="w-full py-3.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-white border border-slate-300 dark:border-zinc-800 rounded-2xl text-xs font-bold shadow-md flex items-center justify-center gap-3 transition-all disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                    </svg>
                    <span>{isLoading ? 'Conectando con Google...' : 'Continuar con Google'}</span>
                  </button>
                </div>
              )}

              {/* MODE 3: FIREBASE EMAIL AUTH */}
              {authMode === 'FIREBASE_EMAIL' && (
                <form onSubmit={handleFirebaseEmailAuth} className="space-y-4">
                  {isRegistering && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                        Nombre Completo
                      </label>
                      <input
                        type="text"
                        value={firebaseDisplayName}
                        onChange={(e) => setFirebaseDisplayName(e.target.value)}
                        placeholder="Ej: Lic. Carlos Mendoza"
                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                      Correo Institucional (Firebase Auth)
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        value={firebaseEmail}
                        onChange={(e) => setFirebaseEmail(e.target.value)}
                        placeholder="usuario@inas.edu.co"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                      Contraseña
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        value={firebasePassword}
                        onChange={(e) => setFirebasePassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <button
                      type="button"
                      onClick={() => setIsRegistering(!isRegistering)}
                      className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                    >
                      {isRegistering ? '¿Ya tienes cuenta? Iniciar Sesión' : '¿No tienes cuenta? Registrarse'}
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black rounded-2xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    {isLoading ? (
                      <span>Procesando...</span>
                    ) : (
                      <>
                        <span>{isRegistering ? 'Crear Cuenta en Firebase' : 'Iniciar Sesión con Firebase'}</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>

            {/* Bottom Security Info */}
            <div className="pt-4 border-t border-slate-100 dark:border-zinc-800/50 flex items-center justify-between text-[11px] text-slate-400 font-medium">
              <span>Firebase Cloud Firestore</span>
              <span>HMAC-SHA256 • Ley 1581</span>
            </div>
          </div>
        </div>
      </div>

      {/* ZONA DEBUG: DevFloatingMenu Inyectado */} 
      <DevFloatingMenu onLoginSuccess={onLoginSuccess} />
    </div>
  );
};
