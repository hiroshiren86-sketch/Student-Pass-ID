/**
 * Ronda 21 — helper de fecha Bogotá con desplazamiento en días.
 * Reutiliza la semántica de getTodayDateString() (America/Bogota, en-CA → YYYY-MM-DD)
 * y suma `offsetDays` con aritmética segura de mediodía (evita el edge de DST/fin de mes).
 */
export function bogotaToday(offsetDays: number = 0): string {
  const base = new Date();
  const options: Intl.DateTimeFormatOptions = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' };
  const today = new Intl.DateTimeFormat('en-CA', options).format(base); // YYYY-MM-DD
  if (!offsetDays) return today;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
