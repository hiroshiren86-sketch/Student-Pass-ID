import { chromium } from './node_modules/playwright/index.mjs';
import fs from 'fs';
import { loginAsRectoria, openPlantillas, shot, ensureNoOverlay } from './liblogin.mjs';
import { openAjustes, clickSettingsTab, clickPull, clickPush, syncResultMessage, activeTemplateLS, readLS } from './libapp.mjs';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const ls=[]; const log=(...a)=>{ const s=a.join(' '); ls.push(s); process.stdout.write(s+'\n'); };
const browser = await chromium.launch({ headless:true });
const { ctx, page } = await loginAsRectoria(browser);

const captured = { push: null, pushUrl: null, attendance: [] };
page.on('request', (req) => {
  if (req.method()!=='POST') return;
  const url=req.url();
  if (url.includes('/api/sync/push')) { captured.push={url,body:req.postData()}; captured.pushUrl=url; }
  if (url.includes('/api/attendance')) captured.attendance.push({url,body:req.postData()});
});

// T01 apply T
await openPlantillas(page);
const before=await activeTemplateLS(page);
await page.evaluate(()=>{for(const btn of Array.from(document.querySelectorAll('button'))) if(btn.textContent.trim()==='Aplicar hoy'){const card=btn.closest('div[class*="rounded-2xl"]'); if(card&&card.querySelector('h4')?.textContent.includes('Jornada de Pruebas')){btn.click();return;}}});
await wait(1000);
const after=await activeTemplateLS(page);
log('T01 after apply =', after);
await shot(page,'r54_T01_plantillaT');

// push
const ok = await openAjustes(page);
if (ok) {
  await clickSettingsTab(page,'Sync y Seguridad');
  await clickPush(page);
  await wait(1500);
  log('T01 PUSH msg =', JSON.stringify(await syncResultMessage(page)).slice(0,200));
  await shot(page,'r54_T01_push');
}

// T02 pull
await clickPull(page);
await wait(3000);
log('T02 PULL msg =', JSON.stringify(await syncResultMessage(page)).slice(0,260));
await shot(page,'r54_T02_pull');

// T03 push 2
await clickPush(page);
await wait(1500);
log('T03 PUSH2 msg =', JSON.stringify(await syncResultMessage(page)).slice(0,200));

log('CAPTURED push url =', captured.pushUrl);
log('CAPTURED push body (trun) =', (captured.push?.body||'').slice(0,300));
log('attendance captured =', captured.attendance.length);
fs.writeFileSync('/tmp/captured.json', JSON.stringify(captured,null,2));
await browser.close();
log('DONE');
