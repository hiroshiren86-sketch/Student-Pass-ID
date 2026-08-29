import React, { useState, useEffect, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { 
  Building2, 
  Clock, 
  Users, 
  CheckCircle2, 
  AlertTriangle, 
  UserX, 
  Settings, 
  Volume2, 
  VolumeX, 
  GraduationCap, 
  QrCode, 
  Scan, 
  ShieldCheck, 
  RotateCcw,
  Sparkles,
  Info
} from 'lucide-react';
import { 
  Student, 
  AttendanceRecord, 
  ScanResultFeedback, 
  AttendanceMethod, 
  AttendanceStatus,
  SchoolSettings 
} from './types/attendance';
import { AttendanceStorageService, getTodayDateString } from './services/attendanceStorage';
import { SoundEffects } from './utils/sound';
import { ScannerHub } from './components/ScannerHub';
import { ScanFeedbackBanner } from './components/ScanFeedbackBanner';
import { AttendanceTable } from './components/AttendanceTable';
import { StudentCardModal } from './components/StudentCardModal';
import { StudentDirectoryModal } from './components/StudentDirectoryModal';
import { SettingsModal } from './components/SettingsModal';

export default function App() {
  // Application State
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());
  const [feedback, setFeedback] = useState<ScanResultFeedback | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDateFormatted, setCurrentDateFormatted] = useState<string>('');

  // Modals state
  const [selectedStudentForCard, setSelectedStudentForCard] = useState<Student | null>(null);
  const [isDirectoryOpen, setIsDirectoryOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Refresh records and settings from storage
  const refreshData = useCallback(() => {
    setRecords(AttendanceStorageService.getAllAttendance());
    setSettings(AttendanceStorageService.getSettings());
  }, []);

  // Subscribe to storage changes & initial load
  useEffect(() => {
    refreshData();
    const unsub = AttendanceStorageService.subscribe(() => {
      refreshData();
    });
    return unsub;
  }, [refreshData]);

  // Live Clock loop
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      setCurrentDateFormatted(now.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // Master Scan Handler (Receives scan from USB HID, Live Camera, or Manual)
  const handleScanReceived = async (
    scanInput: string, 
    method: AttendanceMethod, 
    customStatus?: AttendanceStatus, 
    notes?: string
  ) => {
    setIsProcessing(true);

    try {
      const result = await AttendanceStorageService.registerScan({
        scanInput,
        method,
        customStatus,
        notes
      });

      setFeedback(result);

      // Trigger audio feedback according to result and user settings
      if (settings.soundFeedback) {
        if (result.type === 'success_punctual') {
          SoundEffects.playPunctual();
          // Gentle confetti burst for punctual entrance
          try {
            confetti({
              particleCount: 35,
              spread: 60,
              origin: { y: 0.75 },
              colors: ['#10b981', '#3b82f6', '#6366f1']
            });
          } catch {}
        } else if (result.type === 'success_tardy') {
          SoundEffects.playTardy();
        } else if (result.type === 'already_scanned') {
          SoundEffects.playAlreadyScanned();
        } else {
          SoundEffects.playError();
        }
      }

      // Auto-dismiss feedback after 8 seconds (or user can close anytime)
      setTimeout(() => {
        setFeedback(prev => (prev?.timestamp === result.timestamp ? null : prev));
      }, 8000);
    } catch (err) {
      console.error('Error during scan registration:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Calculate live stats
  const summary = AttendanceStorageService.getSummary(getTodayDateString());

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* ================= TOP APPLICATION HEADER ================= */}
      <header className="border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          {/* Institution Branding */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-extrabold text-white tracking-tight leading-none">
                  {settings.schoolName}
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" /> Prototipo $0 • Etapa 1
                </span>
              </div>
              <p className="text-xs text-slate-400 capitalize mt-0.5">
                {currentDateFormatted || 'Cargando fecha...'}
              </p>
            </div>
          </div>

          {/* Live Clock & Navigation Actions */}
          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            {/* Live Clock Pill */}
            <div className="bg-slate-950 px-3.5 py-1.5 rounded-2xl border border-slate-800 flex items-center gap-2 shadow-inner">
              <Clock className="w-4 h-4 text-cyan-400 animate-pulse" />
              <span className="font-mono text-xs sm:text-sm font-bold text-white tracking-wider">
                {currentTime || '07:00:00 AM'}
              </span>
            </div>

            {/* Student Directory & Cards */}
            <button
              onClick={() => setIsDirectoryOpen(true)}
              id="btn-open-directory"
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-semibold border border-slate-700 transition-colors flex items-center gap-1.5 shadow-sm"
              title="Ver lista de estudiantes y carnés"
            >
              <GraduationCap className="w-4 h-4 text-indigo-400" />
              <span className="hidden md:inline">Directorio & Carnés</span>
            </button>

            {/* Sound Toggle */}
            <button
              onClick={() => {
                const updated = { ...settings, soundFeedback: !settings.soundFeedback };
                AttendanceStorageService.saveSettings(updated);
                setSettings(updated);
              }}
              id="btn-toggle-sound"
              className={`p-2 rounded-xl border transition-colors ${
                settings.soundFeedback
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
              }`}
              title={settings.soundFeedback ? 'Alertas sonoras activadas' : 'Alertas sonoras silenciadas'}
            >
              {settings.soundFeedback ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Settings Modal Button */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              id="btn-open-settings"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Configuración de horarios y jornada"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ================= MAIN CONTENT BODY ================= */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full space-y-6 flex-1">
        {/* Anti-Riesgos / Legal Notice Banner */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              <strong className="text-slate-200">Prototipo Seguro Anti-Riesgos:</strong> Datos 100% ficticios conformes a la Ley 1581. Firma HMAC-SHA256 client-side sin costos de nube.
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-500 shrink-0">
            Jornada Escolar: {settings.dailyStartTime} (Tolerancia: {settings.tardyGracePeriodMinutes} min)
          </span>
        </div>

        {/* ================= SUMMARY STATS KPI CARDS ================= */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4" id="stats-summary-grid">
          {/* Total Matriculados */}
          <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl flex flex-col justify-between shadow-lg">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">Matriculados</span>
              <Users className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
                {summary.totalEnrolled}
              </span>
              <span className="text-xs text-slate-400">estudiantes</span>
            </div>
          </div>

          {/* Asistencia Presentes */}
          <div className="bg-slate-900 border border-indigo-500/30 p-4 rounded-2xl flex flex-col justify-between shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 left-0 h-1 bg-indigo-500" />
            <div className="flex items-center justify-between text-indigo-300 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">Presentes Hoy</span>
              <Scan className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-2xl sm:text-3xl font-extrabold text-indigo-200 font-mono">
                {summary.totalPresent}
              </span>
              <span className="text-xs font-bold text-indigo-400 font-mono px-2 py-0.5 bg-indigo-500/10 rounded-full">
                {summary.attendanceRate}% Asistencia
              </span>
            </div>
          </div>

          {/* Puntuales */}
          <div className="bg-slate-900 border border-emerald-500/30 p-4 rounded-2xl flex flex-col justify-between shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 left-0 h-1 bg-emerald-500" />
            <div className="flex items-center justify-between text-emerald-300 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">A Tiempo (Puntual)</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-300 font-mono">
                {summary.punctualCount}
              </span>
              <span className="text-xs text-emerald-500">
                {summary.totalPresent > 0 ? `${Math.round((summary.punctualCount / summary.totalPresent) * 100)}% de los presentes` : '0%'}
              </span>
            </div>
          </div>

          {/* Tardanzas */}
          <div className="bg-slate-900 border border-amber-500/30 p-4 rounded-2xl flex flex-col justify-between shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 left-0 h-1 bg-amber-500" />
            <div className="flex items-center justify-between text-amber-300 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">Tardanzas</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-300 font-mono">
                {summary.tardyCount}
              </span>
              <span className="text-xs text-amber-500">
                {summary.totalPresent > 0 ? `${Math.round((summary.tardyCount / summary.totalPresent) * 100)}% de los presentes` : '0%'}
              </span>
            </div>
          </div>

          {/* Ausentes Proyectados */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col justify-between shadow-lg col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">Ausentes (Sin Registro)</span>
              <UserX className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-300 font-mono">
                {summary.absentCount}
              </span>
              <span className="text-xs text-slate-500">
                por registrar
              </span>
            </div>
          </div>
        </div>

        {/* ================= SCAN FEEDBACK BANNER (TRIGGERED ON SCAN) ================= */}
        <ScanFeedbackBanner
          feedback={feedback}
          onDismiss={() => setFeedback(null)}
        />

        {/* ================= CORE SCANNER HUB ================= */}
        <ScannerHub
          onScanReceived={handleScanReceived}
          isProcessing={isProcessing}
          onOpenCardModal={(student) => setSelectedStudentForCard(student)}
        />

        {/* ================= ATTENDANCE TABLE & LIVE FEED ================= */}
        <AttendanceTable
          records={records}
          onOpenCardModal={(student) => setSelectedStudentForCard(student)}
          onRefresh={refreshData}
        />
      </main>

      {/* ================= MODALS ================= */}
      {/* Student ID Card with Cryptographic QR */}
      {selectedStudentForCard && (
        <StudentCardModal
          student={selectedStudentForCard}
          onClose={() => setSelectedStudentForCard(null)}
          onSimulateScan={(payload, method) => handleScanReceived(payload, method)}
        />
      )}

      {/* Student Directory Modal */}
      {isDirectoryOpen && (
        <StudentDirectoryModal
          onClose={() => setIsDirectoryOpen(false)}
          onSelectStudentCard={(student) => setSelectedStudentForCard(student)}
          todayRecords={records}
        />
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <SettingsModal
          onClose={() => setIsSettingsOpen(false)}
          onSaved={refreshData}
        />
      )}

      {/* ================= FOOTER ================= */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Sistema de Registro de Asistencia Escolar con Carné Digital • Versión Consolidada 2026</span>
          <span className="font-mono text-[11px] text-slate-600">
            Arquitectura: WebCrypto HMAC-SHA256 • Storage Optimizado • Modo USB HID / Cámara QR
          </span>
        </div>
      </footer>
    </div>
  );
}
