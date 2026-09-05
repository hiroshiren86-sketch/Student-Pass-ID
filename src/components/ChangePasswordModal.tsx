import React, { useState } from 'react';
import { Key, Lock, Eye, EyeOff, Check, AlertCircle, X, ShieldCheck } from 'lucide-react';
import { Teacher, UserRole } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { FirebaseService } from '../services/firebase';

interface ChangePasswordModalProps {
  onClose: () => void;
  teacher?: Teacher;
  role: UserRole;
  username: string;
  /** Ronda 33 (M2): primer ingreso con contraseña temporal — el cambio es OBLIGATORIO. */
  forced?: boolean;
}

/**
 * Ronda 33 (M2 — MISIÓN AUTH): autoservicio de contraseña REAL para docentes con
 * cuenta de Firebase Auth. La verificación de identidad la hace Firebase
 * (re-autenticación con EmailAuthProvider) y el cambio ocurre en Firebase Auth
 * (updatePassword) — la fuente de autoridad de las credenciales. El espejo local
 * solo deja de mostrar la contraseña temporal (privacidad) y marca la ficha.
 *
 * Sin `teacher` no hay nada que cambiar: el componente NO se renderiza (guard duro)
 * — jamás un falso éxito como el corregido en Ronda 32.
 */
export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  onClose,
  teacher,
  role,
  username,
  forced = false
}) => {
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!teacher || role !== 'DOCENTE') {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!currentPasswordInput.trim()) {
      setError('Por favor ingrese su contraseña actual.');
      return;
    }

    if (!newPassword.trim()) {
      setError('Por favor ingrese la nueva contraseña.');
      return;
    }

    if (newPassword.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres por seguridad.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('La nueva contraseña y la confirmación no coinciden.');
      return;
    }

    if (newPassword === currentPasswordInput) {
      setError('La nueva contraseña debe ser diferente a la actual.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1) Firebase Auth: re-autenticación + cambio real (la autoridad).
      const uid = await FirebaseService.changeOwnPassword(currentPasswordInput, newPassword);

      // 2) Espejo local: la contraseña temporal deja de existir en el dispositivo
      //    (privacidad — ni Rectoría la ve) y la ficha marca credencial personalizada.
      AttendanceStorageService.updateTeacher(teacher.id, {
        hasFirebaseAccount: true,
        hasCustomPassword: true,
        authUid: uid,
        tempPassword: undefined
      });

      // Mensaje único y honesto (nunca éxito + error simultáneos).
      setSuccess('Su contraseña fue actualizada en Firebase Auth. Úsela la próxima vez que ingrese al portal.');
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      console.error('Error in change password:', err);
      setError(err?.message || 'Error al actualizar la contraseña. Reintente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-md w-full space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black shadow-xs">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {forced ? 'Defina su Contraseña Personal' : 'Cambiar Mi Contraseña'}
              </h3>
              <p className="text-xs text-slate-500 truncate max-w-[220px]">
                {username} • Docente
              </p>
            </div>
          </div>
          {!forced && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {forced && (
          <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>
              Primer ingreso con contraseña temporal: por seguridad debe definir su propia contraseña antes de continuar.
            </span>
          </div>
        )}

        {error && (
          <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
            <Check className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Current Password — verificada contra Firebase Auth por re-autenticación */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Contraseña Actual
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={currentPasswordInput}
                onChange={(e) => setCurrentPasswordInput(e.target.value)}
                placeholder="Ingrese contraseña actual"
                autoComplete="current-password"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800 rounded-2xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                required
              />
            </div>
          </div>

          {/* New Password */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Nueva Contraseña
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoComplete="new-password"
                className="w-full pl-10 pr-10 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800 rounded-2xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white absolute right-3 top-1/2 -translate-y-1/2"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Confirmar Nueva Contraseña
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita la nueva contraseña"
                autoComplete="new-password"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800 rounded-2xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                required
              />
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-[11px] text-indigo-800 dark:text-indigo-300 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <span>
              La verificación de identidad y el cambio los realiza Firebase Auth. Si algún día olvida su clave, Rectoría puede enviarle un enlace de restablecimiento a su correo institucional.
            </span>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            {!forced && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold hover:bg-slate-200 transition-all"
              >
                Cancelar
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              <Key className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Guardando...' : 'Actualizar Contraseña'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
