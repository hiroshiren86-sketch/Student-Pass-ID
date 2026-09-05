/**
 * Ronda 27 — Plan "Entrega Limpia" (Día Cero) — switch anti-seed.
 *
 * true  = primer arranque siembra datos demo (comportamiento histórico del sitio demo:
 *         50 estudiantes, 6 docentes, cátedras y asistencias de ejemplo).
 * false = primer arranque LIMPIO: arrays vacíos persistidos de forma explícita
 *         (patrón Ronda 14: guardar `[]` evita re-disparos del seed) y la app queda
 *         lista para importar la matrícula real (CSV/Excel/SIMAT) o crearla desde cero.
 *
 * Regla 6 del proyecto (Cero Fallbacks): auto-inyectar estudiantes falsos en una
 * instalación productiva ES un fallback silencioso. Con `false`, la corrupción de
 * localStorage NUNCA recupera con demo: se protege un respaldo `_corrupt_backup_*`
 * y se recupera vacío (el PULL de Cloudflare restaura los datos reales).
 *
 * La demo NO se borra del código: `resetToDemo()` (Ajustes → "Reiniciar datos de
 * prueba") sigue siendo la acción explícita para restaurarla (también sirve de
 * rollback documentado del Día Cero).
 */
export const SEED_DEMO_ON_FIRST_LAUNCH: boolean = false; // ← producción/entrega
