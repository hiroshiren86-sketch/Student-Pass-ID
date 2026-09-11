/** R47 — evidencia Planilla: badge QR en los 3 registros (Rectoría). */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs';

const ctx = await chromium.launchPersistentContext('/home/z/my-project/scripts/r47_profile', {
  headless: true, locale: 'es-CO', timezoneId: 'America/Bogota', viewport: { width: 1366, height: 900 },
});
const page = ctx.pages()[0] || (await ctx.newPage());
page.setDefaultTimeout(60000);
const shot = (n) => page.screenshot({ path: `/home/z/my-project/scripts/r47_shots/${n}.png` }).catch(() => {});

async function ensureNoOverlay(max = 8) {
  for (let i = 0; i < max; i++) {
    const layer = page.locator('div.fixed.inset-0.z-50');
    if (!(await layer.count()) || !(await layer.first().isVisible().catch(() => false))) return;
    let acted = false;
    for (const c of ['Cerrar guía', '¡Empezar!', 'Cerrar', 'Ahora no']) {
      const b = page.locator(`button:has-text("${c}")`).first();
      if (await b.isVisible({ timeout: 1000 }).catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); acted = true; break; }
    }
    if (acted) { await page.waitForTimeout(600); continue; }
    const xb = page.locator('#btn-close-settings').first();
    if (await xb.isVisible({ timeout: 800 }).catch(() => false)) { await xb.click({ timeout: 3000, force: true }).catch(() => {}); await page.waitForTimeout(600); continue; }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);
  }
}

await page.goto('https://student-pass-id.pages.dev', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(3500);
await ensureNoOverlay();
// si hay sesión viva (Rectoría quedó logueada), cerrarla primero
if (await page.locator('button[title*="Menú de Usuario"]').first().isVisible({ timeout: 4000 }).catch(() => false)) {
  await page.click('button[title*="Menú de Usuario"]');
  await page.waitForTimeout(600);
  await page.locator('span:has-text("Cerrar Sesión")').first().click();
  await page.waitForTimeout(2000);
  await ensureNoOverlay();
}
const btn = page.locator('button:has-text("Rectoría / Admin")').first();
if (await btn.isVisible({ timeout: 10000 }).catch(() => false)) await btn.click();
// Ronda 58 (F-25): credenciales desde el entorno (ver r47_fases.mjs — nunca en el repo).
if (!process.env.INAS_REC_EMAIL || !process.env.INAS_REC_PASS) {
  console.error('Falta INAS_REC_EMAIL / INAS_REC_PASS (exporta o crea ~/.inas-qa.env, chmod 600).');
  process.exit(2);
}
await page.locator('input[type="email"]').fill(process.env.INAS_REC_EMAIL);
await page.locator('input[type="password"]').fill(process.env.INAS_REC_PASS);
await page.locator('button[type="submit"]:has-text("Ingresar")').click();
await page.waitForSelector('button[title*="Menú de Usuario"]', { timeout: 90000 });
await ensureNoOverlay();
console.log('login OK');

// Planilla: botón de la barra segmentada (no role=tab)
const seg = page.locator('div.hidden.lg\\:flex button:has-text("Planilla")').first();
if (await seg.isVisible({ timeout: 6000 }).catch(() => false)) {
  await seg.click();
} else {
  await page.locator('button:has-text("Módulos")').first().click();
  await page.waitForTimeout(600);
  await page.locator('button:has-text("Planilla de Asistencia")').last().click();
}
await page.waitForTimeout(2000);
await ensureNoOverlay();
// filtrar 6°4 si hay selector de grado
try {
  const sel = page.locator('select').first();
  const opts = await sel.locator('option').allInnerTexts();
  const target = opts.find((o) => o.includes('6°4'));
  if (target) { await sel.selectOption(target); await page.waitForTimeout(1200); }
} catch (e) { console.log('(sin filtro de grado)'); }
await shot('r47C_planilla_QR');
const texto = await page.locator('body').innerText();
for (const n of ['JULIANA', 'SARA', 'DANIEL']) console.log(n + ': ' + (texto.includes(n) ? 'visible' : 'no visible'));
console.log('menciones QR en página: ' + (texto.match(/QR/g) || []).length);
await ctx.close();
console.log('DONE');
