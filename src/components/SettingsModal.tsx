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
  RefreshCw,
  Calendar,
  Layers,
  Zap,
  Lock,
  Eye,
  EyeOff,
  Server,
  Globe
} from 'lucide-react';
import { SchoolSettings, DayTemplateId } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { FirebaseService } from '../services/firebase';
import { CloudflareSyncService, CloudflareSyncResult } from '../services/cloudflareSync';
import { AiService } from '../services/aiService';
import { AiProviderMark } from './AiProviderMark';
import { DAY_TEMPLATES_DEFINITIONS } from '../services/mockData';

interface SettingsModalProps {
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [cloudSyncMsg, setCloudSyncMsg] = useState<string | null>(null);
  const [isSyncingCloudflare, setIsSyncingCloudflare] = useState(false);
  const [cloudflareSyncResult, setCloudflareSyncResult] = useState<CloudflareSyncResult | null>(null);
  const [isTestingWorker, setIsTestingWorker] = useState(false);
  const [isPullingCloudflare, setIsPullingCloudflare] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showCloudflareToken, setShowCloudflareToken] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string; isRecommended?: boolean; isVision?: boolean; description?: string }>>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsFetchStatus, setModelsFetchStatus] = useState<string | null>(null);

  const fetchProviderModels = async (provider: string, customKey?: string) => {
    setIsLoadingModels(true);
    setModelsFetchStatus(null);
    try {
      const data = await AiService.getAvailableModels(provider, customKey);
      if (data.models && Array.isArray(data.models) && data.models.length > 0) {
        setAvailableModels(data.models);
        setModelsFetchStatus(`✓ ${data.models.length} modelos listos (${data.source})`);
        // Si no hay modelo seleccionado o el actual no pertenece a la lista, sugerir el recomendado
        const recommended = data.models.find((m: any) => m.isRecommended) || data.models[0];
        if (recommended && (!settings.aiModel || !data.models.some((m: any) => m.id === settings.aiModel))) {
          setSettings(prev => ({ ...prev, aiModel: recommended.id }));
        }
      }
    } catch (err: any) {
      console.warn('Error fetching models:', err);
      const fallback = AiService.getCuratedCatalog(provider);
      setAvailableModels(fallback);
      setModelsFetchStatus('Catálogo verificado activo');
    } finally {
      setIsLoadingModels(false);
    }
  };

  // Cargar modelos al montar o al cambiar proveedor
  React.useEffect(() => {
    fetchProviderModels(settings.aiProvider || 'groq', settings.customAiApiKey);
  }, [settings.aiProvider]);

  // Regla E10: Cerrar modal de ajustes con la tecla Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleChange = (field: keyof SchoolSettings, value: string | number | boolean) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleDayTemplateChange = (templateId: DayTemplateId) => {
    setSettings(prev => ({ ...prev, activeDayTemplate: templateId }));
    AttendanceStorageService.applyDayTemplate(templateId);
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
        assignments: AttendanceStorageService.getScheduleAssignments(),
        scheduleSlots: AttendanceStorageService.getScheduleSlots()
      };
      const res = await FirebaseService.backupAllToFirestore(data);
      setCloudSyncMsg(res.message);
    } catch (e: any) {
      setCloudSyncMsg(`Error al respaldar en Firebase: ${e.message || e}`);
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const handleTestWorker = async () => {
    AttendanceStorageService.saveSettings(settings);
    setIsTestingWorker(true);
    try {
      const res = await CloudflareSyncService.testWorkerConnection(settings.cloudflareWorkerUrl, settings.cloudflareApiToken);
      setCloudflareSyncResult({
        success: res.success,
        timestamp: new Date().toLocaleTimeString('es-CO'),
        syncedRecordsCount: 0,
        syncedStudentsCount: 0,
        message: res.message,
        target: 'Cloudflare Worker'
      });
    } finally {
      setIsTestingWorker(false);
    }
  };

  const handlePullCloudflare = async () => {
    AttendanceStorageService.saveSettings(settings);
    if (!window.confirm('¿Deseas descargar los datos de asistencia y estudiantes desde Cloudflare para sincronizar este dispositivo?')) {
      return;
    }
    setIsPullingCloudflare(true);
    try {
      const res = await CloudflareSyncService.pullFromCloudflare();
      setCloudflareSyncResult({
        success: res.success,
        timestamp: new Date().toLocaleTimeString('es-CO'),
        syncedRecordsCount: 0,
        syncedStudentsCount: 0,
        message: res.message,
        target: 'Cloudflare D1'
      });
    } finally {
      setIsPullingCloudflare(false);
    }
  };

  const handleCloudflareSync = async () => {
    setIsSyncingCloudflare(true);
    setCloudflareSyncResult(null);
    try {
      // Guardar primero para que use los tokens recién editados
      AttendanceStorageService.saveSettings(settings);
      const res = await CloudflareSyncService.performCloudflareSync();
      setCloudflareSyncResult(res);
    } catch (err: any) {
      setCloudflareSyncResult({
        success: false,
        timestamp: new Date().toLocaleTimeString('es-CO'),
        syncedRecordsCount: 0,
        syncedStudentsCount: 0,
        message: `Error al sincronizar con Cloudflare: ${err.message || err}`,
        target: 'Cloudflare D1'
      });
    } finally {
      setIsSyncingCloudflare(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    AttendanceStorageService.saveSettings(settings);
    if (settings.activeDayTemplate) {
      AttendanceStorageService.applyDayTemplate(settings.activeDayTemplate);
    }
    CloudflareSyncService.initAutoSync();
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

  const activeTemplateDef = DAY_TEMPLATES_DEFINITIONS.find(t => t.id === settings.activeDayTemplate) || DAY_TEMPLATES_DEFINITIONS[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 dark:bg-slate-950/85 backdrop-blur-md animate-fadeIn" id="settings-modal">
      <div className="glass-panel rounded-3xl max-w-xl w-full p-4 sm:p-6 shadow-2xl relative space-y-5 max-h-[92vh] overflow-y-auto transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-2xl shadow-xs">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Configuración Institucional</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Jornadas, IA Multi-Proveedor, Criptografía, Cloudflare D1 & Firebase</p>
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

          {/* Day Template Selector (Día Normal, Recorte, Izada, Asesoría, Especial) */}
          <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-indigo-950 dark:text-indigo-200">
                <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Plantilla de Jornada Activa (DayTemplate)</span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-200 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200">
                {activeTemplateDef.blockDurationMinutes} min / bloque
              </span>
            </div>

            <select
              value={settings.activeDayTemplate || 'NORMAL'}
              onChange={(e) => handleDayTemplateChange(e.target.value as DayTemplateId)}
              className="w-full bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 text-slate-900 dark:text-white text-xs font-bold px-3 py-2 rounded-xl outline-none"
            >
              {DAY_TEMPLATES_DEFINITIONS.map(tpl => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.blockDurationMinutes}m - {tpl.totalBlocks} bloques)
                </option>
              ))}
            </select>

            <p className="text-[11px] text-indigo-700 dark:text-indigo-300 leading-relaxed">
              {activeTemplateDef.description}
            </p>
          </div>

          {/* Time & Grace Period */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Hora de Inicio de Jornada
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
                  const [h, m] = (settings.dailyStartTime || '06:30').split(':').map(Number);
                  const total = h * 60 + m + Number(settings.tardyGracePeriodMinutes || 10);
                  const th = String(Math.floor(total / 60)).padStart(2, '0');
                  const tm = String(total % 60).padStart(2, '0');
                  return `${th}:${tm}`;
                })()}
              </span>
            </div>
          </div>

          {/* AI Engine & Multi-Provider Configuration */}
          <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-slate-900 dark:text-white">
                <AiProviderMark provider={settings.aiProvider} active={Boolean(settings.customAiApiKey?.trim())} className="w-4 h-4" />
                <span>Motor de Inteligencia Artificial (Mistral, Groq, OpenRouter, Gemini, OpenAI)</span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 uppercase flex items-center gap-1">
                <AiProviderMark provider={settings.aiProvider} active={Boolean(settings.customAiApiKey?.trim())} className="w-3 h-3" />
                {settings.customAiApiKey?.trim() ? 'Activa' : 'Sin clave'}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
              IA 100% local: el navegador consulta directo al proveedor con tu clave (BYOK). Sin proxies ni servidores intermedios — el Worker solo sincroniza datos.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Proveedor IA Activo</label>
                <select
                  value={settings.aiProvider || 'groq'}
                  onChange={(e) => {
                    const newProvider = e.target.value as any;
                    const recommended = AiService.getDefaultModelForProvider(newProvider);
                    setSettings(prev => ({ ...prev, aiProvider: newProvider, aiModel: recommended }));
                    fetchProviderModels(newProvider, settings.customAiApiKey);
                  }}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs font-bold px-2.5 py-2 rounded-xl outline-none"
                >
                  <option value="groq">Groq Cloud (GPT-OSS 120B / Compound / LPU)</option>
                  <option value="mistral">Mistral AI (Mistral Small / Pixtral Vision)</option>
                  <option value="openrouter">OpenRouter (Multi-model Router)</option>
                  <option value="gemini">Google Gemini (Gemini 2.5 Flash)</option>
                  <option value="openai">OpenAI (GPT-4.1 Mini / GPT-4.1)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-bold uppercase text-slate-400">Modelo Seleccionado</label>
                  <button
                    type="button"
                    onClick={() => fetchProviderModels(settings.aiProvider || 'groq', settings.customAiApiKey)}
                    disabled={isLoadingModels}
                    className="text-[9px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${isLoadingModels ? 'animate-spin' : ''}`} />
                    <span>{isLoadingModels ? 'Consultando...' : 'Consultar API'}</span>
                  </button>
                </div>
                <select
                  value={settings.aiModel || (availableModels[0]?.id || '')}
                  onChange={(e) => handleChange('aiModel', e.target.value)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs font-bold px-2.5 py-2 rounded-xl outline-none"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.isRecommended ? '⭐ (Recomendado)' : ''} {m.isVision ? '👁️ (Visión)' : ''}
                    </option>
                  ))}
                  {/* Fallback si no hay lista cargada */}
                  {availableModels.length === 0 && (
                    <option value={settings.aiModel || 'default'}>{settings.aiModel || 'Modelo por defecto del proveedor'}</option>
                  )}
                </select>
                {modelsFetchStatus && (
                  <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium block mt-0.5">
                    {modelsFetchStatus}
                  </span>
                )}
              </div>
            </div>

            {/* Custom API Key input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[10px] font-bold uppercase text-slate-400">
                  API Key Personalizada ({settings.aiProvider?.toUpperCase() || 'MISTRAL/GROQ'})
                </label>
                <span className="text-[10px] text-slate-400">Se guarda solo en este dispositivo y viaja directo al proveedor</span>
              </div>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={settings.customAiApiKey || ''}
                  onChange={(e) => handleChange('customAiApiKey', e.target.value)}
                  placeholder={`Ingresa tu API Key de ${settings.aiProvider?.toUpperCase() || 'IA'}...`}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs pl-3 pr-9 py-2 rounded-xl outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Temperatura ({settings.aiTemperature ?? 0.2})</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.aiTemperature ?? 0.2}
                  onChange={(e) => handleChange('aiTemperature', parseFloat(e.target.value))}
                  className="w-full accent-indigo-600 mt-1"
                />
              </div>

              <div className="flex items-center justify-between pt-3">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Fallback Local (Offline)
                </span>
                <input
                  type="checkbox"
                  checked={settings.aiFallbackOfflineMode !== false}
                  onChange={(e) => handleChange('aiFallbackOfflineMode', e.target.checked)}
                  className="accent-indigo-600 w-4 h-4 rounded cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Cloudflare D1 & Worker Automated Connection */}
          <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-amber-950 dark:text-amber-200">
                <Server className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>Conexión y Sincronización Automática Cloudflare D1</span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-200 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
                {settings.cloudflareAutoSync !== false ? 'Auto-Sync Activo' : 'Manual'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                  Cloudflare Worker URL / D1 Endpoint
                </label>
                <input
                  type="text"
                  value={settings.cloudflareWorkerUrl || ''}
                  onChange={(e) => handleChange('cloudflareWorkerUrl', e.target.value)}
                  placeholder="https://inas-attendance-worker.hiroshiren86.workers.dev"
                  className="w-full bg-white dark:bg-slate-950 border border-amber-200 dark:border-amber-800 text-slate-900 dark:text-white text-xs px-2.5 py-2 rounded-xl outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                  Intervalo de Auto-Sincronización
                </label>
                <select
                  value={settings.cloudflareSyncIntervalMinutes || 5}
                  onChange={(e) => handleChange('cloudflareSyncIntervalMinutes', Number(e.target.value))}
                  className="w-full bg-white dark:bg-slate-950 border border-amber-200 dark:border-amber-800 text-slate-900 dark:text-white text-xs font-bold px-2.5 py-2 rounded-xl outline-none"
                >
                  <option value={1}>Cada 1 minuto (Tiempo Real)</option>
                  <option value={5}>Cada 5 minutos (Recomendado)</option>
                  <option value={15}>Cada 15 minutos</option>
                  <option value={30}>Cada 30 minutos</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                  Cloudflare Account ID (Opcional)
                </label>
                <input
                  type="text"
                  value={settings.cloudflareAccountId || ''}
                  onChange={(e) => handleChange('cloudflareAccountId', e.target.value)}
                  placeholder="ID de cuenta Cloudflare"
                  className="w-full bg-white dark:bg-slate-950 border border-amber-200 dark:border-amber-800 text-slate-900 dark:text-white text-xs px-2.5 py-2 rounded-xl outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                  Cloudflare API Token / D1 Database ID
                </label>
                <div className="relative">
                  <input
                    type={showCloudflareToken ? 'text' : 'password'}
                    value={settings.cloudflareApiToken || ''}
                    onChange={(e) => handleChange('cloudflareApiToken', e.target.value)}
                    placeholder="API Token con permisos D1:Edit"
                    className="w-full bg-white dark:bg-slate-950 border border-amber-200 dark:border-amber-800 text-slate-900 dark:text-white text-xs pl-2.5 pr-8 py-2 rounded-xl outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCloudflareToken(!showCloudflareToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    {showCloudflareToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-amber-200/60 dark:border-amber-900/60">
              <span className="text-[11px] text-amber-800 dark:text-amber-300">
                Última sync: {settings.lastCloudflareSync || 'No realizada aún'}
              </span>
              
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleTestWorker}
                  disabled={isTestingWorker || !settings.cloudflareWorkerUrl}
                  className="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 border border-amber-500/30 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-all disabled:opacity-40"
                  title="Verificar que el Worker responda correctamente"
                >
                  <Globe className={`w-3 h-3 ${isTestingWorker ? 'animate-spin' : ''}`} />
                  <span>{isTestingWorker ? 'Probando...' : 'Probar Conexión'}</span>
                </button>

                <button
                  type="button"
                  onClick={handlePullCloudflare}
                  disabled={isPullingCloudflare || !settings.cloudflareWorkerUrl}
                  className="px-2.5 py-1.5 bg-sky-600/15 hover:bg-sky-600/25 text-sky-900 dark:text-sky-200 border border-sky-500/30 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-all disabled:opacity-40"
                  title="Descargar estudiantes y asistencias desde Cloudflare a este dispositivo"
                >
                  <RefreshCw className={`w-3 h-3 ${isPullingCloudflare ? 'animate-spin' : ''}`} />
                  <span>{isPullingCloudflare ? 'Descargando...' : 'Descargar (Pull)'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCloudflareSync}
                  disabled={isSyncingCloudflare}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
                  title="Subir datos locales a la base de datos D1 y KV de Cloudflare"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCloudflare ? 'animate-spin' : ''}`} />
                  <span>{isSyncingCloudflare ? 'Subiendo...' : 'Sincronizar (Push)'}</span>
                </button>
              </div>
            </div>

            {cloudflareSyncResult && (
              <div className={`p-2.5 rounded-xl text-xs font-medium border flex items-center gap-2 ${
                cloudflareSyncResult.success 
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 text-rose-800 dark:text-rose-300'
              }`}>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{cloudflareSyncResult.message}</span>
              </div>
            )}
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
              Firma criptográfica determinista de carnés escolares
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

