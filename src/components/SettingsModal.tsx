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
  Trash2,
  RefreshCw,
  Calendar,
  Layers,
  Zap,
  Lock,
  Eye,
  EyeOff,
  Server,
  Globe,
  BrainCircuit,
  School as SchoolIcon
} from 'lucide-react';
import { SchoolSettings } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { FirebaseService } from '../services/firebase';
import { CloudflareSyncService, CloudflareSyncResult } from '../services/cloudflareSync';
import { AiService } from '../services/aiService';
import { AiProviderMark } from './AiProviderMark';
import { ConfirmDialog } from './ConfirmDialog';
import { enablePush, disablePush, getPushStatus } from '../services/pushService';
import { BackupRestoreSection } from './BackupRestoreSection'; // Ronda 27 (§3): respaldo local export/import
import { CloudPurgeSection } from './CloudPurgeSection'; // Ronda 28: copia de nube + purga D1/KV con confirmación tipeada
import { BellRing, BellOff } from 'lucide-react';

import { SyncOverlay } from './SyncOverlay';

interface SettingsModalProps {
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());
  const [showSavedToast, setShowSavedToast] = useState(false);
  // Ronda 25 (P1 del informe QA externo): 3 pestañas internas — los inputs PERMANECEN
  // montados (solo se ocultan con CSS) → cero cambios de estado, validaciones ni save.
  const [settingsTab, setSettingsTab] = useState<'institucion' | 'ia' | 'sync'>('institucion');
  const settingsTabs: Array<{ id: 'institucion' | 'ia' | 'sync'; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'institucion', label: 'Institución y Jornada', icon: SchoolIcon },
    { id: 'ia', label: 'Inteligencia Artificial', icon: BrainCircuit },
    { id: 'sync', label: 'Sync y Seguridad', icon: Server },
  ];
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  // Ronda 23 (P4): notificaciones push de excusas (por dispositivo)
  const [pushStatus, setPushStatus] = useState<{ supported: boolean; permission: string; subscribed: boolean } | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  // Ronda 18 (H4): confirmación propia para reiniciar datos demo
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [cloudSyncMsg, setCloudSyncMsg] = useState<string | null>(null);
  const [isSyncingCloudflare, setIsSyncingCloudflare] = useState(false);
  const [cloudflareSyncResult, setCloudflareSyncResult] = useState<CloudflareSyncResult | null>(null);
  const [isTestingWorker, setIsTestingWorker] = useState(false);
  const [isPullingCloudflare, setIsPullingCloudflare] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showCloudflareToken, setShowCloudflareToken] = useState(false);
  const [showQrSecret, setShowQrSecret] = useState(false); // Ronda 19 (BUG-5): el dueño puede necesitar copiarlo a otro dispositivo
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string; isRecommended?: boolean; isVision?: boolean; description?: string }>>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsFetchStatus, setModelsFetchStatus] = useState<string | null>(null);

  const [syncOverlay, setSyncOverlay] = useState<{
    isOpen: boolean;
    provider: 'firebase' | 'cloudflare';
    action: 'push' | 'pull';
    status: 'syncing' | 'success' | 'error';
    message: string;
  }>({
    isOpen: false,
    provider: 'cloudflare',
    action: 'push',
    status: 'syncing',
    message: ''
  });
  
  // AI Connection Test state
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string; latencyMs?: number; model?: string } | null>(null);

  const handleTestAiConnection = async () => {
    setIsTestingAi(true);
    setAiTestResult(null);
    try {
      const res = await AiService.testProviderConnection(
        settings.aiProvider || 'groq',
        settings.customAiApiKey,
        settings.aiModel
      );
      setAiTestResult(res);
    } catch (e: any) {
      setAiTestResult({
        success: false,
        message: `Error al ejecutar prueba de conexión: ${e?.message || e}`
      });
    } finally {
      setIsTestingAi(false);
    }
  };

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

  // Ronda 23 (P4): estado de las notificaciones push al abrir Ajustes
  React.useEffect(() => {
    getPushStatus().then(setPushStatus);
  }, []);

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

  const handleDayTemplateChange = (templateId: string) => {
    setSettings(prev => ({ ...prev, activeDayTemplate: templateId }));
    AttendanceStorageService.applyDayTemplate(templateId);
  };

  const handleCloudSync = async () => {
    setIsSyncingCloud(true);
    setCloudSyncMsg(null);
    setSyncOverlay({
      isOpen: true,
      provider: 'firebase',
      action: 'push',
      status: 'syncing',
      message: 'Subiendo datos a Firebase Firestore...'
    });
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
      setSyncOverlay(prev => ({ ...prev, status: 'success', message: res.message }));
      setCloudSyncMsg(res.message);
    } catch (e: any) {
      setSyncOverlay(prev => ({ ...prev, status: 'error', message: `Error al respaldar en Firebase: ${e.message || e}` }));
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
    // Remover window.confirm porque el overlay asume la confirmación de iniciar
    setSyncOverlay({
      isOpen: true,
      provider: 'cloudflare',
      action: 'pull',
      status: 'syncing',
      message: 'Descargando datos desde Cloudflare Worker (D1/KV)...'
    });
    setIsPullingCloudflare(true);
    try {
      const res = await CloudflareSyncService.pullFromCloudflare();
      setSyncOverlay(prev => ({ ...prev, status: res.success ? 'success' : 'error', message: res.message }));
      setCloudflareSyncResult({
        success: res.success,
        timestamp: new Date().toLocaleTimeString('es-CO'),
        syncedRecordsCount: 0,
        syncedStudentsCount: 0,
        message: res.message,
        target: 'Cloudflare Worker'
      });
    } catch (err: any) {
      setSyncOverlay(prev => ({ ...prev, status: 'error', message: err.message || 'Error desconocido' }));
    } finally {
      setIsPullingCloudflare(false);
    }
  };

  const handleCloudflareSync = async () => {
    setIsSyncingCloudflare(true);
    setCloudflareSyncResult(null);
    setSyncOverlay({
      isOpen: true,
      provider: 'cloudflare',
      action: 'push',
      status: 'syncing',
      message: 'Sincronizando datos con Cloudflare D1/KV...'
    });
    try {
      // Guardar primero para que use los tokens recién editados
      AttendanceStorageService.saveSettings(settings);
      const res = await CloudflareSyncService.performCloudflareSync();
      setSyncOverlay(prev => ({ ...prev, status: res.success ? 'success' : 'error', message: res.message }));
      setCloudflareSyncResult(res);
    } catch (err: any) {
      const errorMsg = `Error al sincronizar con Cloudflare: ${err.message || err}`;
      setSyncOverlay(prev => ({ ...prev, status: 'error', message: errorMsg }));
      setCloudflareSyncResult({
        success: false,
        timestamp: new Date().toLocaleTimeString('es-CO'),
        syncedRecordsCount: 0,
        syncedStudentsCount: 0,
        message: errorMsg,
        target: 'Cloudflare Worker'
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
    // Ronda 18 (H4): ConfirmDialog propio del sistema en lugar de window.confirm nativo
    setResetConfirmOpen(true);
  };



  // Ronda 4 (F1): lista fusionada (oficiales + CUSTOM de Rectoría); activo resuelto por ID con compat de TYPE legado
  const activeTemplateDef = AttendanceStorageService.getActiveDayTemplate();
  const allTemplates = AttendanceStorageService.getDayTemplates();

  return (
    <>
      <SyncOverlay 
        {...syncOverlay}
        onClose={() => setSyncOverlay(prev => ({ ...prev, isOpen: false }))}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 dark:bg-black/85 backdrop-blur-md animate-fadeIn" id="settings-modal">
        <div className="glass-panel rounded-3xl max-w-xl w-full p-4 sm:p-6 shadow-2xl relative space-y-5 max-h-[92vh] overflow-y-auto transition-colors">
          {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-4">
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
          {/* Ronda 25 (P1): barra de pestañas — cada pestaña responde a UNA pregunta
              (¿cómo opera mi colegio? / ¿cómo está la IA? / ¿cómo está conectado y
              seguro este dispositivo?). Los 3 secretos quedan agrupados en Sync y Seguridad. */}
          <div role="tablist" aria-label="Secciones de configuración" className="flex gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/60">
            {settingsTabs.map(t => {
              const Icon = t.icon;
              const active = settingsTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSettingsTab(t.id)}
                  className={`flex-1 px-2 py-2 rounded-xl text-[10px] sm:text-[11px] font-black transition-all inline-flex items-center justify-center gap-1.5 ${
                    active
                      ? 'bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200 dark:border-zinc-800'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className={settingsTab === 'institucion' ? 'space-y-4' : 'hidden'}>
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
                className="w-full bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 focus:border-indigo-500 text-slate-900 dark:text-white text-xs pl-9 pr-3 py-2.5 rounded-xl outline-none shadow-xs"
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
              value={activeTemplateDef.id}
              onChange={(e) => handleDayTemplateChange(e.target.value)}
              className="w-full bg-white dark:bg-zinc-950 border border-indigo-200 dark:border-indigo-800 text-slate-900 dark:text-white text-xs font-bold px-3 py-2 rounded-xl outline-none"
            >
              {allTemplates.map(tpl => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.blockDurationMinutes}m - {tpl.totalBlocks} bloques){tpl.type === 'CUSTOM' ? ' · Personalizada' : ''}
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
                  className="w-full bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 focus:border-indigo-500 text-slate-900 dark:text-white text-xs pl-9 pr-3 py-2.5 rounded-xl outline-none font-mono shadow-xs"
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
                  className="w-full bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 focus:border-indigo-500 text-slate-900 dark:text-white text-xs px-3 py-2.5 rounded-xl outline-none font-mono shadow-xs"
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

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Fin de Jornada
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="time"
                  value={settings.dailyEndTime}
                  onChange={(e) => handleChange('dailyEndTime', e.target.value)}
                  className="w-full bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 focus:border-indigo-500 text-slate-900 dark:text-white text-xs pl-9 pr-3 py-2.5 rounded-xl outline-none font-mono shadow-xs"
                  required
                />
              </div>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-1">La jornada se cierra tras esta hora (Ronda 4)</span>
            </div>
          </div>

          </div>

          <div className={settingsTab === 'ia' ? 'space-y-4' : 'hidden'}>
          {/* AI Engine & Multi-Provider Configuration */}
          <div className="p-4 rounded-2xl bg-slate-100 dark:bg-zinc-950/90 border border-slate-200 dark:border-zinc-800/50 space-y-3">
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
                  className="w-full bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-slate-900 dark:text-white text-xs font-bold px-2.5 py-2 rounded-xl outline-none"
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
                  className="w-full bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-slate-900 dark:text-white text-xs font-bold px-2.5 py-2 rounded-xl outline-none"
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
                  className="w-full bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-slate-900 dark:text-white text-xs pl-3 pr-9 py-2 rounded-xl outline-none font-mono"
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

            {/* AI Test Connection Button & Result */}
            <div className="pt-2 border-t border-slate-200 dark:border-zinc-800/50 space-y-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleTestAiConnection}
                  disabled={isTestingAi}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isTestingAi ? 'animate-spin' : ''}`} />
                  <span>{isTestingAi ? 'Probando Conexión...' : `Probar Conexión (${settings.aiProvider?.toUpperCase() || 'IA'})`}</span>
                </button>

                {aiTestResult && (
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2.5 h-2.5 rounded-full ${aiTestResult.success ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                    <span className={`text-[11px] font-bold ${aiTestResult.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {aiTestResult.success ? 'Conexión Exitosa' : 'Fallo en Conexión'}
                    </span>
                  </div>
                )}
              </div>

              {aiTestResult && (
                <div className={`p-2.5 rounded-xl text-xs font-medium border animate-fadeIn ${
                  aiTestResult.success 
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200' 
                    : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                }`}>
                  <p>{aiTestResult.message}</p>
                </div>
              )}
            </div>
          </div>

          </div>

          <div className={settingsTab === 'sync' ? 'space-y-4' : 'hidden'}>
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
                  className="w-full bg-white dark:bg-black border border-amber-200 dark:border-amber-800 text-slate-900 dark:text-white text-xs px-2.5 py-2 rounded-xl outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                  Intervalo de Auto-Sincronización
                </label>
                <select
                  value={settings.cloudflareSyncIntervalMinutes || 5}
                  onChange={(e) => handleChange('cloudflareSyncIntervalMinutes', Number(e.target.value))}
                  className="w-full bg-white dark:bg-black border border-amber-200 dark:border-amber-800 text-slate-900 dark:text-white text-xs font-bold px-2.5 py-2 rounded-xl outline-none"
                >
                  <option value={1}>Cada 1 minuto (Tiempo Real)</option>
                  <option value={5}>Cada 5 minutos (Recomendado)</option>
                  <option value={15}>Cada 15 minutos</option>
                  <option value={30}>Cada 30 minutos</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                  Token de Acceso del Worker — AUTH_TOKEN
                </label>
                <div className="relative">
                  <input
                    type={showCloudflareToken ? 'text' : 'password'}
                    value={settings.cloudflareApiToken || ''}
                    onChange={(e) => handleChange('cloudflareApiToken', e.target.value)}
                    placeholder="Pega aquí el AUTH_TOKEN del Worker — sin él la nube rechazará todo con 401"
                    className="w-full bg-white dark:bg-black border border-amber-200 dark:border-amber-800 text-slate-900 dark:text-white text-xs pl-2.5 pr-8 py-2 rounded-xl outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCloudflareToken(!showCloudflareToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    {showCloudflareToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
                <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1 leading-snug">
                  Se envía como Bearer al Worker. El AUTH_TOKEN está ACTIVO en producción desde la Ronda 27 (hardening): sin este token, push/pull/excusas responden 401 y la caché local nunca sale del dispositivo (los secretos de cada dispositivo jamás viajan a la nube — política Ronda 16/29). Usa “Probar Conexión” para validar el token; el navegador NUNCA accede directo a la API de Cloudflare: el Worker es el único con acceso a D1/KV.
                </p>
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
                  disabled={isTestingWorker}
                  className="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 border border-amber-500/30 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-all disabled:opacity-40"
                  title="Verificar que el Worker responda correctamente"
                >
                  <Globe className={`w-3 h-3 ${isTestingWorker ? 'animate-spin' : ''}`} />
                  <span>{isTestingWorker ? 'Probando...' : 'Probar Conexión'}</span>
                </button>

                <button
                  type="button"
                  onClick={handlePullCloudflare}
                  disabled={isPullingCloudflare}
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

          {/* Ronda 23 (P4): Notificaciones push de excusas — por dispositivo */}
          <div className="p-4 rounded-2xl bg-violet-50/70 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-violet-950 dark:text-violet-200">
                <BellRing className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                <span>Notificaciones Push de Excusas (este dispositivo)</span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                pushStatus?.subscribed
                  ? 'bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200'
                  : 'bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-slate-300'
              }`}>
                {pushStatus === null ? '…' : pushStatus.subscribed ? 'Activas' : 'Inactivas'}
              </span>
            </div>
            <p className="text-[11px] text-violet-800 dark:text-violet-300">
              Rectoría recibe aviso cuando se radica una excusa; el estudiante/acudiente recibe la decisión (verificada o rechazada con motivo). Requiere permiso del navegador y conexión con el Worker.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  setPushBusy(true);
                  const res = await enablePush();
                  setPushFeedback({ ok: res.ok, message: res.message });
                  setPushStatus(await getPushStatus());
                  setPushBusy(false);
                }}
                disabled={pushBusy || (pushStatus !== null && !pushStatus.supported)}
                className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span>{pushBusy ? 'Activando...' : 'Activar notificaciones'}</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  setPushBusy(true);
                  const res = await disablePush();
                  setPushFeedback({ ok: res.ok, message: res.message });
                  setPushStatus(await getPushStatus());
                  setPushBusy(false);
                }}
                disabled={pushBusy || (pushStatus !== null && !pushStatus.subscribed)}
                className="px-3 py-1.5 bg-white dark:bg-black text-violet-800 dark:text-violet-200 border border-violet-300 dark:border-violet-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-40"
              >
                <BellOff className="w-3.5 h-3.5" />
                <span>Desactivar</span>
              </button>
              {/* Ronda 24: prueba de entrega real — el Worker envía una notificación de prueba
                  y devuelve el estado HTTP de cada push service (veredicto honesto, WCAG 3.3.1) */}
              <button
                type="button"
                onClick={async () => {
                  setPushBusy(true);
                  try {
                    const baseUrl = (JSON.parse(localStorage.getItem('inas_settings_v5') || '{}').cloudflareWorkerUrl || '').trim().replace(/\/+$/, '');
                    if (!baseUrl) throw new Error('Configura primero la URL del Cloudflare Worker.');
                    const res = await fetch(`${baseUrl}/api/push/test`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ role: 'RECTORIA' })
                    });
                    const data = await res.json().catch(() => null);
                    setPushFeedback({ ok: !!(data?.sent > 0), message: data?.message || `HTTP ${res.status}` });
                  } catch (e: any) {
                    setPushFeedback({ ok: false, message: e?.message || 'Fallo de la prueba de notificación.' });
                  }
                  setPushStatus(await getPushStatus());
                  setPushBusy(false);
                }}
                disabled={pushBusy}
                className="px-3 py-1.5 bg-white dark:bg-black text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-zinc-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-40"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span>Probar notificación</span>
              </button>
              {pushStatus && !pushStatus.supported && (
                <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">Navegador sin soporte push (requiere HTTPS).</span>
              )}
            </div>
            {pushFeedback && (
              <p role="status" className={`text-xs font-bold ${pushFeedback.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {pushFeedback.message}
              </p>
            )}
          </div>

          {/* Ronda 27 (doc-produccion §3): Respaldo local — export/import de configuración y/o
              base de datos en UN archivo JSON versionado (INAS_BACKUP v1). Secretos solo con
              casilla explícita; import con resumen DRY-RUN + respaldo automático previo. */}
          <BackupRestoreSection />

          {/* Ronda 28 (petición del propietario): copia completa de la nube + purga D1/KV
              para limpiar datos demo sin wrangler — con copia previa innegociable,
              token obligatorio, confirmación tipeada y rate limit en el Worker. */}
          <CloudPurgeSection />

          {/* Secret QR HMAC Key */}
          <div className="pt-2 border-t border-slate-100 dark:border-zinc-800/50">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Clave Secreta HMAC-SHA256 (QR_SECRET)
            </label>
            <div className="relative">
              <ShieldCheck className="w-4 h-4 text-emerald-500 absolute left-3 top-1/2 -translate-y-1/2" />
              {/* Ronda 19 (BUG-5): enmascarado por defecto (password) + ojo para copiarlo al
                  siguiente dispositivo — los secrets no viajan en el sync, por diseño */}
              <input
                type={showQrSecret ? 'text' : 'password'}
                value={settings.qrSecret}
                onChange={(e) => handleChange('qrSecret', e.target.value)}
                className="w-full bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 focus:border-indigo-500 text-slate-900 dark:text-white text-xs pl-9 pr-9 py-2 rounded-xl outline-none font-mono shadow-xs"
              />
              <button
                type="button"
                onClick={() => setShowQrSecret(!showQrSecret)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label={showQrSecret ? 'Ocultar secreto QR' : 'Mostrar secreto QR para copiarlo'}
              >
                {showQrSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-1">
              Firma criptográfica de carnés y QR de Clase. Se genera aleatorio en el primer arranque; cópialo manualmente al siguiente dispositivo (no viaja en el sync).
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
                className="px-3 py-1.5 bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black rounded-xl text-[11px] font-bold shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCloud ? 'animate-spin' : ''}`} />
                <span>{isSyncingCloud ? 'Respaldando...' : 'Respaldar en Firestore'}</span>
              </button>
            </div>
            {cloudSyncMsg && (
              <p className="text-[10px] font-medium text-indigo-700 dark:text-indigo-300 bg-white/80 dark:bg-zinc-950/80 p-2 rounded-xl border border-indigo-100 dark:border-indigo-900">
                {cloudSyncMsg}
              </p>
            )}
          </div>

          </div>

          {/* Actions */}
          <div className="pt-4 flex items-center justify-between gap-3 border-t border-slate-100 dark:border-zinc-800/50">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleResetData}
                className="px-3.5 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-slate-700 dark:text-slate-300 border border-slate-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                title="Restaurar a datos de prueba"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              

            </div>

            <button
              type="submit"
              id="btn-save-settings"
              className="px-5 py-2.5 bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>{showSavedToast ? '¡Guardado!' : 'Guardar Cambios'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Ronda 18 (H4): modal de confirmación propio (reemplaza window.confirm nativo) */}
      <ConfirmDialog
        open={resetConfirmOpen}
        title="Reiniciar datos de prueba"
        message="¿Deseas reiniciar todos los registros de prueba y restaurar los 50 estudiantes y datos de ejemplo iniciales?"
        confirmLabel="Sí, reiniciar"
        onConfirm={() => { setResetConfirmOpen(false); AttendanceStorageService.resetToDemo(); onClose(); }}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </div>
    </>
  );
};

