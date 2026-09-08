/* ============================================================
 * Ronda 51 — Verificación E2E del FIX CORS (worker >= 2273960c)
 * Comprueba que el preflight CORS del Worker acepta los headers
 * que la PWA envía (X-Device-Id, X-Device-Name, X-Firebase-Id-Token)
 * y que un Pull real funciona desde el navegador. SOLO LECTURA
 * (health + pull). NADA de Push/Escritura.
 *
 * Uso (sin credenciales embebidas — política del repo):
 *   INAS_AUTH_TOKEN=<token de sync> node scripts/verify_fix_cors_r51.js
 * Requiere: npm i playwright (o bun add playwright)
 * ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.INAS_APP_URL || 'https://student-pass-id.pages.dev';
const WORKER = process.env.INAS_WORKER_URL || 'https://inas-attendance-worker.hiroshiren86.workers.dev';
const SCHOOL = process.env.INAS_SCHOOL_CODE || 'INAS-ANTONIA-SANTOS-2026';
const AUTH_TOKEN = (process.env.INAS_AUTH_TOKEN || '').trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'America/Bogota' });
  const page = await ctx.newPage();
  const failures = [];
  page.on('requestfailed', r => { if (r.url().includes('worker')) failures.push('REQFAIL ' + r.url() + ' :: ' + (r.failure() || {}).errorText); });

  console.log('== Matriz de headers (preflight real desde navegador) ==');
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(2500);
  const matriz = await page.evaluate(async ({ WORKER, AUTH_TOKEN, SCHOOL }) => {
    const out = {};
    const dev = { 'X-Device-Id': 'dev-qa-cors', 'X-Device-Name': 'QA-CORS' };
    const id = { 'X-Firebase-Id-Token': 'token-de-prueba' };
    try { const r = await fetch(`${WORKER}/api/health`, { headers: { 'Authorization': 'Bearer x' } }); out.A1_soloAuth = 'HTTP ' + r.status; }
    catch (e) { out.A1_soloAuth = 'FALLO: ' + String(e).slice(0, 80); }
    try { const r = await fetch(`${WORKER}/api/health`, { headers: { 'Authorization': 'Bearer x', ...dev } }); out.A2_conDeviceId = 'HTTP ' + r.status; }
    catch (e) { out.A2_conDeviceId = 'FALLO: ' + String(e).slice(0, 80); }
    try { const r = await fetch(`${WORKER}/api/health`, { headers: { 'Authorization': 'Bearer x', ...dev, ...id } }); out.A3_conIdToken = 'HTTP ' + r.status; }
    catch (e) { out.A3_conIdToken = 'FALLO: ' + String(e).slice(0, 80); }
    if (AUTH_TOKEN) {
      try {
        const r = await fetch(`${WORKER}/api/sync/pull?schoolCode=${SCHOOL}`, { headers: { 'Authorization': `Bearer ${AUTH_TOKEN}`, ...dev } });
        const j = await r.json().catch(() => null);
        const d = j && j.data ? j.data : j;
        out.A4_pullReal = `HTTP ${r.status} · estudiantes=${(d && d.students ? d.students.length : '?')} · docentes=${(d && d.teachers ? d.teachers.length : '?')}`;
      } catch (e) { out.A4_pullReal = 'FALLO: ' + String(e).slice(0, 80); }
    }
    return out;
  }, { WORKER, AUTH_TOKEN, SCHOOL });
  console.log(JSON.stringify(matriz, null, 2));

  const ok = /HTTP 200/.test(matriz.A1_soloAuth || '') && /HTTP 200/.test(matriz.A2_conDeviceId || '') && /HTTP 200/.test(matriz.A3_conIdToken || '');
  console.log('== VEREDICTO:', ok ? 'PASS ✓ (preflight acepta todos los headers de la PWA)' : 'FAIL ✗ (revisar corsHeaders del Worker)', '==');
  if (!AUTH_TOKEN) console.log('(A4 omitido: falta INAS_AUTH_TOKEN en el entorno)');
  console.log('Fallos de red al worker:', failures.length ? failures.slice(0, 4) : 'NINGUNO ✓');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERROR SCRIPT:', e.message); process.exit(1); });
