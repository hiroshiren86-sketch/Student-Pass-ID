import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Scan, 
  Camera, 
  Search, 
  Keyboard, 
  Zap, 
  CheckCircle2, 
  Clock, 
  UserPlus, 
  ShieldAlert, 
  SlidersHorizontal,
  Sparkles,
  QrCode
} from 'lucide-react';
import { CameraScanner } from './CameraScanner';
import { Student, AttendanceMethod, AttendanceStatus } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { generateStudentQrPayload } from '../utils/crypto';

interface ScannerHubProps {
  onScanReceived: (scanInput: string, method: AttendanceMethod, customStatus?: AttendanceStatus, notes?: string) => void;
  isProcessing: boolean;
  onOpenCardModal: (student: Student) => void;
}

export const ScannerHub: React.FC<ScannerHubProps> = ({ 
  onScanReceived, 
  isProcessing,
  onOpenCardModal
}) => {
  const [activeTab, setActiveTab] = useState<'usb' | 'camera' | 'manual'>('usb');
  
  // USB Scanner State
  const [usbInputText, setUsbInputText] = useState<string>('');
  const [isUsbModeActive, setIsUsbModeActive] = useState<boolean>(true);
  const [lastScannedCode, setLastScannedCode] = useState<string>('');
  const usbInputRef = useRef<HTMLInputElement | null>(null);

  // Manual Mode State
  const [manualQuery, setManualQuery] = useState<string>('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [manualStatus, setManualStatus] = useState<AttendanceStatus>('punctual');
  const [manualNotes, setManualNotes] = useState<string>('');
  const [allStudents, setAllStudents] = useState<Student[]>([]);

  useEffect(() => {
    setAllStudents(AttendanceStorageService.getStudents());
    const unsub = AttendanceStorageService.subscribe(() => {
      setAllStudents(AttendanceStorageService.getStudents());
    });
    return unsub;
  }, []);

  // USB Auto-focus loop
  useEffect(() => {
    if (activeTab === 'usb' && isUsbModeActive) {
      const focusInterval = setInterval(() => {
        if (usbInputRef.current && document.activeElement !== usbInputRef.current) {
          // If user is not typing in another input, regain focus
          const tag = document.activeElement?.tagName.toLowerCase();
          if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
            usbInputRef.current.focus();
          }
        }
      }, 800);
      return () => clearInterval(focusInterval);
    }
  }, [activeTab, isUsbModeActive]);

  // Handle USB Keydown (Enter triggers scan submission)
  const handleUsbKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = usbInputText.trim();
      if (code.length > 0) {
        setLastScannedCode(code);
        onScanReceived(code, 'usb_scanner');
        setUsbInputText('');
      }
    }
  };

  // Handle Camera Scan
  const handleCameraScan = (decodedText: string) => {
    setLastScannedCode(decodedText);
    onScanReceived(decodedText, 'camera_qr');
  };

  // Handle Manual Submit
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;
    onScanReceived(selectedStudent.documentId, 'manual_entry', manualStatus, manualNotes);
    setSelectedStudent(null);
    setManualQuery('');
    setManualNotes('');
  };

  // Fast Simulator Quick Click (Tests signed QR or raw barcode instantly)
  const handleSimulateScan = async (student: Student, useQrSignature: boolean) => {
    if (useQrSignature) {
      const payload = await generateStudentQrPayload(student);
      onScanReceived(payload, 'camera_qr');
    } else {
      onScanReceived(student.documentId, 'usb_scanner');
    }
  };

  // Filter students for manual search
  const filteredStudents = manualQuery.trim() === ''
    ? []
    : allStudents.filter(s => 
        s.firstName.toLowerCase().includes(manualQuery.toLowerCase()) ||
        s.lastName.toLowerCase().includes(manualQuery.toLowerCase()) ||
        s.documentId.includes(manualQuery) ||
        s.grade.toLowerCase().includes(manualQuery.toLowerCase())
      ).slice(0, 6);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl relative overflow-hidden" id="scanner-hub-container">
      {/* Tab Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-2xl border border-slate-800">
          <button
            onClick={() => setActiveTab('usb')}
            id="tab-usb-scanner"
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'usb'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Scan className="w-4 h-4" />
            <span>Lector USB HID (Portería)</span>
          </button>

          <button
            onClick={() => setActiveTab('camera')}
            id="tab-camera-scanner"
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'camera'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Cámara QR en Vivo</span>
          </button>

          <button
            onClick={() => setActiveTab('manual')}
            id="tab-manual-entry"
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'manual'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Search className="w-4 h-4" />
            <span>Registro Manual</span>
          </button>
        </div>

        {/* Live Status indicator */}
        <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1.5 rounded-full border border-slate-800">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span>LISTO PARA ESCANEO</span>
        </div>
      </div>

      {/* ================= TAB 1: USB HID SCANNER ================= */}
      {activeTab === 'usb' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-950 border border-indigo-500/20 rounded-2xl p-5 relative overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    Modo Ráfaga Manos Libres
                  </span>
                  <span className="text-xs text-slate-400">Pistola USB / Barcode / QR HID</span>
                </div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Escanea el carné con la pistola lectora USB
                </h3>
                <p className="text-xs text-slate-300">
                  El cursor se mantendrá auto-enfocado permanentemente para registrar a los estudiantes al pasar por la portería.
                </p>
              </div>

              {/* USB Input field */}
              <div className="w-full md:w-80 space-y-2">
                <div className="relative">
                  <input
                    ref={usbInputRef}
                    id="usb-scanner-input"
                    type="text"
                    value={usbInputText}
                    onChange={(e) => setUsbInputText(e.target.value)}
                    onKeyDown={handleUsbKeyDown}
                    placeholder="Esperando código..."
                    autoFocus
                    className="w-full bg-slate-950 border-2 border-indigo-500/80 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/20 text-white font-mono text-sm px-4 py-3 rounded-xl shadow-inner outline-none transition-all placeholder:text-slate-600"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      ENTER ↵
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
                    <input
                      type="checkbox"
                      checked={isUsbModeActive}
                      onChange={(e) => setIsUsbModeActive(e.target.checked)}
                      className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span>Auto-enfoque continuo</span>
                  </label>
                  {lastScannedCode && (
                    <span className="font-mono text-slate-400 truncate max-w-[150px]">
                      Último: {lastScannedCode}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Simulation Grid (Allows 1-click test of student barcodes) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Simulador Rápido de Escaneo (Prueba con 1 Click)
                </h4>
              </div>
              <span className="text-xs text-slate-400">
                Haz clic en cualquier estudiante para simular un escaneo físico
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[280px] overflow-y-auto pr-1">
              {allStudents.slice(0, 9).map((std) => (
                <div
                  key={std.id}
                  className="bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800/80 hover:border-indigo-500/50 p-2.5 rounded-xl transition-all flex items-center justify-between gap-2 group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {std.avatarUrl ? (
                      <img
                        src={std.avatarUrl}
                        alt={std.firstName}
                        className="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-xs shrink-0">
                        {std.firstName[0]}{std.lastName[0]}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">
                        {std.firstName} {std.lastName}
                      </p>
                      <p className="text-[11px] font-mono text-slate-400">
                        {std.grade} • Doc: {std.documentId}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleSimulateScan(std, false)}
                      title="Simular Escaneo USB de Código de Barras"
                      className="px-2 py-1 bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white rounded-lg text-[11px] font-medium transition-colors flex items-center gap-1"
                    >
                      <Scan className="w-3 h-3" /> USB
                    </button>
                    <button
                      onClick={() => onOpenCardModal(std)}
                      title="Ver Carné Digital con Código QR HMAC"
                      className="p-1 text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/20 rounded-lg transition-colors"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: LIVE CAMERA QR SCANNER ================= */}
      {activeTab === 'camera' && (
        <div className="space-y-4">
          <CameraScanner 
            onScan={handleCameraScan} 
            isPaused={isProcessing} 
          />
        </div>
      )}

      {/* ================= TAB 3: MANUAL SEARCH & REGISTRATION ================= */}
      {activeTab === 'manual' && (
        <div className="space-y-4">
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div className="relative">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Buscar Estudiante por Nombre, Documento o Grado
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={manualQuery}
                  onChange={(e) => {
                    setManualQuery(e.target.value);
                    if (selectedStudent) setSelectedStudent(null);
                  }}
                  placeholder="Ej. Santiago, 1025890123, 11°, Gómez..."
                  className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-white text-sm pl-10 pr-4 py-2.5 rounded-xl outline-none transition-all placeholder:text-slate-500"
                />
              </div>

              {/* Autocomplete Dropdown */}
              {filteredStudents.length > 0 && !selectedStudent && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl z-30 overflow-hidden divide-y divide-slate-800">
                  {filteredStudents.map((std) => (
                    <button
                      type="button"
                      key={std.id}
                      onClick={() => {
                        setSelectedStudent(std);
                        setManualQuery(`${std.firstName} ${std.lastName} (${std.documentId})`);
                      }}
                      className="w-full text-left p-3 hover:bg-indigo-950/50 flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {std.avatarUrl ? (
                          <img src={std.avatarUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-indigo-600/30 text-indigo-300 flex items-center justify-center font-bold text-xs">
                            {std.firstName[0]}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {std.firstName} {std.lastName}
                          </p>
                          <p className="text-xs text-slate-400">
                            Grado {std.grade}-{std.section} • Documento: <span className="font-mono text-slate-300">{std.documentId}</span>
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-indigo-400 font-medium px-2 py-1 rounded bg-indigo-500/10">
                        Seleccionar
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected Student Card */}
            {selectedStudent && (
              <div className="p-4 bg-indigo-950/30 border border-indigo-500/40 rounded-2xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {selectedStudent.avatarUrl ? (
                    <img src={selectedStudent.avatarUrl} alt="" className="w-12 h-12 rounded-xl object-cover border border-indigo-400/30" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-base">
                      {selectedStudent.firstName[0]}{selectedStudent.lastName[0]}
                    </div>
                  )}
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      {selectedStudent.firstName} {selectedStudent.lastName}
                    </h4>
                    <p className="text-xs text-slate-300 font-mono">
                      {selectedStudent.documentType}: {selectedStudent.documentId} • Grado: {selectedStudent.grade}-{selectedStudent.section}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Acudiente: {selectedStudent.guardianName} ({selectedStudent.guardianPhone})
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedStudent(null);
                    setManualQuery('');
                  }}
                  className="text-xs text-slate-400 hover:text-rose-400 underline"
                >
                  Cambiar
                </button>
              </div>
            )}

            {/* Status & Notes controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                  Estado del Registro
                </label>
                <select
                  value={manualStatus}
                  onChange={(e) => setManualStatus(e.target.value as AttendanceStatus)}
                  className="w-full bg-slate-950 border border-slate-700 text-white text-sm px-3 py-2.5 rounded-xl outline-none focus:border-indigo-500"
                >
                  <option value="punctual">Puntual (A tiempo)</option>
                  <option value="tardy">Tardanza (Con justificación o retraso)</option>
                  <option value="justified">Permiso Especial / Justificado</option>
                  <option value="early_departure">Ingreso Excepcional</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                  Observación o Motivo (Opcional)
                </label>
                <input
                  type="text"
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Ej. Cita médica, transporte demorado..."
                  className="w-full bg-slate-950 border border-slate-700 text-white text-sm px-3 py-2.5 rounded-xl outline-none focus:border-indigo-500 placeholder:text-slate-600"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!selectedStudent}
              id="btn-submit-manual-attendance"
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                selectedStudent
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>Registrar Asistencia Manual</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
