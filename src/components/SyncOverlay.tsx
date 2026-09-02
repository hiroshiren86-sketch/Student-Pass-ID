import React from 'react';
import { CheckCircle2, XCircle, ArrowUp, ArrowDown } from 'lucide-react';

interface SyncOverlayProps {
  isOpen: boolean;
  provider: 'firebase' | 'cloudflare';
  action: 'push' | 'pull';
  status: 'syncing' | 'success' | 'error';
  message: string;
  onClose: () => void;
}

export const SyncOverlay: React.FC<SyncOverlayProps> = ({
  isOpen,
  provider,
  action,
  status,
  message,
  onClose
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="p-8 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-sm w-full flex flex-col items-center text-center space-y-6">
        
        {/* Icon Container with Animation */}
        <div className="relative">
          {provider === 'firebase' ? (
            <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center border border-slate-100 dark:border-zinc-800">
               {/* Official Firebase Logo */}
               <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                 <path d="M4.32912 18.232L2.09112 5.09301C2.01512 4.63601 2.53112 4.31601 2.91512 4.58201L12.0231 10.963L4.32912 18.232Z" fill="#FFA000"/>
                 <path d="M12.0231 10.963L14.7391 7.15901L11.8391 1.63701C11.6031 1.18901 10.9421 1.18401 10.7021 1.63101L4.32912 18.232L12.0231 10.963Z" fill="#F57C00"/>
                 <path d="M21.936 15.539L18.846 1.48701C18.73 0.96701 18.007 0.88401 17.755 1.362L4.32901 18.232L11.517 22.257C11.815 22.424 12.181 22.424 12.479 22.257L21.936 15.539Z" fill="#FFCA28"/>
                 <path d="M21.9361 15.539L12.4791 22.257C12.1811 22.424 11.8151 22.424 11.5171 22.257L4.3291 18.232L21.9361 15.539Z" fill="#FFA000"/>
               </svg>
            </div>
          ) : (
            <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center border border-slate-100 dark:border-zinc-800">
               {/* Official Cloudflare Logo */}
               <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                 <path d="M16.9231 7.02602C16.5824 7.02602 16.2736 7.12781 16.027 7.29173C15.5562 5.06013 13.5658 3.375 11.1611 3.375C8.9443 3.375 7.08643 4.87271 6.50506 6.89926C6.18206 6.78768 5.83445 6.72656 5.47115 6.72656C3.89679 6.72656 2.62024 8.00311 2.62024 9.57748C2.62024 11.1518 3.89679 12.4284 5.47115 12.4284H16.9231C18.4162 12.4284 19.6269 11.2177 19.6269 9.7246C19.6269 8.23145 18.4162 7.02602 16.9231 7.02602Z" fill="#F38020"/>
                 <path d="M22.0913 13.8052C21.8447 11.9686 20.3061 10.562 18.4162 10.562C18.0673 10.562 17.7347 10.6133 17.4243 10.7077C16.8991 9.07632 15.3582 7.91504 13.5144 7.91504C11.5367 7.91504 9.88046 9.29074 9.42065 11.1398C8.92723 10.9632 8.39702 10.8667 7.8447 10.8667C6.01255 10.8667 4.46973 12.1129 4.02016 13.8052H22.0913Z" fill="#FAAD3F"/>
                 <path d="M22.1837 15.3621C22.2599 15.0211 22.3023 14.6644 22.3023 14.2969C22.3023 11.8344 20.306 9.83823 17.8436 9.83823C17.6599 9.83823 17.4809 9.85172 17.3069 9.8763C16.8093 7.82865 14.9654 6.30273 12.75 6.30273C10.6558 6.30273 8.89531 7.68962 8.30756 9.6139C7.86877 9.49755 7.40428 9.43457 6.92308 9.43457C4.66316 9.43457 2.80287 11.1578 2.5539 13.3621H22.1837Z" fill="#FFC95E"/>
               </svg>
            </div>
          )}

          {/* Transfer Animation */}
          {status === 'syncing' && (
            <div className={`absolute -right-2 -bottom-2 w-10 h-10 rounded-full bg-white dark:bg-slate-800 border-4 border-slate-100 dark:border-slate-900 shadow-lg flex items-center justify-center ${action === 'push' ? 'text-emerald-500 animate-bounce' : 'text-sky-500 animate-bounce'}`}>
              {action === 'push' ? <ArrowUp className="w-5 h-5" /> : <ArrowDown className="w-5 h-5" />}
            </div>
          )}

          {status === 'success' && (
            <div className="absolute -right-2 -bottom-2 w-10 h-10 rounded-full bg-emerald-500 border-4 border-white dark:border-slate-900 shadow-lg flex items-center justify-center text-white">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          )}

          {status === 'error' && (
            <div className="absolute -right-2 -bottom-2 w-10 h-10 rounded-full bg-rose-500 border-4 border-white dark:border-slate-900 shadow-lg flex items-center justify-center text-white">
              <XCircle className="w-5 h-5" />
            </div>
          )}
        </div>

        {/* Status Text */}
        <div className="space-y-2 w-full">
          <h3 className="text-lg font-black text-slate-900 dark:text-white">
            {status === 'syncing' && (action === 'push' ? 'Subiendo Datos...' : 'Descargando Datos...')}
            {status === 'success' && '¡Sincronización Exitosa!'}
            {status === 'error' && 'Error de Sincronización'}
          </h3>
          <p className={`text-sm leading-relaxed px-2 ${
            status === 'error' 
              ? 'text-rose-600 dark:text-rose-400 font-medium' 
              : 'text-slate-600 dark:text-slate-400'
          }`}>
            {message}
          </p>
        </div>

        {/* Close Action */}
        {status !== 'syncing' && (
          <button
            onClick={onClose}
            className={`w-full py-3 rounded-xl text-sm font-bold shadow-md transition-all ${
              status === 'success'
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/25'
                : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/25'
            }`}
          >
            Cerrar
          </button>
        )}
      </div>
    </div>
  );
};
