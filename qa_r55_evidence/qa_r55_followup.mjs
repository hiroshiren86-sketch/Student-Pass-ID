// R55 FOLLOW-UP: re-test quirúrgico de los 3 falsos negativos (T1 badge, T2b login docente real, T5 regex)
import { chromium } from './node_modules/playwright/index.mjs';
import fs from 'fs';

const envRaw = fs.readFileSync('/home/user/spv/.env','utf8');
const get = (k) => (envRaw.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim().replace(/^['\"]|['\"]$/g,'') || '';
const EMAIL = get('RECTORIA_EMAIL');
const PASS  = get('RECTORIA_PASS');
const BASE = 'https://student-pass-id.pages.dev';
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
const cardOf = (page, name) => page.locator('h3:has-text("'+name+'")').locator('xpath=ancestor::div[contains(@class,"rounded-3xl")][1]').first();

(async () => {
  const browser = await chromium.launch();

  // ===== CONTEXTO RECTORÍA =====
  const ctx = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0,150)));
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
  check('F0 login Rectoría', true);
  if (await openAjustes(page)) {
    await page.locator('button[role="tab"]:has-text("Sync y Seguridad")').click({ force:true }).catch(()=>{});
    await wait(500);
    await page.locator('button:has-text("Descargar (Pull)")').first().click({ force:true }).catch(()=>{});
    await wait(12000);
    await closeSyncOverlay(page);
    await page.locator('#btn-close-settings').click({ force:true }).catch(()=>{});
    await wait(800);
  }
  const st = await page.evaluate(() => ({
    s: JSON.parse(localStorage.getItem('inas_students_v5')||'[]').length,
    t: JSON.parse(localStorage.getItem('inas_teachers_v5')||'[]').length
  }));
  check('F0 Pull 80/20', st.s===80 && st.t===20, JSON.stringify(st));

  // ===== T1b: TARJETA DE MARÍA CAMILA (badge ⭐ + chips SIN duplicar DG) =====
  const mod = page.locator('button:has-text("Módulos")').first();
  if (await mod.isVisible({ timeout:6000 }).catch(()=>false)) { await mod.click(); await wait(500); }
  await page.locator('button:has-text("Gestión Docentes")').last().click();
  await wait(1500);
  await ensureNoOverlay(page);
  const cardM = cardOf(page, 'María Camila Restrepo Henao');
  const badge = (await cardM.locator('span:has-text("Director de Grupo:")').textContent().catch(()=> '')).trim();
  check('T1b badge ⭐ «Director de Grupo: 6°4» visible', /Director de Grupo:\s*6°4/.test(badge), badge);
  const chips = await cardM.locator('.flex.flex-wrap.gap-1 span').allTextContents();
  const hasLG = chips.includes('Lengua Castellana');
  const hasDGchip = chips.includes('Dirección de Grupo');
  check('T1b chips: Lengua Castellana presente', hasLG, chips.join(' | '));
  check('T1b chips: «Dirección de Grupo» NO duplicada (la representa el badge ⭐)', !hasDGchip);
  await cardM.scrollIntoViewIfNeeded().catch(()=>{});
  await page.screenshot({ path: SHOTS+'/r55_T1b_maria_card.png' });

  // ===== T2b': LOGIN DOCENTE REAL (Andrés Felipe, clave temporal de su ficha) =====
  const andres = await page.evaluate(() => {
    const ts = JSON.parse(localStorage.getItem('inas_teachers_v5')||'[]');
    const a = ts.find(t=>/Andrés Felipe Giraldo/.test(t.fullName||''));
    return a ? { email: a.authEmail || a.email, temp: a.tempPassword || '', hasAcct: !!a.hasFirebaseAccount, subjects: a.subjects } : null;
  });
  check('F2b ficha de Andrés con cuenta y clave temporal local', !!andres && !!andres.temp && andres.hasAcct, JSON.stringify({email: andres?.email, tempLen: (andres?.temp||'').length, subjects: andres?.subjects}));
  if (andres && andres.temp) {
    const dctx = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
    const dpage = await dctx.newPage();
    dpage.setDefaultTimeout(60000);
    await dpage.goto(BASE, { waitUntil:'domcontentloaded', timeout:90000 });
    await wait(3000);
    const dbtn = dpage.locator('button:has-text("Portal Docente & Aula")').first();
    if (await dbtn.isVisible({ timeout:10000 }).catch(()=>false)) await dbtn.click();
    await dpage.locator('input[type="email"]').fill(andres.email);
    await dpage.locator('input[type="password"]').fill(andres.temp);
    await dpage.locator('button[type="submit"]:has-text("Ingresar")').click();
    const loggedIn = await dpage.waitForSelector('button[title*="Menú de Usuario"]', { timeout:60000 }).then(()=>true).catch(()=>false);
    check('T2b login docente REAL con clave temporal de la ficha', loggedIn, andres.email);
    if (loggedIn) {
      await wait(2000);
      for (const c of ['¡Empezar!','Cerrar','Entendido','Ahora no']) {
        const b = dpage.locator(`button:has-text("${c}")`).first();
        if (await b.isVisible({ timeout:800 }).catch(()=>false)) { await b.click({ force:true }).catch(()=>{}); await wait(400); }
      }
      const subjSelect = dpage.locator('select[aria-label="Asignatura de la clase"]');
      const selVisible = await subjSelect.isVisible({ timeout:10000 }).catch(()=>false);
      check('T2b Asignatura del aula es <select>', selVisible);
      if (selVisible) {
        const opts = await subjSelect.locator('option').allTextContents();
        check('T2b opciones del select = SU ficha (Inglés ∈ opciones)', opts.includes('Inglés'), opts.join(' | '));
        const val = await subjSelect.inputValue();
        check('T2b valor inicial = primera asignatura de la ficha', val === 'Inglés', val);
      }
      const freeInput = await dpage.locator('input[list="inas-subjects-datalist"]').count();
      check('T2b cero texto libre de asignatura en el aula', freeInput === 0);
      await dpage.screenshot({ path: SHOTS+'/r55_T2b_aula_andres.png' });
      const mc = dpage.locator('button[aria-label="Abrir Mis Cátedras (autogestión de horario)"]');
      if (await mc.isVisible({ timeout:4000 }).catch(()=>false)) {
        await mc.click(); await wait(800);
        const mSel = dpage.locator('select[aria-label="Materia"]');
        check('T2b Mis Cátedras: <select> de materia', await mSel.isVisible().catch(()=>false));
        if (await mSel.isVisible().catch(()=>false)) {
          const mOpts = await mSel.locator('option').allTextContents();
          check('T2b Mis Cátedras: opciones desde ficha', mOpts.some(o=>o.includes('Inglés')), mOpts.join(' | '));
        }
        await dpage.screenshot({ path: SHOTS+'/r55_T2b_catedras_andres.png' });
        await dpage.locator('button:has-text("Listo")').last().click().catch(()=>{}); await wait(500);
      }
      const mt = dpage.locator('button[aria-label="Abrir Mis Tarjetas QR (credencial docente firmada)"]');
      if (await mt.isVisible({ timeout:4000 }).catch(()=>false)) {
        await mt.click(); await wait(800);
        const mCount = await dpage.locator('button:has-text("Ver tarjeta QR")').count();
        const expected = (andres.subjects||[]).length;
        check('T2b Mis Tarjetas QR = 1 por asignatura de la ficha', mCount === expected, `tarjetas=${mCount} esperadas=${expected}`);
        await dpage.screenshot({ path: SHOTS+'/r55_T2b_tarjetas_andres.png' });
        await dpage.locator('button[aria-label="Cerrar Mis Tarjetas QR"]').click().catch(()=>{}); await wait(400);
      }
    }
    await dctx.close();
  }

  // ===== T5': GUARDA DE JORNADA CON REGEX CORRECTO + PRUEBA DE CERO REGISTROS =====
  const attBefore = await page.evaluate(() => (JSON.parse(localStorage.getItem('inas_attendance_v5')||'[]')).length);
  const esc = page.locator('button:has-text("Escanear")').first();
  if (await esc.isVisible({ timeout:6000 }).catch(()=>false)) { await esc.click(); await wait(1200); }
  await ensureNoOverlay(page);
  const manual = page.locator('input[placeholder*="carné"], input[placeholder*="Esperando"]').first();
  let rejected = false;
  if (await manual.isVisible({ timeout:8000 }).catch(()=>false)) {
    await manual.fill('196555769');
    await manual.press('Enter');
    await wait(3000);
    const fb = await page.locator('body').textContent();
    rejected = /No hay clase en curso|Jornada Cerrada|no se registra asistencia/i.test(fb||'');
  }
  const attAfter = await page.evaluate(() => (JSON.parse(localStorage.getItem('inas_attendance_v5')||'[]')).length);
  check('T5 escaneo 16h RECHAZADO (guarda activa, mensaje correcto)', rejected);
  check('T5 CERO registros nuevos en asistencia local', attAfter === attBefore, `antes=${attBefore} después=${attAfter}`);
  await page.screenshot({ path: SHOTS+'/r55_T5_rechazo.png' });

  console.log('\n=== ERRORES JS ===');
  console.log(errs.length ? errs.join('\n') : '(ninguno)');
  const fails = results.filter(r=>!r.ok).length;
  console.log(`\nFOLLOW-UP R55: ${results.length-fails}/${results.length} PASS`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
