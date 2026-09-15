/**
 * R69 · E2E 03 — PASO B: sub-roles desde Rectoría ("Hacer Rep") y verificación
 * del perfil de Representante en otro dispositivo.
 *
 *   1. Navegador limpio → Rectoría → Pull → Directorio.
 *   2. Por cada curso del catálogo (o los de E2E_GRADES): filtrar el curso,
 *      pulsar "Hacer Rep" junto a un estudiante y verificar que la fila queda
 *      con la insignia "Representante" (sub-rol persistido, R68 RC-4/R69 RC-9).
 *   3. Push del sub-rol a la nube (la ficha viaja con isRepresentative).
 *   4. SEGUNDO navegador limpio → login del estudiante con su código y la clave
 *      por defecto → el Portal muestra "Modo Representante de Salón" y las
 *      acciones de representante (horas/bloques y escaneo del grupo).
 *   5. Verificación en la nube: /api/sync/pull con idToken real → la ficha del
 *      representante trae el sub-rol (no es un estado local del navegador).
 *
 * Requisitos: BASE_URL, RECTORIA_*, ESTUDIANTE_CLAVE (o la clave por defecto
 * 000000 del Paso A). Ejecutar:
 *   node tests/e2e/simulation/03_paso_b_subroles_rep.mjs
 */
import { Reporter } from './lib/report.mjs';
import { env, requireEnv } from './lib/env.mjs';
import {
  launchBrowser, newDevice, clearSiteData, openApp, dismissOverlays,
  loginAs, navTo, readLocalState, pullFromUi, pushFromUi, shot,
  firebaseIdToken, workerFetch,
} from './lib/app.mjs';

requireEnv(['BASE_URL', 'RECTORIA_EMAIL', 'RECTORIA_PASS']);
const R = new Reporter('03_paso_b_subroles_rep', { grades: env.grades });
const browser = await launchBrowser();

try {
  // ══ 1. Rectoría limpia ══
  const dev = await newDevice(browser, 'rectoria');
  const { page } = dev;
  await clearSiteData(page);
  await openApp(page);
  R.section('1 · Rectoría: catálogo vigente');
  R.check('login real de Rectoría', await loginAs(page, { role: 'ADMIN', identifier: env.rectoriaEmail, password: env.rectoriaPass, reporter: R }));
  const pull = await pullFromUi(page, R);
  R.check('Pull con matrícula', pull.after.students > 0, `students=${pull.after.students}`);
  const cursos = (env.grades.length ? env.grades : pull.after.gradeList).filter(g => (pull.after.grades[g] || 0) > 0);
  R.note(`cursos a procesar: ${cursos.length} → ${cursos.join(', ')}`);
  R.check('hay cursos para asignar sub-roles', cursos.length > 0);

  // ══ 2. "Hacer Rep" por curso ══
  R.section('2 · Asignación del sub-rol Representante por curso');
  await navTo(page, 'students');
  const select = page.getByTestId('directorio-filtro-grado');
  await select.waitFor({ state: 'visible', timeout: 30_000 });
  const reps = [];
  let asignados = 0, fallidos = 0;
  for (const curso of cursos) {
    await select.selectOption(curso).catch(async () => {
      const opts = await select.locator('option').evaluateAll(els => els.map(e => e.value));
      const m = opts.find(v => v.replace(/\D/g, '') === curso.replace(/\D/g, ''));
      if (m) await select.selectOption(m);
    });
    await page.waitForTimeout(600);
    const hacerRep = page.locator('[data-testid^="hacer-rep-"]').first();
    if (!(await hacerRep.isVisible().catch(() => false))) {
      R.note(`${curso}: sin botón "Hacer Rep" visible (¿el curso ya tiene representante?)`);
      fallidos++;
      continue;
    }
    const testid = await hacerRep.getAttribute('data-testid');
    const code = testid.replace('hacer-rep-', '');
    await hacerRep.click();
    await page.waitForTimeout(1200);
    const insignia = await page.locator(`[data-testid="quitar-rep-${code}"]`).count();
    if (insignia === 1) { asignados++; reps.push({ curso, code }); }
    else { fallidos++; R.note(`${curso}: no apareció la insignia de Representante para ${code}`); }
  }
  R.check(`sub-rol asignado en los cursos (${asignados}/${cursos.length})`, asignados === cursos.length && fallidos === 0,
    `asignados=${asignados} fallidos=${fallidos}`);
  R.note(`representantes: ${reps.map(r => `${r.curso}→${r.code}`).join(', ')}`);
  await shot(R, page, 'subroles_asignados');

  // Invariante: un solo representante por curso
  const st = await readLocalState(page);
  R.check('el almacenamiento local refleja las fichas actualizadas', st.students === pull.after.students, `${st.students}`);

  // ══ 3. Push ══
  R.section('3 · Push del sub-rol a la nube');
  R.check('Push lanzado desde Ajustes', await pushFromUi(page, R));

  // ══ 4. Verificación en la nube ══
  if (env.workerUrl && env.schoolCode && process.env.FIREBASE_API_KEY) {
    try {
      const { idToken } = await firebaseIdToken(env.rectoriaEmail, env.rectoriaPass);
      const r = await workerFetch(`/api/sync/pull?schoolCode=${encodeURIComponent(env.schoolCode)}`, idToken);
      const j = await r.json().catch(() => ({}));
      const estudiantes = j.students || [];
      const conRol = estudiantes.filter(s => s.isRepresentative);
      R.check('la nube guarda fichas con el sub-rol de representante', conRol.length >= reps.length,
        `nube=${conRol.length} · asignados=${reps.length}`);
      const perdidos = reps.filter(rp => !conRol.some(s => String(s.code) === String(rp.code)));
      R.check('cada representante asignado está en la nube', perdidos.length === 0,
        perdidos.map(p => `${p.curso}:${p.code}`).join(','));
    } catch (e) {
      R.check('verificación del sub-rol en la nube', false, String(e.message).slice(0, 300));
    }
  } else {
    R.skip('verificación del sub-rol en la nube', 'falta WORKER_URL / SCHOOL_CODE / FIREBASE_API_KEY');
  }

  // ══ 5. Perfil de representante en OTRO dispositivo limpio ══
  R.section('4 · Portal del Representante en un segundo dispositivo limpio');
  const rep = reps[0];
  const clave = env.estudianteClave || '000000';
  if (!rep) {
    R.skip('portal del representante', 'no se asignó ningún sub-rol en el paso anterior');
  } else {
    const dev2 = await newDevice(browser, 'estudiante');
    await clearSiteData(dev2.page);
    await openApp(dev2.page);
    const entro = await loginAs(dev2.page, { role: 'ESTUDIANTE_ACUDIENTE', identifier: rep.code, password: clave, reporter: R });
    R.check(`login del estudiante ${rep.code} (${rep.curso}) con la clave por defecto`, entro,
      entro ? '' : 'revise que el Paso A haya restablecido las claves (000000)');
    if (entro) {
      const cuerpo = await dev2.page.locator('body').innerText();
      R.check('el Portal muestra "Modo Representante de Salón"', /Modo Representante/i.test(cuerpo),
        cuerpo.slice(0, 220).replace(/\n+/g, ' | '));
      R.check('el portal del representante ofrece el control de horas/bloques',
        /bloque|hora|asistencia|escanear/i.test(cuerpo), '');
      const st2 = await readLocalState(dev2.page);
      R.check('la sesión del segundo dispositivo es de estudiante (no suplantación de Rectoría)',
        st2.sessionRole === 'ESTUDIANTE_ACUDIENTE', `rol=${st2.sessionRole}`);
      await shot(R, dev2.page, 'portal_representante');
    }
  }

  R.note(`errores de consola: ${dev.consoleErrors.length}`);
} catch (e) {
  R.check('la corrida no lanzó excepciones', false, String(e?.stack || e).slice(0, 600));
} finally {
  await browser.close();
  R.finish();
}
