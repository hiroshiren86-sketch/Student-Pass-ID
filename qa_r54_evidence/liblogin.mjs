import { chromium } from './node_modules/playwright/index.mjs';
import fs from 'fs';

// Credenciales desde .env (sin exponer)
const envRaw = fs.readFileSync('/home/user/spv/.env','utf8');
const get = (k) => (envRaw.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim().replace(/^['"]|['"]$/g,'') || '';
const EMAIL = get('RECTORIA_EMAIL');
const PASS  = get('RECTORIA_PASS');

const timeout = 60000;
const shot = async (page, n) => page.screenshot({ path: `/tmp/qa_shots/${n}.png` }).catch(()=>{});

async function ensureNoOverlay(page, max=10){
  for (let i=0;i<max;i++){
    const layer = page.locator('div.fixed.inset-0.z-50');
    if (!(await layer.count()) || !(await layer.first().isVisible().catch(()=>false))) return;
    let acted=false;
    for (const c of ['Cerrar guía','¡Empezar!','Cerrar','Ahora no','Entendido']) {
      const b = page.locator(`button:has-text("${c}")`).first();
      if (await b.isVisible({ timeout: 1000 }).catch(()=>false)) { await b.click({ timeout: 3000 }).catch(()=>{}); acted=true; break; }
    }
    if (acted){ await page.waitForTimeout(600); continue; }
    const xb = page.locator('#btn-close-settings').first();
    if (await xb.isVisible({ timeout: 800 }).catch(()=>false)) { await xb.click({ timeout: 3000, force:true }).catch(()=>{}); await page.waitForTimeout(600); continue; }
    await page.keyboard.press('Escape').catch(()=>{});
    await page.waitForTimeout(600);
  }
}

export async function loginAsRectoria(browser){
  const ctx = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const page = await ctx.newPage();
  page.setDefaultTimeout(timeout);
  await page.goto('https://student-pass-id.pages.dev', { waitUntil:'domcontentloaded', timeout:90000 });
  await page.waitForTimeout(3500);
  await ensureNoOverlay(page);
  // cerrar sesión si hay una viva
  if (await page.locator('button[title*="Menú de Usuario"]').first().isVisible({ timeout:4000 }).catch(()=>false)) {
    await page.click('button[title*="Menú de Usuario"]');
    await page.waitForTimeout(600);
    await page.locator('span:has-text("Cerrar Sesión")').first().click();
    await page.waitForTimeout(2000);
    await ensureNoOverlay(page);
  }
  const btn = page.locator('button:has-text("Rectoría / Admin")').first();
  if (await btn.isVisible({ timeout:10000 }).catch(()=>false)) await btn.click();
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.locator('button[type="submit"]:has-text("Ingresar")').click();
  await page.waitForSelector('button[title*="Menú de Usuario"]', { timeout:90000 });
  await ensureNoOverlay(page);
  console.log('LOGIN Rectoría OK');
  return { ctx, page };
}

export async function openPlantillas(page){
  // tab Horarios Escolares (menú Módulos)
  const mod = page.locator('button:has-text("Módulos")').first();
  if (await mod.isVisible({ timeout:6000 }).catch(()=>false)) { await mod.click(); await page.waitForTimeout(500); }
  const item = page.locator('button:has-text("Horarios Escolares")').last();
  if (await item.isVisible({ timeout:4000 }).catch(()=>false)) { await item.click(); await page.waitForTimeout(1500); }
  await ensureNoOverlay(page);
  // menú de vista → Plantillas
  const vm = page.locator('button[aria-label^="Vista actual"]').first();
  if (await vm.isVisible({ timeout:6000 }).catch(()=>false)) { await vm.click(); await page.waitForTimeout(400); }
  const pl = page.locator('button:has-text("Plantillas")').last();
  if (await pl.isVisible({ timeout:4000 }).catch(()=>false)) { await pl.click(); await page.waitForTimeout(1200); }
  await ensureNoOverlay(page);
  return page;
}

export { shot, ensureNoOverlay, EMAIL, PASS };
