import React, { useState } from 'react';
import { 
  X, 
  Settings, 
  Clock, 
  ShieldCheck, 
  Volume2, 
  VolumeX, 
  RotateCcw, 
  Save, 
  Building2, 
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Cloud,
  RefreshCw
} from 'lucide-react';
import { SchoolSettings } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { FirebaseService } from '../services/firebase';

interface SettingsModalProps {
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [cloudSyncMsg, setCloudSyncMsg] = useState<string | null>(null);

  const handleChange = (field: keyof SchoolSettings, value: string | number | boolean) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleCloudSync = async () => {
    setIsSyncingCloud(true);
    setCloudSyncMsg(null);
    try {
      const data = {
        students: AttendanceStorageService.getStudents(),
        teachers: AttendanceStorageService.getTeachers(),
        settings: settings,
        records: AttendanceStorageService.getAllAttendance(),
        assignments: AttendanceStorageService.getScheduleAssignments()
      };
      const res = await FirebaseService.backupAllToFirestore(data);
      setCloudSyncMsg(res.message);
    } catch (e: any) {
      setCloudSyncMsg(`Error al respaldar en Firebase: ${e.message || e}`);
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    AttendanceStorageService.saveSettings(settings);
    setShowSavedToast(true);
    setTimeout(() => {
      setShowSavedToast(false);
      onClose();
    }, 600);
  };

  const handleResetData = () => {
    if (window.confirm('¿Deseas reiniciar todos los registros de prueba y restaurar los 50 estudiantes y datos de ejemplo iniciales?')) {
      AttendanceStorageService.resetToDemo();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 dark:bg-slate-950/85 backdrop-blur-md animate-fadeIn" id="settings-modal">
      <div className="glass-panel rounded-3xl max-w-md w-full p-4 sm:p-6 shadow-2xl relative space-y-5 max-h-[92vh] overflow-y-auto transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-2xl shadow-xs">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Configuración Institucional</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Jornada escolar, horarios y nube Firebase</p>
            </div>
          </div>
          <button
            onClick={onClose}
            id="btn-close-settings"
            className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* School Name */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Nombre de la Institución Educativa
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={settings.schoolName}
                onChange={(e) => handleChange('schoolName', e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-indigo-500 text-slate-900 dark:text-white text-xs pl-9 pr-3 py-2.5 rounded-xl outline-none shadow-xs"
                required
              />
            </div>
          </div>

          {/* Time & Grace Period */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Hora de Inicio
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="time"
                  value={settings.dailyStartTime}
                  onChange={(e) => handleChange('dailyStartTime', e.target.value)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-indigo-500 text-slate-900 dark:text-white text-xs pl-9 pr-3 py-2.5 rounded-xl outline-none font-mono shadow-xs"
                  required
                />
              </div>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-1">Horario regular</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Tolerancia Tardanza
              </label>
              <div className="flex items-center">
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={settings.tardyGracePeriodMinutes}
                  onChange={(e) => handleChange('tardyGracePeriodMinutes', Number(e.target.value))}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-indigo-500 text-slate-900 dark:text-white text-xs px-3 py-2.5 rounded-xl outline-none font-mono shadow-xs"
                  required
                />
                <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">min</span>
              </div>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-1">
                Tardanza tras: {(() => {
                  const [h, m] = settings.dailyStartTime.split(':').map(Number);
                  const total = h * 60 + m + Number(settings.tardyGracePeriodMinutes);
                  const th = String(Math.floor(total / 60)).padStart(2, '0');
                  const tm = String(total % 60).padStart(2, '0');
                  return `${th}:${tm}`;
                })()}
              </span>
            </div>
          </div>

          {/* Secret QR HMAC Key */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Clave Secreta HMAC-SHA256 (QR_SECRET)
            </label>
            <div className="relative">
              <ShieldCheck className="w-4 h-4 text-emerald-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={settings.qrSecret}
                onChange={(e) => handleChange('qrSecret', e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-indigo-500 text-slate-900 dark:text-white text-xs pl-9 pr-3 py-2 rounded-xl outline-none font-mono shadow-xs"
              />
            </div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-1">
              Firma criptográfica determinista de carnés
            </span>
          </div>

          {/* Firebase Cloud Firestore Backup Button */}
          <div className="p-3.5 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-indigo-900 dark:text-indigo-200">
                <Cloud className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Nube Firebase Firestore</span>
              </div>
              <button
                type="button"
                onClick={handleCloudSync}
                disabled={isSyncingCloud}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[11px] font-bold shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCloud ? 'animate-spin' : ''}`} />
                <span>{isSyncingCloud ? 'Respaldando...' : 'Respaldar en Firestore'}</span>
              </button>
            </div>
            {cloudSyncMsg && (
              <p className="text-[10px] font-medium text-indigo-700 dark:text-indigo-300 bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-indigo-100 dark:border-indigo-900">
                {cloudSyncMsg}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="pt-4 flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={handleResetData}
              className="px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reiniciar Demo</span>
            </button>

            <button
              type="submit"
              id="btn-save-settings"
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>{showSavedToast ? '¡Guardado!' : 'Guardar Cambios'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
