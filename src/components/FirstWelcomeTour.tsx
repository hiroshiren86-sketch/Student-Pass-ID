import React, { useEffect, useState } from 'react';
import {
  Shield, BookOpen, GraduationCap, FileSpreadsheet, ShieldCheck, ScanLine,
  Users, Calendar, Key, CreditCard, ArrowRight, X, Sparkles
} from 'lucide-react';
import { UserRole } from '../types/attendance';

/**
 * Ronda 29 — Asistente de Primer Ingreso (guía rápida por perfil)
 * ------------------------------------------------------------------
 * Propósito (decisión del propietario): cuando el sistema detecta que un perfil
 * (Rectoría / Docente / Estudiante) ingresa POR PRIMERA VEZ en este dispositivo,
 * se muestra una guía informativa — NO técnica, sin saturar — con las funciones
 * clave del sistema y enlaces directos "Probar ahora" que navegan a la función.
 *
 * Reglas de comportamiento:
 *  - Se muestra UNA sola vez por perfil y por dispositivo (bandera en
 *    localStorage `inas_onboarding_seen_v1`). Nunca vuelve a molestar.
 *  - Se puede reabrir a voluntad desde el menú de sesión → "Guía rápida"
 *    (eso NO toca la bandera: es solo consulta).
 *  - Cualquier cierre (botón, Escape o clic en el fondo) marca la guía como vista.
 *  - Estudiante: la guía es puramente informativa (el portal es una sola
 *    pantalla); para Rectoría y Docente cada item navega a su módulo.
 */

const ONBOARDING_KEY = 'inas_onboarding_seen_v1';

type SeenFlags = { admin?: boolean; docente?: boolean; estudiante?: boolean };

export const FirstWelcomeTourService = {
  getSeenFlags(): SeenFlags {
    try { return JSON.parse(localStorage.getItem(ONBOARDING_KEY) || '{}'); } catch { return {}; }
  },
  isSeen(role: UserRole): boolean {
    const flags = this.getSeenFlags();
    if (role === 'ADMIN') return !!flags.admin;
    if (role === 'DOCENTE') return !!flags.docente;
    return !!flags.estudiante;
  },
  markSeen(role: UserRole): void {
    try {
      const flags = this.getSeenFlags();
      if (role === 'ADMIN') flags.admin = true;
      else if (role === 'DOCENTE') flags.docente = true;
      else flags.estudiante = true;
      localStorage.setItem(ONBOARDING_KEY, JSON.stringify(flags));
    } catch { /* prescindible */ }
  }
};

interface TourItem {
  icon: React.ElementType;
  title: string;
  description: string;
  /** Tab destino; undefined = solo informativo (no navega) */
  target?: string;
  actionLabel?: string;
  accent: string;
}

const TOURS: Record<UserRole, { greeting: string; intro: string; items: TourItem[] }> = {
  ADMIN: {
    greeting: 'Bienvenido a la plataforma institucional',
    intro: 'Este es el panel de Rectoría. Todo el control escolar vive aquí — estas son las funciones que más usarás:',
    items: [
      {
        icon: FileSpreadsheet, accent: 'emerald',
        title: 'Planilla de Asistencia',
        description: 'Marca el día completo en una sola tabla y justifica ausencias con un toque.',
        target: 'attendance', actionLabel: 'Abrir Planilla'
      },
      {
        icon: ShieldCheck, accent: 'purple',
        title: 'Buzón de Justificaciones',
        description: 'Las excusas que radican estudiantes y docentes llegan aquí. Decides con un clic y el veredicto se notifica.',
        target: 'excuses', actionLabel: 'Abrir Buzón'
      },
      {
        icon: ScanLine, accent: 'indigo',
        title: 'Escanear Asistencia',
        description: 'Lector de código USB o cámara: escanea el carné y queda registrado. Con el código por clase, el Representante del salón puede ayudar a escanear.',
        target: 'scan', actionLabel: 'Probar Escáner'
      },
      {
        icon: Users, accent: 'sky',
        title: 'Directorio y Matrícula',
        description: 'Matricula uno a uno o carga la lista completa (CSV / Excel / SIMAT). También nombras Representantes por grado.',
        target: 'students', actionLabel: 'Ir a Matrícula'
      },
      {
        icon: Calendar, accent: 'amber',
        title: 'Horarios Escolares',
        description: 'Diseña la jornada con plantillas por día y aplícalas cuando quieras.',
        target: 'schedules', actionLabel: 'Ver Horarios'
      },
      {
        icon: Key, accent: 'rose',
        title: 'Credenciales Docentes',
        description: 'Crea las cuentas de tus docentes y sus cátedras en segundos.',
        target: 'teachers', actionLabel: 'Gestionar Docentes'
      },
      {
        icon: CreditCard, accent: 'cyan',
        title: 'Carnés CR80 para imprimir',
        description: 'Genera carnés PDF tamaño tarjeta con QR criptográfico anti-falsificación.',
        target: 'cards', actionLabel: 'Generar Carnés'
      }
    ]
  },
  DOCENTE: {
    greeting: 'Bienvenido, Docente',
    intro: 'Tu aula lista en segundos — esto es lo que puedes hacer:',
    items: [
      {
        icon: BookOpen, accent: 'emerald',
        title: 'Mi Aula',
        description: 'Llamado a lista por bloques con ventana horaria y escáner en vivo para tu clase.',
        target: 'teacher', actionLabel: 'Entrar a Mi Aula'
      },
      {
        icon: ScanLine, accent: 'indigo',
        title: 'Escanear Carnés',
        description: 'Con lector USB o cámara. Al abrir tu primera clase generas el código de clase para que el Representante ayude a escanear a sus compañeros.',
        target: 'scan', actionLabel: 'Probar Escáner'
      },
      {
        icon: FileSpreadsheet, accent: 'sky',
        title: 'Planilla de tus bloques',
        description: 'Revisa y ajusta la asistencia de tus clases del día.',
        target: 'attendance', actionLabel: 'Abrir Planilla'
      },
      {
        icon: Users, accent: 'amber',
        title: 'Directorio de estudiantes',
        description: 'Consulta la matrícula y los datos de tus grupos cuando lo necesites.',
        target: 'students', actionLabel: 'Ver Directorio'
      }
    ]
  },
  ESTUDIANTE_ACUDIENTE: {
    greeting: 'Bienvenido(a) a tu Portal',
    intro: 'Tu carné y tu historial siempre contigo. Esto es lo que puedes hacer desde aquí:',
    items: [
      {
        icon: CreditCard, accent: 'sky',
        title: 'Tu carné estudiantil digital',
        description: 'Muéstralo para escanear en la portería o en el aula. Puedes personalizar tu foto y descargarlo en PDF.'
      },
      {
        icon: ShieldCheck, accent: 'purple',
        title: 'Radica tus justificaciones ANTES',
        description: 'Cita médica, incapacidad o calamidad: radícalo desde tu celular y tu registro queda protegido mientras Rectoría revisa (máximo 72 h, con aviso del veredicto).'
      },
      {
        icon: Calendar, accent: 'emerald',
        title: 'Tu horario de clases',
        description: 'Carga tu horario con un CSV simple y tenlo a mano todo el día (es informativo, no afecta tu asistencia).'
      },
      {
        icon: ScanLine, accent: 'indigo',
        title: '¿Te nombraron Representante?',
        description: 'Si tu director de grupo te nombra Representante, podrás escanear la asistencia de tu salón con el código de clase.'
      }
    ]
  }
};

const ACCENTS: Record<string, { chip: string; btn: string }> = {
  emerald: { chip: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300', btn: 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700' },
  purple: { chip: 'bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-300', btn: 'text-purple-600 dark:text-purple-400 hover:text-purple-700' },
  indigo: { chip: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300', btn: 'text-indigo-600 dark:text-indigo-400 hover:text-indigo-700' },
  sky: { chip: 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-300', btn: 'text-sky-600 dark:text-sky-400 hover:text-sky-700' },
  amber: { chip: 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-300', btn: 'text-amber-600 dark:text-amber-400 hover:text-amber-700' },
  rose: { chip: 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300', btn: 'text-rose-600 dark:text-rose-400 hover:text-rose-700' },
  cyan: { chip: 'bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-300', btn: 'text-cyan-600 dark:text-cyan-400 hover:text-cyan-700' }
};

interface FirstWelcomeTourProps {
  role: UserRole;
  /** true = reapertura manual desde el menú (NO vuelve a marcar como vista) */
  isManualReopen?: boolean;
  onClose: () => void;
  onNavigate?: (tab: string) => void;
}

export const FirstWelcomeTour: React.FC<FirstWelcomeTourProps> = ({ role, isManualReopen, onClose, onNavigate }) => {
  const tour = TOURS[role];
  const [leaving, setLeaving] = useState(false);

  const finish = () => {
    setLeaving(true);
    // Solo se marca como vista cuando es la aparición automática de primer ingreso
    if (!isManualReopen) FirstWelcomeTourService.markSeen(role);
    window.setTimeout(onClose, 180);
  };

  // Regla de Escape (patrón del sistema — Ronda 8 B1): cerrar con teclado también marca como vista
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md transition-opacity duration-200 ${leaving ? 'opacity-0' : 'opacity-100 animate-fadeIn'}`}
      onClick={finish}
    >
      <div
        className="p-5 sm:p-7 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-lg w-full space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Guía rápida de bienvenida"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/25 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight leading-tight">
                {tour.greeting}
              </h3>
              <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider">
                Guía de primer ingreso
              </p>
            </div>
          </div>
          <button
            onClick={finish}
            className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            aria-label="Cerrar guía"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {tour.intro}
        </p>

        {/* Items */}
        <div className="space-y-2">
          {tour.items.map((item) => {
            const Icon = item.icon;
            const accent = ACCENTS[item.accent] || ACCENTS.indigo;
            return (
              <div
                key={item.title}
                className="p-3 rounded-2xl bg-slate-50 dark:bg-black/60 border border-slate-100 dark:border-zinc-800/50 flex items-start gap-3"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${accent.chip}`}>
                  <Icon className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-slate-900 dark:text-white">{item.title}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                    {item.description}
                  </p>
                  {item.target && onNavigate && item.actionLabel && (
                    <button
                      onClick={() => { if (!isManualReopen) FirstWelcomeTourService.markSeen(role); onNavigate(item.target!); }}
                      className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold ${accent.btn} transition-colors`}
                    >
                      {item.actionLabel}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="pt-2 space-y-2">
          <button
            onClick={finish}
            className="w-full py-2.5 rounded-2xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-600/20"
          >
            {role === 'ESTUDIANTE_ACUDIENTE' ? '¡Listo, empecemos!' : '¡Empezar!'}
          </button>
          <p className="text-[10px] text-slate-400 text-center">
            Puedes volver a abrir esta guía cuando quieras desde tu menú de sesión → «Guía rápida».
          </p>
        </div>
      </div>
    </div>
  );
};
