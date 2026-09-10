// R55 QA E2E EN PRODUCCIÓN (student-pass-id.pages.dev, bundle R55 verificado por marcadores)
// Etapas: T0 login+pull · T1 ficha fantasma reparada por invariante · T2 alta docente chips+cuenta
//         T2b login docente (aula select/Mis Cátedras/Mis Tarjetas QR) · T2c borrado+tombstone
//         T3 Ajustes sin duplicado · T4 Plantillas intactas · T5 guarda jornada (negativo) · T6 nube final
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

async function cloudPull(){
  const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true })
  }).then(r=>r.json());
  const pull = await fetch(`${WORKER}/api/sync/pull?schoolCode=${SCHOOL}&scope=ADMIN`, {
    headers: { 'X-Firebase-Id-Token': login.idToken }
  }).then(r=>r.json());
  return pull;
}

const cardOf = (page, name) => page.locator('h3:has-text("'+name+'")').locator('xpath=ancestor::div[contains(@class,"rounded-3xl")][1]').first();

(async () => {
  const browser = await chromium.launch();

  // ============ T0: LOGIN + PULL (producción) ============
  const ctx = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push('PAGEERROR: '+String(e).slice(0,200)));
  await page.goto(BASE, { waitUntil:'domcontentloaded', timeout:90000 });
  await wait(3500);
  await ensureNoOverlay(page);
  const btn = page.locator('button:has-text("Rectoría / Admin")').first();
  if (await btn.isVisible({ timeout:10000 }).catch(()=>false)) await btn.click();
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.locator('button[type="submit"]:has-text("Ingresar")').click();
  await page.waitForSelector('button[title*="Menú de Usuario"]', { timeout:90000 });
  await ensureNoOverlay(page);
  check('T0 login Rectoría en producción', true);
  // Pull para partir del estado de nube
  if (await openAjustes(page)) {
    await page.locator('button[role="tab"]:has-text("Sync y Seguridad")').click({ force:true }).catch(()=>{});
    await wait(500);
    await page.locator('button:has-text("Descargar (Pull)")').first().click({ force:true }).catch(()=>{});
    await wait(12000);
    await closeSyncOverlay(page);
    await page.locator('#btn-close-settings').click({ force:true }).catch(()=>{});
    await wait(800);
    const st = await page.evaluate(() => ({
      s: JSON.parse(localStorage.getItem('inas_students_v5')||'[]').length,
      t: JSON.parse(localStorage.getItem('inas_teachers_v5')||'[]').length
    }));
    check('T0 Pull producción 80 estudiantes / 20 docentes', st.s===80 && st.t===20, `s=${st.s} t=${st.t}`);
  } else check('T0 Pull (Ajustes no abrió)', false);

  // ============ T1: FICHA FANTASMA (María Camila, 6°4) — derivación + reparación ============
  const mod = page.locator('button:has-text("Módulos")').first();
  if (await mod.isVisible({ timeout:6000 }).catch(()=>false)) { await mod.click(); await wait(500); }
  await page.locator('button:has-text("Gestión Docentes")').last().click();
  await wait(1500);
  await ensureNoOverlay(page);
  const cardM = cardOf(page, 'María Camila Restrepo Henao');
  check('T1 tarjeta de María Camila visible', await cardM.isVisible().catch(()=>false));
  const badgeDG = await cardM.locator('span:has-text("Director de Grupo:")').textContent().catch(()=>'' );
  check('T1 badge ⭐ muestra 6°4 (fantasma pre-fix)', /6°4/.test(badgeDG||''), (badgeDG||'').trim().slice(0,60));
  await cardM.locator('button[title="Editar datos del docente"]').click();
  await wait(800);
  // derivación al abrir: sus materias guardadas NO incluyen DG, pero directorGrade 6°4 → chip ⭐ activo
  const dgOnOpen = await page.locator('span.bg-amber-400:has-text("Dirección de Grupo")').count();
  check('T1 chip ⭐ DERIVADO activo al abrir (auto-reparación visual)', dgOnOpen === 1, `count=${dgOnOpen}`);
  await page.screenshot({ path: SHOTS+'/r55_T1_ficha_derivada.png' });
  // sincronización viva en producción: N/A → OFF; 6°4 → ON
  const dgSelect = page.locator('select').filter({ has: page.locator('option:has-text("N/A - Sin dirección")') }).first();
  await dgSelect.selectOption({ label: 'N/A - Sin dirección de grupo asignada' });
  await wait(300);
  check('T1 chip ⭐ OFF al pasar a N/A', (await page.locator('span.bg-amber-400:has-text("Dirección de Grupo")').count()) === 0);
  await dgSelect.selectOption({ label: 'Director de Grupo de: 6°4' });
  await wait(300);
  check('T1 chip ⭐ ON al volver a 6°4', (await page.locator('span.bg-amber-400:has-text("Dirección de Grupo")').count()) === 1);
  // guardar → normaliza la ficha (repara fantasma)
  await page.locator('button:has-text("Guardar Cambios")').click();
  await wait(1500);
  await ensureNoOverlay(page);
  const badgeM = await cardOf(page, 'María Camila Restrepo Henao').locator('span:has-text("Director de Grupo:")').textContent().catch(()=> '');
  check('T1 ficha guardada, badge ⭐ 6°4 intacto', /6°4/.test(badgeM||''), (badgeM||'').trim().slice(0,60));
  await page.screenshot({ path: SHOTS+'/r55_T1_guardada.png' });

  // ============ T2: ALTA DE DOCENTE CON CHIPS + CUENTA REAL ============
  await page.locator('button:has-text("Registrar Nuevo Docente")').first().click();
  await wait(800);
  await page.locator('#teachers-manager-view input[placeholder="Ej: 71829301"]').fill('555777999');
  await page.locator('#teachers-manager-view input[placeholder="Ej: Juan Pablo Pérez Gómez"]').fill('QA Ronda 55 Eliminar');
  await page.locator('#teachers-manager-view input[placeholder="jperez@inas.edu.co"]').fill('qa.r55.eliminar@inas.edu.co');
  const tempPass = await page.locator('#teachers-manager-view input').nth(9).inputValue().catch(()=> '');
  console.log('clave temporal leída del formulario (longitud):', (tempPass||'').length);
  // quitar Física para probar toggle en alta
  await page.locator('button[type="button"]:has-text("Física")').first().click();
  await wait(200);
  await page.screenshot({ path: SHOTS+'/r55_T2_alta_chips.png' });
  await page.locator('button:has-text("Registrar Docente")').last().click();
  await wait(4000); // provisionAccount (Firebase real vía UI)
  await ensureNoOverlay(page);
  // cerrar modal de credenciales si abrió
  const ent = page.locator('button:has-text("Entendido")').last();
  if (await ent.isVisible({ timeout:3000 }).catch(()=>false)) { await ent.click(); await wait(600); }
  const cnt = await page.evaluate(() => JSON.parse(localStorage.getItem('inas_teachers_v5')||'[]').length);
  const qaCard = await cardOf(page, 'QA Ronda 55 Eliminar').isVisible().catch(()=>false);
  check('T2 docente QA creado con chips (21 local, tarjeta visible)', cnt===21 && qaCard, `t=${cnt} tarjeta=${qaCard}`);
  // push a la nube
  if (await openAjustes(page)) {
    await page.locator('button[role="tab"]:has-text("Sync y Seguridad")').click({ force:true }).catch(()=>{});
    await wait(500);
    await page.locator('button:has-text("Sincronizar (Push)")').first().click({ force:true }).catch(()=>{});
    await wait(12000);
    await closeSyncOverlay(page);
    await page.locator('#btn-close-settings').click({ force:true }).catch(()=>{});
    await wait(800);
    check('T2 push (21 docentes) enviado', true);
  }

  // ============ T2b: LOGIN DOCENTE (cuenta recién creada) — AULA CON SELECT ============
  const dctx = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const dpage = await dctx.newPage();
  dpage.setDefaultTimeout(60000);
  await dpage.goto(BASE, { waitUntil:'domcontentloaded', timeout:90000 });
  await wait(3000);
  const dbtn = dpage.locator('button:has-text("Portal Docente & Aula")').first();
  if (await dbtn.isVisible({ timeout:10000 }).catch(()=>false)) await dbtn.click();
  await dpage.locator('input[type="email"]').fill('qa.r55.eliminar@inas.edu.co');
  await dpage.locator('input[type="password"]').fill(tempPass);
  await dpage.locator('button[type="submit"]:has-text("Ingresar")').click();
  const loggedIn = await dpage.waitForSelector('button[title*="Menú de Usuario"]', { timeout:60000 }).then(()=>true).catch(()=>false);
  check('T2b login docente QA (cuenta Firebase real de la UI)', loggedIn);
  if (loggedIn) {
    await wait(1500);
    // cerrar overlays de bienvenida si los hay
    for (const c of ['¡Empezar!','Cerrar','Entendido','Ahora no']) {
      const b = dpage.locator(`button:has-text("${c}")`).first();
      if (await b.isVisible({ timeout:800 }).catch(()=>false)) { await b.click({ force:true }).catch(()=>{}); await wait(400); }
    }
    const subjSelect = dpage.locator('select[aria-label="Asignatura de la clase"]');
    const selVisible = await subjSelect.isVisible({ timeout:10000 }).catch(()=>false);
    check('T2b Asignatura del aula es <select>', selVisible);
    if (selVisible) {
      const opts = await subjSelect.locator('option').allTextContents();
      check('T2b opciones = su ficha (Matemáticas; Física fue retirada)', opts.includes('Matemáticas') && !opts.includes('Física'), opts.join(' | '));
      const freeInput = await dpage.locator('input[list="inas-subjects-datalist"]').count();
      check('T2b sin texto libre de asignatura en el aula', freeInput === 0);
    }
    await dpage.screenshot({ path: SHOTS+'/r55_T2b_aula_select.png' });
    const mc = dpage.locator('button[aria-label="Abrir Mis Cátedras (autogestión de horario)"]');
    if (await mc.isVisible({ timeout:4000 }).catch(()=>false)) {
      await mc.click(); await wait(800);
      const mSel = dpage.locator('div[role="dialog"], div.fixed').filter({ hasText: 'Elija la asignatura' }).first();
      check('T2b Mis Cátedras con <select> de asignatura', await mSel.isVisible().catch(()=>false));
      await dpage.screenshot({ path: SHOTS+'/r55_T2b_mis_catedras.png' });
      await dpage.locator('button:has-text("Listo")').last().click().catch(()=>{}); await wait(500);
    }
    const mt = dpage.locator('button[aria-label="Abrir Mis Tarjetas QR (credencial docente firmada)"]');
    if (await mt.isVisible({ timeout:4000 }).catch(()=>false)) {
      await mt.click(); await wait(800);
      const mCount = await dpage.locator('button:has-text("Ver tarjeta QR")').count();
      check('T2b Mis Tarjetas QR lista ficha (1 por asignatura)', mCount === 1, `tarjetas=${mCount} (solo Matemáticas)`);
      await dpage.screenshot({ path: SHOTS+'/r55_T2b_mis_tarjetas.png' });
      await dpage.locator('button[aria-label="Cerrar Mis Tarjetas QR"]').click().catch(()=>{}); await wait(400);
    }
  }

  // ============ T2c: BORRADO DEL DOCENTE QA (tombstone) ============
  await cardOf(page, 'QA Ronda 55 Eliminar').locator('button[title="Eliminar docente"]').click();
  await wait(600);
  const confirmBtn = page.locator('button:has-text("Sí, eliminar")').first();
  if (await confirmBtn.isVisible({ timeout:5000 }).catch(()=>false)) { await confirmBtn.click(); await wait(1500); }
  const cnt2 = await page.evaluate(() => JSON.parse(localStorage.getItem('inas_teachers_v5')||'[]').length);
  const tomb = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('inas_tombstones_v1')||'[]').filter(t=>t.type==='teacher'); } catch { return []; } });
  check('T2c docente QA eliminado (20 local) + tombstone teacher', cnt2===20 && tomb.some(t=>/prof-/.test(t.id||'')), `t=${cnt2} tombstones=${tomb.length}`);
  await page.screenshot({ path: SHOTS+'/r55_T2c_eliminado.png' });
  if (await openAjustes(page)) {
    await page.locator('button[role="tab"]:has-text("Sync y Seguridad")').click({ force:true }).catch(()=>{});
    await wait(500);
    await page.locator('button:has-text("Sincronizar (Push)")').first().click({ force:true }).catch(()=>{});
    await wait(12000);
    await closeSyncOverlay(page);
    await page.locator('#btn-close-settings').click({ force:true }).catch(()=>{});
    await wait(800);
    check('T2c push de eliminación enviado', true);
  }

  // ============ T3: AJUSTES SIN SELECTOR DUPLICADO (producción) ============
  if (await openAjustes(page)) {
    const selects = page.locator('#settings-modal select');
    const n = await selects.count();
    let tpl = 0;
    for (let i=0;i<n;i++){
      const opts = (await selects.nth(i).locator('option').allTextContents()).join(' | ');
      if (/Día Normal|Recorte|Plantilla/.test(opts)) tpl++;
    }
    check('T3 Ajustes SIN selector de Plantillas', tpl===0, `selects=${n}`);
    check('T3 nota hacia Horarios → Plantillas', (await page.locator('text=Horarios Escolares → Plantillas').count()) > 0);
    check('T3 inicio/fin de jornada presentes', (await page.locator('#settings-modal input[type="time"]').count()) === 2);
    await page.screenshot({ path: SHOTS+'/r55_T3_ajustes.png' });
    await page.keyboard.press('Escape'); await wait(700); // salir SIN guardar
  } else check('T3 Ajustes no abrió', false);

  // ============ T4: HORARIOS → PLANTILLAS INTACTO (sin aplicar nada) ============
  const mod2 = page.locator('button:has-text("Módulos")').first();
  if (await mod2.isVisible({ timeout:6000 }).catch(()=>false)) { await mod2.click(); await wait(500); }
  await page.locator('button:has-text("Horarios Escolares")').last().click();
  await wait(1500);
  await ensureNoOverlay(page);
  const vm = page.locator('button[aria-label^="Vista actual"]').first();
  if (await vm.isVisible({ timeout:6000 }).catch(()=>false)) { await vm.click(); await wait(400); }
  const pl = page.locator('button:has-text("Plantillas")').last();
  if (await pl.isVisible({ timeout:4000 }).catch(()=>false)) { await pl.click(); await wait(1200); }
  await ensureNoOverlay(page);
  const tplA = page.locator('h4:has-text("Plantilla A: Día Normal")').first();
  const aplicar = page.locator('button:has-text("Aplicar hoy")').first();
  check('T4 Plantillas en Horarios con Plantilla A y «Aplicar hoy»', await tplA.isVisible().catch(()=>false) && await aplicar.isVisible().catch(()=>false));
  await page.screenshot({ path: SHOTS+'/r55_T4_plantillas.png' });

  // ============ T5: GUARDA DE JORNADA — NEGATIVO (~22h, Plantilla A cerrada) ============
  const esc = page.locator('button:has-text("Escanear")').first();
  if (await esc.isVisible({ timeout:6000 }).catch(()=>false)) { await esc.click(); await wait(1200); }
  await ensureNoOverlay(page);
  const manual = page.locator('input[placeholder*="carné"], input[placeholder*="Esperando"]').first();
  let rejected = false;
  if (await manual.isVisible({ timeout:8000 }).catch(()=>false)) {
    await manual.fill('196555769');
    await manual.press('Enter');
    await wait(2500);
    const fb = await page.locator('body').textContent();
    rejected = /Jornada Cerrada|jornada de hoy inicia|Fuera de este rango/i.test(fb||'');
  }
  check('T5 escaneo fuera de jornada RECHAZADO (guarda intacta)', rejected);
  await page.screenshot({ path: SHOTS+'/r55_T5_jornada_cerrada.png' });

  await ctx.close(); await dctx.close();

  // ============ T6: ESTADO FINAL DE LA NUBE (API) ============
  const pull = await cloudPull();
  const d = pull.data || {};
  const mc = (d.teachers||[]).find(t=>/María Camila Restrepo Henao/.test(t.fullName||''));
  const qaGone = !(d.teachers||[]).some(t=>/QA Ronda 55/.test(t.fullName||''));
  check('T6 nube: 80 estudiantes', (d.students||[]).length===80, `s=${(d.students||[]).length}`);
  check('T6 nube: 20 docentes', (d.teachers||[]).length===20, `t=${(d.teachers||[]).length}`);
  check('T6 nube: 180 cátedras', (d.assignments||[]).length===180, `a=${(d.assignments||[]).length}`);
  check('T6 nube: 2 registros de asistencia', (d.records||[]).length===2, `r=${(d.records||[]).length}`);
  check('T6 nube: Plantilla A activa', d.settings?.activeDayTemplate==='tmpl-normal', d.settings?.activeDayTemplate);
  check('T6 María Camila REPARADA (materia DG ∈ subjects)', !!(mc && (mc.subjects||[]).includes('Dirección de Grupo') && mc.directorGrade==='6°4' && mc.isGroupDirector===true), JSON.stringify({dg: mc?.directorGrade, subj: mc?.subjects}));
  check('T6 docente QA ausente en nube', qaGone);
  const tombs = pull.tombstones || d.tombstones || [];
  check('T6 tombstone de docente QA propagado a nube', tombs.some(t=>t.type==='teacher'), JSON.stringify(tombs).slice(0,160));

  console.log('\n=== ERRORES JS DE PÁGINA ===');
  console.log(consoleErrors.length ? consoleErrors.join('\n') : '(ninguno)');
  const fails = results.filter(r=>!r.ok).length;
  console.log(`\nQA E2E PRODUCCIÓN R55: ${results.length-fails}/${results.length} PASS`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
