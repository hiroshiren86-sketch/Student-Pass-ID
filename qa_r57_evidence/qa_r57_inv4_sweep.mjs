// R57 — INV-4 en su escenario ÚNICO: pull SCOPEADO (docente) + fantasma FUERA de la porción.
// El UPSERT no borra; SOLO applyCloudTombstones puede eliminar al eliminado-histórico.
// Salida esperada: porción 38 → inyección 39 → re-login 38 + log '[Sync Pull] ... estudiantes removidos: 1'
import fs from 'fs';
import { chromium } from './node_modules/playwright/index.mjs';
const envRaw = fs.readFileSync('/home/user/spv/.env','utf8');
const get = (k) => (envRaw.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim().replace(/^["']|["']$/g,'') || '';
const API_KEY = JSON.parse(fs.readFileSync('/home/user/spv/firebase-applet-config.json','utf8')).apiKey;
const BASE='https://student-pass-id.pages.dev';
const WORKER='https://inas-attendance-worker.hiroshiren86.workers.dev';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const r0 = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+API_KEY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:get('RECTORIA_EMAIL'),password:get('RECTORIA_PASS'),returnSecureToken:true})}).then(r=>r.json());
const d0 = await fetch(WORKER+'/api/sync/pull?schoolCode=INAS-ANTONIA-SANTOS-2026&scope=ADMIN',{headers:{'X-Firebase-Id-Token':r0.idToken}}).then(r=>r.json());
const andres = (d0.data.teachers||[]).find(t=>/Andrés Felipe Giraldo/.test(t.fullName||''));
const tpl64 = (d0.data.students||[]).find(s=>s.grade==='6°4');
if (!andres || !tpl64) { console.error('FATAL: credenciales/semilla no encontradas'); process.exit(2); }
const b = await chromium.launch();
const ctx = await b.newContext({locale:'es-CO',timezoneId:'America/Bogota',viewport:{width:1366,height:900}});
const p = await ctx.newPage();
const consoleLines = []; const errs = [];
p.on('console', m => { const t = m.text(); if (/Sync Pull|Tombstones/.test(t)) consoleLines.push(t); });
p.on('pageerror', e => errs.push(String(e).slice(0,120)));
await p.goto(BASE,{waitUntil:'domcontentloaded',timeout:90000});
await wait(4000);
for (const c of ['Cerrar guía','Cerrar']) { const x=p.locator('button:has-text("'+c+'")').first(); if (await x.isVisible({timeout:800}).catch(()=>false)) { await x.click().catch(()=>{}); await wait(400); } }
const db = p.locator('button:has-text("Docente")').first();
if (await db.isVisible({timeout:8000}).catch(()=>false)) await db.click();
await p.locator('input[type="email"]').fill(andres.email);
await p.locator('input[type="password"]').fill(andres.tempPassword);
await p.locator('button[type="submit"]:has-text("Ingresar")').click();
await p.waitForSelector('button[title*="Menú de Usuario"]',{timeout:90000});
await wait(9000);
const cnt1 = await p.evaluate(() => JSON.parse(localStorage.getItem('inas_students_v5')||'[]').length);
let out=false;
for (let i=0;i<3&&!out;i++){
  const um = p.locator('button[title*="Menú de Usuario"]').first();
  if (await um.isVisible({timeout:3000}).catch(()=>false)) await um.click({force:true}).catch(()=>{});
  await wait(800);
  const lo = p.locator('button:has-text("Cerrar Sesión")').first();
  if (await lo.isVisible({timeout:2000}).catch(()=>false)) { await lo.click({force:true}).catch(()=>{}); out=true; }
  else await p.keyboard.press('Escape').catch(()=>{});
  await wait(1500);
}
const inj = await p.evaluate((tpl) => {
  const arr = JSON.parse(localStorage.getItem('inas_students_v5')||'[]');
  if (!arr.some(s=>String(s.code)==='999999999')) {
    arr.push({ ...tpl, code:'999999999', documentId:'999999999', isRepresentative:false, hasFirebaseAccount:false, authEmail:'', authUid:'' });
    localStorage.setItem('inas_students_v5', JSON.stringify(arr));
  }
  return arr.length;
}, tpl64);
const db2 = p.locator('button:has-text("Docente")').first();
if (await db2.isVisible({timeout:8000}).catch(()=>false)) await db2.click();
await p.locator('input[type="email"]').fill(andres.email);
await p.locator('input[type="password"]').fill(andres.tempPassword);
await p.locator('button[type="submit"]:has-text("Ingresar")').click();
await p.waitForSelector('button[title*="Menú de Usuario"]',{timeout:90000});
await wait(9000);
const cnt2 = await p.evaluate(() => JSON.parse(localStorage.getItem('inas_students_v5')||'[]').length);
const phantom = await p.evaluate(() => JSON.parse(localStorage.getItem('inas_students_v5')||'[]').some(s=>String(s.code)==='999999999'));
const sweep = consoleLines.find(t=>/removidos: 1/.test(t)) || '';
console.log(`porción=${cnt1} trasInyección=${inj} trasReLogin=${cnt2} fantasmaVivo=${phantom}`);
console.log(`barridoLog="${sweep}" erroresJS=${errs.length}`);
console.log((cnt1===38 && inj===39 && cnt2===38 && phantom===false && /removidos: 1/.test(sweep) && errs.length===0) ? 'INV-4 SWEEP: PASS' : 'INV-4 SWEEP: FAIL');
await b.close();
