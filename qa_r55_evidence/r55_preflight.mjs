// R55 PRE-FLIGHT LOCAL (dist nuevo vía vite preview :4173) — cero riesgo para producción.
// Verifica: render de tarjetas de asignaturas, sincronización viva ⭐, settings sin selector duplicado.
import { chromium } from './node_modules/playwright/index.mjs';
import fs from 'fs';

const envRaw = fs.readFileSync('/home/user/spv/.env','utf8');
const get = (k) => (envRaw.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim().replace(/^['\"]|['\"]$/g,'') || '';
const EMAIL = get('RECTORIA_EMAIL');
const PASS  = get('RECTORIA_PASS');
const BASE = process.env.BASE || 'http://localhost:4173';
fs.mkdirSync('/tmp/qa_shots', { recursive: true });

const wait = (ms) => new Promise(r => setTimeout(r, ms));

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

const results = [];
const check = (name, ok, extra='') => { results.push({ name, ok, extra }); console.log(`${ok?'PASS':'FAIL'} · ${name}${extra?' — '+extra:''}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale:'es-CO', timezoneId:'America/Bogota', viewport:{width:1366,height:900} });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const consoleErrors = [];
  page.on('console', m => { if (m.type()==='error') consoleErrors.push(m.text().slice(0,200)); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR: '+String(e).slice(0,200)));

  await page.goto(BASE, { waitUntil:'domcontentloaded', timeout:60000 });
  await wait(3000);
  await ensureNoOverlay(page);

  // login Rectoría
  const btn = page.locator('button:has-text("Rectoría / Admin")').first();
  if (await btn.isVisible({ timeout:10000 }).catch(()=>false)) await btn.click();
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.locator('button[type="submit"]:has-text("Ingresar")').click();
  await page.waitForSelector('button[title*="Menú de Usuario"]', { timeout:90000 });
  await ensureNoOverlay(page);
  check('login Rectoría (local dist R55)', true);

  // localhost = localStorage vacío → Pull primero (el guard anti-aplastado exige datos).
  // OJO: NO invocar ensureNoOverlay con el modal de Ajustes abierto (lo cierra).
  let ajustesOk = false;
  for (let attempt=0; attempt<4 && !ajustesOk; attempt++) {
    const um0 = page.locator('button[title*="Menú de Usuario"]').first();
    if (await um0.isVisible({ timeout:2000 }).catch(()=>false)) { await um0.click({ force:true }).catch(()=>{}); }
    await wait(700);
    await page.locator('button:has-text("Configuración & Motores IA")').first().click({ force:true }).catch(()=>{});
    await wait(1000);
    ajustesOk = await page.locator('#btn-close-settings').isVisible({ timeout:1500 }).catch(()=>false);
    if (!ajustesOk) { await page.keyboard.press('Escape').catch(()=>{}); await wait(600); }
  }
  check('modal Ajustes abierto', ajustesOk);
  await page.locator('button[role="tab"]:has-text("Sync y Seguridad")').click({ force:true }).catch(()=>{});
  await wait(600);
  await page.locator('button:has-text("Descargar (Pull)")').first().click({ force:true }).catch(()=>{});
  console.log('Pull lanzado, esperando…');
  // el SyncOverlay muestra el resultado; esperar a que termine (hasta ~30s)
  await wait(15000);
  await page.screenshot({ path: '/tmp/qa_shots/r55_preflight_pull.png' });
  const studentsLocal = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('inas_students_v5')||'[]').length; } catch { return -1; } });
  const teachersLocal = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('inas_teachers_v5')||'[]').length; } catch { return -1; } });
  check('Pull pobló la matrícula local', studentsLocal > 0 && teachersLocal > 0, `students=${studentsLocal} teachers=${teachersLocal}`);
  // cerrar overlay de éxito de sync (z-[100], botón "Cerrar") si está abierto
  const syncOverlayBtn = page.locator('div.fixed.inset-0.z-\\[100\\] button:has-text("Cerrar")').first();
  if (await syncOverlayBtn.isVisible({ timeout:3000 }).catch(()=>false)) { await syncOverlayBtn.click({ force:true }).catch(()=>{}); await wait(700); }
  // cerrar Ajustes
  await page.locator('#btn-close-settings').click({ force:true }).catch(()=>{});
  await wait(900);
  // por si quedó cualquier overlay z-[100] residual
  const residual = page.locator('div.fixed.inset-0.z-\\[100\\]');
  if (await residual.isVisible({ timeout:800 }).catch(()=>false)) {
    await page.locator('div.fixed.inset-0.z-\\[100\\] button').last().click({ force:true }).catch(()=>{});
    await wait(600);
  }

  // Gestión Docentes
  const mod = page.locator('button:has-text("Módulos")').first();
  if (await mod.isVisible({ timeout:6000 }).catch(()=>false)) { await mod.click(); await wait(500); }
  await page.locator('button:has-text("Gestión Docentes")').last().click();
  await wait(1500);
  await ensureNoOverlay(page);
  check('navegación a Gestión Docentes', true);

  // abrir edición del primer docente (lapicito)
  const editBtn = page.locator('button[title="Editar datos del docente"]').first();
  await editBtn.waitFor({ state:'visible', timeout:15000 });
  await editBtn.click();
  await wait(800);
  const modal = page.locator('text=Editar Ficha del Docente').first();
  check('modal Editar Ficha abre', await modal.isVisible().catch(()=>false));

  // campo antiguo NO debe existir; tarjetas sí
  const oldInput = await page.locator('input[list="inas-subjects-datalist-teacher"]').count();
  check('input viejo "Separadas por coma" ausente', oldInput === 0);
  const chipGrid = page.locator('text=Asignaturas que Dicta').first();
  check('título "Asignaturas que Dicta" presente', await chipGrid.isVisible().catch(()=>false));
  const matChip = page.locator('button[type="button"]:has-text("Matemáticas")').first();
  check('tarjeta Matemáticas presente', await matChip.isVisible().catch(()=>false));
  const dgChip = page.locator('span:has-text("⭐")').filter({ hasText: 'Dirección de Grupo' }).first();
  check('tarjeta ⭐ Dirección de Grupo presente', await dgChip.isVisible().catch(()=>false));

  // sincronización viva: elegir un curso en el selector ⭐ → tarjeta debe activarse
  const dgSelect = page.locator('select').filter({ has: page.locator('option:has-text("N/A - Sin dirección")') }).first();
  const options = await dgSelect.locator('option').allTextContents();
  const target = options.find(o => /Director de Grupo de:/.test(o));
  if (target) {
    await dgSelect.selectOption({ label: target });
    await wait(400);
    const val = await dgSelect.inputValue();
    check('selector ⭐ cambia a ' + target.trim(), val !== '');
    const dgOn = await page.locator('span.bg-amber-400:has-text("Dirección de Grupo")').count();
    check('tarjeta ⭐ se ACTIVÓ sola al elegir curso', dgOn > 0, `count=${dgOn}`);
    await page.screenshot({ path: '/tmp/qa_shots/r55_preflight_dg_on.png' });
    // volver a N/A → tarjeta se retira
    await dgSelect.selectOption({ label: 'N/A - Sin dirección de grupo asignada' });
    await wait(400);
    const dgOff = await page.locator('span.bg-amber-400:has-text("Dirección de Grupo")').count();
    check('tarjeta ⭐ se RETIRÓ sola al pasar a N/A', dgOff === 0, `count=${dgOff}`);
  } else {
    check('selector ⭐ con opciones', false, 'sin opciones de grado');
  }

  // toggle de una tarjeta normal
  const reli = page.locator('button[type="button"]:has-text("Religión")').first();
  const before = await reli.getAttribute('aria-pressed');
  await reli.click(); await wait(250);
  const after = await reli.getAttribute('aria-pressed');
  check('toggle tarjeta Religión', before !== after, `${before}→${after}`);
  await reli.click(); await wait(250); // restaurar

  // asignatura custom: agregar y quitar
  await page.locator('input[placeholder^="Otra asignatura"]').fill('Materia QA R55');
  await page.locator('button:has-text("Agregar")').last().click();
  await wait(300);
  const custom = await page.locator('span:has-text("Materia QA R55")').count();
  check('tarjeta custom agregada', custom > 0);
  if (custom > 0) {
    await page.locator('button[aria-label="Quitar Materia QA R55"]').click();
    await wait(250);
    check('tarjeta custom removida', (await page.locator('span:has-text("Materia QA R55")').count()) === 0);
  }

  // cancelar sin guardar
  await page.locator('button:has-text("Cancelar")').last().click();
  await wait(500);

  // Configuración: sin selector duplicado de Plantillas (con reintentos; NO usar ensureNoOverlay abierto el modal)
  let ajustesOk2 = false;
  for (let attempt=0; attempt<4 && !ajustesOk2; attempt++) {
    const um = page.locator('button[title*="Menú de Usuario"]').first();
    if (await um.isVisible({ timeout:2000 }).catch(()=>false)) { await um.click({ force:true }).catch(()=>{}); }
    await wait(700);
    await page.locator('button:has-text("Configuración & Motores IA")').first().click({ force:true }).catch(()=>{});
    await wait(1000);
    ajustesOk2 = await page.locator('#btn-close-settings').isVisible({ timeout:1500 }).catch(()=>false);
    if (!ajustesOk2) { await page.keyboard.press('Escape').catch(()=>{}); await wait(600); }
  }
  check('modal Ajustes re-abierto para verificación final', ajustesOk2);
  const dupSelect = await page.locator('#settings-modal select').count();
  let dayTplSelects = 0;
  const allSelects = page.locator('#settings-modal select');
  const n = await allSelects.count();
  for (let i=0;i<n;i++){
    const opts = (await allSelects.nth(i).locator('option').allTextContents()).join(' | ');
    if (/Día Normal|Recorte|Plantilla/.test(opts)) dayTplSelects++;
  }
  check('Configuración SIN selector de Plantillas duplicado', dayTplSelects === 0, `selects totales=${n}`);
  const note = await page.locator('text=Horarios Escolares → Plantillas').count();
  check('nota orientadora hacia Horarios → Plantillas presente', note > 0);
  const startInp = await page.locator('input[type="time"]').count();
  check('inicio/fin de jornada siguen en Configuración', startInp >= 2, `time inputs=${startInp}`);
  await page.screenshot({ path: '/tmp/qa_shots/r55_preflight_ajustes.png' });

  console.log('\n=== ERRORES DE CONSOLA (filtrados Firebase ruido) ===');
  const real = consoleErrors.filter(e => !/Firestore|Firebase|webchannel|auth\/| fuego/i.test(e));
  console.log(real.length ? real.join('\n') : '(ninguno)');
  check('sin errores JS de página', consoleErrors.filter(e=>e.startsWith('PAGEERROR')).length === 0);

  const fails = results.filter(r=>!r.ok).length;
  console.log(`\nPRE-FLIGHT LOCAL R55: ${results.length-fails}/${results.length} PASS`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
