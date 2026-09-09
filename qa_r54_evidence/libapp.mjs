export async function closeSettingsModal(page) {
  for (let i=0;i<4;i++){
    await page.keyboard.press('Escape').catch(()=>{});
    await wait(500);
    const gone = !(await page.locator('#btn-close-settings').isVisible({ timeout:800 }).catch(()=>false));
    if (gone) return true;
  }
  // fallback: click close
  await page.locator('#btn-close-settings').click({ force:true }).catch(()=>{});
  await wait(700);
  const gone = !(await page.locator('#btn-close-settings').isVisible({ timeout:800 }).catch(()=>false));
  return gone;
}

import { ensureNoOverlay, shot } from './liblogin.mjs';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

export async function openAjustes(page) {
  await ensureNoOverlay(page);
  for (let attempt=0; attempt<4; attempt++) {
    const um = page.locator('button[title*="Menú de Usuario"]').first();
    if (await um.isVisible({ timeout:1500 }).catch(()=>false)) { await um.click({ force:true }).catch(()=>{}); }
    await wait(700);
    const b = page.locator('button:has-text("Configuración & Motores IA")').first();
    if (await b.isVisible({ timeout:1500 }).catch(()=>false)) { await b.click({ force:true }).catch(()=>{}); }
    await wait(900);
    const modal = await page.locator('#btn-close-settings').isVisible({ timeout:1500 }).catch(()=>false);
    if (modal) { console.log('modal Ajustes abierta (intento '+attempt+')'); return true; }
    // cerrar cualquier menú abierto
    await page.keyboard.press('Escape').catch(()=>{}); 
    await wait(600);
  }
  console.log('modal Ajustes NO se abrió');
  return false;
}

export async function clickSettingsTab(page, label) {
  for (let i=0;i<5;i++){
    const t = page.locator(`button:has-text("${label}")`).first();
    if (await t.isVisible({ timeout:1500 }).catch(()=>false)) { await t.click({ force:true }).catch(()=>{}); await wait(500); return true; }
    await wait(500);
  }
  return false;
}

export async function clickPull(page) {
  const b = page.locator('button:has-text("Descargar (Pull)")').first();
  await b.click({ force:true }).catch(()=>{});
  await wait(300);
  return page;
}

export async function clickPush(page) {
  const b = page.locator('button:has-text("Sincronizar (Push)")').first();
  if (await b.isVisible({ timeout:2000 }).catch(()=>false)) { await b.click({ force:true }).catch(()=>{}); }
  // esperar a que deje de estar "Subiendo..."
  for (let i=0;i<40;i++){
    const busy = await page.locator('button:has-text("Subiendo...")').count();
    if (busy===0) { await wait(800); break; }
    await wait(500);
  }
  await wait(800);
  return page;
}

export async function syncResultMessage(page) {
  const el = page.locator('div[class*="bg-emerald-50"], div[class*="bg-rose-50"]').last();
  try { return (await el.innerText()).trim(); } catch { return ''; }
}
export async function activeTemplateLS(page) {
  return await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('inas_settings_v5')||'{}')?.activeDayTemplate || null; } catch { return null; }
  });
}

export async function readLS(page, key) {
  return await page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)||'null'); } catch { return null; } }, key);
}
