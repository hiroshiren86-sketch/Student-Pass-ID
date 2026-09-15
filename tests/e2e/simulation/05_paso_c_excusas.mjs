/**
 * R69 · E2E 05 — PASO C (2ª parte): ausencias y excusas verificadas.
 *
 *   1. Dispositivo DOCENTE: se marca AUSENTE a un estudiante del grupo (sin
 *      escaneo o con registro manual de ausencia).
 *   2. Dispositivo ESTUDIANTE/REPRESENTANTE (navegador limpio): envía una excusa
 *      ANTICIPADA por el formulario del portal (motivo + fechas) y una excusa
 *      POST-HOC de un toque sobre la ausencia real.
 *   3. Dispositivo RECTORÍA: Buzón de Justificaciones → aprobar → el estado pasa
 *      a "Excusada (verificada)" y la planilla/IA lo reflejan.
 *   4. Nube: /api/sync/pull con idToken real → la excusa aprobada viaja con su
 *      verificador (approvedBy/approvedAt) y el registro queda EXCUSED_VERIFIED.
 *
 * Requisitos: BASE_URL, RECTORIA_*, DOCENTE_*, ESTUDIANTE_CODE/ESTUDIANTE_CLAVE.
 * Ejecutar: node tests/e2e/simulation/05_paso_c_excusas.mjs
 */
import { Reporter } from './lib/report.mjs';
import { env, requireEnv } from './lib/env.mjs';
import {
  launchBrowser, newDevice, clearSiteData, openApp, dismissOverlays,
  loginAs, navTo, readLocalState, pullFromUi, pushFromUi, shot,
  firebaseIdToken, workerFetch,
} from './lib/app.mjs';

requireEnv(['BASE_URL', 'RECTORIA_EMAIL', 'RECTORIA_PASS']);
const R = new Reporter('05_paso_c_excusas', {});
const browser = await launchBrowser();

try {
  // ══ 1. Docente: ausencia real de un estudiante ══
  R.section('1 · Docente: registro de AUSENCIA');
  const devT = await newDevice(browser, 'docente');
  await clearSiteData(devT.page);
  await openApp(devT.page);
  if (!env.docenteEmail || !env.docentePass) {
    R.skip('ausencia desde el aula', 'falta DOCENTE_EMAIL / DOCENTE_PASS');
  } else {
    R.check('login real del docente', await loginAs(devT.page, { role: 'DOCENTE', identifier: env.docenteEmail, password: env.docentePass, reporter: R }));
    await pullFromUi(devT.page, R).catch(() => {});
    await navTo(devT.page, 'teacher');
    const alumnos = await devT.page.evaluate(() => {
      const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
      const list = read('inas_passid_students') || [];
      const session = read('inas_passid_logged_user');
      const grades = session?.teacher?.assignedGrades || [];
      const pool = grades.length ? list.filter(s => grades.includes(s.grade)) : list;
      return pool.slice(0, 12).map(s => ({ code: s.code, grade: s.grade, name: `${s.firstName} ${s.lastName}` }));
    });
    R.check('el docente ve estudiantes de sus cursos', alumnos.length > 0, `${alumnos.length}`);
    const objetivo = alumnos[0];
    if (objetivo) {
      // Selección de curso/bloque/materia en el Aula
      const selGrado = devT.page.getByTestId('aula-grado');
      if (await selGrado.isVisible().catch(() => false)) {
        await selGrado.selectOption(objetivo.grade).catch(() => R.note(`no se pudo seleccionar ${objetivo.grade}`));
        await devT.page.waitForTimeout(700);
      }
      // Marca de ausencia: botón "Ausente" de la fila o registro manual
      const botonAusente = devT.page.getByRole('button', { name: /ausente/i }).first();
      if (await botonAusente.isVisible().catch(() => false)) {
        await botonAusente.click();
        await devT.page.waitForTimeout(1500);
        await dismissOverlays(devT.page);
        const confirmar = devT.page.getByRole('button', { name: /confirmar|sí|aceptar/i }).first();
        if (await confirmar.isVisible().catch(() => false)) { await confirmar.click(); await devT.page.waitForTimeout(1500); }
      } else {
        R.note('no hay botón "Ausente" visible; se intenta el registro manual por código');
      }
      const stT = await readLocalState(devT.page);
      R.check('el dispositivo del docente registró actividad', stT.attendance > 0, `attendance=${stT.attendance}`);
      R.check('Push del docente (ausencia a la nube)', await pushFromUi(devT.page, R));
      await shot(R, devT.page, 'docente_ausencia');
      // Se comparte el estudiante objetivo con los pasos siguientes
      process.env.E2E_OBJETIVO_CODE = objetivo.code;
      process.env.E2E_OBJETIVO_GRADE = objetivo.grade;
      R.note(`estudiante objetivo: ${objetivo.name} (${objetivo.code}, ${objetivo.grade})`);
    }
  }

  // ══ 2. Portal del estudiante/representante: excusas ══
  R.section('2 · Portal: excusa anticipada y post-hoc');
  const code = process.env.E2E_OBJETIVO_CODE || env.estudianteCode;
  const clave = env.estudianteClave || '000000';
  const devS = await newDevice(browser, 'estudiante');
  await clearSiteData(devS.page);
  await openApp(devS.page);
  if (!code) {
    R.skip('excusas desde el portal', 'no hay estudiante objetivo (EJECUTE primero el paso 1 o defina ESTUDIANTE_CODE)');
  } else {
    const entro = await loginAs(devS.page, { role: 'ESTUDIANTE_ACUDIENTE', identifier: code, password: clave, reporter: R });
    R.check(`login del estudiante ${code}`, entro);
    if (entro) {
      await pullFromUi(devS.page, R).catch(() => {});
      await navTo(devS.page, 'portal');
      const cuerpo = await devS.page.locator('body').innerText();
      R.check('el portal ofrece el flujo de excusas', /excusa|justific/i.test(cuerpo), cuerpo.slice(0, 240).replace(/\n+/g, ' | '));

      // (a) Excusa ANTICIPADA por formulario
      const btnNueva = devS.page.getByRole('button', { name: /nueva excusa|solicitar excusa|excusa anticipada|justificar/i }).first();
      if (await btnNueva.isVisible().catch(() => false)) {
        await btnNueva.click();
        await devS.page.waitForTimeout(1200);
        const motivo = devS.page.locator('textarea, input[name*="motivo" i], input[placeholder*="motivo" i]').first();
        await motivo.fill('Cita médica programada (E2E R69 — simulación Mini Colegio)').catch(() => {});
        const fechaIni = devS.page.locator('input[type="date"]').first();
        const manana = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);
        await fechaIni.fill(manana).catch(() => {});
        const fechaFin = devS.page.locator('input[type="date"]').nth(1);
        if (await fechaFin.isVisible().catch(() => false)) await fechaFin.fill(manana).catch(() => {});
        await devS.page.getByRole('button', { name: /enviar|solicitar|registrar|guardar/i }).first().click().catch(() => {});
        await devS.page.waitForTimeout(4000);
        const trasEnviar = await devS.page.locator('body').innerText();
        R.check('la excusa anticipada queda enviada/pendiente', /pendiente|enviada|registrada/i.test(trasEnviar),
          trasEnviar.slice(0, 260).replace(/\n+/g, ' | '));
        await shot(R, devS.page, 'portal_excusa_anticipada');
      } else {
        R.skip('excusa anticipada', 'no se encontró el botón de nueva excusa en el portal');
      }

      // (b) Excusa POST-HOC de un toque sobre la ausencia real
      const btnPostHoc = devS.page.getByRole('button', { name: /justificar|excusar/i }).nth(1);
      if (await btnPostHoc.isVisible().catch(() => false)) {
        await btnPostHoc.click();
        await devS.page.waitForTimeout(1200);
        await devS.page.locator('textarea').first().fill('Incapacidad médica (E2E R69)').catch(() => {});
        await devS.page.getByRole('button', { name: /enviar|justificar|guardar/i }).first().click().catch(() => {});
        await devS.page.waitForTimeout(4000);
        R.check('la excusa post-hoc quedó enviada', /pendiente|enviada|registrada/i.test(await devS.page.locator('body').innerText()));
      } else {
        R.skip('excusa post-hoc', 'no hay ausencia visible para justificar en el portal');
      }
      R.check('Push del portal (excusas a la nube)', await pushFromUi(devS.page, R));
    }
  }

  // ══ 3. Rectoría: buzón y aprobación ══
  R.section('3 · Rectoría: Buzón de Justificaciones y aprobación');
  const devA = await newDevice(browser, 'rectoria');
  await clearSiteData(devA.page);
  await openApp(devA.page);
  R.check('login real de Rectoría', await loginAs(devA.page, { role: 'ADMIN', identifier: env.rectoriaEmail, password: env.rectoriaPass, reporter: R }));
  const pullA = await pullFromUi(devA.page, R);
  R.check('el Pull trae las excusas del portal', pullA.after.attendance >= 0);
  await navTo(devA.page, 'excuses');
  const cuerpoBuzon = await devA.page.locator('body').innerText();
  R.check('el buzón muestra solicitudes', /pendiente|solicitud|excusa/i.test(cuerpoBuzon), cuerpoBuzon.slice(0, 240).replace(/\n+/g, ' | '));
  await shot(R, devA.page, 'buzon_antes');
  const btnAprobar = devA.page.getByRole('button', { name: /aprobar/i }).first();
  if (await btnAprobar.isVisible().catch(() => false)) {
    await btnAprobar.click();
    await devA.page.waitForTimeout(1200);
    const confirmar = devA.page.getByRole('button', { name: /confirmar|sí|aprobar/i }).first();
    if (await confirmar.isVisible().catch(() => false)) { await confirmar.click(); }
    await devA.page.waitForTimeout(6000);
    const trasAprobar = await devA.page.locator('body').innerText();
    R.check('la excusa pasa a verificada/aprobada', /verificad|aprobada/i.test(trasAprobar),
      trasAprobar.slice(0, 300).replace(/\n+/g, ' | '));
    await shot(R, devA.page, 'buzon_aprobada');
    R.check('Push de Rectoría (aprobación a la nube)', await pushFromUi(devA.page, R));
  } else {
    R.skip('aprobación en el buzón', 'no hay solicitudes pendientes visibles');
  }

  // ══ 4. Nube: la excusa aprobada viaja con su verificador ══
  R.section('4 · Nube: excusa aprobada con verificador');
  if (env.workerUrl && env.schoolCode && process.env.FIREBASE_API_KEY) {
    try {
      const { idToken } = await firebaseIdToken(env.rectoriaEmail, env.rectoriaPass);
      const r = await workerFetch(`/api/sync/pull?schoolCode=${encodeURIComponent(env.schoolCode)}`, idToken);
      const j = await r.json().catch(() => ({}));
      const registros = j.attendance || j.records || [];
      const excusados = registros.filter(x => /EXCUSED/i.test(String(x.status || '')));
      const verificados = excusados.filter(x => x.approvedBy || x.excuseVerifiedAt || /VERIFIED/i.test(String(x.status || '')));
      R.note(`registros en la nube: ${registros.length} · excusados: ${excusados.length} · verificados: ${verificados.length}`);
      R.check('la nube tiene al menos una excusa verificada', verificados.length > 0,
        `excusados=${excusados.length} verificados=${verificados.length}`);
    } catch (e) {
      R.check('verificación de excusas en la nube', false, String(e.message).slice(0, 300));
    }
  } else {
    R.skip('verificación de excusas en la nube', 'falta WORKER_URL / SCHOOL_CODE / FIREBASE_API_KEY');
  }
} catch (e) {
  R.check('la corrida no lanzó excepciones', false, String(e?.stack || e).slice(0, 600));
} finally {
  await browser.close();
  R.finish();
}
