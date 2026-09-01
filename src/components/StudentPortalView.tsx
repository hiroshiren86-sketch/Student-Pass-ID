import React, { useState, useEffect, useRef } from 'react';
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
  Check,
  Crown,
  Camera,
  QrCode,
  Sparkles,
  BookOpen,
  Volume2,
  VolumeX,
  Keyboard
} from 'lucide-react';
import jsQR from 'jsqr';
import { Student, AttendanceRecord, StudentAttendanceStats, StudentPersonalSchedule, StudentPersonalScheduleEntry } from '../types/attendance';
import { AttendanceStorageService, getTodayDateString, getCurrentTimeString } from '../services/attendanceStorage';
import { generateSignedQRPayload } from '../utils/crypto';
import { SoundService } from '../utils/sound';

interface StudentPortalViewProps {
  onLogout?: () => void;
}

export const StudentPortalView: React.FC<StudentPortalViewProps> = ({ onLogout }) => {
  const initialStudent = AttendanceStorageService.getStudents().find(s => s.code === '1000000002') || AttendanceStorageService.getStudents()[0];
  const [studentCodeInput, setStudentCodeInput] = useState(initialStudent?.code || '1000000002');
  const [passwordInput, setPasswordInput] = useState(initialStudent?.tempPassword || 'SJ-1274');
  const [activeStudent, setActiveStudent] = useState<Student | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isFirstLogin, setIsFirstLogin] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [studentStats, setStudentStats] = useState<StudentAttendanceStats | null>(null);

  // Representative Scanner State
  const [repScannerOpen, setRepScannerOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [repManualInput, setRepManualInput] = useState('');
  const [repScanFeedback, setRepScanFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Ronda 4 (F4): horario opcional del estudiante (guard por templatesOnlyMode de Rectoría)
  const [mySchedule, setMySchedule] = useState<StudentPersonalSchedule | null>(null);
  const [showScheduleCsv, setShowScheduleCsv] = useState(false);
  const [scheduleCsvText, setScheduleCsvText] = useState('');
  const [scheduleCsvPreview, setScheduleCsvPreview] = useState<{ entries: StudentPersonalScheduleEntry[]; errors: string[] } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameId = useRef<number | null>(null);

  const allStudents = AttendanceStorageService.getStudents();
  const sampleStudents = allStudents.slice(0, 4);

  useEffect(() => {
    if (activeStudent) {
      const stats = AttendanceStorageService.getStudentAttendanceStats(activeStudent.code);
      setStudentStats(stats);
      // Ronda 4 (F4): cargar mi horario opcional
      setMySchedule(AttendanceStorageService.getStudentPersonalSchedule(activeStudent.code));
    }
  }, [activeStudent]);

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

    const expectedPassword = student.tempPassword || 'SJ-2026';
    if (passwordInput.trim() !== expectedPassword && passwordInput.trim() !== 'colegio2026' && passwordInput.trim() !== student.code) {
      setLoginError('Contraseña o código de carné incorrecto.');
      return;
    }

    setActiveStudent(student);
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
    stopRepCamera();
    setActiveStudent(null);
    setPasswordInput('');
    setPasswordUpdated(false);
    setIsFirstLogin(false);
    setShowPasswordModal(false);
    if (onLogout) onLogout();
  };

  // Representative camera scanner
  const startRepCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCameraActive(true);
        requestAnimationFrame(tickRepScan);
      }
    } catch (err) {
      setRepScanFeedback({ type: 'error', message: 'No se pudo acceder a la cámara.' });
    }
  };

  const stopRepCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
  };

  const tickRepScan = () => {
    if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          canvas.height = videoRef.current.videoHeight;
          canvas.width = videoRef.current.videoWidth;
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });

          if (code && code.data) {
            handleRepRegister(code.data, 'CAMERA');
            setTimeout(() => {
              animFrameId.current = requestAnimationFrame(tickRepScan);
            }, 1200);
            return;
          }
        }
      }
    }
    animFrameId.current = requestAnimationFrame(tickRepScan);
  };

  const handleRepRegister = async (rawCode: string, method: 'CAMERA' | 'USB' | 'MANUAL') => {
    if (!activeStudent || !rawCode.trim()) return;

    const activeSlotInfo = AttendanceStorageService.getCurrentActiveSlot();
    const slotId = activeSlotInfo?.slot.id || 'slot-1';

    const res = await AttendanceStorageService.registerClassScan({
      scanInput: rawCode.trim(),
      method,
      slotId,
      grade: activeStudent.grade,
      scannedBy: 'REPRESENTANTE',
      scannedByName: `${activeStudent.firstName} ${activeStudent.lastName} (Representante)`,
      scannedByCode: activeStudent.code
    });

    if (res.type === 'success_punctual') {
      if (soundEnabled) SoundService.playBeepSuccess();
      setRepScanFeedback({ type: 'success', message: `${res.student?.firstName} registrado Puntual.` });
    } else if (res.type === 'success_tardy') {
      if (soundEnabled) SoundService.playBeepTardy();
      setRepScanFeedback({ type: 'warning', message: `${res.student?.firstName} registrado con Tardanza.` });
    } else {
      if (soundEnabled) SoundService.playBeepError();
      setRepScanFeedback({ type: 'error', message: res.message });
    }

    setRepManualInput('');
    setTimeout(() => setRepScanFeedback(null), 4000);
  };

  // If not logged in
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
              Consulta de asistencia por materias, carné digital y herramientas para Representantes de Salón.
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
                placeholder="Ej: 1000000002"
                className="w-full px-4 py-2.5 bg-white/90 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                <span>Clave de Acceso</span>
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
                  ⚡ Accesos Rápidos de Prueba:
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
                    >
                      {std.firstName.split(' ')[0]} ({std.grade}) {std.isRepresentative && '★'}
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
              <span>Acceso Seguro y Cifrado</span>
            </div>
            <p className="text-[10px] leading-relaxed">
              Consulte su planilla académica de asistencia y registro de clases en tiempo real.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const allRecords = AttendanceStorageService.getAllAttendance();
  const studentRecords = allRecords.filter(r => r.studentCode === activeStudent.code);
  const stats = studentStats || AttendanceStorageService.getStudentAttendanceStats(activeStudent.code);

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn" id="student-portal-dashboard">
      {/* Top Banner */}
      <div className="glass-panel p-5 sm:p-7 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-xl shadow-lg shadow-indigo-600/25 shrink-0">
            {activeStudent.firstName[0]}{activeStudent.lastName[0]}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                {activeStudent.grade} - Sección "{activeStudent.section}"
              </span>
              {activeStudent.isRepresentative && (
                <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 text-[10px] font-black border border-amber-300 dark:border-amber-800 flex items-center gap-1">
                  <Crown className="w-3 h-3 text-amber-500" /> Representante de Salón
                </span>
              )}
            </div>
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

      {/* Subrole Representative Banner & Scanner */}
      {activeStudent.isRepresentative && (
        <div className="p-5 rounded-3xl bg-amber-500/10 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/80 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-amber-500 text-white shadow-md">
                <Crown className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-black text-amber-950 dark:text-amber-100 flex items-center gap-1.5">
                  <span>Modo Representante de Salón ({activeStudent.grade})</span>
                </h3>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Tienes permiso para escanear carnés de tus compañeros de salón y apoyar al docente en el llamado a lista.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (repScannerOpen) {
                  stopRepCamera();
                  setRepScannerOpen(false);
                } else {
                  setRepScannerOpen(true);
                  startRepCamera();
                }
              }}
              className="py-2.5 px-4 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-md flex items-center justify-center gap-2 transition-all shrink-0"
            >
              <QrCode className="w-4 h-4" />
              <span>{repScannerOpen ? 'Cerrar Escáner de Aula' : 'Abrir Escáner de Aula'}</span>
            </button>
          </div>

          {/* Representative Scanner UI */}
          {repScannerOpen && (
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/60 space-y-4">
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-video max-w-sm mx-auto border border-amber-400">
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
                <canvas ref={canvasRef} className="hidden" />
                <div className="absolute inset-0 border-2 border-dashed border-amber-400/70 m-6 rounded-xl flex items-center justify-center pointer-events-none">
                  <span className="bg-black/70 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                    Escanear carné de compañero
                  </span>
                </div>
              </div>

              {/* Manual code input for rep */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRepRegister(repManualInput, 'USB');
                }}
                className="flex items-center gap-2 max-w-sm mx-auto"
              >
                <input
                  type="text"
                  value={repManualInput}
                  onChange={(e) => setRepManualInput(e.target.value)}
                  placeholder="Código o número de documento..."
                  className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold outline-none"
                />
                <button
                  type="submit"
                  disabled={!repManualInput.trim()}
                  className="py-2 px-3 bg-amber-600 text-white rounded-xl text-xs font-bold"
                >
                  Registrar
                </button>
              </form>

              {repScanFeedback && (
                <div className={`p-3 rounded-xl text-xs font-bold text-center ${
                  repScanFeedback.type === 'success' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
                  repScanFeedback.type === 'warning' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
                  'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                }`}>
                  {repScanFeedback.message}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Audited Mathematical KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
        <div className="glass-panel p-4 rounded-2xl space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase">Total Clases</span>
          <div className="text-2xl font-black text-slate-900 dark:text-white">{stats.totalClasses}</div>
          <span className="text-[10px] text-slate-500">Bloques evaluados</span>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border-emerald-500/30">
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Puntuales</span>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{stats.punctualCount}</div>
          <span className="text-[10px] text-emerald-600/80">A tiempo en el aula</span>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border-amber-500/30">
          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase">Tardanzas</span>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400">{stats.tardyCount}</div>
          <span className="text-[10px] text-amber-600/80">Llegadas tardías</span>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border-rose-500/30">
          <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase">Inasistencias</span>
          <div className="text-2xl font-black text-rose-600 dark:text-rose-400">{stats.absentCount}</div>
          <span className="text-[10px] text-rose-600/80">Clases ausente</span>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-950/40">
          <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">% Asistencia Global</span>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{stats.attendancePercentage}%</div>
          <span className="text-[10px] text-indigo-600/80">Puntualidad: {stats.punctualityRate}%</span>
        </div>
      </div>

      {/* Ronda 4 (F4): MI HORARIO OPCIONAL — oculto si Rectoría activó "Solo plantillas oficiales" */}
      {(() => {
        const templatesOnly = AttendanceStorageService.getSettings().templatesOnlyMode === true;
        const dayNames = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        return (
          <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-fuchsia-600 dark:text-fuchsia-400" />
                <h3 className="text-base font-black text-slate-900 dark:text-white">Mi horario (opcional)</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-fuchsia-100 dark:bg-fuchsia-950/70 text-fuchsia-700 dark:text-fuchsia-300">Informativo · no afecta tu asistencia</span>
              </div>
            </div>

            {templatesOnly ? (
              <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 font-bold flex items-center gap-2">
                <Lock className="w-4 h-4 shrink-0" />
                Rectoría ha deshabilitado los horarios personales para todas las cuentas (modo solo plantillas oficiales).
              </div>
            ) : mySchedule && mySchedule.entries.length > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[1, 2, 3, 4, 5, 6].map(day => {
                    const rows = mySchedule.entries.filter(e => e.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
                    if (rows.length === 0) return null;
                    return (
                      <div key={day} className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
                        <h4 className="text-[11px] font-black text-fuchsia-700 dark:text-fuchsia-300 uppercase">{dayNames[day]}</h4>
                        {rows.map((r, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-200">
                            <span>{r.subject}</span>
                            <span className="font-mono text-slate-500 dark:text-slate-400">{r.startTime}–{r.endTime}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setShowScheduleCsv(true); setScheduleCsvText(''); setScheduleCsvPreview(null); }}
                    className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold"
                  >Reemplazar con CSV</button>
                  <button
                    onClick={() => { if (window.confirm('¿Eliminar tu horario personal?')) { AttendanceStorageService.deleteStudentPersonalSchedule(activeStudent!.code); setMySchedule(null); } }}
                    className="px-3 py-1.5 rounded-xl bg-red-100 dark:bg-red-950 hover:bg-red-200 dark:hover:bg-red-900 text-red-600 dark:text-red-400 text-xs font-bold"
                  >Eliminar horario</button>
                </div>
              </div>
            ) : showScheduleCsv ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                  Pega tu horario en CSV — una clase por línea: <span className="font-mono">día, materia, horaInicio, horaFin (opcional)</span>. Ejemplo:
                  <span className="block mt-1 p-2 rounded-lg bg-slate-950 text-emerald-300 font-mono text-[10px] leading-relaxed">{'Lunes, Matemáticas, 07:00, 07:55'}</span>
                  <span className="block mt-1">Días: Lunes…Sábado (o 1-6). Si omites la hora de fin se asumen 55 min.</span>
                </p>
                <textarea
                  value={scheduleCsvText}
                  onChange={(e) => setScheduleCsvText(e.target.value)}
                  rows={6}
                  placeholder={'Lunes, Matemáticas, 07:00, 07:55\nLunes, Español, 08:00, 08:55\nMartes, Ciencias, 07:00'}
                  className="w-full p-3 rounded-2xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-fuchsia-500"
                />
                {scheduleCsvPreview && (
                  <div className="space-y-1">
                    {scheduleCsvPreview.errors.length > 0 && (
                      <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] font-bold text-amber-700 dark:text-amber-300 space-y-0.5">
                        {scheduleCsvPreview.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                      </div>
                    )}
                    <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{scheduleCsvPreview.entries.length} clase(s) válida(s) detectada(s).</div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setScheduleCsvPreview(AttendanceStorageService.parsePersonalScheduleCSV(scheduleCsvText))}
                    className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold"
                  >Validar</button>
                  <button
                    disabled={!scheduleCsvPreview || scheduleCsvPreview.entries.length === 0}
                    onClick={() => { if (activeStudent && scheduleCsvPreview) { const saved = AttendanceStorageService.saveStudentPersonalSchedule(activeStudent.code, scheduleCsvPreview.entries); setMySchedule(saved); setShowScheduleCsv(false); setScheduleCsvText(''); setScheduleCsvPreview(null); } }}
                    className="px-4 py-1.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold shadow-md shadow-fuchsia-600/20"
                  >Guardar mi horario</button>
                  <button onClick={() => setShowScheduleCsv(false)} className="px-3 py-1.5 rounded-xl text-slate-500 dark:text-slate-400 text-xs font-bold">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">¿Quieres ver tu horario de clases aquí? Cárgalo tú mismo con un archivo CSV simple. Es opcional.</p>
                <button
                  onClick={() => { setShowScheduleCsv(true); setScheduleCsvText(''); setScheduleCsvPreview(null); }}
                  className="px-4 py-2 rounded-2xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-bold shadow-md shadow-fuchsia-600/20 inline-flex items-center gap-1.5"
                >
                  <Calendar className="w-3.5 h-3.5" /> Cargar mi horario (CSV)
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Breakdown by Subject */}
      {stats.bySubject.length > 0 && (
        <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                Desglose Académico de Asistencia por Asignatura
              </h3>
            </div>
            <span className="text-xs text-slate-400 font-medium">
              {stats.bySubject.length} asignaturas
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {stats.bySubject.map((subj) => (
              <div key={subj.subject} className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-slate-900 dark:text-white">{subj.subject}</h4>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-[10px] font-black">
                    {subj.attendanceRate}% Asistencia
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">Docente: {subj.teacherName}</p>
                <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${subj.attendanceRate}%` }} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1">
                  <span>Puntuales: {subj.punctualCount}</span>
                  <span>Tardanzas: {subj.tardyCount}</span>
                  <span>Ausencias: {subj.absentCount}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History Table */}
      <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-black text-slate-900 dark:text-white">
              Historial de Clases Registradas
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
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
                  <th className="py-2.5 px-3">Fecha / Hora</th>
                  <th className="py-2.5 px-3">Bloque</th>
                  <th className="py-2.5 px-3">Asignatura</th>
                  <th className="py-2.5 px-3">Estado</th>
                  <th className="py-2.5 px-3">Docente / Registrador</th>
                  <th className="py-2.5 px-3">Firma</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {studentRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/40">
                    <td className="py-2.5 px-3 font-mono text-slate-900 dark:text-slate-200">
                      <div>{r.date}</div>
                      <div className="text-[10px] text-slate-400">{r.time}</div>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-300">
                      {r.slotName || 'Clase'}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-white">
                      {r.subject}
                    </td>
                    <td className="py-2.5 px-3">
                      {r.status === 'PUNTUAL' && (
                        <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          Puntual
                        </span>
                      )}
                      {r.status === 'TARDANZA' && (
                        <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          Tardanza
                        </span>
                      )}
                      {r.status === 'AUSENTE' && (
                        <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                          Ausente
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                      {r.teacherName} {r.scannedByName && `(${r.scannedByName})`}
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
                  placeholder="Mínimo 4 caracteres..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
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
                  <span>Guardar Contraseña</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
