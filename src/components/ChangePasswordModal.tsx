import React, { useState } from 'react';
import { Key, Lock, Eye, EyeOff, Check, AlertCircle, X, ShieldCheck } from 'lucide-react';
import { Teacher, UserRole } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { FirebaseService, getFirebaseAuth } from '../services/firebase';

interface ChangePasswordModalProps {
  onClose: () => void;
  teacher?: Teacher;
  role: UserRole;
  username: string;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  onClose,
  teacher,
  role,
  username
}) => {
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Ronda 32 (verificación de aceptación MISIÓN AUTH): el autoservicio SOLO existe para un
  // docente con credencial local verificable. Sin `teacher` no hay nada que actualizar de
  // verdad (Rectoría usa credencial embebida pendiente de M1; estudiante pendiente de M3) y
  // renderizar el formulario producía el falso éxito "¡Contraseña actualizada correctamente!"
  // sin cambiar absolutamente nada — exactamente el patrón "función integrada pero no
  // cableada" que la Regla 6 (Cero Fallbacks) prohíbe.
  if (!teacher || !teacher.tempPassword) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Basic Validation
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

    if (newPassword === teacher.tempPassword) {
      setError('La nueva contraseña debe ser diferente a la actual.');
      return;
    }

    // Verify current password against the teacher's real local credential
    if (currentPasswordInput.trim() !== teacher.tempPassword) {
      setError('La contraseña actual ingresada es incorrecta.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Actualiza la credencial local del docente (la fuente que verifica el
      //    "Acceso Institucional" hasta que M2 migre la verificación a Firestore).
      const localUpdated = AttendanceStorageService.updateTeacher(teacher.id, {
        tempPassword: newPassword
      });

      if (!localUpdated) {
        setError('No se pudo actualizar la contraseña en este dispositivo. Intente nuevamente.');
        setIsSubmitting(false);
        return;
      }

      // 2. Si además existe una cuenta REAL de Firebase Auth (no anónima — modelo futuro M2),
      //    refleja el cambio en la nube. Hoy la sesión Firebase es siempre anónima, así que
      //    esta rama es inerte y jamás inventa éxito donde no lo hay.
      let firebaseNote: string | null = null;
      const currentUser = getFirebaseAuth()?.currentUser ?? null;
      if (currentUser && !currentUser.isAnonymous) {
        try {
          await FirebaseService.updateUserPassword(newPassword);
          firebaseNote = 'El cambio también se aplicó en Firebase Auth.';
        } catch (fbErr: any) {
          console.warn('Firebase Auth update password notice:', fbErr);
          if (fbErr?.code === 'auth/requires-recent-login') {
            firebaseNote = 'Para aplicarla también en Firebase Auth deberá volver a iniciar sesión y repetir el cambio.';
          } else {
            firebaseNote = 'La clave local quedó actualizada, pero no se pudo reflejar en Firebase Auth en este intento.';
          }
        }
      }

      // Mensaje único y honesto (nunca éxito + error simultáneos).
      setSuccess(
        'Su contraseña fue actualizada. Úsela la próxima vez que ingrese al portal.' +
        (firebaseNote ? ` Nota: ${firebaseNote}` : '')
      );
      setTimeout(() => {
        onClose();
      }, 2600);
    } catch (err: any) {
      console.error('Error in change password:', err);
      setError(err.message || 'Error al actualizar la contraseña. Reintente.');
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
                Cambiar Mi Contraseña
              </h3>
              <p className="text-xs text-slate-500 truncate max-w-[220px]">
                {username} • {role === 'ADMIN' ? 'Rectoría' : role === 'DOCENTE' ? 'Docente' : 'Estudiante'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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
          {/* Current Password — el docente siempre tiene tempPassword (guard de arriba) */}
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
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800 rounded-2xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                required
              />
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-[11px] text-indigo-800 dark:text-indigo-300 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <span>
              Su nueva clave queda activa para su ingreso al portal. Rectoría conserva la capacidad de restablecerla desde Gestión Docentes si la olvida.
            </span>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold hover:bg-slate-200 transition-all"
            >
              Cancelar
            </button>
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
