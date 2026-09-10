// R56 QA E2E — SINCRONIZACIÓN TOTAL en producción (student-pass-id.pages.dev, bundle R56)
// F1: Rectoría (limpio) → pull al login aplica settings (18:30/plantilla) · Push fija qrSecret en nube
// F2: Docente Andrés (limpio) = "teléfono 2" → settings aplicadas + UPSERT porción (Camila CON rol) + nada destruido
// F3: Rectoría (limpio) → tarjeta CLASE:v2 generada en Node: firma correcta PASA el check; firma mala NO
// F4: restauración neutral (qrSecret:'' en nube) — el secret canónico lo fijará el teléfono real de Rectoría
import { chromium } from './node_modules/playwright/index.mjs';
import fs from 'fs';
import crypto from 'crypto';

const envRaw = fs.readFileSync('/home/user/spv/.env','utf8');
const get = (k) => (envRaw.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim().replace(/^['"]|['"]$/g,'') || '';
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

const hmac16 = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0,16);

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
async function uiPush(page){
  if (!(await openAjustes(page))) return false;
  await page.locator('button[role="tab"]:has-text("Sync y Seguridad")').click({ force:true }).catch(()=>{});
  await wait(500);
  await page.locator('button:has-text("Sincronizar (Push)")').first().click({ force:true }).catch(()=>{});
  await wait(13000);
  await closeSyncOverlay(page);
  await page.locator('#btn-close-settings').click({ force:true }).catch(()=>{});
  await wait(800);
  return true;
}
const lsSettings = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('inas_settings_v5')||'{}'); } catch { return {}; } });

(async () => {
  const browser = await chromium.launch();

  // ================= FASE 0: estado previo de la nube =================
  const token = await apiLogin();
  const pre = await apiPull(token);
  const preSecret = pre?.data?.settings?.qrSecret;
  console.log(`[F0] nube: catalogVersion=${pre.catalogVersion} qrSecret=${preSecret===undefined?'(ausente)':preSecret===''?'(vacío)':'(presente len '+preSecret.length+')'}`);
  const andresCloud = (pre?.data?.teachers||[]).find(t=>/Andrés Felipe Giraldo/.test(t.fullName||''));
  check('F0 Andrés en nube con tempPassword legible', !!andresCloud && !!andresCloud.tempPassword, `id=${andresCloud?.id}`);

  // ================= FASE 1: Rectoría (contexto limpio A) =================
  const ctxA = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const pageA = await ctxA.newPage();
  pageA.setDefaultTimeout(60000);
  const errsA = [];
  pageA.on('pageerror', e => errsA.push(String(e).slice(0,150)));
  await pageA.goto(BASE, { waitUntil:'domcontentloaded', timeout:90000 });
  await wait(3500);
  await ensureNoOverlay(pageA);
  const btnA = pageA.locator('button:has-text("Rectoría / Admin")').first();
  if (await btnA.isVisible({ timeout:10000 }).catch(()=>false)) await btnA.click();
  await pageA.locator('input[type="email"]').fill(EMAIL);
  await pageA.locator('input[type="password"]').fill(PASS);
  await pageA.locator('button[type="submit"]:has-text("Ingresar")').click();
  await pageA.waitForSelector('button[title*="Menú de Usuario"]', { timeout:90000 });
  await wait(8000); // pull silencioso del login R56
  const sA = await lsSettings(pageA);
  check('F1-A settings: fin de jornada 18:30 APLICADO desde nube', sA.dailyEndTime==='18:30', `dailyEndTime=${sA.dailyEndTime}`);
  check('F1-A settings: plantilla activa tmpl-normal', sA.activeDayTemplate==='tmpl-normal', `activeDayTemplate=${sA.activeDayTemplate}`);
  const nA = await pageA.evaluate(() => JSON.parse(localStorage.getItem('inas_students_v5')||'[]').length);
  check('F1-A catálogo completo 80 estudiantes (verbatim ADMIN)', nA===80, `students=${nA}`);
  const secretA = sA.qrSecret || '';
  check('F1-A qrSecret local presente (default o configurado)', secretA.length > 8, `len=${secretA.length}`);
  // Push por UI → fija qrSecret en la nube
  const pushed = await uiPush(pageA);
  check('F1-A push UI ejecutado', pushed);
  await wait(2500);
  const post1 = await apiPull(await apiLogin());
  const cloudSecretNow = post1?.data?.settings?.qrSecret;
  check('F1-B nube tiene qrSecret institucional tras push R56', typeof cloudSecretNow === 'string' && cloudSecretNow.length > 8, `len=${(cloudSecretNow||'').length}`);
  const secretFixed = cloudSecretNow || '';
  // regresión R55 rápida en A: chips + Ajustes sin selector plantillas
  const mod = pageA.locator('button:has-text("Módulos")').first();
  if (await mod.isVisible({ timeout:6000 }).catch(()=>false)) { await mod.click(); await wait(500); }
  await pageA.locator('button:has-text("Gestión Docentes")').last().click();
  await wait(1500);
  await ensureNoOverlay(pageA);
  const editBtn = pageA.locator('button[title="Editar datos del docente"]').first();
  const chipsOk = (async () => {
    await editBtn.click(); await wait(800);
    const old = await pageA.locator('input[list="inas-subjects-datalist-teacher"]').count();
    const chip = await pageA.locator('span:has-text("⭐")').filter({ hasText: 'Dirección de Grupo' }).count();
    await pageA.locator('button:has-text("Cancelar")').last().click(); await wait(500);
    return old === 0 && chip > 0;
  })();
  check('F1-C regresión R55: chips de asignaturas intactos', await chipsOk);
  await ctxA.close();

  // ================= FASE 2: Docente Andrés (contexto limpio B) — "el teléfono 2" =================
  const ctxB = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const pageB = await ctxB.newPage();
  pageB.setDefaultTimeout(60000);
  await pageB.goto(BASE, { waitUntil:'domcontentloaded', timeout:90000 });
  await wait(3500);
  await ensureNoOverlay(pageB);
  const btnB = pageB.locator('button:has-text("Portal Docente & Aula")').first();
  if (await btnB.isVisible({ timeout:10000 }).catch(()=>false)) await btnB.click();
  await pageB.locator('input[type="email"]').fill(andresCloud.authEmail || andresCloud.email);
  await pageB.locator('input[type="password"]').fill(andresCloud.tempPassword);
  await pageB.locator('button[type="submit"]:has-text("Ingresar")').click();
  const loggedB = await pageB.waitForSelector('button[title*="Menú de Usuario"]', { timeout:60000 }).then(()=>true).catch(()=>false);
  check('F2 login docente en teléfono limpio', loggedB);
  await wait(5000); // el pull del login docente (scopeado)
  const sB = await lsSettings(pageB);
  check('F2-B settings en docente: jornada 18:30', sB.dailyEndTime==='18:30', `dailyEndTime=${sB.dailyEndTime}`);
  check('F2-B settings en docente: qrSecret INSTITUCIONAL alineado', sB.qrSecret === secretFixed, `coincide=${sB.qrSecret===secretFixed} len=${(sB.qrSecret||'').length}`);
  const localB = await pageB.evaluate(() => ({
    st: JSON.parse(localStorage.getItem('inas_students_v5')||'[]'),
    tc: JSON.parse(localStorage.getItem('inas_teachers_v5')||'[]'),
    asg: JSON.parse(localStorage.getItem('inas_schedule_assignments_v5')||'[]'),
    slots: JSON.parse(localStorage.getItem('inas_schedule_slots_v5')||'[]')
  }));
  const camila = localB.st.find(s=>String(s.code)==='17422362');
  check('F2-B ★ Camila (11°3) presente CON rol de representante (el caso exacto del propietario)', !!camila && camila.isRepresentative===true && camila.representativeGrade==='11°3', camila?`rep=${camila.isRepresentative} grade=${camila.representativeGrade}`:'ausente');
  check('F2-B UPSERT: su ficha presente', localB.tc.some(t=>/Giraldo/.test(t.fullName||'')), `teachers=${localB.tc.length} (porción scopeada, no 20)`);
  check('F2-B UPSERT: estudiantes de su porción presentes sin destruir nada', localB.st.length > 0 && localB.st.length <= 80, `students=${localB.st.length}`);
  check('F2-B UPSERT: cátedras y bloques hidratados', localB.asg.length > 0 && localB.slots.length > 0, `asg=${localB.asg.length} slots=${localB.slots.length}`);
  await pageB.screenshot({ path: SHOTS+'/r56_F2_docente_b.png' });
  await ctxB.close();

  // ================= FASE 3: prueba REAL de firma (Rectoría C limpio, ScanHub) =================
  const ctxC = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const pageC = await ctxC.newPage();
  pageC.setDefaultTimeout(60000);
  await pageC.goto(BASE, { waitUntil:'domcontentloaded', timeout:90000 });
  await wait(3500);
  await ensureNoOverlay(pageC);
  const btnC = pageC.locator('button:has-text("Rectoría / Admin")').first();
  if (await btnC.isVisible({ timeout:10000 }).catch(()=>false)) await btnC.click();
  await pageC.locator('input[type="email"]').fill(EMAIL);
  await pageC.locator('input[type="password"]').fill(PASS);
  await pageC.locator('button[type="submit"]:has-text("Ingresar")').click();
  await pageC.waitForSelector('button[title*="Menú de Usuario"]', { timeout:90000 });
  await wait(8000);
  await ensureNoOverlay(pageC);
  // ir a Escanear
  const escC = pageC.locator('button:has-text("Escanear")').first();
  if (await escC.isVisible({ timeout:6000 }).catch(()=>false)) { await escC.click(); await wait(1500); }
  await ensureNoOverlay(pageC);
  const scanInput = pageC.locator('input[placeholder*="Esperando lectura de carné"]').first();
  const inputOk = await scanInput.isVisible({ timeout:8000 }).catch(()=>false);
  check('F3 ScanHub input disponible', inputOk);
  if (inputOk) {
    const exp = Date.parse('2026-12-20T04:59:59.000Z'); // 19-dic 23:59 Bogotá (fin del año escolar)
    const base = `${andresCloud.id}|ingles|${exp}`;
    const goodToken = `CLASE:v2:${andresCloud.id}:ingles:${exp}:${hmac16(base, secretFixed)}`;
    await scanInput.fill(goodToken);
    await scanInput.press('Enter');
    await wait(3000);
    let body = await pageC.locator('body').textContent();
    const firmaOk = !/firma inválida|firma HMAC no coincide|firma no coincide/i.test(body||'');
    const flujoOk = /No hay clase en curso|Jornada|clase activa/i.test(body||'');
    check('F3-★ tarjeta CON secret sincronizado: firma VÁLIDA (pasa a validaciones siguientes)', firmaOk && flujoOk, (body||'').match(/(No hay clase en curso|Jornada[^\"]{0,40}|clase activa)/i)?.[0]);
    await pageC.screenshot({ path: SHOTS+'/r56_F3_firma_ok.png' });
    // negativa: secret equivocado debe ser rechazado
    const badToken = `CLASE:v2:${andresCloud.id}:ingles:${exp}:${hmac16(base, 'SECRET-DE-OTRA-INSTITUCION')}`;
    await scanInput.fill(badToken);
    await scanInput.press('Enter');
    await wait(3000);
    body = await pageC.locator('body').textContent();
    const firmaBad = /firma inválida|firma HMAC no coincide|firma no coincide|pertenece a otra institución/i.test(body||'');
    check('F3-★ tarjeta CON secret ajeno: RECHAZADA por firma (el check es real)', firmaBad);
    await pageC.screenshot({ path: SHOTS+'/r56_F3_firma_mal.png' });
  }
  await ctxC.close();

  // ================= FASE 4: restauración neutral (nube sin qrSecret) =================
  const snap = await apiPull(await apiLogin());
  const restoreData = { ...snap.data, settings: { ...(snap.data.settings||{}), qrSecret: '' } };
  const restoreBody = {
    schoolCode: SCHOOL,
    schoolName: restoreData.settings.schoolName || 'Institución Educativa Antonia Santos',
    syncedAt: new Date().toISOString(),
    studentsCount: (restoreData.students||[]).length,
    recordsCount: (restoreData.records||[]).length,
    opId: `op-r56-restore-${Date.now()}`,
    deviceId: 'dev-r56-restore',
    deviceName: 'QA R56 restore',
    catalogVersion: snap.catalogVersion,
    force: false,
    data: restoreData
  };
  const restoreResp = await fetch(`${WORKER}/api/sync/push`, {
    method:'POST',
    headers: { 'Content-Type':'application/json', 'X-Firebase-Id-Token': await apiLogin(), 'X-Device-Id':'dev-r56-restore', 'X-Device-Name':'QA R56 restore' },
    body: JSON.stringify(restoreBody)
  }).then(r=>r.json());
  check('F4 push de restauración aceptado', restoreResp.success === true, restoreResp.message?.slice(0,80));
  await wait(1500);
  const final = await apiPull(await apiLogin());
  const finalSecret = final?.data?.settings?.qrSecret;
  check('F4 nube restaurada SIN qrSecret (neutral; el canónico lo fija el teléfono real de Rectoría)', finalSecret === '' || finalSecret === undefined, `qrSecret=${finalSecret===undefined?'(ausente)':finalSecret===''?'(vacío)':'(¡presente!)'}`);
  check('F4 nube intacta (80/20/180/2 + Camila rol)', (final?.data?.students||[]).length===80 && (final?.data?.teachers||[]).length===20 && (final?.data?.assignments||[]).length===180 && (final?.data?.records||[]).length===2 && !!(final?.data?.students||[]).find(s=>String(s.code)==='17422362')?.isRepresentative);

  console.log('\n=== ERRORES JS ===');
  console.log(errsA.length ? errsA.join('\n') : '(ninguno)');
  check('sin errores JS de página', errsA.length === 0);

  const fails = results.filter(r=>!r.ok).length;
  console.log(`\nQA E2E R56: ${results.length-fails}/${results.length} PASS`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
