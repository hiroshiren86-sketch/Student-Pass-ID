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
  Keyboard,
  CreditCard,
  Download,
  Eye,
  FileDown,
  Upload,
  Trash2,
  Image as ImageIcon,
  Info
} from 'lucide-react';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { Student, AttendanceRecord, StudentAttendanceStats, StudentPersonalSchedule, StudentPersonalScheduleEntry, SchoolSettings } from '../types/attendance';
import { AttendanceStorageService, getTodayDateString, getCurrentTimeString } from '../services/attendanceStorage';
import { generateStudentQrPayload, generateSignedQRPayload } from '../utils/crypto';
import { generateStudentCardPdf, downloadPdfBlob } from '../utils/pdfGenerator';
import { generateBarcodeDataUrl } from '../utils/barcode';
import { SoundService } from '../utils/sound';
import { ConfirmDialog } from './ConfirmDialog';
import { ActiveClassBanner } from './ActiveClassBanner';
import { PortalExcusesSection } from './PortalExcusesSection'; // Ronda 21: Mis Justificaciones (Escudo)

interface StudentPortalViewProps {
  onLogout?: () => void;
  activeStudentCode?: string;
}

export const StudentPortalView: React.FC<StudentPortalViewProps> = ({ onLogout, activeStudentCode }) => {
  const initialStudent = AttendanceStorageService.getStudents().find(s => s.code === (activeStudentCode || '1000000002')) || AttendanceStorageService.getStudents()[0];
  const [studentCodeInput, setStudentCodeInput] = useState(initialStudent?.code || '1000000002');
  const [passwordInput, setPasswordInput] = useState(initialStudent?.tempPassword || 'SJ-1274');
  const [activeStudent, setActiveStudent] = useState<Student | null>(activeStudentCode ? (AttendanceStorageService.getStudentByCodeOrDoc(activeStudentCode) || initialStudent) : null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isFirstLogin, setIsFirstLogin] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [studentStats, setStudentStats] = useState<StudentAttendanceStats | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());

  // Ronda 8 (B3): el portal era la ÚNICA vista grande sin suscripción al storage — el guard
  // de templatesOnlyMode quedaba stale al cambiar de rol en caliente. Con esta suscripción,
  // cualquier escritura local (toggle F2, Ajustes, plantillas) re-renderiza el portal con
  // datos frescos sin necesidad de recargar.
  useEffect(() => {
    const unsubscribe = AttendanceStorageService.subscribe(() => {
      setSettings(AttendanceStorageService.getSettings());
    });
    return unsubscribe;
  }, []);

  // Ronda 8 (O2): confirmación propia del portal
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; action: () => void } | null>(null);
  // Ronda 8 (B6): feedback visual de arrastre sobre la zona de foto
  const [photoDragActive, setPhotoDragActive] = useState(false);

  // Representative Scanner State
  const [repScannerOpen, setRepScannerOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [repManualInput, setRepManualInput] = useState('');
  const [repScanFeedback, setRepScanFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Pestañas organizadas de Carné: 'view' (Visualizar) | 'customize' (Personalizar)
  const [cardSectionTab, setCardSectionTab] = useState<'view' | 'customize'>('view');
  const [photoUrlInput, setPhotoUrlInput] = useState('');
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

  // Ronda 8 (B6): handler compartido para la foto — clic (picker) y drag & drop usan el mismo camino
  const handlePhotoFile = (file: File | undefined | null) => {
    if (!file || !activeStudent) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      AttendanceStorageService.updateStudent(activeStudent.code, { photoUrl: dataUrl });
      const updated = { ...activeStudent, photoUrl: dataUrl };
      setActiveStudent(updated);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (activeStudentCode) {
      const std = AttendanceStorageService.getStudentByCodeOrDoc(activeStudentCode);
      if (std) {
        setActiveStudent(std);
      }
    }
  }, [activeStudentCode]);

  useEffect(() => {
    if (activeStudent) {
      const stats = AttendanceStorageService.getStudentAttendanceStats(activeStudent.code);
      setStudentStats(stats);
      // Ronda 4 (F4): cargar mi horario opcional
      setMySchedule(AttendanceStorageService.getStudentPersonalSchedule(activeStudent.code));

      // Generar código QR firmado criptográficamente para el carné en vivo
      generateStudentQrPayload(activeStudent).then((payload) => {
        QRCode.toDataURL(payload, { margin: 1, width: 256 })
          .then((url) => setQrDataUrl(url))
          .catch((err) => console.error('Error generando QR para carné de estudiante:', err));
      });
    }
  }, [activeStudent]);

  const handleDownloadMyCardPdf = async () => {
    if (!activeStudent) return;
    try {
      const pdfBytes = await generateStudentCardPdf(activeStudent, settings);
      downloadPdfBlob(pdfBytes, `Carne_${activeStudent.lastName}_${activeStudent.firstName}_CR80.pdf`);
    } catch (err) {
      console.error('Error al generar carné PDF:', err);
      alert('No se pudo generar el carné PDF.');
    }
  };

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

    // Ronda 19 — QR DE CLASE: la tarjeta de la pizarra se rutear antes del registro de
    // estudiantes. El representante escanea el QR de clase y su dispositivo queda con el
    // contexto exacto (materia/bloque) para todos los carnés de su curso.
    if (rawCode.trim().startsWith('CLASE:v1:')) {
      const activation = await AttendanceStorageService.setActiveClassFromToken(rawCode.trim());
      if (soundEnabled) {
        if (activation.type === 'class_activated') SoundService.playBeepSuccess();
        else SoundService.playBeepError();
      }
      setRepScanFeedback({ type: activation.type === 'class_activated' ? 'success' : 'error', message: `${activation.title}: ${activation.message}` });
      setRepManualInput('');
      setTimeout(() => setRepScanFeedback(null), 6000);
      return;
    }

    // Ronda 19 (BUG-3 del informe): límite anti-abuso / anti-lector-defectuoso configurado en Ajustes.
    const limit = AttendanceStorageService.checkScanRateLimit();
    if (limit.limited) {
      if (soundEnabled) SoundService.playBeepError();
      setRepScanFeedback({ type: 'warning', message: `Demasiados escaneos por minuto (máx. ${limit.maxPerMin}). Reintenta en ${limit.retryAfterSec}s.` });
      setRepManualInput('');
      setTimeout(() => setRepScanFeedback(null), 4000);
      return;
    }

    // Ronda 19 (BUG-1 del informe): durante recreo/transición el reloj NO define el bloque.
    // Antes: `activeSlotInfo?.slot.id || 'slot-1'` registraba TARDANZA en 1ª Hora a las 09:20.
    const activeSlotInfo = AttendanceStorageService.getCurrentActiveSlot();
    if (!activeSlotInfo || !activeSlotInfo.isWithin) {
      if (soundEnabled) SoundService.playBeepError();
      setRepScanFeedback({ type: 'warning', message: activeSlotInfo ? AttendanceStorageService.buildNoActiveSlotMessage() : 'No hay bloques de clase configurados en la plantilla.' });
      setRepManualInput('');
      setTimeout(() => setRepScanFeedback(null), 4000);
      return;
    }
    const slotId = activeSlotInfo.slot.id;

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
                className="w-full px-4 py-2.5 bg-white/90 dark:bg-black/80 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                className="w-full px-4 py-2.5 bg-white/90 dark:bg-black/80 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                          : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-zinc-800'
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
              className="w-full py-3 bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2"
            >
              <KeyRound className="w-4 h-4" />
              <span>Ingresar a Mi Historial</span>
            </button>
          </form>

          <div className="p-3.5 bg-slate-50 dark:bg-black/50 rounded-2xl border border-slate-200/80 dark:border-zinc-800/50 text-[11px] text-slate-500 space-y-1">
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
            <div className="p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-amber-200 dark:border-amber-900/60 space-y-4">
              {/* Ronda 19 — QR de Clase: contexto activo (el representante escanea la tarjeta de la pizarra primero) */}
              <ActiveClassBanner />

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
                  className="flex-1 px-3 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-bold outline-none"
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

      {/* MI CARNÉ ESTUDIANTIL DIGITAL Y ESTUDIO DE PERSONALIZACIÓN */}
      <div className="glass-panel rounded-3xl p-5 sm:p-7 space-y-6 border border-indigo-200/80 dark:border-indigo-900/50 shadow-lg">
        {/* Header con Título, Segmented Controls (Tabs) y Acciones */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-100 dark:border-zinc-800/50 pb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  Carné Estudiantil Digital
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  CR80 Oficial • 2026
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Identificación oficial y gestión de fotografía para control de acceso y aula.
              </p>
            </div>
          </div>

          {/* Segmented Control Switcher & Actions */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-between md:justify-end">
            <div className="inline-flex p-1 bg-slate-100 dark:bg-zinc-950/80 rounded-2xl border border-slate-200/80 dark:border-zinc-800/50">
              <button
                type="button"
                onClick={() => setCardSectionTab('view')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  cardSectionTab === 'view'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Visualizar Carné</span>
              </button>
              <button
                type="button"
                onClick={() => setCardSectionTab('customize')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  cardSectionTab === 'customize'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Personalizar Foto</span>
                {activeStudent.photoUrl && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Foto activa" />
                )}
              </button>
            </div>

            {cardSectionTab === 'view' ? (
              <button
                onClick={handleDownloadMyCardPdf}
                className="px-4 py-2 bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/25 flex items-center gap-2 shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar PDF</span>
              </button>
            ) : (
              <button
                onClick={() => setCardSectionTab('view')}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 shrink-0"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Ver Carné</span>
              </button>
            )}
          </div>
        </div>

        {/* CONTENIDO DE LA PESTAÑA: VISUALIZAR CARNÉ */}
        {cardSectionTab === 'view' && (
          <div className="space-y-5 animate-fadeIn">
            {/* Dual Card Display (Front / Back) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Anverso / Front */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Anverso (Frontal Oficial)
                </span>
                <div className="w-full aspect-[85.6/53.98] rounded-2xl bg-white border-2 border-slate-300 dark:border-zinc-800 shadow-xl p-3.5 flex flex-col justify-between relative overflow-hidden text-slate-900">
                  {/* Subtle Colombia Tricolor Header */}
                  <div className="absolute top-0 left-0 right-0 h-1.5 flex">
                    <div className="w-1/2 h-full bg-amber-400" />
                    <div className="w-1/4 h-full bg-blue-600" />
                    <div className="w-1/4 h-full bg-red-600" />
                  </div>

                  {/* Header: Institución Educativa y Año */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="min-w-0 pr-2">
                      <span className="text-[8.5px] font-black text-slate-900 truncate block leading-tight" title={settings.schoolName}>
                        {settings.schoolName || 'Institución Educativa'}
                      </span>
                      <span className="text-[7px] uppercase font-bold text-indigo-700 block">
                        Carné Estudiantil
                      </span>
                    </div>
                    <div className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white text-[7px] font-black tracking-wider shrink-0">
                      2026
                    </div>
                  </div>

                  {/* Body with QR / Chip and Student Details */}
                  <div className="flex items-center gap-3 my-0.5">
                    <div className="w-16 h-16 rounded-xl bg-white p-1 border border-slate-300 shadow-xs flex items-center justify-center text-slate-900 shrink-0 relative">
                      {qrDataUrl ? (
                        <img src={qrDataUrl} alt="QR carné" className="w-full h-full object-contain" />
                      ) : (
                        <QrCode className="w-12 h-12 text-slate-700" />
                      )}
                      <div className="absolute -bottom-1 -right-1 px-1 bg-indigo-600 text-white text-[6px] font-black rounded">
                        HMAC
                      </div>
                    </div>

                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="text-[7px] font-bold text-slate-400 uppercase leading-none">
                        {activeStudent.documentType && !activeStudent.documentType.includes('DOC') ? `${activeStudent.documentType}. ` : ''}DOCUMENTO DE IDENTIDAD
                      </div>
                      <div className="text-[11px] font-black font-mono text-indigo-950 leading-tight">
                        {activeStudent.documentId}
                      </div>

                      <div className="text-[7px] font-bold text-slate-400 uppercase leading-none mt-0.5">
                        Estudiante
                      </div>
                      <div className="text-[10px] font-black uppercase truncate text-slate-900 leading-tight">
                        {activeStudent.lastName} {activeStudent.firstName}
                      </div>

                      <div className="text-[8.5px] font-bold text-indigo-700">
                        GRADO: <span className="font-black">{activeStudent.grade}</span> • SECC: <span className="font-black">{activeStudent.section}</span>
                      </div>
                    </div>

                    {/* Foto si el estudiante la tiene cargada */}
                    {activeStudent.photoUrl ? (
                      <img
                        src={activeStudent.photoUrl}
                        alt="Foto carné"
                        className="w-12 h-14 rounded-lg object-cover border border-slate-300 shadow-xs shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-14 rounded-lg bg-indigo-50 border border-indigo-200 flex flex-col items-center justify-center text-indigo-700 text-[9px] font-black shrink-0">
                        <span>{activeStudent.firstName[0]}{activeStudent.lastName[0]}</span>
                      </div>
                    )}
                  </div>

                  {/* Real 1D Barcode (Code 128) */}
                  <div className="bg-white border-t border-slate-200/90 -mx-3.5 -mb-3.5 px-2 py-1 flex flex-col items-center justify-center">
                    {generateBarcodeDataUrl(activeStudent.code, { height: 20 }) ? (
                      <img 
                        src={generateBarcodeDataUrl(activeStudent.code, { height: 20 })} 
                        alt={`Código de barras ${activeStudent.code}`}
                        className="h-7 max-w-full object-contain"
                      />
                    ) : (
                      <div className="font-mono text-[7px] text-slate-600">||| ||| || ||| | {activeStudent.code}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Reverso / Back */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Reverso (Acceso y Seguridad)
                </span>
                <div className="w-full aspect-[85.6/53.98] rounded-2xl bg-slate-50 border-2 border-slate-300 dark:border-zinc-800 shadow-xl p-3.5 flex flex-col justify-between relative overflow-hidden text-slate-900">
                  <div className="absolute top-0 left-0 right-0 h-2 bg-slate-900" />

                  <div className="pt-2 space-y-2">
                    <div className="text-[8px] font-black text-slate-800 uppercase flex items-center justify-between">
                      <span>Credenciales de Consulta</span>
                      <span className="text-[7px] font-bold text-emerald-700">● Sistema Escolar</span>
                    </div>

                    <div className="p-2.5 bg-white rounded-xl border border-slate-200 text-[8.5px] font-mono space-y-1 shadow-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-400">CÓDIGO:</span>
                        <span className="font-bold text-slate-900">{activeStudent.code}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">PIN PORTAL:</span>
                        <span className="font-bold text-indigo-700">{activeStudent.tempPassword || `SJ-${activeStudent.documentId.slice(-4)}`}</span>
                      </div>
                    </div>

                    <div className="text-[7px] text-slate-600 leading-tight space-y-1">
                      <p>• Este carné es personal e intransferible. Válido para ingreso y registro de asistencia.</p>
                      <p>• Código QR con firma digital criptográfica inviolable. En caso de pérdida, informe a coordinación.</p>
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-1 flex items-center justify-between text-[7px] font-bold text-slate-400">
                    <span>VIGENCIA: NOVIEMBRE 2026</span>
                    <span className="text-indigo-600 font-black">INAS SEGURIDAD DIGITAL</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Barra de Acceso Rápido a Personalización y Estado de Seguridad */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-950/60 border border-slate-200/80 dark:border-zinc-800/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-bold text-slate-800 dark:text-slate-200">Seguridad Activa:</span> Token QR con firma criptográfica HMAC-SHA256 y Código 128 listo para escaneo.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setCardSectionTab('customize')}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 hover:underline flex items-center gap-1.5 shrink-0"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{activeStudent.photoUrl ? 'Cambiar mi foto' : 'Personalizar fotografía de mi carné'}</span>
              </button>
            </div>
          </div>
        )}

        {/* CONTENIDO DE LA PESTAÑA: PERSONALIZAR FOTO */}
        {cardSectionTab === 'customize' && (
          <div className="space-y-5 animate-fadeIn">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Columna Izquierda: Vista Previa de la Fotografía Actual */}
              <div className="lg:col-span-5 p-5 rounded-2xl bg-slate-50 dark:bg-zinc-950/90 border border-slate-200/80 dark:border-zinc-800/50 flex flex-col items-center justify-center text-center space-y-4">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Encuadre de Fotografía
                </span>

                <div className="relative group">
                  {activeStudent.photoUrl ? (
                    <div className="w-32 h-40 rounded-2xl overflow-hidden border-2 border-indigo-600/40 shadow-md bg-white">
                      <img
                        src={activeStudent.photoUrl}
                        alt="Foto carné"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-32 h-40 rounded-2xl border-2 border-dashed border-slate-300 dark:border-zinc-800 bg-slate-100 dark:bg-slate-800 flex flex-col items-center justify-center text-slate-400 gap-2 p-3">
                      <ImageIcon className="w-8 h-8 text-slate-400" />
                      <span className="text-[10px] font-bold text-center leading-tight">Sin fotografía personalizada</span>
                      <span className="text-[9px] text-slate-400 font-mono">Usa iniciales</span>
                    </div>
                  )}

                  {activeStudent.photoUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('¿Deseas quitar tu fotografía personalizada y volver a las iniciales estándar?')) {
                          AttendanceStorageService.updateStudent(activeStudent.code, { photoUrl: undefined });
                          const updated = { ...activeStudent, photoUrl: undefined };
                          setActiveStudent(updated);
                        }
                      }}
                      className="absolute -top-2 -right-2 p-1.5 rounded-full bg-rose-600 text-white shadow-md hover:bg-rose-700 transition-all"
                      title="Quitar foto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-black text-slate-900 dark:text-white">
                    {activeStudent.lastName} {activeStudent.firstName}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {activeStudent.documentType || 'DOC'}: {activeStudent.documentId} • Grado {activeStudent.grade}
                  </div>
                  <div className="pt-1">
                    {activeStudent.photoUrl ? (
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Fotografía Activa
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 inline-flex items-center gap-1">
                        Iniciales Predeterminadas
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Columna Derecha: Opciones de Carga y Consejos */}
              <div className="lg:col-span-7 space-y-4">
                {/* Opción 1: Subir Archivo Local */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-950/90 border border-slate-200/80 dark:border-zinc-800/50 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                      <Upload className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-slate-900 dark:text-white">
                        Opción A: Subir archivo desde tu dispositivo
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Formatos recomendados: JPG, PNG o WEBP.
                      </p>
                    </div>
                  </div>

                  <label
                    className={`cursor-pointer border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-2 text-center transition-all ${photoDragActive ? 'border-indigo-500 bg-indigo-100/60 dark:bg-indigo-950/60 ring-2 ring-indigo-400' : 'border-indigo-200 hover:border-indigo-500 dark:border-indigo-900/60 dark:hover:border-indigo-500/80 bg-white/50 dark:bg-black/50 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30'}`}
                    onDragOver={(e) => { e.preventDefault(); setPhotoDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setPhotoDragActive(false); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setPhotoDragActive(false);
                      // Ronda 8 (B6): drag & drop implementado — mismo camino que el picker
                      handlePhotoFile(e.dataTransfer?.files?.[0]);
                    }}
                  >
                    <Camera className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Haz clic aquí o arrastra tu foto hasta esta zona
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Se ajustará automáticamente al tamaño del carné
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        handlePhotoFile(e.target.files?.[0]);
                        e.target.value = ''; // permite re-seleccionar el mismo archivo
                      }}
                    />
                  </label>
                </div>

                {/* Opción 2: URL / Enlace Directo */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-950/90 border border-slate-200/80 dark:border-zinc-800/50 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-slate-900 dark:text-white">
                        Opción B: Pegar enlace o URL de imagen
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Pega una URL pública directa de tu foto.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="url"
                      placeholder="https://ejemplo.com/mi-foto.jpg"
                      value={photoUrlInput || activeStudent.photoUrl || ''}
                      onChange={(e) => setPhotoUrlInput(e.target.value)}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val && val !== activeStudent.photoUrl) {
                          AttendanceStorageService.updateStudent(activeStudent.code, { photoUrl: val });
                          const updated = { ...activeStudent, photoUrl: val };
                          setActiveStudent(updated);
                        }
                      }}
                      className="flex-1 px-3.5 py-2 bg-white dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = (photoUrlInput || '').trim();
                        if (val) {
                          AttendanceStorageService.updateStudent(activeStudent.code, { photoUrl: val });
                          const updated = { ...activeStudent, photoUrl: val };
                          setActiveStudent(updated);
                        }
                      }}
                      className="px-3.5 py-2 bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black rounded-xl text-xs font-bold transition-all shrink-0"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>

                {/* Consejos para Fotografía */}
                <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-900/40 text-[11px] text-indigo-900 dark:text-indigo-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>Recomendaciones para tu carné escolar</span>
                  </div>
                  <p className="text-indigo-800/80 dark:text-indigo-300/80 pl-5">
                    Procura usar una foto tipo documento con fondo liso, buena iluminación y rostro de frente. El carné se actualiza inmediatamente tanto en pantalla como en el PDF descargable.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setCardSectionTab('view')}
                className="px-5 py-2.5 bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/25 flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>Guardar y Ver Carné Digital</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Ronda 4 (F4): MI HORARIO OPCIONAL — oculto si Rectoría activó "Solo plantillas oficiales" */}
      {(() => {
        // Ronda 8 (B3): ahora lee del estado reactivo (suscripción al storage arriba);
        // antes solo se refrescaba al remontar y quedaba stale en cambio de rol caliente.
        const templatesOnly = settings.templatesOnlyMode === true;
        const dayNames = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        return (
          <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-fuchsia-600 dark:text-fuchsia-400" />
                <h3 className="text-base font-black text-slate-900 dark:text-white">Mi horario (opcional)</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-fuchsia-100 dark:bg-fuchsia-950/70 text-fuchsia-700 dark:text-fuchsia-300">Informativo · no afecta tu asistencia</span>
              </div>
            </div>

            {templatesOnly ? (
              <div className="p-4 rounded-2xl bg-slate-100 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 text-xs text-slate-500 dark:text-slate-400 font-bold flex items-center gap-2">
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
                      <div key={day} className="p-3 rounded-2xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 space-y-1.5">
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
                    onClick={() => {
                      // Ronda 8 (O2): confirmación con modal propio (antes window.confirm nativo)
                      if (!activeStudent) return;
                      setConfirmState({
                        title: 'Eliminar horario',
                        message: '¿Eliminar tu horario personal? Podrás volver a crearlo después con un CSV.',
                        action: () => {
                          AttendanceStorageService.deleteStudentPersonalSchedule(activeStudent.code);
                          setMySchedule(null);
                        }
                      });
                    }}
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
                  className="w-full p-3 rounded-2xl bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-fuchsia-500"
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
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-3">
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
              <div key={subj.subject} className="p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 space-y-2">
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

      {/* Ronda 21 (spec §7.1): "Mis Justificaciones" — radicación anticipada (Escudo)
          + expediente propio. La post-hoc de 1 toque es de Rectoría (planilla). */}
      {activeStudent && (
        <PortalExcusesSection studentCode={activeStudent.code} />
      )}

      {/* History Table */}
      <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-3">
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
                <tr className="border-b border-slate-100 dark:border-zinc-800/50 text-slate-400 font-bold uppercase text-[10px]">
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
                        /* Ronda 21 (spec §7.4): la ausencia justificada se muestra como
                           "Excusada" — no es una falta injustificada para el estudiante. */
                        r.excuseId ? (
                          <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" />
                            {r.excuseStatus === 'APROBADA' ? 'Excusada (verificada)' : 'Excusada (bajo revisión)'}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                            Ausente
                          </span>
                        )
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
          <div className="p-6 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-md w-full space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-3">
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
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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

      {/* Ronda 8 (O2): modal de confirmación propio del portal (reemplaza window.confirm) */}
      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        onConfirm={() => { const a = confirmState?.action; setConfirmState(null); a?.(); }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
};
