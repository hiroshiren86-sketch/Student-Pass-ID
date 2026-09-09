import { chromium } from './node_modules/playwright/index.mjs';
import { loginAsRectoria, openPlantillas, shot, ensureNoOverlay } from './liblogin.mjs';
import { openAjustes, clickSettingsTab, clickPull, closeSettingsModal, readLS } from './libapp.mjs';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>process.stdout.write(a.join(' ')+'\n');
const browser = await chromium.launch({ headless:true });
const { ctx, page } = await loginAsRectoria(browser);

// Pull para catálogo + settings
let ok = await openAjustes(page);
if (ok){ await clickSettingsTab(page,'Sync y Seguridad'); await clickPull(page); await wait(2500); await closeSettingsModal(page); }
const code = await page.evaluate(()=>{ const st=JSON.parse(localStorage.getItem('inas_students_v5')||'[]'); return (st.find(x=>x.code)||{}).code || null; });
log('código de estudiante real =', code);

async function goScan(){
  await ensureNoOverlay(page);
  await page.click('button:has-text("Módulos")',{force:true}).catch(()=>{});
  await wait(500);
  await page.locator('button:has-text("Escanear Asistencia")').last().click({force:true}).catch(()=>{});
  await wait(1800);
}
async function doScan(){
  await page.locator('input[placeholder="Esperando lectura de carné..."]').fill(code);
  await page.keyboard.press('Enter');
  await wait(1800);
  // leer banner de jornada + feedback
  const txt = await page.locator('body').innerText();
  const jornada = (txt.match(/Jornada (abierta|cerrada)[^\n]*/i)||[''])[0];
  // tarjeta de feedback del escaneo (la que tiene el icono y title/message)
  const feed = await page.locator('div[class*="animate-fadeIn"]').filter({hasText:/(Jornada Cerrada|registrada|PRESENTE|presente|TARDE|tarde|No corresponde|bloque|Fuera de|éxito|No se encontró|ya fue|Límite)/}).first().innerText().catch(()=>'') || await page.locator('body').innerText();
  return { jornada, feed: feed.replace(/\n+/g,' | ').slice(-320) };
}

async function applyTpl(name){
  await openPlantillas(page);
  await page.evaluate((n)=>{for(const btn of Array.from(document.querySelectorAll('button'))) if(btn.textContent.trim()==='Aplicar hoy'){const card=btn.closest('div[class*="rounded-2xl"]'); if(card&&card.querySelector('h4')?.textContent.includes(n)){btn.click();return;}}}, name);
  await wait(1000);
  const act = await page.evaluate(()=>JSON.parse(localStorage.getItem('inas_settings_v5')||'{}').activeDayTemplate);
  log('plantilla aplicada =', act);
}

log('--- Plantilla A (Día Normal, 06:30-12:30) ---');
applyTpl._ = await applyTpl('Plantilla A: Día Normal');
log('hora Bogotá ~12:2x → esperado: Jornada ABIERTA, escaneo ACEPTADO');
await goScan(); const a = await doScan();
log('A) banner:', a.jornada); log('A) feedback:', a.feed);
await shot(page,'r54_AB_A_scan');

log('--- Plantilla B (Recorte −10, ~11:30) ---');
await applyTpl('Plantilla B: Recorte −10');
log('hora Bogotá ~12:2x → esperado: Jornada CERRADA, escaneo RECHAZADO');
await goScan(); const b = await doScan();
log('B) banner:', b.jornada); log('B) feedback:', b.feed);
await shot(page,'r54_AB_B_scan');

// Restaurar Plantilla A
log('--- Restaurar Plantilla A ---');
await applyTpl('Plantilla A: Día Normal');
await browser.close(); log('DONE');
