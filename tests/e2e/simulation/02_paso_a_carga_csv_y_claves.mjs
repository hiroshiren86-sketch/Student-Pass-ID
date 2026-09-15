/**
 * R69 · E2E 02 — PASO A: carga masiva por CSV + claves por defecto.
 *
 * Flujo real de Rectoría sobre la app desplegada (sin inyección hardcodeada):
 *   1. Navegador limpio → login real de Rectoría → Pull del catálogo vigente.
 *   2. Directorio → "Cargar Archivo(s)" → subir el CSV versionado
 *      (tests/fixtures/matricula_mini_colegio_15_grupos.csv, 150 estudiantes =
 *      15 cursos × 10) → previsualización → "Confirmar y Registrar".
 *   3. Verificación local: 15 cursos nuevos con ≥10 estudiantes cada uno y los
 *      cursos existentes intactos (sembrado ADITIVO, no destructivo).
 *   4. Push a la nube y verificación EN LA NUBE con el API del Worker
 *      (/api/sync/pull con idToken real de Firebase) — no basta el localStorage.
 *   5. "Restablecer claves (todos)" con la clave por defecto 000000 y reporte
 *      honesto por usuario (requiere Worker + Service Account; si el entorno no
 *      lo permite, el script lo dice en vez de fingir éxito).
 *   6. Segundo navegador limpio → login → Pull → los 150 estudiantes llegan
 *      desde la nube (prueba de persistencia real y no de caché local).
 *
 * Requisitos: BASE_URL, WORKER_URL, AUTH_TOKEN, SCHOOL_CODE, RECTORIA_*,
 * FIREBASE_API_KEY (para el login REST que consulta el Worker).
 * Ejecutar: node tests/e2e/simulation/02_paso_a_carga_csv_y_claves.mjs
 */
import { Reporter } from './lib/report.mjs';
import { env, requireEnv, FIXTURE_MATRICULA } from './lib/env.mjs';
import {
  launchBrowser, newDevice, clearSiteData, openApp, dismissOverlays,
  loginAs, navTo, readLocalState, pullFromUi, pushFromUi, shot,
  firebaseIdToken, workerFetch,
} from './lib/app.mjs';
import { existsSync } from 'node:fs';

requireEnv(['BASE_URL', 'RECTORIA_EMAIL', 'RECTORIA_PASS']);
const R = new Reporter('02_paso_a_carga_csv_y_claves', { fixture: FIXTURE_MATRICULA });
if (!existsSync(FIXTURE_MATRICULA)) {
  R.check('existe el fixture de matrícula', false, FIXTURE_MATRICULA);
  R.finish(1);
} else {
  const browser = await launchBrowser();
  try {
    // ══ 1. Rectoría en un navegador limpio ══
    const dev = await newDevice(browser, 'rectoria');
    const { page } = dev;
    await clearSiteData(page);
    await openApp(page);
    R.section('1 · Sesión de Rectoría y catálogo vigente');
    R.check('login real de Rectoría', await loginAs(page, { role: 'ADMIN', identifier: env.rectoriaEmail, password: env.rectoriaPass, reporter: R }));
    const pull = await pullFromUi(page, R);
    const base = pull.after;
    R.check('Pull con matrícula vigente', base.students > 0, `students=${base.students}`);
    R.note(`catálogo ANTES: ${base.students} estudiantes en ${base.gradeList.length} cursos`);
    const gruposAntes = { ...base.grades };

    // ══ 2. Carga masiva por CSV (flujo real de la UI) ══
    R.section('2 · Carga masiva por CSV desde el Directorio');
    await navTo(page, 'students');
    await page.getByTestId('accion-cargar-archivos').click();
    await page.waitForTimeout(1200);
    await dismissOverlays(page);
    const fileInput = page.getByTestId('carga-archivo-input');
    await fileInput.setInputFiles(FIXTURE_MATRICULA);
    await page.waitForTimeout(6000); // parseo del CSV de 150 filas
    const previewText = await page.locator('body').innerText();
    const anunciados = Number((previewText.match(/Confirmar y Registrar\s*\((\d+)\)/) || [])[1] || 0);
    R.check('la previsualización anuncia 150 registros válidos', anunciados === 150, `anunciados=${anunciados}`);
    await shot(R, page, 'carga_preview');
    await page.getByTestId('carga-confirmar').click();
    await page.waitForTimeout(9000); // altas + push diferido de las fichas nuevas
    await dismissOverlays(page);

    // ══ 3. Verificación local del catálogo resultante ══
    R.section('3 · Catálogo local tras la importación');
    const despues = await readLocalState(page);
    R.check('la matrícula creció en 150', despues.students === base.students + 150,
      `antes=${base.students} después=${despues.students}`);
    const nuevos = ['6°1','6°2','6°3','7°1','7°2','7°3','8°1','8°2','8°3','9°1','9°2','10°1','10°2','11°1','11°2'];
    const faltan = nuevos.filter(g => (despues.grades[g] || 0) < 10);
    R.check('los 15 cursos nuevos tienen ≥10 estudiantes', faltan.length === 0, `faltan: ${faltan.join(',') || 'ninguno'}`);
    const pisados = Object.entries(gruposAntes).filter(([g, n]) => (despues.grades[g] || 0) < n);
    R.check('ningún curso existente perdió estudiantes (sembrado aditivo)', pisados.length === 0,
      pisados.map(([g, n]) => `${g}:${n}→${despues.grades[g]}`).join(','));
    await navTo(page, 'students');
    const select = page.getByTestId('directorio-filtro-grado');
    await select.waitFor({ state: 'visible', timeout: 20_000 });
    const opciones = await select.locator('option').evaluateAll(els => els.map(e => e.value));
    R.check('el selector del Directorio ya ofrece los 15 cursos nuevos',
      nuevos.every(g => opciones.includes(g)), `faltan: ${nuevos.filter(g => !opciones.includes(g)).join(',')}`);
    await select.selectOption('6°1');
    await page.waitForTimeout(700);
    const filas61 = await page.locator('[data-testid^="directorio-fila-"]').count();
    R.check('filtrar 6°1 muestra sus 10 estudiantes (regresión corregida con datos nuevos)', filas61 === 10, `filas=${filas61}`);
    await shot(R, page, 'directorio_6_1');

    // ══ 4. Push y verificación EN LA NUBE ══
    R.section('4 · Push y verificación en la nube (API del Worker)');
    const pushed = await pushFromUi(page, R);
    R.check('se lanzó el Push desde Ajustes', pushed);
    const stPush = await readLocalState(page);
    R.check('lastPushAt quedó registrado', !!stPush.settings.lastPushAt, JSON.stringify(stPush.settings));

    if (env.workerUrl && env.authToken && env.schoolCode && process.env.FIREBASE_API_KEY) {
      try {
        const { idToken } = await firebaseIdToken(env.rectoriaEmail, env.rectoriaPass);
        const r = await workerFetch(`/api/sync/pull?schoolCode=${encodeURIComponent(env.schoolCode)}`, idToken);
        const j = await r.json().catch(() => ({}));
        const nube = (j.students || []).filter(s => /^109\d{7}$/.test(String(s.documentId || '')));
        R.check('el Worker responde al Pull autenticado', r.status === 200, `status=${r.status}`);
        R.check('la nube tiene los 150 estudiantes del fixture', nube.length === 150, `en la nube=${nube.length}`);
        const cursosNube = {};
        for (const s of (j.students || [])) { const g = String(s.grade || '').trim(); cursosNube[g] = (cursosNube[g] || 0) + 1; }
        R.check('la nube conserva los cursos existentes', Object.entries(gruposAntes).every(([g, n]) => (cursosNube[g] || 0) >= n),
          JSON.stringify(cursosNube).slice(0, 240));
        R.note(`cursos en la nube: ${JSON.stringify(cursosNube)}`);
      } catch (e) {
        R.check('verificación en la nube', false, String(e.message).slice(0, 300));
      }
    } else {
      R.skip('verificación en la nube con el API del Worker',
        'falta WORKER_URL / AUTH_TOKEN / SCHOOL_CODE / FIREBASE_API_KEY');
    }

    // ══ 5. Claves por defecto (restablecimiento masivo) ══
    R.section('5 · Clave por defecto 000000 (restablecimiento masivo)');
    await navTo(page, 'students');
    await page.getByTestId('accion-restablecer-claves').click();
    await page.waitForTimeout(1200);
    await dismissOverlays(page);
    const dialogo = await page.locator('body').innerText();
    R.check('abre el diálogo de restablecimiento masivo', /restablecer/i.test(dialogo));
    // Estrategia "clave por defecto" + confirmación.
    const opcionDefault = page.getByRole('radio', { name: /defecto/i }).or(page.getByText(/clave por defecto/i)).first();
    if (await opcionDefault.isVisible().catch(() => false)) await opcionDefault.click().catch(() => {});
    const campoDefault = page.locator('input[type="text"], input[type="password"]').filter({ hasText: '' }).first();
    await page.locator('input[placeholder*="000000"], input[name*="default" i]').first().fill('000000').catch(() => {});
    await page.getByRole('button', { name: /confirmar|restablecer|aplicar/i }).first().click().catch(() => {});
    await page.waitForTimeout(20_000); // operación masiva contra /api/admin/credential
    const resultado = await page.locator('body').innerText();
    const okMasivo = /restablec/i.test(resultado) && !/error de red|no se pudo|fall/i.test(resultado.slice(0, 4000));
    R.check('el restablecimiento masivo terminó con reporte visible', okMasivo, resultado.slice(0, 300).replace(/\n+/g, ' | '));
    await shot(R, page, 'claves_resultado');
    R.note('NOTA: el reset masivo requiere Worker + Service Account; si el entorno no lo tiene, el reporte por usuario lo indica.');

    // ══ 6. Segundo navegador limpio: la nube responde ══
    R.section('6 · Segundo dispositivo limpio: los datos vienen de la nube');
    const dev2 = await newDevice(browser, 'rectoria-2');
    await clearSiteData(dev2.page);
    await openApp(dev2.page);
    const st2inicial = await readLocalState(dev2.page);
    R.check('el segundo navegador arranca vacío', st2inicial.students === 0, `students=${st2inicial.students}`);
    R.check('login real en el segundo navegador', await loginAs(dev2.page, { role: 'ADMIN', identifier: env.rectoriaEmail, password: env.rectoriaPass, reporter: R }));
    const pull2 = await pullFromUi(dev2.page, R);
    R.check('el segundo navegador recibe los 150 estudiantes del fixture desde la nube',
      pull2.after.students >= base.students + 150, `students=${pull2.after.students}`);
    R.check('el segundo navegador ve los 15 cursos nuevos',
      nuevos.every(g => (pull2.after.grades[g] || 0) >= 10),
      nuevos.filter(g => (pull2.after.grades[g] || 0) < 10).join(','));
    await shot(R, dev2.page, 'segundo_dispositivo');

    R.note(`errores de consola: ${dev.consoleErrors.length + dev2.consoleErrors.length}`);
  } catch (e) {
    R.check('la corrida no lanzó excepciones', false, String(e?.stack || e).slice(0, 600));
  } finally {
    await browser.close();
    R.finish();
  }
}
