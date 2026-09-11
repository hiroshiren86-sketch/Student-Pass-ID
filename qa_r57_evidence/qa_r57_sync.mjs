// R57 QA E2E — BUCLE DE AUTO-MEJORA DE LA SYNC en producción (bundle index-BA65SUBf.js)
// INV-1a: sello dirty protege lo local adelantado; el auto-sync (push→pull) lo publica y libera
// INV-1b: pull manual NO aplasta settings con sello activo (resumen 'ajustes locales sin subir preservados')
// INV-4:  tombstone de la nube elimina entidad local (fantasma re-inyectado) y converge
// INV-2:  (implícito) login pull con sello no corre — cubierto por el gate compartido del pull
// F4: restauración institucional (18:30) + no-regresión docente (pull scopeado sin gate)
import { chromium } from './node_modules/playwright/index.mjs';
import fs from 'fs';

const envRaw = fs.readFileSync('/home/user/spv/.env','utf8');
const get = (k) => (envRaw.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim().replace(/^['\"]|['\"]$/g,'') || '';
const EMAIL = get('RECTORIA_EMAIL');
const PASS  = get('RECTORIA_PASS');
const API_KEY = JSON.parse(fs.readFileSync('/home/user/spv/firebase-applet-config.json','utf8')).apiKey;
const BASE = 'https://student-pass-id.pages.dev';
const WORKER = 'https://inas-attendance-worker.hiroshiren86.workers.dev';
const SCHOOL = 'INAS-ANTONIA-SANTOS-2026';
const SHOTS = '/tmp/qa_shots';
fs.mkdirSync(SHOTS, { recursive: true });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra='') => { results.push({name, ok}); console.log(`${ok?'PASS':'FAIL'} · ${name}${extra?' — '+extra:''}`); };

async function apiLogin(){
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true })
  }).then(r=>r.json());
  return r.idToken;
}
async function apiPull(token){
  return fetch(`${WORKER}/api/sync/pull?schoolCode=${SCHOOL}&scope=ADMIN`, { headers: { 'X-Firebase-Id-Token': token } }).then(r=>r.json());
}

async function ensureNoOverlay(page, max=8){
  for (let i=0;i<max;i++){
    const layer = page.locator('div.fixed.inset-0.z-50');
    if (!(await layer.count()) || !(await layer.first().isVisible().catch(()=>false))) return;
    let acted=false;
    for (const c of ['Cerrar guía','¡Empezar!','Cerrar','Ahora no','Entendido']) {
      const b = page.locator(`button:has-text("${c}")`).first();
      if (await b.isVisible({ timeout: 800 }).catch(()=>false)) { await b.click({ timeout: 3000 }).catch(()=>{}); acted=true; break; }
    }
    if (acted){ await page.waitForTimeout(500); continue; }
    const xb = page.locator('#btn-close-settings').first();
    if (await xb.isVisible({ timeout: 600 }).catch(()=>false)) { await xb.click({ timeout: 3000, force:true }).catch(()=>{}); await page.waitForTimeout(500); continue; }
    await page.keyboard.press('Escape').catch(()=>{});
    await page.waitForTimeout(500);
  }
}
async function closeSyncOverlay(page){
  const btn = page.locator('div.fixed.inset-0.z-\\[100\\] button:has-text("Cerrar")').first();
  if (await btn.isVisible({ timeout:4000 }).catch(()=>false)) { await btn.click({ force:true }).catch(()=>{}); await wait(700); }
}
async function openAjustes(page){
  for (let attempt=0; attempt<4; attempt++) {
    const um = page.locator('button[title*="Menú de Usuario"]').first();
    if (await um.isVisible({ timeout:2000 }).catch(()=>false)) { await um.click({ force:true }).catch(()=>{}); }
    await wait(700);
    await page.locator('button:has-text("Configuración & Motores IA")').first().click({ force:true }).catch(()=>{});
    await wait(1000);
    if (await page.locator('#btn-close-settings').isVisible({ timeout:1500 }).catch(()=>false)) return true;
    await page.keyboard.press('Escape').catch(()=>{}); await wait(600);
  }
  return false;
}
async function uiPull(page){
  if (!(await openAjustes(page))) return null;
  await page.locator('button[role="tab"]:has-text("Sync y Seguridad")').click({ force:true }).catch(()=>{});
  await wait(500);
  await page.locator('button:has-text("Descargar (Pull)")').first().click({ force:true }).catch(()=>{});
  await wait(15000);
  const msg = await page.locator('div.fixed.inset-0.z-\\[100\\]').innerText({ timeout:4000 }).catch(()=> '');
  await closeSyncOverlay(page);
  await page.locator('#btn-close-settings').click({ force:true }).catch(()=>{});
  await wait(800);
  return msg;
}
async function uiPush(page){
  if (!(await openAjustes(page))) return null;
  await page.locator('button[role="tab"]:has-text("Sync y Seguridad")').click({ force:true }).catch(()=>{});
  await wait(500);
  await page.locator('button:has-text("Sincronizar (Push)")').first().click({ force:true }).catch(()=>{});
  await wait(15000);
  const msg = await page.locator('div.fixed.inset-0.z-\\[100\\]').innerText({ timeout:4000 }).catch(()=> '');
  await closeSyncOverlay(page);
  await page.locator('#btn-close-settings').click({ force:true }).catch(()=>{});
  await wait(800);
  return msg;
}
// Edita "Fin de Jornada" en Ajustes y guarda (sella dirty por diseño)
async function setFinJornada(page, value){
  if (!(await openAjustes(page))) return false;
  const inp = page.locator('xpath=//label[normalize-space()="Fin de Jornada"]/following::input[@type="time"][1]');
  await inp.fill(value);
  await wait(300);
  await page.locator('#btn-save-settings').click({ force:true });
  await wait(1200);
  await page.locator('#btn-close-settings').click({ force:true }).catch(()=>{});
  await wait(800);
  return true;
}
const lsSettings = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('inas_settings_v5')||'{}'); } catch { return {}; } });
const lsSeal = (page) => page.evaluate(() => { try { return localStorage.getItem('inas_local_sync_dirty_v1'); } catch { return null; } }); // FIX QA: sello = string ISO plano (JSON.parse lo tumbaba → null siempre)

(async () => {
  const browser = await chromium.launch();

  // ================= FASE 0: estado previo de la nube =================
  const token = await apiLogin();
  const pre = await apiPull(token);
  const cnt = (a)=>Array.isArray(a)?a.length:-1;
  const F0 = {
    students: cnt(pre?.data?.students), teachers: cnt(pre?.data?.teachers),
    assignments: cnt(pre?.data?.assignments), templates: cnt(pre?.data?.customTemplates),
    slots: cnt(pre?.data?.slots), tombstones: cnt(pre?.data?.tombstones),
    dailyEndTime: pre?.data?.settings?.dailyEndTime, qrSecret: pre?.data?.settings?.qrSecret
  };
  console.log(`[F0] nube: v=${pre.catalogVersion} students=${F0.students} teachers=${F0.teachers} assignments=${F0.assignments} templates=${F0.templates} slots=${F0.slots} dailyEndTime=${F0.dailyEndTime} qrSecret=${F0.qrSecret===''?'(neutro)':F0.qrSecret?'(presente len '+F0.qrSecret.length+')':'(ausente)'}`);
  const tombs = Array.isArray(pre?.data?.tombstones)?pre.data.tombstones:[];
  const tomb999 = tombs.find(t=>String(t.id)==='999999999'&&t.type==='student');
  check('F0 tombstone del estudiante 999999999 existe en la nube (semilla INV-4)', !!tomb999, `total tombstones=${tombs.length}`);
  const andresCloud = (pre?.data?.teachers||[]).find(t=>/Andrés Felipe Giraldo/.test(t.fullName||''));
  check('F0 Andrés en nube con tempPassword legible', !!andresCloud && !!andresCloud.tempPassword, `id=${andresCloud?.id}`);

  // ================= FASE 1: INV-1a — sello protege y el auto-sync publica =================
  const ctxA = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  await ctxA.addInitScript(() => {
    const KEY = 'inas_local_sync_dirty_v1';
    const os = Storage.prototype.setItem, or = Storage.prototype.removeItem;
    Storage.prototype.setItem = function(k, v) {
      if (k === KEY) console.log('[SEAL-SET] ' + (new Error().stack||'').split('\n').slice(2,6).join(' | '));
      return os.call(this, k, v);
    };
    Storage.prototype.removeItem = function(k) {
      if (k === KEY) console.log('[SEAL-CLEAR] ' + (new Error().stack||'').split('\n').slice(2,6).join(' | '));
      return or.call(this, k);
    };
  });
  const pageA = await ctxA.newPage();
  pageA.setDefaultTimeout(60000);
  const errsA = [];
  pageA.on('pageerror', e => errsA.push(String(e).slice(0,150)));
  pageA.on('console', m => { const t = m.text(); if (t.startsWith('[SEAL-')) console.log('[pageA]', t.slice(0,400)); });
  await pageA.goto(BASE, { waitUntil:'domcontentloaded', timeout:90000 });
  await wait(5000);
  check('F1.p0 arranque limpio NO sella (fix hueco #7: lazy-init system)', (await lsSeal(pageA))===null);
  await ensureNoOverlay(pageA);
  const btnA = pageA.locator('button:has-text("Rectoría / Admin")').first();
  if (await btnA.isVisible({ timeout:10000 }).catch(()=>false)) await btnA.click();
  await pageA.locator('input[type="email"]').fill(EMAIL);
  await pageA.locator('input[type="password"]').fill(PASS);
  await pageA.locator('button[type="submit"]:has-text("Ingresar")').click();
  await pageA.waitForSelector('button[title*="Menú de Usuario"]', { timeout:90000 });
  // R57: esperar ESTABILIZACIÓN (Firestore inicial + login pull) — dailyEndTime constante 3 lecturas seguidas
  for (let i=0;i<30;i++) {
    const a = await lsSettings(pageA);
    await wait(1500);
    const b = await lsSettings(pageA);
    await wait(1500);
    const c = await lsSettings(pageA);
    if (a.dailyEndTime===b.dailyEndTime && b.dailyEndTime===c.dailyEndTime && a.cloudflareLastSyncedAt===c.cloudflareLastSyncedAt) break;
  }
  const s0 = await lsSettings(pageA);
  check('F1.0 teléfono limpio: jornada base de la nube (18:30)', s0.dailyEndTime==='18:30', `dailyEndTime=${s0.dailyEndTime}`);
  check('F1.0 teléfono limpio: SIN sello tras login+pull', (await lsSeal(pageA))===null);

  await setFinJornada(pageA, '18:35');
  const seal1 = await lsSeal(pageA);
  check('F1.1 editar jornada 18:35 ACTIVA el sello dirty', !!seal1, `seal=${JSON.stringify(seal1).slice(0,120)}`);
  const cloudMid = await apiPull(await apiLogin());
  check('F1.2 la nube AÚN no conoce el 18:35 (sin push)', cloudMid?.data?.settings?.dailyEndTime==='18:30', `nube=${cloudMid?.data?.settings?.dailyEndTime}`);

  // Esperar el ciclo auto-sync (intervalo 5 min): sello debe LIBERARSE tras el push exitoso
  let sealNow = seal1, cycles = 0;
  const t0 = Date.now();
  while (sealNow !== null && Date.now()-t0 < 9*60*1000) {
    await wait(20000); cycles++;
    sealNow = await lsSeal(pageA);
    if (cycles % 6 === 0) console.log(`  …esperando auto-sync (${Math.round((Date.now()-t0)/1000)}s, sello ${sealNow?'presente':'liberado'})`);
  }
  check('F1.3 auto-sync liberó el sello tras push exitoso', sealNow===null, `espera=${Math.round((Date.now()-t0)/1000)}s`);
  const s1 = await lsSettings(pageA);
  check('F1.4 lo local adelantado SOBREVIVIÓ al ciclo (18:35 intacto)', s1.dailyEndTime==='18:35', `dailyEndTime=${s1.dailyEndTime}`);
  const cloudPost = await apiPull(await apiLogin());
  check('F1.5 la nube CONVERGIÓ al 18:35 local (push lo publicó)', cloudPost?.data?.settings?.dailyEndTime==='18:35', `nube=${cloudPost?.data?.settings?.dailyEndTime}`);
  check('F1.6 sin errores JS en Rectoría durante todo el ciclo', errsA.length===0, errsA.slice(0,2).join(' | '));

  // ================= FASE 2: INV-1b — pull manual NO aplasta con sello =================
  await setFinJornada(pageA, '18:40');
  check('F2.1 segunda edición (18:40) activa el sello', !!(await lsSeal(pageA)));
  const pullMsg = await uiPull(pageA);
  check('F2.2 resumen del pull declara "ajustes locales sin subir preservados"', /ajustes locales sin subir preservados/.test(pullMsg||''), `msg="${(pullMsg||'').slice(0,160)}"`);
  const s2 = await lsSettings(pageA);
  check('F2.3 lo local adelantado NO fue pisado por el pull (18:40 intacto)', s2.dailyEndTime==='18:40', `dailyEndTime=${s2.dailyEndTime}`);
  const cloudF2 = await apiPull(await apiLogin());
  check('F2.4 la nube sigue en 18:35 (el pull no cambia la nube)', cloudF2?.data?.settings?.dailyEndTime==='18:35', `nube=${cloudF2?.data?.settings?.dailyEndTime}`);

  // ================= FASE 3: INV-4 — tombstone de la nube elimina lo local =================
  const ctxB = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const pageB = await ctxB.newPage();
  pageB.setDefaultTimeout(60000);
  const errsB = [];
  pageB.on('pageerror', e => errsB.push(String(e).slice(0,150)));
  await pageB.goto(BASE, { waitUntil:'domcontentloaded', timeout:90000 });
  await wait(3500);
  await ensureNoOverlay(pageB);
  const btnB = pageB.locator('button:has-text("Rectoría / Admin")').first();
  if (await btnB.isVisible({ timeout:10000 }).catch(()=>false)) await btnB.click();
  await pageB.locator('input[type="email"]').fill(EMAIL);
  await pageB.locator('input[type="password"]').fill(PASS);
  await pageB.locator('button[type="submit"]:has-text("Ingresar")').click();
  await pageB.waitForSelector('button[title*="Menú de Usuario"]', { timeout:90000 });
  await wait(8000);
  // Escenario real del propietario (R57): el teléfono perdió/perdió-sincronizó datos y re-entra.
  // 1) LOGOUT; 2) inyectar fantasma con el código eliminado históricamente (R54) con FORMA COMPLETA
  //    (hereda todos los campos de un estudiante real — la app usa firstName/lastName); 3) re-LOGIN →
  //    el login-pull integra los tombstones de la nube y el BARRIDO elimina al fantasma (INV-4).
  const consoleB = [];
  pageB.on('console', m => { const t = m.text(); if (/Sync Pull|Tombstones/.test(t)) consoleB.push(t); });
  await ensureNoOverlay(pageB); // la guía de bienvenida intercepta clics (lección run1/run5)
  let loggedOutB = false;
  for (let i=0;i<3 && !loggedOutB;i++) {
    const umB = pageB.locator('button[title*="Menú de Usuario"]').first();
    if (await umB.isVisible({ timeout:4000 }).catch(()=>false)) await umB.click({ force:true }).catch(()=>{});
    await wait(800);
    const lo = pageB.locator('button:has-text("Cerrar Sesión")').first();
    if (await lo.isVisible({ timeout:2000 }).catch(()=>false)) { await lo.click({ force:true }).catch(()=>{}); loggedOutB = true; }
    else await pageB.keyboard.press('Escape').catch(()=>{});
    await wait(1500);
  }
  const backToLogin = await pageB.locator('input[type="email"]').isVisible({ timeout:12000 }).catch(()=>false);
  check('F3.0 logout real (vuelve a la puerta de login)', backToLogin);
  const injected = await pageB.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('inas_students_v5')||'[]');
    if (!arr.some(s=>String(s.code)==='999999999')) {
      const tpl = arr[0] || {};
      arr.push({ ...tpl, code:'999999999', documentId:'999999999', firstName:'QA', lastName:'R57 TOMBSTONE', active:true });
      localStorage.setItem('inas_students_v5', JSON.stringify(arr));
    }
    return arr.length;
  });
  check('F3.1 fantasma 999999999 presente localmente tras logout (BD sucia con forma completa)', injected===81, `students=${injected}`);
  const btnB2 = pageB.locator('button:has-text("Rectoría / Admin")').first();
  if (await btnB2.isVisible({ timeout:10000 }).catch(()=>false)) await btnB2.click();
  await pageB.locator('input[type="email"]').fill(EMAIL);
  await pageB.locator('input[type="password"]').fill(PASS);
  await pageB.locator('button[type="submit"]:has-text("Ingresar")').click();
  await pageB.waitForSelector('button[title*="Menú de Usuario"]', { timeout:90000 });
  await wait(9000); // login-pull: verbatim 80 + barrido tombstones
  await ensureNoOverlay(pageB);
  const sweepLog = consoleB.find(t=>/Tombstones de la nube integrados/.test(t)) || '';
  check('F3.2 barrido reporta integración con ELIMINACIÓN del fantasma', /estudiantes removidos: 1/.test(sweepLog), sweepLog.slice(0,160));
  const tombsLocal = await pageB.evaluate(() => { try { return JSON.parse(localStorage.getItem('inas_tombstones_v1')||'[]'); } catch { return []; } });
  check('F3.4 tombstone 999999999 quedó unido a la lista local (no resucita con push)', tombsLocal.some(t=>String(t.id)==='999999999'&&t.type==='student'), `total local=${tombsLocal.length}`);
  const cntB = await pageB.evaluate(() => JSON.parse(localStorage.getItem('inas_students_v5')||'[]').length);
  check('F3.5 matrícula real intacta tras el barrido (80)', cntB===80, `students=${cntB}`);
  check('F3.6 sin errores JS en el segundo teléfono', errsB.length===0, errsB.slice(0,2).join(' | '));

  // ================= FASE 4: restauración 18:30 + no-regresión docente =================
  await setFinJornada(pageA, '18:30');
  check('F4.1 edición de restauración (18:30) activa el sello', !!(await lsSeal(pageA)));
  const pushMsg = await uiPush(pageA);
  check('F4.2 push manual publicado', /descargad|sincroniz|éxito|correct|v\d|catalog/i.test(pushMsg||''), `msg="${(pushMsg||'').slice(0,140)}"`);
  check('F4.3 push manual liberó el sello', (await lsSeal(pageA))===null);
  const cloudF4 = await apiPull(await apiLogin());
  check('F4.4 nube restaurada: dailyEndTime 18:30', cloudF4?.data?.settings?.dailyEndTime==='18:30', `nube=${cloudF4?.data?.settings?.dailyEndTime}`);
  check('F4.5 nube idéntica al estado F0 (estudiantes/docentes/cátedras/plantillas/slots/tombstones)', cnt(cloudF4?.data?.students)===F0.students && cnt(cloudF4?.data?.teachers)===F0.teachers && cnt(cloudF4?.data?.assignments)===F0.assignments && cnt(cloudF4?.data?.customTemplates)===F0.templates && cnt(cloudF4?.data?.slots)===F0.slots && cnt(cloudF4?.data?.tombstones)===F0.tombstones, `s=${cnt(cloudF4?.data?.students)}/${F0.students} t=${cnt(cloudF4?.data?.teachers)}/${F0.teachers} a=${cnt(cloudF4?.data?.assignments)}/${F0.assignments} tmpl=${cnt(cloudF4?.data?.customTemplates)}/${F0.templates} slots=${cnt(cloudF4?.data?.slots)}/${F0.slots} tombs=${cnt(cloudF4?.data?.tombstones)}/${F0.tombstones}`);
  check('F4.6 qrSecret preservado BYTE-EXACTO vs F0 (el canónico vive intacto)', cloudF4?.data?.settings?.qrSecret===F0.qrSecret, `len=${(cloudF4?.data?.settings?.qrSecret||'').length}/${(F0.qrSecret||'').length}`);

  // Docente real en teléfono limpio (pull scopeado NO gateado — sin sello siempre converge)
  const ctxC = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const pageC = await ctxC.newPage();
  pageC.setDefaultTimeout(60000);
  const errsC = [];
  pageC.on('pageerror', e => errsC.push(String(e).slice(0,150)));
  await pageC.goto(BASE, { waitUntil:'domcontentloaded', timeout:90000 });
  await wait(3500);
  await ensureNoOverlay(pageC);
  const btnC = pageC.locator('button:has-text("Docente")').first();
  if (await btnC.isVisible({ timeout:10000 }).catch(()=>false)) await btnC.click();
  await pageC.locator('input[type="email"]').fill(andresCloud.email);
  await pageC.locator('input[type="password"]').fill(andresCloud.tempPassword);
  await pageC.locator('button[type="submit"]:has-text("Ingresar")').click();
  const okDoc = await pageC.waitForSelector('button[title*="Menú de Usuario"]', { timeout:90000 }).then(()=>true).catch(()=>false);
  check('F4.7 login docente OK (pull scopeado sin gate)', okDoc);
  await wait(8000);
  const sC = await pageC.evaluate(() => { try { return { s: JSON.parse(localStorage.getItem('inas_settings_v5')||'{}'), st: JSON.parse(localStorage.getItem('inas_students_v5')||'[]') }; } catch { return { s:{}, st:[] }; } });
  check('F4.8 docente recibió jornada institucional 18:30', sC.s.dailyEndTime==='18:30', `dailyEndTime=${sC.s.dailyEndTime}`);
  check('F4.9 docente recibió su porción de matrícula (UPSERT intacto)', sC.st.length>=30, `students=${sC.st.length}`);
  const camila = sC.st.find(x=>/CAMILA FELIPE/i.test(x.firstName||'') && /ZAPATA CÓRDOBA/i.test(x.lastName||''));
  check('F4.10 rol de la representante Camila (11°3) sigue bajando', !!camila && camila.isRepresentative===true, camila?`grade=${camila.grade} rep=${camila.isRepresentative}`:'no encontrada');
  check('F4.11 sin errores JS en docente', errsC.length===0, errsC.slice(0,2).join(' | '));

  await browser.close();
  const pass = results.filter(r=>r.ok).length;
  console.log(`\n==== RESUMEN QA R57: ${pass}/${results.length} PASS ====`);
  const fails = results.filter(r=>!r.ok);
  if (fails.length) { console.log('FALLOS:'); fails.forEach(f=>console.log(' - '+f.name)); }
  fs.writeFileSync('/tmp/qa_r57_results.json', JSON.stringify({ pass, total: results.length, results }, null, 2));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
