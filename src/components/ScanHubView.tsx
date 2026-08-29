import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ScanLine, 
  Keyboard, 
  Camera, 
  Volume2, 
  VolumeX, 
  Clock, 
  Zap, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Wifi,
  WifiOff,
  RefreshCw,
  Sparkles,
  ArrowRight,
  Smartphone,
  Check
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
  const [scanType, setScanType] = useState<AttendanceType>('ENTRADA');
  const [scanInput, setScanInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<ScanResultFeedback | null>(null);
  const [currentTime, setCurrentTime] = useState(getCurrentTimeString());
  const [recentScans, setRecentScans] = useState<AttendanceRecord[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  
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
      AttendanceStorageService.syncOfflineQueue().then(() => {
        setOfflineQueueCount(AttendanceStorageService.getOfflineQueue().length);
      });
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    setOfflineQueueCount(AttendanceStorageService.getOfflineQueue().length);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Cargar registros recientes
  const refreshRecent = () => {
    const today = getTodayDateString();
    const records = AttendanceStorageService.getAttendanceByDate(today);
    setRecentScans(records.slice(0, 8));
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
      // El servicio registra directamente en LocalStorage/WebCrypto, garantizando soporte 100% Offline
      const feedback = await AttendanceStorageService.registerScan({
        scanInput: cleanInput,
        method: method,
        type: scanType
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
        } else if (feedback.type === 'success_tardy' || feedback.type === 'success_exit') {
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

  // Global Hardware USB Scanner Keystroke Burst Listener
  // Permite capturar ráfagas rápidas de lectores USB/OTG sin forzar foco ni abrir teclado virtual
  useEffect(() => {
    if (scanMethod !== 'USB') return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ignorar si el usuario está escribiendo intencionalmente en un textarea o input de otra vista
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

      // Si es un carácter imprimible
      if (e.key.length === 1) {
        // Si la ráfaga es rápida (< 75ms entre teclas), es un lector óptico por hardware
        if (timeDiff > 200 && bufferRef.current.length > 0) {
          bufferRef.current = ''; // Reiniciar buffer si hubo pausa manual
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
    <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn" id="scan-hub-view">
      {/* Top Banner with Digital Clock & Status */}
      <div className="p-6 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-indigo-600/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-2xl border border-indigo-200 dark:border-indigo-500/30">
            <ScanLine className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                PORTERÍA • CAPTURA DIRECTA
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <Wifi className="w-3 h-3" /> 100% Offline-Ready
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5">
              Terminal de Control de Acceso
            </h2>
          </div>
        </div>

        {/* Live Clock & Sound Toggle */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="px-3.5 py-2 bg-slate-900 dark:bg-slate-950 text-white rounded-2xl font-mono text-base sm:text-xl font-black tracking-widest border border-slate-800 shadow-inner">
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
                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
            }`}
            title={soundEnabled ? 'Sonido Activado (Clic para silenciar o probar)' : 'Sonido Silenciado (Clic para activar)'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Sonido ON' : 'Mudo'}</span>
          </button>
        </div>
      </div>

      {/* Mode Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Toggle Entrada / Salida */}
        <div className="p-2 bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl rounded-2xl flex items-center gap-1.5 shadow-sm">
          <button
            onClick={() => setScanType('ENTRADA')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
              scanType === 'ENTRADA'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            ENTRADA (Matutina)
          </button>
          <button
            onClick={() => setScanType('SALIDA')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
              scanType === 'SALIDA'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            SALIDA (Tarde)
          </button>
        </div>

        {/* Toggle USB HID vs Cámara */}
        <div className="p-2 bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl rounded-2xl flex items-center gap-1.5 shadow-sm">
          <button
            onClick={() => setScanMethod('USB')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              scanMethod === 'USB'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
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
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Cámara Móvil / QR</span>
          </button>
        </div>
      </div>

      {/* Main Scanner Stage */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm space-y-6">
        {scanMethod === 'USB' ? (
          <div className="space-y-4 text-center max-w-lg mx-auto py-2">
            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Captura por Hardware USB / Inalámbrico
              </span>
              <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                Pase el carné por el lector de código
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Escaneo inmediato en menos de 0.5s sin necesidad de hacer clic.
              </p>
            </div>

            <form onSubmit={handleManualSubmit} className="relative">
              <input
                ref={inputRef}
                type="text"
                value={scanInput}
                inputMode={preventVirtualKeyboard ? "none" : "text"}
                onChange={(e) => setScanInput(e.target.value)}
                placeholder="Escaneando ráfaga USB..."
                className="w-full px-5 py-4 bg-slate-900 text-white dark:bg-slate-950 rounded-2xl text-center font-mono text-lg font-bold border-2 border-indigo-500/70 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all placeholder:text-slate-500 shadow-xl"
                autoComplete="off"
                spellCheck="false"
              />
            </form>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setPreventVirtualKeyboard(!preventVirtualKeyboard)}
                className={`text-[11px] font-bold px-3 py-1.5 rounded-xl border transition-all flex items-center gap-1.5 ${
                  preventVirtualKeyboard
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Bloquear teclado táctil en celular: {preventVirtualKeyboard ? 'Activado' : 'Desactivado'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-md mx-auto">
            {/* Camera View with zero virtual keyboard popup */}
            <CameraScanner
              onScan={(code) => handleExecuteScan(code, 'CAMERA')}
              isPaused={isProcessing}
            />
          </div>
        )}

        {/* Big Visual Result Feedback Card */}
        {lastFeedback && (
          <div
            className={`p-5 rounded-2xl border transition-all animate-fadeIn ${
              lastFeedback.type === 'success_punctual'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-200'
                : lastFeedback.type === 'success_tardy'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-200'
                : lastFeedback.type === 'success_exit'
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-950 dark:text-blue-200'
                : lastFeedback.type === 'already_scanned'
                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-950 dark:text-indigo-200'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-950 dark:text-rose-200'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 shrink-0 mt-0.5 shadow-sm">
                {lastFeedback.type === 'success_punctual' ? (
                  <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                ) : lastFeedback.type === 'success_tardy' ? (
                  <Clock className="w-7 h-7 text-amber-600 dark:text-amber-400" />
                ) : lastFeedback.type === 'success_exit' ? (
                  <ArrowRight className="w-7 h-7 text-blue-600 dark:text-blue-400" />
                ) : lastFeedback.type === 'already_scanned' ? (
                  <AlertTriangle className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
                ) : (
                  <XCircle className="w-7 h-7 text-rose-600 dark:text-rose-400" />
                )}
              </div>

              <div className="space-y-1 min-w-0 flex-1">
                <h4 className="text-base font-black tracking-tight">
                  {lastFeedback.title}
                </h4>
                <p className="text-xs sm:text-sm leading-relaxed opacity-90">
                  {lastFeedback.message}
                </p>
                {lastFeedback.student && (
                  <div className="pt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono">
                    <span className="px-2 py-0.5 bg-white dark:bg-slate-900 rounded-md font-bold text-slate-900 dark:text-white shadow-xs">
                      CÓD: {lastFeedback.student.code}
                    </span>
                    <span className="px-2 py-0.5 bg-white dark:bg-slate-900 rounded-md font-bold text-slate-900 dark:text-white shadow-xs">
                      DOC: {lastFeedback.student.documentId}
                    </span>
                    <span className="px-2 py-0.5 bg-white dark:bg-slate-900 rounded-md font-bold text-indigo-600 dark:text-indigo-400 shadow-xs">
                      GRADO: {lastFeedback.student.grade}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Recent Scans Strip */}
      <div className="p-5 sm:p-6 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Actividad Reciente en Portería
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400 font-bold">
            {recentScans.length} escaneos hoy
          </span>
        </div>

        {recentScans.length === 0 ? (
          <div className="py-6 text-center text-slate-400 text-xs">
            Sin registros en la jornada actual.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {recentScans.map((r) => (
              <div
                key={r.id}
                className="p-3 rounded-2xl bg-white/80 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {r.studentName}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1.5 mt-0.5">
                    <span>{r.studentGrade}</span>
                    <span>•</span>
                    <span>DOC: {r.studentDocument}</span>
                    <span>•</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300">{r.time}</span>
                  </div>
                </div>

                <div>
                  {r.status === 'PUNTUAL' ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                      Puntual
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                      Tardanza
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
