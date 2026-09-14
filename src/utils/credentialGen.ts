/**
 * R67 (§9 — NUEVO MODELO DE CONTRASEÑAS): utilidades de generación y política
 * de claves de acceso.
 *
 * Política (documentada en la UI y en AGENTS.md R67):
 *   · Caso 1 — Rectoría escribe una clave manual → esa clave se usa tal cual.
 *   · Caso 2 — campo vacío en el registro → se GENERA una clave.
 *   · Caso 3 — existe `defaultAccessPassword` configurada (Ajustes) → la
 *     generación usa ESA clave (la institución decide, p. ej. "INAS-2026").
 *   · Caso 4 — sin predeterminada → ALEATORIA segura (8 caracteres de un
 *     alfabeto sin ambigüedades: sin 0/O/1/I/l — legible al comunicarla y al
 *     imprimirla en el carné; jamás derivada del documento ni de datos públicos
 *     — REGRESIÓN 12 cerrada por diseño).
 *
 * Toda clave generada cumple el mínimo de Firebase (≥6) y es EXACTAMENTE la
 * que se envía a Firebase y al verifier de la ficha (una sola verdad, §23).
 */

// Alfabeto sin caracteres ambiguos (0/O, 1/I/l) — 30 símbolos.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Genera una clave aleatoria legible tipo XXXX-XXXX (9 chars con guion). */
export function generateRandomAccessPassword(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}`;
}

export type PasswordStrategy = 'manual' | 'default' | 'random';

export interface ResolvedPassword {
  password: string;
  origin: 'manual' | 'default' | 'random';
}

/**
 * Resuelve la clave según la política §9. `manual` = lo que Rectoría escribió
 * (ya validado ≥6 si habrá cuenta). Si no hay manual → predeterminada
 * configurada (si es válida) → aleatoria. Devuelve SIEMPRE una clave válida.
 */
export function resolveAccessPassword(
  manual: string | undefined | null,
  defaultPassword: string | undefined | null
): ResolvedPassword {
  const m = (manual || '').trim();
  if (m) return { password: m, origin: 'manual' };
  const d = (defaultPassword || '').trim();
  if (d && d.length >= 6) return { password: d, origin: 'default' };
  return { password: generateRandomAccessPassword(), origin: 'random' };
}
