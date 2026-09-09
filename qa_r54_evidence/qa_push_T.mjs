import { chromium } from './node_modules/playwright/index.mjs';
import fs from 'fs';
import { loginAsRectoria, openPlantillas, shot } from './liblogin.mjs';
import { openAjustes, clickSettingsTab, clickPush, clickPull, syncResultMessage, activeTemplateLS } from './libapp.mjs';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>process.stdout.write(a.join(' ')+'\n');
const browser = await chromium.launch({ headless:true });
const { ctx, page } = await loginAsRectoria(browser);
const captured={push:null,pushUrl:null};
page.on('request',(req)=>{ if(req.method()!=='POST')return; const u=req.url(); if(u.includes('/api/sync/push')){captured.push={url:u,body:req.postData()};captured.pushUrl=u;} });

await openPlantillas(page);
await page.evaluate(()=>{for(const btn of Array.from(document.querySelectorAll('button'))) if(btn.textContent.trim()==='Aplicar hoy'){const card=btn.closest('div[class*="rounded-2xl"]'); if(card&&card.querySelector('h4')?.textContent.includes('Jornada de Pruebas')){btn.click();return;}}});
await wait(1200);
log('T01 apply =', await activeTemplateLS(page));

const ok = await openAjustes(page);
if (ok) {
  await clickSettingsTab(page,'Sync y Seguridad');
  await clickPush(page);
  await wait(1800);
  log('PUSH msg =', JSON.stringify(await syncResultMessage(page)).slice(0,220));
  await shot(page,'r54_T01_push');
}
log('push url =', captured.pushUrl);
log('push body trun =', (captured.push?.body||'').slice(0,260));
fs.writeFileSync('/tmp/captured.json', JSON.stringify(captured,null,2));
await browser.close();
log('DONE');
