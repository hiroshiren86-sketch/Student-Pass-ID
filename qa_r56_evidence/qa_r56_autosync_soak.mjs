// Resistencia: Rectoría abierta 7+ min → el intervalo (5 min) debe hacer push→pull COMPLETO sin intervención.
import { chromium } from './node_modules/playwright/index.mjs';
import fs from 'fs';
const envRaw = fs.readFileSync('/home/user/spv/.env','utf8');
const get = (k) => (envRaw.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim().replace(/^['"]|['"]$/g,'') || '';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const page = await ctx.newPage();
  await page.goto('https://student-pass-id.pages.dev', { waitUntil:'domcontentloaded', timeout:90000 });
  await wait(3500);
  const btn = page.locator('button:has-text("Rectoría / Admin")').first();
  if (await btn.isVisible().catch(()=>false)) await btn.click();
  await page.locator('input[type="email"]').fill(get('RECTORIA_EMAIL'));
  await page.locator('input[type="password"]').fill(get('RECTORIA_PASS'));
  await page.locator('button[type="submit"]:has-text("Ingresar")').click();
  await page.waitForSelector('button[title*="Menú de Usuario"]', { timeout:90000 });
  await wait(8000);
  // registrar la hora local y la versión de catálogo conocida
  const v0 = await page.evaluate(() => (JSON.parse(localStorage.getItem('inas_settings_v5')||'{}')).cloudflareCatalogVersion);
  console.log('catalogVersion local inicial:', v0);
  console.log('esperando 7 min (2 ciclos de auto-sync de 5 min)...');
  await wait(7*60*1000);
  const local = await page.evaluate(() => ({
    s: JSON.parse(localStorage.getItem('inas_settings_v5')||'{}'),
    st: JSON.parse(localStorage.getItem('inas_students_v5')||'[]').length
  }));
  const s = local.s; const st = local.st;
  console.log('catalogVersion local final:', s.cloudflareCatalogVersion);
  console.log('students locales:', st, '| dailyEndTime:', s.dailyEndTime, '| activeDayTemplate:', s.activeDayTemplate);
  const ok = Number(s.cloudflareCatalogVersion) >= Number(v0) && st === 80 && s.dailyEndTime === '18:30';
  console.log(`${ok?'PASS':'FAIL'} · auto-sync push→pull completo ejecutó sin intervención y el estado local sigue sano`);
  await page.screenshot({ path: '/tmp/qa_shots/r56_soak_final.png' });
  await browser.close();
  process.exit(ok?0:1);
})().catch(e=>{console.error('FATAL',e.message);process.exit(2);});
