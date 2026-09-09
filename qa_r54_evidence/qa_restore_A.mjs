import { chromium } from './node_modules/playwright/index.mjs';
import { loginAsRectoria, openPlantillas, shot } from './liblogin.mjs';
import { openAjustes, clickSettingsTab, clickPull, clickPush, closeSettingsModal, activeTemplateLS, readLS } from './libapp.mjs';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>process.stdout.write(a.join(' ')+'\n');
const browser = await chromium.launch({ headless:true });
const { ctx, page } = await loginAsRectoria(browser);
const pushes=[];
page.on('response', async (r)=>{ const u=r.url(); if(u.includes('/api/sync/push')){ try{pushes.push(await r.json().catch(()=>null));}catch{} } });

// Pull (para tener catálogo + settings actuales)
let ok = await openAjustes(page);
if (ok){ await clickSettingsTab(page,'Sync y Seguridad'); await clickPull(page); await wait(2500); await closeSettingsModal(page); }
log('active tras pull =', await activeTemplateLS(page));

// Aplicar Plantilla A (Día Normal)
await openPlantillas(page);
await page.evaluate(()=>{for(const btn of Array.from(document.querySelectorAll('button'))) if(btn.textContent.trim()==='Aplicar hoy'){const card=btn.closest('div[class*="rounded-2xl"]'); if(card&&card.querySelector('h4')?.textContent.includes('Plantilla A: Día Normal')){btn.click();return;}}});
await wait(1200);
log('active tras aplicar A =', await activeTemplateLS(page));
log('slots =', Array.isArray(await readLS(page,'inas_schedule_slots_v5'))?(await readLS(page,'inas_schedule_slots_v5')).length:'?');
await shot(page,'r54_restore_A');

// Push
ok = await openAjustes(page);
if (ok){ await clickSettingsTab(page,'Sync y Seguridad'); await clickPush(page); await wait(1800); }
log('PUSH restore =', JSON.stringify(pushes[0]).slice(0,200));
await browser.close();
log('DONE');
