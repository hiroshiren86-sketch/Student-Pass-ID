import { chromium } from './node_modules/playwright/index.mjs';
import { loginAsRectoria, openPlantillas, shot } from './liblogin.mjs';
import { openAjustes, clickSettingsTab, clickPull, clickPush, closeSettingsModal, activeTemplateLS, readLS } from './libapp.mjs';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>process.stdout.write(a.join(' ')+'\n');
const browser = await chromium.launch({ headless:true });
const { ctx, page } = await loginAsRectoria(browser);
const res={push:null,pull:null};
page.on('response', async (r)=>{ const u=r.url(); if(u.includes('/api/sync/push')){try{res.push=await r.json().catch(()=>null);}catch{}} if(u.includes('/api/sync/pull')){try{res.pull=await r.json().catch(()=>null);}catch{}} });

// 1) PULL (poblar catálogo)
let ok = await openAjustes(page);
if (ok) {
  await clickSettingsTab(page,'Sync y Seguridad');
  await clickPull(page);
  for (let i=0;i<40 && !res.pull;i++) await wait(500);
  log('PULL: local students=', (Array.isArray(await readLS(page,'inas_students_v5'))?(await readLS(page,'inas_students_v5')).length:0));
  log('PULL resp scope=', res.pull?.scope, 'records=', (res.pull?.data?.records||[]).length, 'students=', (res.pull?.data?.students||[]).length, 'teachers=', (res.pull?.data?.teachers||[]).length, 'assignments=', (res.pull?.data?.assignments||[]).length);
  log('PULL resp activeDayTemplate=', res.pull?.data?.activeDayTemplate, 'catalogVersion=', res.pull?.data?.catalogVersion);
  await shot(page,'r54_T02_pull');
  log('cerrando modal:', await closeSettingsModal(page));
}

// 2) Aplicar Plantilla T
await openPlantillas(page);
log('active antes =', await activeTemplateLS(page));
await page.evaluate(()=>{for(const btn of Array.from(document.querySelectorAll('button'))) if(btn.textContent.trim()==='Aplicar hoy'){const card=btn.closest('div[class*="rounded-2xl"]'); if(card&&card.querySelector('h4')?.textContent.includes('Jornada de Pruebas')){btn.click();return;}}});
await wait(1200);
log('active después =', await activeTemplateLS(page));
log('slots =', Array.isArray(await readLS(page,'inas_schedule_slots_v5'))?(await readLS(page,'inas_schedule_slots_v5')).length:'?');
await shot(page,'r54_T01_plantillaT_aplicada');

// 3) PUSH
ok = await openAjustes(page);
if (ok) {
  await clickSettingsTab(page,'Sync y Seguridad');
  await clickPush(page);
  for (let i=0;i<40 && !res.push;i++) await wait(500);
  log('PUSH resp =', JSON.stringify(res.push).slice(0,400));
  await shot(page,'r54_T01_push_result');
}
await browser.close();
log('DONE');
