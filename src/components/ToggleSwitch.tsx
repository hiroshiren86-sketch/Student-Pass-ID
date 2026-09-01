import React from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  id?: string;
  icon?: React.ReactNode;
  activeColor?: 'indigo' | 'emerald' | 'amber' | 'cyan';
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  label,
  description,
  size = 'md',
  disabled = false,
  id,
  icon,
  activeColor = 'indigo'
}) => {
  const sizeClasses = {
    sm: {
      track: 'w-8 h-4.5 p-0.5',
      thumb: 'w-3.5 h-3.5',
      translate: 'translate-x-3.5',
      text: 'text-xs',
      desc: 'text-[10px]'
    },
    md: {
      track: 'w-11 h-6 p-0.5',
      thumb: 'w-5 h-5',
      translate: 'translate-x-5',
      text: 'text-xs sm:text-sm',
      desc: 'text-[11px]'
    },
    lg: {
      track: 'w-14 h-7.5 p-1',
      thumb: 'w-6 h-6',
      translate: 'translate-x-6.5',
      text: 'text-sm sm:text-base',
      desc: 'text-xs'
    }
  }[size];

  const colorClasses = {
    indigo: checked ? 'bg-indigo-600 shadow-indigo-500/30' : 'bg-slate-300 dark:bg-slate-700',
    emerald: checked ? 'bg-emerald-600 shadow-emerald-500/30' : 'bg-slate-300 dark:bg-slate-700',
    amber: checked ? 'bg-amber-500 shadow-amber-500/30' : 'bg-slate-300 dark:bg-slate-700',
    cyan: checked ? 'bg-cyan-600 shadow-cyan-500/30' : 'bg-slate-300 dark:bg-slate-700'
  }[activeColor];

  return (
    <label
      htmlFor={id}
      className={`inline-flex items-center justify-between gap-3 cursor-pointer select-none group ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
    >
      {(label || description) && (
        <div className="flex items-start gap-2 min-w-0 pr-1">
          {icon && <div className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors">{icon}</div>}
          <div>
            {label && (
              <span className={`font-semibold text-slate-800 dark:text-slate-200 block ${sizeClasses.text}`}>
                {label}
              </span>
            )}
            {description && (
              <span className={`text-slate-500 dark:text-slate-400 block ${sizeClasses.desc}`}>
                {description}
              </span>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        id={id}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          if (!disabled) onChange(!checked);
        }}
        className={`relative shrink-0 rounded-full transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-indigo-500/40 shadow-inner ${sizeClasses.track} ${colorClasses} ${
          checked ? 'shadow-md' : ''
        }`}
      >
        <span
          className={`block rounded-full bg-white shadow-md transform transition-transform duration-300 ease-out ${
            sizeClasses.thumb
          } ${checked ? sizeClasses.translate : 'translate-x-0'}`}
        />
      </button>
    </label>
  );
};
