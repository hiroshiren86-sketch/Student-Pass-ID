import React, { useEffect } from 'react';
import { X, QrCode, Download } from 'lucide-react';

/**
 * Ronda 43 — Tarjetas QR de Docente (protocolo CLASE:v2): modal A6 compartido por las
 * DOS entradas de generación (Mis Tarjetas QR del Portal Docente y Tarjetas QR de
 * Docentes de Rectoría). Espejo del modal v1 de Horarios con los textos del manual v2:
 * título = asignatura · sub = {docente} · {colegio} · footer mono = CLASE:v2 firmado.
 * Escape cierra (Regla E10). El PNG es descargable (512×512, decodificable con jsQR).
 */
interface TeacherCardQrModalProps {
  dataUrl: string;          // PNG del QR (QRCode.toDataURL, width 512)
  subject: string;          // nombre EXACTO de la asignatura en la ficha
  teacherName: string;      // nombre completo del docente
  schoolName?: string;      // settings.schoolName
  downloadName: string;     // nombre del archivo PNG (sin extensión)
  onClose: () => void;
}

export const TeacherCardQrModal: React.FC<TeacherCardQrModalProps> = ({
  dataUrl,
  subject,
  teacherName,
  schoolName,
  downloadName,
  onClose
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Tarjeta QR de Docente: ${subject}, ${teacherName}`}>
      <div className="bg-white dark:bg-zinc-950 rounded-3xl p-6 w-full max-w-sm border border-slate-200 dark:border-zinc-800/50 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
            <QrCode className="w-5 h-5 text-emerald-600" />
            <span>Tarjeta QR de Docente</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Cerrar tarjeta QR de docente"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {dataUrl && (
          <img src={dataUrl} alt={`Tarjeta QR de Docente: ${subject}, ${teacherName}`} className="w-full rounded-2xl border border-slate-200 dark:border-zinc-800" />
        )}

        <div className="text-center space-y-1">
          <p className="text-sm font-black text-slate-900 dark:text-white">{subject}</p>
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
            {teacherName}{schoolName ? ` · ${schoolName}` : ''}
          </p>
          <p className="text-[10px] text-slate-400 font-mono break-all">Firmado HMAC-SHA256 · Vence el 19-dic · Sirve todos los días</p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-3 text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400"
          >
            Cerrar
          </button>
          <a
            href={dataUrl}
            download={`${downloadName}.png`}
            className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/30 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Descargar PNG
          </a>
        </div>
      </div>
    </div>
  );
};
