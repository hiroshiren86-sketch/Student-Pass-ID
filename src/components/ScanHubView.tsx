import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ScanLine, 
  Keyboard, 
  Camera, 
  Volume2, 
  VolumeX, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Wifi,
  Smartphone,
  ArrowRight,
  UserCheck
} from 'lucide-react';
import { AttendanceMethod, AttendanceType, ScanResultFeedback, AttendanceRecord } from '../types/attendance';
import { AttendanceStorageService, getCurrentTimeString, getTodayDateString } from '../services/attendanceStorage';
import { SoundService } from '../utils/sound';
import { CameraScanner } from './CameraScanner';
import confetti from 'canvas-confetti';

interface ScanHubViewProps {
  onScanSuccess?: () => void;
}

export const ScanHubView: React.FC<ScanHubViewProps> = ({ onScanSuccess }) => {
  const [scanMethod, setScanMethod] = useState<'USB' | 'CAMERA'>('USB');
  const scanType: AttendanceType = 'CLASE';
  const [scanInput, setScanInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<ScanResultFeedback | null>(null);
  const [currentTime, setCurrentTime] = useState(getCurrentTimeString());
  const [recentScans, setRecentScans] = useState<AttendanceRecord[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  // Mobile virtual keyboard prevention toggle
  const [preventVirtualKeyboard, setPreventVirtualKeyboard] = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);

  // Reloj en tiempo real
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(getCurrentTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Escuchar estado online/offline
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      AttendanceStorageService.syncOfflineQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Cargar registros recientes
  const refreshRecent = () => {
    const today = getTodayDateString();
    const records = AttendanceStorageService.getAttendanceByDate(today);
    setRecentScans(records.slice(0, 6));
  };

  useEffect(() => {
    refreshRecent();
    const unsub = AttendanceStorageService.subscribe(refreshRecent);
    return unsub;
  }, []);

  // Manejar escaneo (Offline First: funciona 100% sin internet)
  const handleExecuteScan = useCallback(async (rawCode: string, method: AttendanceMethod) => {
    if (!rawCode.trim() || isProcessing) return;
    setIsProcessing(true);

    try {
      const cleanInput = rawCode.trim();
      const feedback = await AttendanceStorageService.registerScan({
        scanInput: cleanInput,
        method: method,
        scanType: scanType
      });

      setLastFeedback(feedback);

      if (soundEnabled) {
        if (feedback.type === 'success_punctual') {
          SoundService.playBeepSuccess();
          confetti({
            particleCount: 20,
            spread: 40,
            origin: { y: 0.8 },
            colors: ['#10B981', '#6366F1', '#3B82F6']
          });
        } else if (feedback.type === 'success_tardy') {
          SoundService.playBeepTardy();
        } else {
          SoundService.playBeepError();
        }
      }

      if (onScanSuccess) onScanSuccess();
    } catch (err) {
      console.error(err);
      setLastFeedback({
        type: 'error',
        title: 'Error de Lectura',
        message: 'No fue posible validar el código escaneado.',
        timestamp: new Date().toISOString()
      });
      if (soundEnabled) SoundService.playBeepError();
    } finally {
      setScanInput('');
      setIsProcessing(false);
    }
  }, [isProcessing, scanType, soundEnabled, onScanSuccess]);

  // Hardware USB Scanner Keystroke Burst Listener
  useEffect(() => {
    if (scanMethod !== 'USB') return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'textarea' || (activeTag === 'input' && document.activeElement !== inputRef.current)) {
        return;
      }

      const now = Date.now();
      const timeDiff = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === 'Enter') {
        if (bufferRef.current.trim().length > 0) {
          e.preventDefault();
          const codeToScan = bufferRef.current.trim();
          bufferRef.current = '';
          handleExecuteScan(codeToScan, 'USB');
        }
        return;
      }

      if (e.key.length === 1) {
        if (timeDiff > 200 && bufferRef.current.length > 0) {
          bufferRef.current = '';
        }
        bufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [scanMethod, handleExecuteScan]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (scanInput.trim()) {
      handleExecuteScan(scanInput, 'USB');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fadeIn" id="scan-hub-view">
      {/* Top Banner with Clock & Offline Status */}
      <div className="p-5 sm:p-6 rounded-3xl bg-white/80 dark:bg-zinc-950/80 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-200 dark:border-indigo-500/30 shrink-0">
            <ScanLine className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                CAPTURA EN VIVO • CR80
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                <Wifi className="w-3 h-3" /> Offline-Ready
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5">
              Registro de Asistencia
            </h2>
          </div>
        </div>

        {/* Live Clock & Sound Control */}
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <div className="px-4 py-2 bg-slate-950 text-white rounded-2xl font-mono text-base sm:text-xl font-black tracking-widest border border-slate-800 shadow-inner">
            {currentTime}
          </div>
          <button
            onClick={() => {
              const nextState = !soundEnabled;
              setSoundEnabled(nextState);
              if (nextState) {
                SoundService.unlock();
                SoundService.playBeepSuccess();
              }
            }}
            className={`px-3 py-2 rounded-2xl border transition-all flex items-center gap-1.5 text-xs font-bold ${
              soundEnabled 
                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800' 
                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-zinc-800'
            }`}
            title={soundEnabled ? 'Sonido Activado' : 'Sonido Silenciado'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Sonido ON' : 'Mudo'}</span>
          </button>
        </div>
      </div>

      {/* Ronda 4 (F3): banner de ventana de jornada en portería */}
      {(() => {
        const win = AttendanceStorageService.getSchoolDayWindow(getTodayDateString());
        if (!win) return null;
        const open = AttendanceStorageService.isWithinSchoolDay();
        return (
          <div className="max-w-md mx-auto">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-2xl border text-[11px] font-bold mb-2 ${open ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'}`}>
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>
                {open
                  ? `Jornada abierta (${win.start} – ${win.end})`
                  : AttendanceStorageService.getDayCloseState().closedAt
                    ? `Jornada cerrada (${win.start} – ${win.end}) · Cierre del día ya ejecutado`
                    : `Jornada cerrada (${win.start} – ${win.end}) · El escáner no registra fuera de la jornada`}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Unified Modifiers */}
      <div className="max-w-md mx-auto">
        {/* Toggle USB HID vs Cámara */}
        <div className="p-1.5 bg-white/80 dark:bg-zinc-950/80 border border-slate-200/80 dark:border-zinc-800/50 rounded-2xl flex items-center gap-1 shadow-xs">
          <button
            onClick={() => setScanMethod('USB')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              scanMethod === 'USB'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Keyboard className="w-4 h-4" />
            <span>Lector USB / OTG</span>
          </button>
          <button
            onClick={() => setScanMethod('CAMERA')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              scanMethod === 'CAMERA'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Cámara Móvil / QR</span>
          </button>
        </div>
      </div>

      {/* Main Scanner Section */}
      <div className="p-6 sm:p-7 rounded-3xl bg-white/80 dark:bg-zinc-950/80 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-xs space-y-5">
        {scanMethod === 'USB' ? (
          <div className="space-y-4 text-center max-w-lg mx-auto py-1">
            <div className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Lectura Óptica Instantánea (&lt;0.5s)
              </span>
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                Pase el carné por el escáner
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Compatible con lectores de código de barras 1D (Code 128) y códigos QR 2D.
              </p>
            </div>

            <form onSubmit={handleManualSubmit} className="relative">
              <input
                ref={inputRef}
                type="text"
                value={scanInput}
                inputMode={preventVirtualKeyboard ? "none" : "text"}
                onChange={(e) => setScanInput(e.target.value)}
                placeholder="Esperando lectura de carné..."
                className="w-full px-5 py-3.5 bg-slate-950 text-white rounded-2xl text-center font-mono text-base sm:text-lg font-bold border-2 border-indigo-500/70 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all placeholder:text-slate-500 shadow-md"
                autoComplete="off"
                spellCheck="false"
              />
            </form>

            <div className="flex items-center justify-center gap-3 pt-0.5">
              <button
                type="button"
                onClick={() => setPreventVirtualKeyboard(!preventVirtualKeyboard)}
                className={`text-[11px] font-bold px-3 py-1.5 rounded-xl border transition-all flex items-center gap-1.5 ${
                  preventVirtualKeyboard
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-zinc-800'
                    : 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Teclado Táctil Móvil: {preventVirtualKeyboard ? 'Oculto (Lector USB)' : 'Visible (Manual)'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="py-2">
            <CameraScanner 
              onScan={(code) => handleExecuteScan(code, 'CAMERA')} 
              isProcessing={isProcessing}
            />
          </div>
        )}

        {/* Real-time Feedback Card */}
        {lastFeedback && (
          <div 
            className={`p-4 sm:p-5 rounded-2xl border transition-all animate-fadeIn ${
              lastFeedback.type === 'success_punctual'
                ? 'bg-emerald-50/90 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/80 text-emerald-950 dark:text-emerald-100'
                : lastFeedback.type === 'success_tardy'
                ? 'bg-amber-50/90 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800/80 text-amber-950 dark:text-amber-100'
                : lastFeedback.type === 'already_scanned'
                ? 'bg-indigo-50/90 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800/80 text-indigo-950 dark:text-indigo-100'
                : 'bg-rose-50/90 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800/80 text-rose-950 dark:text-rose-100'
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div className="shrink-0">
                {lastFeedback.type === 'success_punctual' ? (
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                ) : lastFeedback.type === 'success_tardy' ? (
                  <AlertTriangle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                ) : (
                  <XCircle className="w-8 h-8 text-rose-600 dark:text-rose-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm sm:text-base font-black truncate">
                    {lastFeedback.title}
                  </h4>
                  <span className="text-[10px] font-mono opacity-70">
                    {new Date(lastFeedback.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-xs sm:text-sm mt-0.5 leading-snug opacity-90">
                  {lastFeedback.message}
                </p>
                {lastFeedback.student && (
                  <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-current/10 text-xs font-bold">
                    <span className="px-2 py-0.5 rounded-md bg-current/10 font-mono">
                      CÓD: {lastFeedback.student.code}
                    </span>
                    <span>{lastFeedback.student.firstName} {lastFeedback.student.lastName}</span>
                    <span className="opacity-60">•</span>
                    <span className="text-indigo-600 dark:text-indigo-300">Grado: {lastFeedback.student.grade}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Recent Scans Strip */}
      <div className="p-5 sm:p-6 rounded-3xl bg-white/80 dark:bg-zinc-950/80 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-xs space-y-3.5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50/80 pb-3">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
              Últimos Registros del Día
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400 font-bold">
            {recentScans.length} registros recientes
          </span>
        </div>

        {recentScans.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {recentScans.map((record) => (
              <div 
                key={record.id} 
                className="p-3 rounded-2xl bg-slate-50 dark:bg-black/70 border border-slate-200/80 dark:border-zinc-800/50/80 flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="min-w-0">
                  <p className="font-bold text-xs text-slate-900 dark:text-white truncate">
                    {record.studentName}
                  </p>
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {record.grade} • DOC: {record.studentDocument} • {record.time}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span 
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      record.status === 'PUNTUAL'
                        ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {record.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-slate-400">
            Aún no se registran escaneos en la sesión de hoy.
          </div>
        )}
      </div>
    </div>
  );
};
