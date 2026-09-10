import { chromium } from './node_modules/playwright/index.mjs';
import fs from 'fs';
const envRaw = fs.readFileSync('/home/user/spv/.env','utf8');
const get = (k) => (envRaw.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim().replace(/^['"]|['"]$/g,'') || '';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function ensureNoOverlay(page, max=10){
  for (let i=0;i<max;i++){
    const layer = page.locator('div.fixed.inset-0.z-50');
    if (!(await layer.count()) || !(await layer.first().isVisible().catch(()=>false))) return;
    let acted=false;
    for (const c of ['Cerrar guía','¡Empezar!','Cerrar','Ahora no','Entendido']) {
      const b = page.locator(`button:has-text("${c}")`).first();
      if (await b.isVisible({ timeout: 800 }).catch(()=>false)) { await b.click({ timeout: 3000 }).catch(()=>{}); acted=true; break; }
    }
    if (acted){ await page.waitForTimeout(500); continue; }
    const xb = page.locator('#btn-close-settings').first();
    if (await xb.isVisible({ timeout: 600 }).catch(()=>false)) { await xb.click({ timeout: 3000, force:true }).catch(()=>{}); await page.waitForTimeout(500); continue; }
    await page.keyboard.press('Escape').catch(()=>{});
    await page.waitForTimeout(500);
  }
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  await page.goto('https://student-pass-id.pages.dev', { waitUntil:'domcontentloaded', timeout:90000 });
  await wait(3500);
  await ensureNoOverlay(page);
  const btn = page.locator('button:has-text("Rectoría / Admin")').first();
  if (await btn.isVisible({timeout:8000}).catch(()=>false)) await btn.click();
  await page.locator('input[type="email"]').fill(get('RECTORIA_EMAIL'));
  await page.locator('input[type="password"]').fill(get('RECTORIA_PASS'));
  await page.locator('button[type="submit"]:has-text("Ingresar")').click();
  await page.waitForSelector('button[title*="Menú de Usuario"]', { timeout:90000 });
  await ensureNoOverlay(page);
  // Pull primero (contexto nuevo = localStorage vacío)
  for (let attempt=0; attempt<4; attempt++) {
    const um = page.locator('button[title*="Menú de Usuario"]').first();
    if (await um.isVisible({timeout:2000}).catch(()=>false)) { await um.click({force:true}).catch(()=>{}); }
    await wait(700);
    await page.locator('button:has-text("Configuración & Motores IA")').first().click({force:true}).catch(()=>{});
    await wait(1000);
    if (await page.locator('#btn-close-settings').isVisible({timeout:1500}).catch(()=>false)) {
      await page.locator('button[role="tab"]:has-text("Sync y Seguridad")').click({force:true}).catch(()=>{});
      await wait(500);
      await page.locator('button:has-text("Descargar (Pull)")').first().click({force:true}).catch(()=>{});
      await wait(12000);
      const so = page.locator('div.fixed.inset-0.z-\\[100\\] button:has-text("Cerrar")').first();
      if (await so.isVisible({timeout:4000}).catch(()=>false)) { await so.click({force:true}).catch(()=>{}); await wait(700); }
      await page.locator('#btn-close-settings').click({force:true}).catch(()=>{});
      await wait(800);
      break;
    }
    await page.keyboard.press('Escape').catch(()=>{}); await wait(600);
  }
  const mod = page.locator('button:has-text("Módulos")').first();
  if (await mod.isVisible({timeout:6000}).catch(()=>false)) { await mod.click(); await wait(500); }
  await page.locator('button:has-text("Gestión Docentes")').last().click();
  await wait(1500);
  await ensureNoOverlay(page);
  const cardM = page.locator('h3:has-text("María Camila Restrepo Henao")').locator('xpath=ancestor::div[contains(@class,"rounded-3xl")][1]').first();
  const badge = (await cardM.locator('span:has-text("Director de Grupo:")').first().textContent().catch(e=>'ERR')).trim();
  const ok = /Director de Grupo:\s*6°4/.test(badge);
  console.log(`${ok?'PASS':'FAIL'} · badge ⭐ tarjeta María Camila = "${badge}"`);
  await cardM.scrollIntoViewIfNeeded().catch(()=>{});
  await page.screenshot({ path: '/tmp/qa_shots/r55_T1b_badge_first.png' });
  await browser.close();
  process.exit(ok?0:1);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});
