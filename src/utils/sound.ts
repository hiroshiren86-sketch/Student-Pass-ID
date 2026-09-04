/**
 * Synthetic Web Audio API Sound Generator for Attendance Scans
 * Zero asset loading latency, 100% reliable offline.
 */

let audioCtx: AudioContext | null = null;

export function initAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  } catch (e) {
    console.warn('AudioContext initialization notice:', e);
  }
  return audioCtx;
}

// Auto-unlock AudioContext on any initial user touch/click/keypress
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    initAudio();
    if (audioCtx && audioCtx.state === 'running') {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    }
  };
  window.addEventListener('click', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
}

export const SoundService = {
  unlock: () => {
    initAudio();
  },

  // Clear high double-chime for on-time punctual scan
  playBeepSuccess: () => {
    try {
      const ctx = initAudio();
      if (!ctx) return;
      
      const play = () => {
        const now = ctx.currentTime;
        
        // Tone 1
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(659.25, now); // E5
        osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
        gain1.gain.setValueAtTime(0.28, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.18);

        // Tone 2 (Harmonic resolve)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(1318.51, now + 0.09); // E6
        gain2.gain.setValueAtTime(0.22, now + 0.09);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.09);
        osc2.stop(now + 0.3);
      };

      if (ctx.state === 'suspended') {
        ctx.resume().then(play).catch(() => {});
      } else {
        play();
      }
    } catch (e) {
      console.warn('SoundService success error:', e);
    }
  },

  // Warm dual-tone for tardy entry or exit
  playBeepTardy: () => {
    try {
      const ctx = initAudio();
      if (!ctx) return;

      const play = () => {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(440.00, now + 0.12); // A4
        
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.32);
      };

      if (ctx.state === 'suspended') {
        ctx.resume().then(play).catch(() => {});
      } else {
        play();
      }
    } catch (e) {
      console.warn('SoundService tardy error:', e);
    }
  },

  // Noticeable error buzz for not found or unregistered document
  playBeepError: () => {
    try {
      const ctx = initAudio();
      if (!ctx) return;

      const play = () => {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(140, now + 0.28);

        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
      };

      if (ctx.state === 'suspended') {
        ctx.resume().then(play).catch(() => {});
      } else {
        play();
      }
    } catch (e) {
      console.warn('SoundService error tone:', e);
    }
  },

  // Ronda 25 — campanita de excusas para Rectoría (petición del propietario:
  // "lo mejor sería que sonara algo, una campanita, como un Teams o un timbre
  // conveniente para el tema de las excusas" — con el punto rojo ya existente
  // es suficiente feedback; NADA de popups intrusivos).
  //
  // Diseño sonoro: doble "din-din" descendente (E6 → D6) con parcial de brillo,
  // attack rápido y decay suave — claramente distinto del beep de escaneo
  // (success/tardy/error) y del noticeBell de fin de bloque (A5→E5).
  playExcuseChime: () => {
    try {
      const ctx = initAudio();
      if (!ctx) return;

      const play = () => {
        const strike = (startAt: number, freq: number, sparkle: number, dur: number, peak: number) => {
          // Cuerpo de la campana (triangle, grave suave)
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, startAt);
          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0008, startAt + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startAt);
          osc.stop(startAt + dur);
          // Parcial de brillo (sine, 1 octava arriba, muy tenue — timbre "campanita")
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(freq * 2, startAt);
          gain2.gain.setValueAtTime(0.0001, startAt);
          gain2.gain.exponentialRampToValueAtTime(sparkle, startAt + 0.008);
          gain2.gain.exponentialRampToValueAtTime(0.0005, startAt + dur * 0.6);
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.start(startAt);
          osc2.stop(startAt + dur * 0.6);
        };
        const now = ctx.currentTime;
        strike(now,        1318.51, 0.07, 0.55, 0.20); // E6
        strike(now + 0.26, 1174.66, 0.06, 0.75, 0.20); // D6 (resolución cálida)
      };

      if (ctx.state === 'suspended') {
        ctx.resume().then(play).catch(() => {});
      } else {
        play();
      }
    } catch (e) {
      console.warn('SoundService excuse chime error:', e);
    }
  },

  // Distinctive end-of-block notice bell: two warm descending chimes (A5 -> E5)
  // Disparada UNA sola vez por bloque cuando entra en la ventana T-{noticeMinutesBeforeEnd}.
  playNoticeBell: () => {
    try {
      const ctx = initAudio();
      if (!ctx) return;

      const play = () => {
        const ring = (startAt: number, freq: number, dur: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, startAt);
          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, startAt + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startAt);
          osc.stop(startAt + dur);
        };
        const now = ctx.currentTime;
        ring(now, 880, 0.45);          // A5
        ring(now + 0.28, 659.25, 0.7); // E5
      };

      if (ctx.state === 'suspended') {
        ctx.resume().then(play).catch(() => {});
      } else {
        play();
      }
    } catch (e) {
      console.warn('SoundService notice bell error:', e);
    }
  }
};

/**
 * ==============================================================================
 * Preferencia de la campanita de excusas — Ronda 25.
 * Persistida por dispositivo en localStorage (clave dedicada, sin tocar las
 * claves de sesión/sync existentes). Por defecto ACTIVADA (es el pedido del
 * propietario); se silencia desde el botón del Buzón de Justificaciones.
 * Se consulta en el momento de sonar: no requiere estado global ni eventos.
 * ==============================================================================
 */
const EXCUSE_CHIME_PREF = 'inas_excuse_chime_v1';

export const ExcuseChimePref = {
  isEnabled(): boolean {
    try {
      return localStorage.getItem(EXCUSE_CHIME_PREF) !== 'off';
    } catch {
      return true; // sin localStorage disponible, la cortesía sonora sigue
    }
  },
  setEnabled(on: boolean): void {
    try {
      localStorage.setItem(EXCUSE_CHIME_PREF, on ? 'on' : 'off');
    } catch { /* dispositivo sin storage: la preferencia vive solo en la sesión */ }
  }
};

