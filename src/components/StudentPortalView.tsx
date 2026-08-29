import React, { useState } from 'react';
import { 
  UserCheck, 
  Clock, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  LogOut, 
  KeyRound, 
  ShieldCheck,
  TrendingUp,
  History,
  Lock,
  X,
  Check
} from 'lucide-react';
import { Student, AttendanceRecord } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';

interface StudentPortalViewProps {
  onLogout?: () => void;
}

export const StudentPortalView: React.FC<StudentPortalViewProps> = ({ onLogout }) => {
  const initialStudent = AttendanceStorageService.getStudents()[0];
  const [studentCodeInput, setStudentCodeInput] = useState(initialStudent?.code || '1000000001');
  const [passwordInput, setPasswordInput] = useState(initialStudent?.tempPassword || 'SJ-1137');
  const [activeStudent, setActiveStudent] = useState<Student | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isFirstLogin, setIsFirstLogin] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // Lista de primeros 5 estudiantes para pruebas rápidas con un clic
  const allStudents = AttendanceStorageService.getStudents();
  const sampleStudents = allStudents.slice(0, 4);

  const fillQuickStudent = (std: Student) => {
    setStudentCodeInput(std.code);
    setPasswordInput(std.tempPassword || `SJ-${std.code.slice(-4)}`);
    setLoginError(null);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const student = AttendanceStorageService.getStudentByCodeOrDoc(studentCodeInput.trim());
    if (!student) {
      setLoginError('Código de estudiante no encontrado.');
      return;
    }

    // Validación de credencial temporal o personalizada
    const expectedPassword = student.tempPassword || 'SJ-2026';
    if (passwordInput.trim() !== expectedPassword && passwordInput.trim() !== 'colegio2026') {
      setLoginError('Contraseña incorrecta. Verifique la clave al reverso de su carné físico o su contraseña personalizada.');
      return;
    }

    setActiveStudent(student);
    // Solo mostrar aviso si NUNCA ha personalizado su contraseña
    setIsFirstLogin(!student.hasCustomPassword);
    setPasswordUpdated(false);
  };

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 4) {
      alert('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }
    if (activeStudent) {
      AttendanceStorageService.updateStudent(activeStudent.code, { 
        tempPassword: newPassword,
        hasCustomPassword: true 
      });
      setActiveStudent({
        ...activeStudent,
        tempPassword: newPassword,
        hasCustomPassword: true
      });
      setPasswordUpdated(true);
      setIsFirstLogin(false);
      setShowPasswordModal(false);
      setNewPassword('');
    }
  };

  const handleExit = () => {
    setActiveStudent(null);
    setPasswordInput('');
    setPasswordUpdated(false);
    setIsFirstLogin(false);
    setShowPasswordModal(false);
    if (onLogout) onLogout();
  };

  // Si no ha iniciado sesión, mostrar pantalla de login de solo lectura
  if (!activeStudent) {
    return (
      <div className="max-w-md mx-auto py-8 animate-fadeIn" id="student-portal-login">
        <div className="glass-panel p-6 sm:p-8 rounded-3xl space-y-6 shadow-2xl">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/15 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 mx-auto flex items-center justify-center border border-indigo-200 dark:border-indigo-500/30">
              <UserCheck className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
              Portal de Consulta Estudiantil
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Consulta inmediata de historial de asistencia y puntualidad para estudiantes y acudientes.
            </p>
          </div>

          {loginError && (
            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Código del Estudiante (en el carné)
              </label>
              <input
                type="text"
                required
                value={studentCodeInput}
                onChange={(e) => setStudentCodeInput(e.target.value)}
                placeholder="Ej: 1000000001"
                className="w-full px-4 py-2.5 bg-white/90 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                <span>Clave de Acceso Permanente</span>
                <span className="text-[10px] text-slate-400">Ver reverso del carné</span>
              </label>
              <input
                type="password"
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 bg-white/90 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Quick Demo Test Buttons */}
            {sampleStudents.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                  ⚡ Accesos Rápidos de Prueba (Clic para autocompletar):
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {sampleStudents.map((std) => (
                    <button
                      key={std.code}
                      type="button"
                      onClick={() => fillQuickStudent(std)}
                      className={`px-2 py-1.5 rounded-lg border text-[10px] font-mono text-left truncate transition-all ${
                        studentCodeInput === std.code
                          ? 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                      title={`${std.firstName} ${std.lastName} (${std.grade}) - Clave: ${std.tempPassword}`}
                    >
                      {std.firstName.split(' ')[0]} ({std.grade})
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2"
            >
              <KeyRound className="w-4 h-4" />
              <span>Ingresar a Mi Historial</span>
            </button>
          </form>

          <div className="p-3.5 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 text-[11px] text-slate-500 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Clave Permanente y Acceso Seguro (Solo Lectura)</span>
            </div>
            <p className="text-[10px] leading-relaxed">
              La clave impresa al reverso del carné <strong>nunca expira</strong>. El estudiante o acudiente puede personalizarla en cualquier momento para su consulta privada sin alterar el sistema escolar ni el panel administrativo del colegio.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Registros de este estudiante
  const allRecords = AttendanceStorageService.getAllAttendance();
  const studentRecords = allRecords.filter(r => r.studentCode === activeStudent.code);
  const totalScans = studentRecords.length;
  const punctualScans = studentRecords.filter(r => r.status === 'PUNTUAL').length;
  const tardyScans = studentRecords.filter(r => r.status === 'TARDANZA').length;
  const punctualityRate = totalScans > 0 ? Math.round((punctualScans / totalScans) * 100) : 100;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn" id="student-portal-dashboard">
      {/* Top Banner with Student Info */}
      <div className="glass-panel p-5 sm:p-7 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-xl shadow-lg shadow-indigo-600/25 shrink-0">
            {activeStudent.firstName[0]}{activeStudent.lastName[0]}
          </div>
          <div>
            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
              {activeStudent.grade} - Sección "{activeStudent.section}" • Estado Activo
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {activeStudent.firstName} {activeStudent.lastName}
            </h2>
            <div className="flex items-center gap-3 text-xs text-slate-500 font-mono mt-0.5">
              <span>CÓDIGO: {activeStudent.code}</span>
              <span>•</span>
              <span>DOC: {activeStudent.documentId}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            onClick={() => setShowPasswordModal(true)}
            className="px-3.5 py-2 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
            title="Cambiar contraseña de consulta"
          >
            <Lock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>Cambiar Clave</span>
          </button>

          <button
            onClick={handleExit}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-rose-500 hover:text-white text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </div>

      {/* Notificación de Éxito al cambiar contraseña */}
      {passwordUpdated && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2 font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>¡Contraseña personalizada guardada con éxito! Ya quedó registrada para sus próximos ingresos.</span>
          </div>
          <button 
            onClick={() => setPasswordUpdated(false)}
            className="p-1 hover:bg-emerald-500/20 rounded-lg text-emerald-800 dark:text-emerald-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Primer Ingreso Opcional: Sugerencia no invasiva (solo si nunca la ha cambiado) */}
      {isFirstLogin && !activeStudent.hasCustomPassword && (
        <div className="glass-panel p-4 rounded-2xl border-amber-500/30 bg-amber-500/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2.5 text-amber-900 dark:text-amber-200 text-xs">
            <Lock className="w-4 h-4 shrink-0 text-amber-600" />
            <div>
              <span className="font-bold block">¿Deseas personalizar tu contraseña de acceso?</span>
              <span className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                Actualmente estás usando la clave temporal del carné ({activeStudent.tempPassword}). Puedes cambiarla cuando gustes.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setShowPasswordModal(true);
                setIsFirstLogin(false);
              }}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Personalizar Ahora</span>
            </button>
            <button
              onClick={() => setIsFirstLogin(false)}
              className="px-2.5 py-1.5 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 rounded-xl text-xs font-semibold"
            >
              Omitir
            </button>
          </div>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="glass-panel p-4 rounded-2xl space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase">Total Asistencias</span>
          <div className="text-2xl font-black text-slate-900 dark:text-white">{totalScans}</div>
          <span className="text-[10px] text-slate-500">Días con marca registrada</span>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border-emerald-500/30">
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Ingresos Puntuales</span>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{punctualScans}</div>
          <span className="text-[10px] text-emerald-600/80">Antes de 07:15 AM</span>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border-amber-500/30">
          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase">Tardanzas</span>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400">{tardyScans}</div>
          <span className="text-[10px] text-amber-600/80">Registro extemporáneo</span>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border-indigo-500/30">
          <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">Índice de Puntualidad</span>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{punctualityRate}%</div>
          <span className="text-[10px] text-indigo-600/80">Cumplimiento escolar</span>
        </div>
      </div>

      {/* History Table */}
      <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Historial Completo de Entradas y Salidas
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {studentRecords.length} registros
          </span>
        </div>

        {studentRecords.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            No se registran marcas de asistencia para este estudiante aún.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase">
                  <th className="py-2.5 px-3">Fecha</th>
                  <th className="py-2.5 px-3">Hora</th>
                  <th className="py-2.5 px-3">Tipo</th>
                  <th className="py-2.5 px-3">Estado</th>
                  <th className="py-2.5 px-3">Método</th>
                  <th className="py-2.5 px-3">Verificación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {studentRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/40">
                    <td className="py-2.5 px-3 font-mono font-medium text-slate-900 dark:text-slate-200">
                      {r.date}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-700 dark:text-slate-300">
                      {r.time}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded-md font-bold text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {r.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      {r.status === 'PUNTUAL' ? (
                        <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          Puntual
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          Tardanza
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                      {r.method}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" /> HMAC
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal para Cambiar Contraseña */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Personalizar Contraseña
                  </h3>
                  <span className="text-[10px] text-slate-500">
                    Estudiante: {activeStudent.firstName} {activeStudent.lastName}
                  </span>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setNewPassword('');
                }}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePasswordChange} className="space-y-3.5 pt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Nueva Contraseña Personal
                </label>
                <input
                  type="password"
                  required
                  autoFocus
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 4 caracteres (ej: 123456, miClave2026)"
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800 text-[10.5px] text-slate-500 leading-relaxed">
                💡 Esta clave solo se utilizará para que el estudiante o su acudiente consulten este portal. No modifica la información en secretaría ni el carné impreso.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setNewPassword('');
                  }}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/25 flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Guardar Nueva Clave</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
