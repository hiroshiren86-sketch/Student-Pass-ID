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
  AlertTriangle
} from 'lucide-react';
import { SchoolSettings } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';

interface SettingsModalProps {
  onClose: () => void;
  onSaved: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, onSaved }) => {
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());
  const [showSavedToast, setShowSavedToast] = useState(false);

  const handleChange = (field: keyof SchoolSettings, value: string | number | boolean) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    AttendanceStorageService.saveSettings(settings);
    setShowSavedToast(true);
    setTimeout(() => {
      setShowSavedToast(false);
      onSaved();
      onClose();
    }, 600);
  };

  const handleResetData = () => {
    if (window.confirm('¿Deseas reiniciar todos los registros de prueba y restaurar los 50 estudiantes y datos de ejemplo iniciales?')) {
      AttendanceStorageService.resetToDemo();
      onSaved();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn" id="settings-modal">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-md w-full p-6 shadow-2xl relative space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Configuración de Jornada</h3>
              <p className="text-xs text-slate-400">Horarios, reglas de tardanza y seguridad</p>
            </div>
          </div>
          <button
            onClick={onClose}
            id="btn-close-settings"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* School Name */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Nombre de la Institución Educativa
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={settings.schoolName}
                onChange={(e) => handleChange('schoolName', e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 text-white text-xs pl-9 pr-3 py-2.5 rounded-xl outline-none"
                required
              />
            </div>
          </div>

          {/* Time & Grace Period */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Hora de Inicio (Ingreso)
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="time"
                  value={settings.dailyStartTime}
                  onChange={(e) => handleChange('dailyStartTime', e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 text-white text-xs pl-9 pr-3 py-2.5 rounded-xl outline-none font-mono"
                  required
                />
              </div>
              <span className="text-[10px] text-slate-400 block mt-1">Horario regular de apertura</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Tolerancia Tardanza
              </label>
              <div className="flex items-center">
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={settings.tardyGracePeriodMinutes}
                  onChange={(e) => handleChange('tardyGracePeriodMinutes', Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 text-white text-xs px-3 py-2.5 rounded-xl outline-none font-mono"
                  required
                />
                <span className="text-xs text-slate-400 ml-2">min</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-1">
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

          {/* Sound Feedback Toggle */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {settings.soundFeedback ? (
                <Volume2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-500" />
              )}
              <div>
                <p className="text-xs font-bold text-white">Alertas Sonoras (Web Audio API)</p>
                <p className="text-[10px] text-slate-400">Sonido sintético instantáneo al escanear</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.soundFeedback}
              onChange={(e) => handleChange('soundFeedback', e.target.checked)}
              className="w-5 h-5 rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
            />
          </div>

          {/* Secret HMAC Key */}
          <div className="pt-2 border-t border-slate-800">
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Clave Secreta HMAC-SHA256 (Anti-Falsificación)
            </label>
            <div className="relative">
              <ShieldCheck className="w-4 h-4 text-emerald-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={settings.secretHmacKey}
                onChange={(e) => handleChange('secretHmacKey', e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 text-white text-xs pl-9 pr-3 py-2 rounded-xl outline-none font-mono"
              />
            </div>
            <span className="text-[10px] text-slate-400 block mt-1">
              Firma los carnés digitales determinísticamente
            </span>
          </div>

          {/* Actions */}
          <div className="pt-4 flex items-center justify-between gap-3 border-t border-slate-800">
            <button
              type="button"
              onClick={handleResetData}
              className="px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
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
