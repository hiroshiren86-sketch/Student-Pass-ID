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
  EyeOff
} from 'lucide-react';
import { UserRole, Teacher, Student } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { FirebaseService } from '../services/firebase';

interface LoginScreenProps {
  onLoginSuccess: (role: UserRole, userPayload?: {
    teacher?: Teacher;
    student?: Student;
    username: string;
    uid?: string;
    email?: string;
    mustChangePassword?: boolean;
  }) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  // Ronda 33 (M1/M2/M3 — MISIÓN AUTH completa): los tres modos de acceso quedan
  // cableados de punta a punta contra Firebase Auth (proveedor Email/Password
  // habilitado y dominios autorizados verificados por API oficial):
  //  - Rectoría: correo + contraseña → Firebase Auth → users/{uid}.role === 'ADMIN'.
  //    La credencial embebida admin/admin2026 fue ELIMINADA del código.
  //  - Docente: correo institucional + contraseña → Firebase Auth → users/{uid}
  //    con role DOCENTE y linkedTeacherId que existe en la BD del dispositivo.
  //  - Estudiante/Acudiente: código + clave de acceso (verificación local endurecida
    //    Ronda 30; la migración a verificación server-side está documentada en
    //    docs/DESPLEGUE_FIREBASE.md — fase Worker).
  const [selectedRole, setSelectedRole] = useState<UserRole>('ADMIN');
  // Ronda 30 (H-30-2): el formulario nace VACÍO. Antes venía precargado con
  // admin/admin2026 — en producción, el navegador de cualquier dispositivo
  // mostraba la contraseña de Rectoría antes de escribir una sola tecla.
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const settings = AttendanceStorageService.getSettings();

  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
    // Ronda 30 (H-30-2): sin precarga de credenciales demo — cada perfil exige
    // escribir sus credenciales reales (Rectoría: admin/admin2026; Docente y
    // Estudiante: la tempPassword impresa/entregada por Rectoría).
    setErrorMessage(null);
  };

  // Acceso Institucional — Ronda 33: login real contra Firebase Auth (sin delays ficticios)
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    const cleanIdent = identifier.trim();
    const cleanPass = password;

    try {
      if (!cleanIdent) {
        setErrorMessage('Por favor ingrese sus credenciales completas.');
        setIsLoading(false);
        return;
      }

      // ===== Role 1: ADMIN — M1: verificación contra Firebase Auth + rol desde users/{uid} =====
      if (selectedRole === 'ADMIN') {
        if (!cleanIdent.includes('@')) {
          setErrorMessage('Rectoría ingresa con su CORREO institucional y su contraseña.');
          setIsLoading(false);
          return;
        }
        const { user, profile } = await FirebaseService.loginWithEmail(cleanIdent.toLowerCase(), cleanPass);
        if (!profile || profile.role !== 'ADMIN') {
          // Cuenta válida pero sin rol de Rectoría: se cierra la sesión abierta.
          await FirebaseService.logout();
          setErrorMessage('Esta cuenta no tiene rol de Rectoría. Use el portal correspondiente.');
          setIsLoading(false);
          return;
        }
        onLoginSuccess('ADMIN', {
          username: profile.displayName || cleanIdent.toLowerCase(),
          uid: user.uid,
          email: user.email || cleanIdent.toLowerCase()
        });
        setIsLoading(false);
        return;
      }

      // ===== Role 2: DOCENTE — M2: Firebase Auth + vinculación users/{uid}.linkedTeacherId =====
      if (selectedRole === 'DOCENTE') {
        if (!cleanIdent.includes('@')) {
          setErrorMessage('Los docentes ingresan con su CORREO institucional y su contraseña (la temporal la entrega Rectoría).');
          setIsLoading(false);
          return;
        }
        const { user, profile } = await FirebaseService.loginWithEmail(cleanIdent.toLowerCase(), cleanPass);
        if (!profile || profile.role !== 'DOCENTE' || !profile.linkedTeacherId) {
          await FirebaseService.logout();
          setErrorMessage('Esta cuenta no está vinculada a una ficha docente. Contacte a Rectoría.');
          setIsLoading(false);
          return;
        }
        const teacher = AttendanceStorageService.getTeachers().find(t => t.id === profile.linkedTeacherId);
        if (!teacher) {
          await FirebaseService.logout();
          setErrorMessage('Su cuenta es válida, pero este dispositivo aún no tiene su ficha docente. Pida a Rectoría sincronizar este dispositivo.');
          setIsLoading(false);
          return;
        }
        // Espejo local: la cuenta real quedó confirmada por el perfil en la nube.
        if (!teacher.hasFirebaseAccount || teacher.authEmail !== cleanIdent.toLowerCase()) {
          AttendanceStorageService.updateTeacher(teacher.id, {
            hasFirebaseAccount: true,
            authEmail: cleanIdent.toLowerCase(),
            authUid: user.uid
          });
          teacher.hasFirebaseAccount = true;
          teacher.authEmail = cleanIdent.toLowerCase();
          teacher.authUid = user.uid;
        }
        onLoginSuccess('DOCENTE', {
          teacher,
          username: teacher.fullName,
          uid: user.uid,
          email: user.email || cleanIdent.toLowerCase(),
          mustChangePassword: profile.mustChangePassword === true
        });
        setIsLoading(false);
        return;
      }

      // ===== Role 3: ESTUDIANTE / ACUDIENTE — M3: código + clave de acceso =====
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

        // Ronda 30 (H-30-2): solo la clave de acceso real (reverso del carné o la que
        // definió el acudiente). El error jamás revela la contraseña válida.
        if (!student.tempPassword || cleanPass !== student.tempPassword) {
          setErrorMessage(`Código de acceso incorrecto para ${student.firstName} ${student.lastName}. Verifique el código del reverso del carné o solicite uno nuevo en Rectoría.`);
          setIsLoading(false);
          return;
        }

        onLoginSuccess('ESTUDIANTE_ACUDIENTE', { student, username: `${student.firstName} ${student.lastName}` });
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
    } catch (err: any) {
      // M1/M2: mensajes honestos, mapeados y sin fugas (anti enumeración)
      setErrorMessage(FirebaseService.mapAuthError(err));
      setIsLoading(false);
    }
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
                        : 'border-slate-200 dark:border-zinc-800/50 bg-white dark:bg-zinc-950 hover:border-slate-300 dark:hover:border-slate-700'
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

            {/* Ronda 30 (H-30-2): el panel "Ver Cuentas Demo de Prueba" fue retirado —
                publicaba la contraseña de Rectoría y las credenciales de docentes y
                estudiantes en la propia pantalla de login. Las credenciales institucionales
                viven en el documento de entrega, no en la aplicación. */}
          </div>

          {/* Right Column: Credentials Form */}
          <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between space-y-6">
            <div>
              {/* Status alerts */}
              {errorMessage && (
                <div className="mb-4 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Acceso Institucional — Ronda 32 (M5): único modo de login */}
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Paso 2: Acceso Institucional
                  </span>
                  <h2 className="text-lg font-black text-slate-900 dark:text-white mt-0.5 mb-3">
                    Ingrese sus Credenciales
                  </h2>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                    {selectedRole === 'ESTUDIANTE_ACUDIENTE' 
                      ? 'Código de Estudiante o Tarjeta de Identidad' 
                      : 'Correo Institucional'}
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={selectedRole === 'ESTUDIANTE_ACUDIENTE' ? 'text' : 'email'}
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      autoCapitalize="none"
                      autoComplete="username"
                      placeholder={
                        selectedRole === 'ESTUDIANTE_ACUDIENTE' ? 'Ej: 1000000002' : 
                        'correo@institucional.edu.co'
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
                      autoComplete="current-password"
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
            </div>

            {/* Bottom Security Info */}
            <div className="pt-4 border-t border-slate-100 dark:border-zinc-800/50 flex items-center justify-between text-[11px] text-slate-400 font-medium">
              <span>Acceso verificado con Firebase Auth</span>
              <span>HMAC-SHA256 • Ley 1581</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
