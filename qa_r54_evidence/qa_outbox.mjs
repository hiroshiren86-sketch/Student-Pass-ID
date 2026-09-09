import { chromium } from './node_modules/playwright/index.mjs';
import { loginAsRectoria, ensureNoOverlay, shot } from './liblogin.mjs';
import { openAjustes, clickSettingsTab, clickPull, closeSettingsModal, readLS } from './libapp.mjs';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>process.stdout.write(a.join(' ')+'\n');
const browser = await chromium.launch({ headless:true });
const { ctx, page } = await loginAsRectoria(browser);
const attSends=[];
page.on('request',(req)=>{ if(req.method()==='POST' && req.url().includes('/api/attendance')) attSends.push({url:req.url(), body:req.postData()}); });

let ok = await openAjustes(page);
if (ok){ await clickSettingsTab(page,'Sync y Seguridad'); await clickPull(page); await wait(2500); await closeSettingsModal(page); }

const info = await page.evaluate(()=>{
  const st=JSON.parse(localStorage.getItem('inas_students_v5')||'[]');
  const slots=JSON.parse(localStorage.getItem('inas_schedule_slots_v5')||'[]');
  const s=st.find(x=>x.code==='196555769')||st[0];
  const slot=slots.find(x=>x.type==='CLASS')||slots[0];
  return { studentCode:s?.code, studentName:(s?.firstName||'')+' '+(s?.lastName||''), slotId:slot?.id };
});
log('estudiante =', info.studentCode, info.studentName, '| slot =', info.slotId);

const seed = await page.evaluate(({studentCode,studentName,slotId})=>{
  const id = `${studentCode}_2026-09-09_09:15`;
  const opId = `op-outbox-${Date.now()}`;
  const payload = { id, studentCode, studentName, date:'2026-09-09', time:'09:15', slotId, subject:'QA OUTBOX', method:'manual', status:'PRESENTE', synced:false };
  localStorage.setItem('inas_offline_queue_v5', JSON.stringify([{ id, studentCode, timestamp:'09:15', slotId, subject:'QA OUTBOX', method:'manual', retryCount:0, opId, payload, status:'PENDING' }]));
  return { opId, id };
}, info);
log('sembrado opId=', seed.opId);

// Navegar al tab "Escanear Asistencia" (monta ScanHubView y registra el listener online)
await ensureNoOverlay(page);
await page.click('button:has-text("Módulos")',{force:true}).catch(()=>{});
await wait(500);
await page.locator('button:has-text("Escanear Asistencia")').last().click({force:true}).catch(()=>{});
await wait(2000);
const scanVisible = await page.locator('input[placeholder*="Escanea"], button:has-text("Escanear"), text="Escanear Asistencia"').first().isVisible({timeout:3000}).catch(()=>false);
log('ScanHub montado?', scanVisible);
await shot(page,'r54_T04_scanhub');

// Disparar ONLINE
await page.evaluate(()=>{ window.dispatchEvent(new Event('online')); });
await wait(3000);
await shot(page,'r54_T04_outbox_replay');
log('attendance POSTs =', attSends.length);
log('POST body =', attSends[0]? (attSends[0].body||'').slice(0,240):'(ninguno)');
const q = await readLS(page,'inas_offline_queue_v5');
log('cola después status =', q?.[0]?.status, '| retryCount =', q?.[0]?.retryCount, '| opId =', q?.[0]?.opId);
await browser.close();
log('DONE');
