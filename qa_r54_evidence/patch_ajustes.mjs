import fs from 'fs';
let s = fs.readFileSync('libapp.mjs','utf8');
const start = s.indexOf('export async function openAjustes(page) {');
const end = s.indexOf('export async function clickSettingsTab');
const newFn = `export async function openAjustes(page) {
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

`;
s = s.slice(0,start) + newFn + s.slice(end);
fs.writeFileSync('libapp.mjs', s);
console.log('openAjustes robusto OK');
