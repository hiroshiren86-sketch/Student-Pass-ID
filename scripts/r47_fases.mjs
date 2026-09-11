/**
 * Ronda 47 — PRUEBA M12 (caso NORMAL) — FASES A/B/C con PERFIL PERSISTENTE.
 * El sandbox mata procesos de fondo: cada fase corre en PRIMER PLANO (<10 min)
 * y el navegador usa launchPersistentContext → el "dispositivo" conserva datos.
 *
 *   node r47_fases.mjs A   → Rectoría: Pull + aplicar Plantilla T + Push + verificar nube
 *   node r47_fases.mjs B   → Docente: activar Lengua Castellana + escanear 3 de 6°4
 *                            + unicidad + esperar auto-sync (hasta ~4 min) + verificar nube
 *   node r47_fases.mjs C   → Rectoría: Push final + Planilla (badge QR) + restaurar
 *                            Plantilla A + Push + verificar nube
 *
 * CERO cambios de código de la app (Regla #8). Evidencias en r47_shots/.
 */
import fs from 'node:fs';
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs';

const APP = 'https://student-pass-id.pages.dev';
const API = 'https://inas-attendance-worker.hiroshiren86.workers.dev';
const SCHOOL = 'INAS-ANTONIA-SANTOS-2026';
// Ronda 58 (F-25): las credenciales YA NO viven en el repo (el historial las filtró
// públicas). Se cargan de process.env o de un .env FUERA del árbol del repo
// (p. ej. ~/.inas-qa.env, permisos 600). El token filtrado y las contraseñas deben
// ROTARSE en Cloudflare/Firebase — saneado el árbol, la rotación es del propietario.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
function loadQaEnv() {
  const candidates = [process.env.INAS_QA_ENV, path.join(os.homedir(), '.inas-qa.env'), '.inas-qa.env'];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const txt = fs.readFileSync(c, 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
      }
      return;
    } catch { /* siguiente candidato */ }
  }
}
loadQaEnv();
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta ${name}. Exporta la variable o crea ~/.inas-qa.env con las credenciales de QA (fuera del repo, chmod 600).`);
    process.exit(2);
  }
  return v;
}
const TOKEN = requireEnv('INAS_AUTH_TOKEN');
const REC_EMAIL = requireEnv('INAS_REC_EMAIL');
const REC_PASS = requireEnv('INAS_REC_PASS');
const DOC_EMAIL = requireEnv('INAS_DOC_EMAIL');
const DOC_PASS = requireEnv('INAS_DOC_PASS');
const PROFILE = '/home/z/my-project/scripts/r47_profile';
const SHOTS = '/home/z/my-project/scripts/r47_shots';
fs.mkdirSync(SHOTS, { recursive: true });

const ALUMNOS = [
  { code: '196555769', nombre: 'JULIANA ANDRÉS JIMÉNEZ BOTERO' },
  { code: '148717593', nombre: 'SARA FELIPE ACOSTA BEHAIN' },
  { code: '132112295', nombre: 'DANIEL ALEJANDRO ZAPATA CÓRDOBA' },
];

const FASE = (process.argv[2] || '').toUpperCase();
if (!['A', 'B', 'C'].includes(FASE)) { console.error('uso: node r47_fases.mjs A|B|C'); process.exit(1); }

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  locale: 'es-CO',
  timezoneId: 'America/Bogota',
  viewport: { width: 1366, height: 900 },
});
const page = ctx.pages()[0] || (await ctx.newPage());
page.setDefaultTimeout(60000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => {});
const step = (m) => console.log('\n== ' + m);
const now = () => new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' });

async function waitShell() {
  await page.waitForSelector('button[title*="Menú de Usuario"]', { timeout: 90000 });
}
async function ensureNoOverlay(max = 10) {
  for (let i = 0; i < max; i++) {
    const layer = page.locator('div.fixed.inset-0.z-50');
    if (!(await layer.count())) return;
    if (!(await layer.first().isVisible().catch(() => false))) return;
    let acted = false;
    // 1) botones con texto (overlay de sync, guía de bienvenida)
    for (const c of ['Cerrar guía', '¡Empezar!', 'Cerrar', 'Ahora no']) {
      const b = page.locator(`button:has-text("${c}")`).first();
      if (await b.isVisible({ timeout: 1000 }).catch(() => false)) {
        try { await b.click({ timeout: 3000 }); acted = true; console.log(`   [overlay] clic "${c}"`); } catch (e) { console.log(`   [overlay] "${c}" no clicable: ${String(e).slice(0, 80)}`); }
        break;
      }
    }
    if (acted) { await page.waitForTimeout(700); continue; }
    // 2) X del modal de Configuración
    const xb = page.locator('#btn-close-settings').first();
    if (await xb.isVisible({ timeout: 800 }).catch(() => false)) {
      try { await xb.click({ timeout: 3000, force: true }); acted = true; console.log('   [overlay] clic X configuración'); } catch (e) { console.log(`   [overlay] X no clicable: ${String(e).slice(0, 80)}`); }
      if (acted) { await page.waitForTimeout(700); continue; }
    }
    // 3) Escape (seguro: la guía ya está cerrada a estas alturas; quirk R43 solo aplica AL Tour)
    console.log('   [overlay] sin botones → Escape');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(700);
  }
}
async function localState() {
  return page.evaluate(() => {
    const g = (k) => JSON.parse(localStorage.getItem(k) || '[]');
    const s = JSON.parse(localStorage.getItem('inas_settings_v5') || '{}');
    return {
      students: g('inas_students_v5').length,
      teachers: g('inas_teachers_v5').length,
      assignments: g('inas_schedule_assignments_v5').length,
      slots: g('inas_schedule_slots_v5').length,
      records: g('inas_attendance_v5').length,
      activeDayTemplate: s.activeDayTemplate || '(ninguno)',
    };
  });
}
async function apiPull() {
  const res = await fetch(`${API}/api/sync/pull?schoolCode=${SCHOOL}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return res.json();
}
async function setTokenAndReload() {
  await page.evaluate((tok) => {
    const s = JSON.parse(localStorage.getItem('inas_settings_v5') || '{}');
    s.cloudflareApiToken = tok;
    localStorage.setItem('inas_settings_v5', JSON.stringify(s));
  }, TOKEN);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitShell();
  await ensureNoOverlay();
}
async function openSyncTab() {
  await ensureNoOverlay();
  if (await page.getByText('Token de Acceso del Worker').first().isVisible({ timeout: 1200 }).catch(() => false)) return;
  await page.click('button[title*="Menú de Usuario"]');
  await page.waitForTimeout(700);
  await page.locator('button:has-text("Configuración & Motores IA")').first().click();
  await page.waitForTimeout(800);
  await page.getByRole('tab', { name: /Sync y Seguridad/ }).click();
  await page.waitForTimeout(500);
  await page.getByText('Token de Acceso del Worker').first().waitFor({ timeout: 15000 });
}
async function clickSyncButton(label) {
  await openSyncTab();
  await page.locator(`button:has-text("${label}")`).first().click();
  await page.locator('button:has-text("Cerrar")').first().waitFor({ timeout: 120000 });
  await shot(`r47_sync_${label.startsWith('Descargar') ? 'pull' : 'push'}_${FASE}`);
  await ensureNoOverlay();
}
async function navHorarios() {
  await ensureNoOverlay();
  const seg = page.locator('div.hidden.lg\\:flex button:has-text("Horarios")');
  if ((await seg.count()) && (await seg.first().isVisible().catch(() => false))) {
    await seg.first().click();
  } else {
    await page.locator('button:has-text("Módulos")').first().click();
    await page.waitForTimeout(600);
    await page.locator('button:has-text("Horarios Escolares")').first().click();
  }
  await page.waitForTimeout(900);
  await ensureNoOverlay();
}
async function switchSubView(label) {
  const trigger = page.locator(
    'button:has-text("Por Día"), button:has-text("Semana Completa"), button:has-text("QR de Clase"), button:has-text("Estructura de Horas"), button:has-text("Plantillas")'
  ).first();
  await trigger.click();
  await page.waitForTimeout(600);
  await page.locator(`button:has-text("${label}")`).last().click();
  await page.waitForTimeout(1200);
}
async function aplicarPlantilla(include, exclude, shotName) {
  const marked = await page.evaluate(({ inc, exc }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const btns = [...document.querySelectorAll('button')].filter((b) => norm(b.textContent) === 'Aplicar hoy');
    for (const b of btns) {
      let el = b;
      while (el && el !== document.body) {
        const t = norm(el.textContent);
        if (t.includes(inc) && !t.includes(exc)) {
          b.setAttribute('data-r47-target', '1');
          return true;
        }
        el = el.parentElement;
      }
    }
    return false;
  }, { inc: include, exc: exclude });
  if (!marked) throw new Error(`No encontré la tarjeta "${include}"`);
  await page.locator('button[data-r47-target="1"]').click();
  await page.waitForTimeout(1200);
  await shot(shotName);
  const st = await localState();
  console.log(`   plantilla "${include}" aplicada → slots=${st.slots}, active=${st.activeDayTemplate}`);
  return st;
}
// Si el perfil trae sesión viva, cierra; garantiza pantalla de login
async function ensureAtLogin() {
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(3500);
  await ensureNoOverlay();
  if (await page.locator('button[title*="Menú de Usuario"]').first().isVisible({ timeout: 4000 }).catch(() => false)) {
    console.log('   perfil con sesión viva → cerrando sesión…');
    await page.click('button[title*="Menú de Usuario"]');
    await page.waitForTimeout(600);
    await page.locator('span:has-text("Cerrar Sesión")').first().click();
    await page.waitForTimeout(2000);
    await ensureNoOverlay();
  }
}
async function login(email, pass, roleBtnText, tag) {
  step(`LOGIN ${tag} [${now()}]`);
  const btn = page.locator(`button:has-text("${roleBtnText}")`).first();
  if (await btn.isVisible({ timeout: 15000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(500);
  }
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(pass);
  await shot(`${tag}_login`);
  await page.locator('button[type="submit"]:has-text("Ingresar")').click();
  await waitShell();
  await ensureNoOverlay();
  console.log(`   login ${tag} OK [${now()}]`);
}
async function logout(tag) {
  step(`LOGOUT ${tag} [${now()}]`);
  await ensureNoOverlay();
  await page.click('button[title*="Menú de Usuario"]');
  await page.waitForTimeout(600);
  await page.locator('span:has-text("Cerrar Sesión")').first().click();
  await page.waitForTimeout(2000);
  await ensureNoOverlay();
  console.log('   sesión cerrada');
}

console.log(`R47 FASE ${FASE} — ${now()} (Bogotá)`);

if (FASE === 'A') {
  await ensureAtLogin();
  await login(REC_EMAIL, REC_PASS, 'Rectoría / Admin', 'r47A_rectoria');
  await setTokenAndReload();
  let st = await localState();
  console.log('   estado local tras token:', JSON.stringify(st));

  step('A.3 — Pull desde la nube');
  await clickSyncButton('Descargar (Pull)');
  st = await localState();
  console.log('   tras pull:', JSON.stringify(st));
  if (st.students < 80) throw new Error('Pull no trajo la matrícula completa');

  step('A.4 — Horarios → Plantillas → Aplicar Plantilla T');
  await navHorarios();
  await switchSubView('Plantillas');
  await shot('r47A_plantillas_antes');
  await aplicarPlantilla('Jornada de Pruebas', 'Día Normal', 'r47A_T_aplicada');
  st = await localState();
  if (st.slots !== 31) throw new Error(`Se esperaban 31 slots, hay ${st.slots}`);

  step('A.5 — Push a la nube');
  await clickSyncButton('Sincronizar (Push)');
  await page.waitForTimeout(2500);
  const nube = await apiPull();
  const d = nube.data || {};
  console.log(`   nube tras push: slots=${(d.slots || []).length}, active=${d.settings?.activeDayTemplate}`);
  if (!(d.settings?.activeDayTemplate === 'tmpl-pruebas-extendida' && (d.slots || []).length === 31)) {
    throw new Error('La nube NO refleja la Plantilla T');
  }
  await logout('rectoria_A');
  console.log('\nFASE A COMPLETA — nube lista (T 31 slots)');
}

if (FASE === 'B') {
  await ensureAtLogin();
  await login(DOC_EMAIL, DOC_PASS, 'Portal Docente & Aula', 'r47B_docente');
  let st = await localState();
  console.log('   dispositivo docente (perfil compartido):', JSON.stringify(st));
  if (st.students < 80 || st.slots !== 31) throw new Error('El dispositivo docente no tiene matrícula/T — correr FASE A');

  step('B.2 — Aula: activar "Lengua Castellana" (1-toque v2)');
  await page.getByText('Escáner de Aula').first().waitFor({ timeout: 30000 });
  const titulo = await page.locator('h2:has-text("Escáner de Aula")').first().innerText();
  console.log('   ' + titulo.replace(/\n/g, ' '));
  await shot('r47B_aula_antes');

  const selAsig = page.locator('select[aria-label="Selecciona tu asignatura para activar"]');
  await selAsig.waitFor({ timeout: 20000 });
  await selAsig.selectOption({ label: 'Lengua Castellana' });
  await page.locator('button[aria-label="Activar mi asignatura en este dispositivo"]').click();
  await page.waitForTimeout(1000);
  await shot('r47B_clase_activada');
  const fb = await page.locator('body').innerText();
  const okAct = fb.includes('Clase activa en este dispositivo') || fb.includes('quedan vinculados a esta asignatura');
  console.log('   activación v2:', okAct ? 'OK — "Clase activa" visible' : 'REVISAR (feedback no hallado)');

  async function escanear(code, tag, esperarTexto) {
    const input = page.locator('input[placeholder*="Escanear con lector USB"]');
    await input.fill(code);
    await page.locator('button:has-text("Registrar")').first().click();
    await page.waitForTimeout(900);
    await shot(tag);
    const texto = await page.locator('body').innerText();
    const ok = esperarTexto.every((t) => texto.includes(t));
    const dup = texto.includes('ya fue registrado');
    console.log(`   escaneo ${code} [${now()}]: ${ok ? 'OK' : 'REVISAR'}${dup ? ' (duplicado detectado)' : ''}`);
    return { ok, dup };
  }

  step('B.3 — Escanear 3 estudiantes de 6°4');
  const esperados = [['JULIANA', 'Lengua Castellana'], ['SARA', 'Lengua Castellana'], ['DANIEL', 'Lengua Castellana']];
  const resultados = [];
  for (let i = 0; i < ALUMNOS.length; i++) {
    resultados.push(await escanear(ALUMNOS[i].code, `r47B_scan${i + 1}`, esperados[i]));
  }

  step('B.4 — Unicidad: re-escanear Juliana');
  await escanear(ALUMNOS[0].code, 'r47B_duplicado', ['ya fue registrado']);

  step('B.5 — Verificación LOCAL');
  const recs = await page.evaluate(() => JSON.parse(localStorage.getItem('inas_attendance_v5') || '[]'));
  const hoy = '2026-09-07';
  const nuevos = recs.filter((r) => ALUMNOS.some((a) => a.code === (r.studentCode || r.studentId)) && String(r.date || '').includes(hoy));
  console.log(`   registros locales de hoy (3 alumnos): ${nuevos.length}`);
  nuevos.forEach((r) => console.log(`   → ${r.studentCode} | ${r.subject} | slot=${r.slotId} | grado=${r.studentGrade} | ctx=${r.contextSource} | QR=${r.classQrVerified} | teacher=${r.teacherId || '-'} | ${r.time}`));
  fs.writeFileSync('/home/z/my-project/scripts/r47_registros_locales.json', JSON.stringify(nuevos, null, 2));

  step('B.6 — Esperar AUTO-SYNC del docente (timer 5 min desde la carga)');
  console.log(`   [${now()}] sondeando la nube cada 25 s (máx ~4 min)…`);
  let vistos = 0;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(25000);
    const nube = await apiPull();
    const rr = ((nube.data || {}).records || []).filter((r) => ALUMNOS.some((a) => a.code === (r.studentCode || r.studentId)) && String(r.date || '').includes(hoy));
    console.log(`   [${now()}] intento ${i + 1}: registros de los 3 en la nube = ${rr.length}`);
    if (rr.length >= 3) { vistos = rr.length; break; }
    vistos = rr.length;
  }
  console.log(`   auto-sync visto: ${vistos >= 3 ? 'SÍ (el propio timer del docente empujó)' : 'no en la ventana — la FASE C hará Push manual'}`);
  await logout('docente_B');
  console.log('\nFASE B COMPLETA');
}

if (FASE === 'C') {
  await ensureAtLogin();
  await login(REC_EMAIL, REC_PASS, 'Rectoría / Admin', 'r47C_rectoria');
  const st = await localState();
  console.log('   estado local de Rectoría (mismo dispositivo):', JSON.stringify(st));

  step('C.2 — Push final (respaldo del dispositivo compartido)');
  await clickSyncButton('Sincronizar (Push)');
  await page.waitForTimeout(2500);

  step('C.3 — Verificación de los registros en la NUBE');
  const hoy = '2026-09-07';
  const nube = await apiPull();
  const d = nube.data || {};
  const rr = (d.records || []).filter((r) => ALUMNOS.some((a) => a.code === (r.studentCode || r.studentId)) && String(r.date || '').includes(hoy));
  const okV2 = rr.filter((r) => r.subject === 'Lengua Castellana' && r.contextSource === 'QR_CLASE' && r.studentGrade === '6°4');
  console.log(`   registros en nube: ${rr.length}/3 | con atribución v2 completa: ${okV2.length}/3`);
  rr.forEach((r) => console.log(`   → ${r.studentCode} | ${r.subject} | slot=${r.slotId} | grado=${r.studentGrade} | ctx=${r.contextSource} | teacher=${r.teacherId || '-'} | ${r.time}`));
  fs.writeFileSync('/home/z/my-project/scripts/r47_registros_nube.json', JSON.stringify(rr, null, 2));

  step('C.4 — Planilla de Asistencia (badge QR)');
  try {
    await page.getByRole('tab', { name: /Planilla/ }).click({ timeout: 15000 });
    await page.waitForTimeout(1800);
    await shot('r47C_planilla');
    console.log('   planilla capturada');
  } catch (e) {
    console.log('   (Planilla no alcanzada: ' + String(e).slice(0, 80) + ')');
  }

  step('C.5 — RESTAURACIÓN: Plantilla A (jornada normal) + Push');
  await navHorarios();
  await switchSubView('Plantillas');
  await aplicarPlantilla('Día Normal', 'Jornada de Pruebas', 'r47C_A_restaurada');
  await clickSyncButton('Sincronizar (Push)');
  await page.waitForTimeout(2500);
  const fin = await apiPull();
  const df = fin.data || {};
  console.log(`   nube final: slots=${(df.slots || []).length}, active=${df.settings?.activeDayTemplate}`);

  step('RESUMEN FASE C');
  console.log(`   registros: ${rr.length}/3 en nube | v2 correctos: ${okV2.length}/3`);
  console.log(`   pageerrors: ${pageErrors.length}${pageErrors.length ? ' → ' + pageErrors.slice(0, 3).join(' | ') : ''}`);
  await logout('rectoria_C');
  console.log('\nFASE C COMPLETA — sistema restaurado a jornada normal');
}

await ctx.close();
console.log(`DONE FASE ${FASE} — ${now()}`);
