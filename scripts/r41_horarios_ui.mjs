/**
 * Ronda 41 — Creación de horarios de demostración COMO USUARIO REAL (mandato del propietario).
 * Flujo en https://student-pass-id.pages.dev con Playwright (chromium headless):
 *  1. Login Firebase como Rectoría (rectoria@inas.edu.co).
 *  2. Configurar AUTH_TOKEN del Worker en Ajustes (equivalente a pegarlo en el campo).
 *  3. Ajustes → "Descargar (Pull)" → restaura el estado exacto de la nube del usuario
 *     (80 estudiantes, 20 docentes, 180 cátedras viejas con vínculos débiles, 7 slots).
 *  4. Horarios → "Importar CSV" → Validar → Aplicar (con reemplazo de los cursos incluidos)
 *     → 180 cátedras NUEVAS con teacherId resuelto para los 20 docentes reales.
 *  5. Ajustes → "Sincronizar (Push)" → sube el estado fusionado a D1/KV.
 *  6. Recarga + verificación local de persistencia. Evidencias en r41_shots/.
 * La verificación del lado servidor se hace aparte con /api/sync/pull (curl).
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const APP = 'https://student-pass-id.pages.dev';
const EMAIL = process.env.R33_ADMIN_EMAIL || 'rectoria@inas.edu.co';
const PASS = process.env.R33_ADMIN_PASS;
const TOKEN = process.env.WORKER_AUTH_TOKEN;
const SHOTS = '/home/z/my-project/scripts/r41_shots';
fs.mkdirSync(SHOTS, { recursive: true });
if (!PASS || !TOKEN) { console.error('FATAL: faltan env R33_ADMIN_PASS / WORKER_AUTH_TOKEN'); process.exit(1); }

const CSV = fs.readFileSync('/home/z/my-project/scripts/horarios_demo_inas.csv', 'utf8').trim();
const csvLines = CSV.split('\n').length - 1; // sin encabezado

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ locale: 'es-CO', viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 200)));

const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }).catch(() => {});

async function waitShell() {
  await page.waitForSelector('button[title*="Menú de Usuario"]', { timeout: 90000 });
}
async function closeOverlayIfAny() {
  const btn = page.locator('button:has-text("Cerrar")').first();
  try { if (await btn.isVisible({ timeout: 8000 })) { await btn.click(); await page.waitForTimeout(600); return true; } } catch {}
  return false;
}
// disuelve TODAS las capas modales (overlay de sync + modal de ajustes) — el quirk de overlays apilados
async function ensureNoOverlay(max = 5) {
  for (let i = 0; i < max; i++) {
    const layer = page.locator('div.fixed.inset-0.z-50');
    if (!(await layer.count())) return;
    const vis = await layer.first().isVisible().catch(() => false);
    if (!vis) return;
    const cerrar = page.locator('button:has-text("Cerrar")').first();
    if (await cerrar.isVisible({ timeout: 1500 }).catch(() => false)) {
      await cerrar.click().catch(() => {});
      await page.waitForTimeout(700);
    } else {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(700);
    }
  }
}
async function openSettings() {
  await ensureNoOverlay();
  // si el modal ya está abierto, no abrir otro
  if (await page.getByText('Token de Acceso del Worker').first().isVisible({ timeout: 1500 }).catch(() => false)) return;
  await page.click('button[title*="Menú de Usuario"]');
  await page.waitForTimeout(700);
  // ítem del menú que abre el modal de ajustes (texto real en App.tsx)
  const item = page.locator('button:has-text("Configuración & Motores IA")').first();
  await item.click();
  await page.waitForTimeout(800);
  // ir a la pestaña "Sync y Seguridad" donde viven Pull/Push
  await page.getByRole('tab', { name: /Sync y Seguridad/ }).click();
  await page.waitForTimeout(500);
  await page.getByText('Token de Acceso del Worker').first().waitFor({ timeout: 15000 });
}
async function localCounts() {
  return page.evaluate(() => ({
    students: JSON.parse(localStorage.getItem('inas_students_v5') || '[]').length,
    teachers: JSON.parse(localStorage.getItem('inas_teachers_v5') || '[]').length,
    assignments: JSON.parse(localStorage.getItem('inas_schedule_assignments_v5') || '[]').length,
    slots: JSON.parse(localStorage.getItem('inas_schedule_slots_v5') || '[]').length,
  }));
}
// Navega a la sección Horarios (barra segmentada si está, si no menú "Módulos")
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
  await page.locator('button[aria-label="Importar horario masivo por CSV"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
}
// Cambia la subvista del Constructor (menú bento de tarjetas)
async function switchSubView(label) {
  const trigger = page.locator('button:has-text("Por Día"), button:has-text("Semana Completa"), button:has-text("QR de Clase"), button:has-text("Estructura de Horas"), button:has-text("Plantillas")').first();
  await trigger.click();
  await page.waitForTimeout(500);
  await page.locator(`button:has-text("${label}")`).last().click();
  await page.waitForTimeout(1200);
}

// ===== 1. LOGIN =====
console.log('1) Login Rectoría…');
await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(3000);
const roleBtn = page.locator('button:has-text("Rectoría / Admin")').first();
if (await roleBtn.isVisible({ timeout: 15000 }).catch(() => false)) {
  await roleBtn.click();
  await page.waitForTimeout(500);
}
await page.locator('input[type="email"]').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASS);
await shot('01_login_relleno');
await page.locator('button[type="submit"]:has-text("Ingresar")').click();
await waitShell();
console.log('   login OK');
await shot('02_app_logueada');

// ===== 2. TOKEN DEL WORKER (paso de configuración de dispositivo) =====
console.log('2) Configurando AUTH_TOKEN del Worker en ajustes locales…');
await page.evaluate((tok) => {
  const KEY = 'inas_settings_v5';
  const s = JSON.parse(localStorage.getItem(KEY) || '{}');
  s.cloudflareApiToken = tok;
  localStorage.setItem(KEY, JSON.stringify(s));
}, TOKEN);
await page.reload({ waitUntil: 'domcontentloaded' });
await waitShell();
const pre = await localCounts();
console.log('   estado local ANTES del pull:', JSON.stringify(pre));

// ===== 3. PULL =====
console.log('3) Ajustes → Descargar (Pull)…');
await openSettings();
await page.locator('button:has-text("Descargar (Pull)")').first().click();
// esperar a que el overlay termine (su botón Cerrar aparece al éxito/error) y el estado local refleje la nube
await page.locator('button:has-text("Cerrar")').first().waitFor({ timeout: 120000 });
let pulled = null;
for (let i = 0; i < 45; i++) {
  pulled = await localCounts();
  if (pulled.teachers > 0 && pulled.students > 0 && pulled.assignments > 0) break;
  await page.waitForTimeout(2000);
}
console.log('   tras pull:', JSON.stringify(pulled));
await shot('03_pull_ok');
await ensureNoOverlay();

// ===== 4. IMPORTAR CSV =====
console.log('4) Horarios → Importar CSV…');
await navHorarios();
await shot('04_horarios_vista');
await page.locator('button[aria-label="Importar horario masivo por CSV"]').click();
await page.waitForTimeout(800);
const ta = page.locator('textarea').first();
await ta.fill(CSV);
await page.locator('button:has-text("Validar")').first().click();
await page.waitForTimeout(1200);
const previewText = await page.locator('[role="dialog"]').innerText().catch(() => '');
const validOk = previewText.toLowerCase().includes(`${csvLines} cátedra(s) válida(s)`);
const hasErrors = previewText.toLowerCase().includes('línea(s) con errores');
console.log(`   validación: válidas=${validOk ? csvLines : '??'} errores=${hasErrors ? 'SÍ' : 'no'}`);
if (!validOk || hasErrors) {
  await shot('05_import_errores');
  console.error('FATAL: la validación del CSV no pasó. Extracto:', previewText.slice(0, 800));
  process.exit(1);
}
await shot('05_import_validado');
// marcar reemplazo de cursos incluidos (wipe escopado a los 6 grados)
const dlg = page.locator('[role="dialog"][aria-label*="Importar horario masivo"]');
await dlg.locator('input[type="checkbox"]').first().check();
await page.locator('button:has-text("Aplicar")').first().click();
await page.waitForTimeout(1500);
const postImport = await localCounts();
const asgDetail = await page.evaluate(() => {
  const a = JSON.parse(localStorage.getItem('inas_schedule_assignments_v5') || '[]');
  const byGrade = {};
  a.forEach(x => { byGrade[x.grade] = (byGrade[x.grade] || 0) + 1; });
  return { total: a.length, conTeacherId: a.filter(x => x.teacherId).length, byGrade };
});
console.log('   tras importar:', JSON.stringify(postImport), '— detalle:', JSON.stringify(asgDetail));
await shot('06_import_aplicado');

// ===== 5. PUSH =====
console.log('5) Ajustes → Sincronizar (Push)…');
await openSettings();
await page.locator('button:has-text("Sincronizar (Push)")').first().click();
// el overlay de sync muestra Cerrar al terminar
await page.locator('button:has-text("Cerrar")').first().waitFor({ timeout: 120000 });
await shot('07_push_ok');
await ensureNoOverlay();

// ===== 6. RELOAD + persistencia =====
console.log('6) Recarga y verificación de persistencia…');
await page.reload({ waitUntil: 'domcontentloaded' });
await waitShell();
const postReload = await localCounts();
console.log('   tras recarga:', JSON.stringify(postReload));
await navHorarios();
// seleccionar el grado 6°4 en el selector si existe
try {
  const sel = page.locator('select').first();
  const opts = await sel.locator('option').allInnerTexts();
  const target = opts.find(o => o.includes('6°4'));
  if (target) { await sel.selectOption(target); await page.waitForTimeout(800); }
} catch (e) { console.log('   (sin selector de grado visible)'); }
await shot('08_por_dia_64_recargada');
try {
  await switchSubView('Semana Completa');
  await shot('09_matriz_semanal_64');
  await switchSubView('QR de Clase');
  await shot('10_qr_de_clase');
} catch (e) { console.log('   subvistas no alcanzadas:', String(e).slice(0, 140)); }

console.log('\nRESUMEN LOCAL:');
console.log('  antes pull :', JSON.stringify(pre));
console.log('  tras pull  :', JSON.stringify(pulled));
console.log('  tras import:', JSON.stringify(postImport));
console.log('  tras reload:', JSON.stringify(postReload));
console.log('  pageerrors :', errors.length, errors.slice(0, 3));
await browser.close();
console.log('DONE');
