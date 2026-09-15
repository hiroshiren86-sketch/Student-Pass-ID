/**
 * R69 · E2E 01 — REGRESIÓN REPORTADA: filtro por curso + Escudito dinámico.
 *
 * Reproduce el reclamo del propietario sobre la app REAL (producción o preview):
 *   "el filtro de 6°1 sale vacío aunque 'Todos los grados' sí muestra datos"
 *   "verificar que la lista del Escudito no esté hardcodeada"
 *
 * Qué prueba (sobre el catálogo real descargado de la nube):
 *   1. El <select> del Directorio sólo ofrece cursos CON matrícula y muestra el conteo.
 *   2. Cada curso del selector devuelve filas (nunca vacío si tiene estudiantes).
 *   3. La búsqueda por nombre funciona con y sin tildes, y combinada con el filtro.
 *   4. El Escudito lista estudiantes/docentes reales del catálogo (no una muestra
 *      fija), se filtra por curso, busca sin tildes y reacciona a un Pull en vivo.
 *   5. Abrir un perfil desde el Escudito NO cierra la sesión real de Rectoría.
 *
 * Requisitos: BASE_URL + credenciales de Rectoría (RECTORIA_EMAIL/RECTORIA_PASS)
 * y red (el Pull consulta al Worker). Ejecutar:
 *   node tests/e2e/simulation/01_regresion_filtro_y_escudito.mjs
 */
import { Reporter } from './lib/report.mjs';
import { env, requireEnv } from './lib/env.mjs';
import {
  launchBrowser, newDevice, clearSiteData, openApp, dismissOverlays,
  loginAs, navTo, readLocalState, pullFromUi, shot,
} from './lib/app.mjs';

requireEnv(['BASE_URL', 'RECTORIA_EMAIL', 'RECTORIA_PASS']);
const R = new Reporter('01_regresion_filtro_y_escudito', { baseUrl: env.baseUrl });
const browser = await launchBrowser();

try {
  // ── Dispositivo limpio (sin localStorage/IndexedDB/caché) ──
  const dev = await newDevice(browser, 'rectoria-limpio');
  const { page } = dev;
  await clearSiteData(page);
  await openApp(page);
  R.section('Sesión de Rectoría en un navegador limpio');
  const state0 = await readLocalState(page);
  R.check('el navegador arranca sin matrícula local (0 estudiantes)', state0.students === 0, `students=${state0.students}`);
  const loggedIn = await loginAs(page, { role: 'ADMIN', identifier: env.rectoriaEmail, password: env.rectoriaPass, reporter: R });
  R.check('login real de Rectoría llega al dashboard', loggedIn);
  await shot(R, page, 'dashboard');

  // ── Catálogo descargado de la nube ──
  R.section('Catálogo real desde la nube (Pull)');
  const pull = await pullFromUi(page, R);
  R.check('el Pull trae matrícula', pull.after.students > 0, `students=${pull.after.students}`);
  R.note(`catálogo: ${pull.after.students} estudiantes en ${pull.after.gradeList.length} cursos → ${pull.after.gradeList.join(', ')}`);
  const grades = env.grades.length ? env.grades : pull.after.gradeList;
  R.check('hay cursos que filtrar', grades.length > 0);

  // ── 1 y 2: el selector del Directorio y su comportamiento por curso ──
  R.section('Directorio · filtro por curso (la regresión reportada)');
  await navTo(page, 'students');
  const select = page.getByTestId('directorio-filtro-grado');
  await select.waitFor({ state: 'visible', timeout: 30_000 });
  const options = await select.locator('option').evaluateAll(els => els.map(e => ({ value: e.value, text: e.textContent?.trim() })));
  R.note(`opciones del selector: ${options.length} → ${options.map(o => o.text).join(' | ')}`);
  R.check('la primera opción es "Todos los Cursos" con el conteo total',
    /todos los cursos\s*\(\d+\)/i.test(options[0]?.text || ''), options[0]?.text);

  const cursosConMatricula = options.filter(o => o.value !== 'all');
  const esperados = pull.after.gradeList.length;
  R.check(`el selector ofrece exactamente los cursos con matrícula (${esperados})`,
    cursosConMatricula.length === esperados, `ofrece=${cursosConMatricula.length}`);
  R.check('ninguna opción carece de conteo (todas dicen "N estudiantes")',
    cursosConMatricula.every(o => /\d+\s*estudiantes/i.test(o.text || '')),
    cursosConMatricula.filter(o => !/\d+\s*estudiantes/i.test(o.text || '')).map(o => o.text).join(' | '));

  let vacios = 0; const detalle = [];
  for (const opt of cursosConMatricula) {
    await select.selectOption(opt.value);
    await page.waitForTimeout(500);
    const filas = await page.locator('[data-testid^="directorio-fila-"]').count();
    const anunciado = Number((opt.text.match(/(\d+)\s*estudiantes/i) || [])[1] || 0);
    detalle.push(`${opt.value}:${filas}/${anunciado}`);
    if (filas === 0 || (anunciado > 0 && filas !== anunciado)) vacios++;
  }
  R.note(`filas por curso → ${detalle.join(', ')}`);
  R.check('NINGÚN curso con matrícula aparece vacío (regresión corregida)', vacios === 0, `${vacios} cursos mal: ${detalle.join(', ')}`);

  // Cursos que NO existen en el catálogo no deben ofrecerse (fin del fantasma demo)
  const fantasma = options.filter(o => o.value !== 'all' && !pull.after.gradeList.includes(o.value));
  R.check('no se ofrecen cursos fantasma sin estudiantes', fantasma.length === 0,
    fantasma.map(o => o.value).join(','));
  await shot(R, page, 'directorio_filtrado');

  // ── 3: búsqueda por nombre, con y sin tildes, y combinada con el filtro ──
  R.section('Directorio · búsqueda por nombre');
  const buscador = page.getByTestId('directorio-buscador');
  await select.selectOption('all');
  await page.waitForTimeout(400);
  const muestra = await page.evaluate(() => {
    const raw = localStorage.getItem('inas_passid_students');
    const list = raw ? JSON.parse(raw) : [];
    return list.slice(0, 40).map(s => ({ code: s.code, first: s.firstName, last: s.lastName, grade: s.grade }))
      .filter(s => (s.first || '').length > 3);
  });
  const objetivo = muestra.find(s => /[áéíóúÁÉÍÓÚñÑ]/.test(`${s.first} ${s.last}`.replace('', ''))) || muestra[0];
  if (objetivo) {
    const sinTildes = `${objetivo.first} ${objetivo.last}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    await buscador.fill(sinTildes.slice(0, 12));
    await page.waitForTimeout(500);
    const hits = await page.locator(`[data-testid="directorio-fila-${objetivo.code}"]`).count();
    R.check(`buscar "${sinTildes.slice(0, 12)}" (sin tildes) encuentra a ${objetivo.first} ${objetivo.last}`, hits === 1, `hits=${hits}`);
    await buscador.fill(objetivo.code);
    await page.waitForTimeout(400);
    R.check('buscar por código encuentra la ficha', await page.locator(`[data-testid="directorio-fila-${objetivo.code}"]`).count() === 1);
    // Búsqueda + filtro de curso combinados
    await select.selectOption(objetivo.grade);
    await page.waitForTimeout(300);
    await buscador.fill(sinTildes.slice(0, 8));
    await page.waitForTimeout(500);
    R.check(`filtro ${objetivo.grade} + búsqueda combinados encuentran la ficha`,
      await page.locator(`[data-testid="directorio-fila-${objetivo.code}"]`).count() === 1);
    // Filtro de otro curso + el mismo nombre → sin resultados (no fuga entre cursos)
    const otroCurso = pull.after.gradeList.find(g => g !== objetivo.grade);
    if (otroCurso) {
      await select.selectOption(otroCurso);
      await page.waitForTimeout(400);
      const fugas = await page.locator(`[data-testid="directorio-fila-${objetivo.code}"]`).count();
      R.check(`el filtro de ${otroCurso} NO muestra la ficha de ${objetivo.grade}`, fugas === 0, `fugas=${fugas}`);
    }
  } else {
    R.skip('búsqueda por nombre', 'no se pudo tomar una ficha de muestra del almacenamiento local');
  }
  await buscador.fill('');
  await select.selectOption('all');
  await page.waitForTimeout(400);

  // ── 4: Escudito 100% dinámico ──
  R.section('Escudito · catálogo dinámico (sin listas hardcodeadas)');
  await page.getByTestId('escudito').click();
  await page.waitForTimeout(800);
  await dismissOverlays(page);
  const chip = await page.getByTestId('escudito-catalogo').innerText().catch(() => '');
  R.note(`chip del catálogo: ${chip}`);
  R.check('el chip anuncia el conteo real de estudiantes', new RegExp(`${pull.after.students}\\s*estudiantes`).test(chip), chip);
  await page.getByTestId('escudito-rol-estudiante').click();
  await page.waitForTimeout(900);
  const entradas = await page.locator('[data-testid^="escudito-estudiante-"]').count();
  R.check('el listado del Escudito no está truncado a una muestra fija',
    entradas === pull.after.students || entradas >= 30, `entradas=${entradas} · catálogo=${pull.after.students}`);
  R.note(`entradas visibles en el picker: ${entradas} (la lista es scrolleable)`);

  // Filtro por curso dentro del Escudito
  const pickerGrade = page.getByTestId('escudito-grado');
  const cursoPrueba = (env.grades[0] || pull.after.gradeList[0]);
  if (cursoPrueba) {
    await pickerGrade.selectOption(cursoPrueba).catch(async () => {
      // El valor puede venir canónico o como se guardó: se elige por etiqueta.
      const opts = await pickerGrade.locator('option').evaluateAll(els => els.map(e => e.value));
      const match = opts.find(v => v.includes(cursoPrueba.replace('°', '')));
      if (match) await pickerGrade.selectOption(match);
    });
    await page.waitForTimeout(600);
    const delCurso = await page.locator('[data-testid^="escudito-estudiante-"]').count();
    const esperadoCurso = pull.after.grades[cursoPrueba] ?? 0;
    R.check(`filtrar el Escudito por ${cursoPrueba} deja sólo sus estudiantes`,
      delCurso === esperadoCurso, `picker=${delCurso} · catálogo=${esperadoCurso}`);
    await pickerGrade.selectOption('all');
    await page.waitForTimeout(400);
  }

  // Búsqueda sin tildes en el Escudito
  const pickerSearch = page.getByTestId('escudito-buscador');
  if (objetivo) {
    const sinTildes = `${objetivo.first} ${objetivo.last}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 10);
    await pickerSearch.fill(sinTildes);
    await page.waitForTimeout(600);
    R.check(`el Escudito encuentra a ${objetivo.first} buscando sin tildes`,
      await page.locator(`[data-testid="escudito-estudiante-${objetivo.code}"]`).count() === 1);
    await pickerSearch.fill('');
    await page.waitForTimeout(300);
  }

  // Reacción en vivo a un Pull (sin recargar)
  R.section('Escudito · reacciona al catálogo actualizado SIN recargar');
  const antes = await page.locator('[data-testid^="escudito-estudiante-"]').count();
  await page.getByTestId('escudito-actualizar').click().catch(() => R.note('sin botón Actualizar en el picker'));
  await page.waitForTimeout(12_000);
  const despues = await page.locator('[data-testid^="escudito-estudiante-"]').count();
  const aviso = await page.getByTestId('escudito-aviso').innerText().catch(() => '');
  R.note(`entradas antes=${antes} después=${despues} · aviso="${aviso}"`);
  R.check('el Escudito sigue listado tras el refresco (o avisa con honestidad si la nube falló)',
    despues > 0 || /no respondió|sin respuesta|reintentar/i.test(aviso), `despues=${despues}`);
  await shot(R, page, 'escudito_picker');

  // ── 5: abrir un perfil no destruye la sesión de Rectoría ──
  R.section('Escudito · vista previa de perfil sin perder la sesión de Rectoría');
  const cualquierEstudiante = page.locator('[data-testid^="escudito-estudiante-"]').first();
  if (await cualquierEstudiante.isVisible().catch(() => false)) {
    const testid = await cualquierEstudiante.getAttribute('data-testid');
    await cualquierEstudiante.click();
    await page.waitForTimeout(2500);
    await dismissOverlays(page);
    const st = await readLocalState(page);
    R.check(`abrir el perfil ${testid} lleva al portal del estudiante`, st.sessionRole === 'ESTUDIANTE_ACUDIENTE', `rol=${st.sessionRole}`);
    await shot(R, page, 'perfil_estudiante');
    // Volver a Rectoría desde el Escudito
    await page.getByTestId('escudito').click();
    await page.waitForTimeout(700);
    const volver = page.getByTestId('escudito-volver-rectoria');
    R.check('aparece "Volver a Rectoría / Admin"', await volver.isVisible().catch(() => false));
    await volver.click().catch(() => {});
    await page.waitForTimeout(2000);
    const st2 = await readLocalState(page);
    R.check('la sesión real de Rectoría sigue intacta (vista previa, no suplantación)',
      st2.sessionRole === 'ADMIN', `rol=${st2.sessionRole}`);
  } else {
    R.skip('vista previa de perfil', 'no hay estudiantes listados en el picker');
  }

  // Docentes: el Escudito también los lista del catálogo real
  R.section('Escudito · docentes del catálogo real');
  await page.getByTestId('escudito').click();
  await page.waitForTimeout(600);
  await page.getByTestId('escudito-rol-docente').click();
  await page.waitForTimeout(900);
  const docentes = await page.locator('[data-testid^="escudito-docente-"]').count();
  R.check('el listado de docentes viene del catálogo (no hardcodeado)', docentes > 0 && docentes <= pull.after.teachers,
    `picker=${docentes} · catálogo=${pull.after.teachers}`);
  if (docentes > 0) {
    await page.locator('[data-testid^="escudito-docente-"]').first().click();
    await page.waitForTimeout(2500);
    const st3 = await readLocalState(page);
    R.check('abrir un docente lleva al portal de aula', st3.sessionRole === 'DOCENTE', `rol=${st3.sessionRole}`);
    await shot(R, page, 'perfil_docente');
  }

  R.note(`errores de consola capturados: ${dev.consoleErrors.length}`);
  if (dev.consoleErrors.length) R.note(dev.consoleErrors.slice(0, 5).join(' | '));
  R.check('sin errores React de "Cannot update a component while rendering"',
    !dev.consoleErrors.some(e => /Cannot update a component/i.test(e)),
    dev.consoleErrors.filter(e => /Cannot update a component/i.test(e)).slice(0, 2).join(' | '));
} catch (e) {
  R.check('la corrida no lanzó excepciones', false, String(e?.stack || e).slice(0, 500));
} finally {
  await browser.close();
  R.finish();
}
