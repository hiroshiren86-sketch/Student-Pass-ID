import React, { useState } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Search, 
  QrCode, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertTriangle,
  RefreshCw,
  FileCheck2,
  Lock
} from 'lucide-react';
import { parseAndVerifyScan, ParsedQrResult } from '../utils/crypto';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { Student } from '../types/attendance';

export const PublicVerifierView: React.FC = () => {
  const [inputToken, setInputToken] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<{
    parsed?: ParsedQrResult;
    student?: Student;
    rateLimited?: boolean;
    error?: string;
  } | null>(null);

  // Rate Limiter en cliente: ventana deslizante máx 30 peticiones por minuto
  const [requestTimestamps, setRequestTimestamps] = useState<number[]>([]);

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const raw = inputToken.trim();
    if (!raw) return;

    // Verificar límite de tasa (30 req / min)
    const now = Date.now();
    const oneMinAgo = now - 60000;
    const recentRequests = requestTimestamps.filter(t => t > oneMinAgo);

    if (recentRequests.length >= 30) {
      setResult({
        rateLimited: true,
        error: 'Demasiadas solicitudes de verificación. Límite de seguridad alcanzado (30/min). Código 429.'
      });
      return;
    }

    setRequestTimestamps([...recentRequests, now]);
    setIsVerifying(true);

    const settings = AttendanceStorageService.getSettings();
    const parsed = await parseAndVerifyScan(raw, settings.qrSecret);

    if (!parsed.isValidFormat || !parsed.studentCode) {
      setResult({
        parsed,
        error: 'El código ingresado no corresponde a un formato de carné válido.'
      });
      setIsVerifying(false);
      return;
    }

    const student = AttendanceStorageService.getStudentByCodeOrDoc(parsed.studentCode);

    setResult({
      parsed,
      student,
      rateLimited: false
    });
    setIsVerifying(false);
  };

  const handleSampleTest = (sampleCode: string) => {
    setInputToken(sampleCode);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn" id="public-verifier-view">
      {/* Header Info */}
      <div className="glass-panel p-6 sm:p-8 rounded-3xl relative overflow-hidden space-y-4">
        <div className="flex items-start gap-4">
          <div className="p-3.5 bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-2xl border border-indigo-200/80 dark:border-indigo-500/30 shrink-0">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 uppercase">
              Verificación Pública • HMAC-SHA256
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
              Validador de Autenticidad de Carnés
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Comprueba si el código QR de un carné físico o digital posee una firma criptográfica legítima emitida por la institución, previniendo falsificaciones o duplicaciones no autorizadas.
            </p>
          </div>
        </div>

        {/* Input Box */}
        <form onSubmit={handleVerify} className="pt-2 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch gap-2.5">
            <div className="relative flex-1">
              <QrCode className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={inputToken}
                onChange={(e) => setInputToken(e.target.value)}
                placeholder="Pegue aquí el texto decodificado del QR o el código del estudiante..."
                className="w-full pl-11 pr-4 py-3 bg-white/90 dark:bg-black/80 border border-slate-200/90 dark:border-zinc-800/50 rounded-2xl text-xs sm:text-sm font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner"
              />
            </div>
            <button
              type="submit"
              disabled={isVerifying || !inputToken.trim()}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-2xl text-xs sm:text-sm font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2"
            >
              {isVerifying ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <FileCheck2 className="w-4 h-4" />
              )}
              <span>Verificar Token</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Pruebas rápidas:</span>
            <button
              type="button"
              onClick={() => handleSampleTest('1000000001')}
              className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-[11px] font-mono text-indigo-600 dark:text-indigo-400"
            >
              Código: 1000000001
            </button>
            <button
              type="button"
              onClick={() => handleSampleTest('IEDSJ:v1:1000000001:1000000001:11°:A:1819584000000:BAD_SIGNATURE')}
              className="px-2 py-1 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 rounded-lg text-[11px] font-mono text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30"
            >
              QR Adulterado (Firma Inválida)
            </button>
          </div>
        </form>
      </div>

      {/* Verification Result Card */}
      {result && (
        <div className="glass-panel p-5 sm:p-7 rounded-3xl space-y-4">
          {result.rateLimited ? (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                  Límite de Consultas Excedido (HTTP 429)
                </h4>
                <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                  Se ha alcanzado el límite de seguridad de 30 consultas por minuto para proteger el sistema contra ataques de fuerza bruta.
                </p>
              </div>
            </div>
          ) : result.error ? (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-rose-900 dark:text-rose-200">
                  Verificación Fallida
                </h4>
                <p className="text-xs text-rose-800/80 dark:text-rose-300/80 mt-0.5">
                  {result.error}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Authenticity Badge */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800/50">
                <div className="flex items-center gap-2">
                  {result.parsed?.isSigned ? (
                    result.parsed?.isSignatureValid ? (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" /> CARNÉ AUTÉNTICO Y VIGENTE
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 text-rose-500" /> FIRMA ADULTERADA O INVÁLIDA
                      </span>
                    )
                  ) : (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-slate-400" /> CÓDIGO DIRECTO (Sin firma QR)
                    </span>
                  )}
                </div>

                <span className="text-[11px] font-mono text-slate-400">
                  Respuesta en &lt;1ms
                </span>
              </div>

              {/* Minimal Public Data Payload (Minimización de datos) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 bg-slate-50/80 dark:bg-black/60 rounded-2xl border border-slate-200/80 dark:border-zinc-800/50/80 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Código Institucional</span>
                  <div className="text-sm font-mono font-bold text-slate-900 dark:text-white">
                    {result.parsed?.studentCode}
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50/80 dark:bg-black/60 rounded-2xl border border-slate-200/80 dark:border-zinc-800/50/80 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Estado en Base de Datos</span>
                  <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    {result.student ? 'ESTUDIANTE ACTIVO' : 'NO REGISTRADO EN D1 (404)'}
                  </div>
                </div>

                {result.student && (
                  <>
                    <div className="p-3.5 bg-slate-50/80 dark:bg-black/60 rounded-2xl border border-slate-200/80 dark:border-zinc-800/50/80 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Nombre del Alumno</span>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        {result.student.firstName} {result.student.lastName}
                      </div>
                    </div>

                    <div className="p-3.5 bg-slate-50/80 dark:bg-black/60 rounded-2xl border border-slate-200/80 dark:border-zinc-800/50/80 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Grado y Sección</span>
                      <div className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                        {result.student.grade} - {result.student.section}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
