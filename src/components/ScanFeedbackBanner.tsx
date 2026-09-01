import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Clock, 
  ShieldCheck, 
  UserCheck, 
  X, 
  Phone,
  Volume2
} from 'lucide-react';
import { ScanResultFeedback } from '../types/attendance';

interface ScanFeedbackBannerProps {
  feedback: ScanResultFeedback | null;
  onDismiss: () => void;
}

export const ScanFeedbackBanner: React.FC<ScanFeedbackBannerProps> = ({ feedback, onDismiss }) => {
  if (!feedback) return null;

  const isPunctual = feedback.type === 'success_punctual';
  const isTardy = feedback.type === 'success_tardy';
  const isAlready = feedback.type === 'already_scanned';
  const isError = feedback.type === 'error' || feedback.type === 'not_found' || feedback.type === 'invalid_signature';

  // Background styling
  const bgClasses = isPunctual
    ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-100 shadow-emerald-950/50'
    : isTardy
    ? 'bg-amber-950/90 border-amber-500/60 text-amber-100 shadow-amber-950/50'
    : isAlready
    ? 'bg-sky-950/90 border-sky-500/60 text-sky-100 shadow-sky-950/50'
    : 'bg-rose-950/90 border-rose-500/60 text-rose-100 shadow-rose-950/50';

  const badgeClasses = isPunctual
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    : isTardy
    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    : isAlready
    ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
    : 'bg-rose-500/20 text-rose-300 border-rose-500/40';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.96 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className={`w-full border-2 rounded-2xl p-4 sm:p-5 shadow-2xl backdrop-blur-md relative overflow-hidden ${bgClasses}`}
        id="scan-feedback-banner"
      >
        {/* Ambient Top Glow Bar */}
        <div 
          className={`absolute top-0 left-0 right-0 h-1.5 ${
            isPunctual ? 'bg-emerald-400' : isTardy ? 'bg-amber-400' : isAlready ? 'bg-sky-400' : 'bg-rose-400'
          }`} 
        />

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 sm:gap-4 flex-1">
            {/* Left Status Icon or Student Avatar */}
            {feedback.student?.avatarUrl ? (
              <div className="relative shrink-0">
                <img
                  src={feedback.student.avatarUrl}
                  alt={feedback.student.firstName}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover border-2 border-white/20 shadow-md"
                />
                <span className={`absolute -bottom-1 -right-1 p-1 rounded-full text-white ${
                  isPunctual ? 'bg-emerald-500' : isTardy ? 'bg-amber-500' : isAlready ? 'bg-sky-500' : 'bg-rose-500'
                }`}>
                  {isPunctual ? <CheckCircle2 className="w-3.5 h-3.5" /> : isTardy ? <Clock className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                </span>
              </div>
            ) : (
              <div className={`p-3 rounded-xl border shrink-0 ${badgeClasses}`}>
                {isPunctual && <CheckCircle2 className="w-8 h-8 text-emerald-400" />}
                {isTardy && <Clock className="w-8 h-8 text-amber-400" />}
                {isAlready && <AlertTriangle className="w-8 h-8 text-sky-400" />}
                {isError && <XCircle className="w-8 h-8 text-rose-400" />}
              </div>
            )}

            {/* Main Content */}
            <div className="space-y-1 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider ${badgeClasses}`}>
                  {isPunctual && 'Puntual • Ingreso Autorizado'}
                  {isTardy && 'Tardanza Registrada'}
                  {isAlready && 'Ya Registrado Hoy'}
                  {isError && 'Error de Registro'}
                </span>

                {feedback.record?.time && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-black/30 border border-white/10 text-slate-300">
                    Hora: {feedback.record.time}
                  </span>
                )}

                {feedback.record?.verifiedHmac && (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    <ShieldCheck className="w-3 h-3" /> Carné Criptográfico HMAC
                  </span>
                )}
              </div>

              <h4 className="text-lg sm:text-xl font-bold tracking-tight text-white truncate">
                {feedback.student ? `${feedback.student.firstName} ${feedback.student.lastName}` : feedback.title}
              </h4>

              <p className="text-xs sm:text-sm text-slate-200/90 leading-snug">
                {feedback.message}
              </p>

              {/* Extra Student Metadata Info Row */}
              {feedback.student && (
                <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
                  <span className="font-medium">
                    Doc: <strong className="text-white font-mono">{feedback.student.documentType} {feedback.student.documentId}</strong>
                  </span>
                  <span>•</span>
                  <span className="font-medium">
                    Grado: <strong className="text-white">{feedback.student.grade} - {feedback.student.section}</strong>
                  </span>
                  {feedback.student.guardianName && (
                    <>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1 text-slate-300">
                        <Phone className="w-3 h-3 text-slate-400" /> Acudiente: <strong className="text-white">{feedback.student.guardianName}</strong> ({feedback.student.guardianPhone})
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Dismiss Button */}
          <button
            onClick={onDismiss}
            id="btn-dismiss-scan-feedback"
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors shrink-0"
            title="Cerrar notificación"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
