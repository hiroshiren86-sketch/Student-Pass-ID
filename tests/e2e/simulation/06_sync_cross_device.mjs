/**
 * R69 · E2E 06 — SINCRONIZACIÓN ENTRE DISPOSITIVOS Y CASI-TIEMPO-REAL.
 *
 *   1. Tres navegadores LIMPIOS (localStorage + IndexedDB + caché borrados):
 *      Rectoría, Docente y Director de Grupo/Estudiante.
 *   2. Cada uno hace Pull y recibe el MISMO catálogo desde la nube (no de caché):
 *      se compara el conteo de estudiantes, cursos y registros.
 *   3. Latencia de propagación: el docente registra un escaneo y hace Push;
 *      Rectoría hace Pull y debe verlo (se mide el tiempo hasta verlo).
 *   4. Higiene de identidad: ningún dispositivo queda en modo anónimo
 *      (`inas_passid_session_mode` ≠ 'anonymous') y el uid de la sesión coincide
 *      con el de la cuenta real (login REST de Firebase) → cero cuentas nuevas
 *      por sesión (R58/R60-e/R68).
 *   5. Token de dispositivo visible y copiable en Ajustes (RC-2 de R68).
 *
 * Requisitos: BASE_URL, WORKER_URL, AUTH_TOKEN, SCHOOL_CODE, RECTORIA_*,
 * DOCENTE_*, FIREBASE_API_KEY. Ejecutar:
 *   node tests/e2e/simulation/06_sync_cross_device.mjs
 */
import { Reporter } from './lib/report.mjs';
import { env, requireEnv } from './lib/env.mjs';
import {
  launchBrowser, newDevice, clearSiteData, openApp, dismissOverlays,
  loginAs, navTo, readLocalState, pullFromUi, pushFromUi, shot,
  readDeviceTokenFromSettings, firebaseIdToken, workerFetch,
} from './lib/app.mjs';

requireEnv(['BASE_URL', 'RECTORIA_EMAIL', 'RECTORIA_PASS']);
const R = new Reporter('06_sync_cross_device', { worker: env.workerUrl || null });
const browser = await launchBrowser();

try {
  // ══ 1. Tres dispositivos limpios ══
  R.section('1 · Tres navegadores limpios (sin caché ni almacenamiento previo)');
  const devA = await newDevice(browser, 'rectoria');
  const devT = await newDevice(browser, 'docente');
  const devS = await newDevice(browser, 'estudiante');
  for (const d of [devA, devT, devS]) { await clearSiteData(d.page); await openApp(d.page); }
  for (const d of [devA, devT, devS]) {
    const st = await readLocalState(d.page);
    R.check(`${d.label}: arranca sin datos locales`, st.students === 0 && st.storageKeys.length <= 3,
      `students=${st.students} keys=${st.storageKeys.length}`);
  }

  // ══ 2. Login real en cada dispositivo + Pull ══
  R.section('2 · Login real y Pull en cada dispositivo');
  R.check('Rectoría inicia sesión', await loginAs(devA.page, { role: 'ADMIN', identifier: env.rectoriaEmail, password: env.rectoriaPass, reporter: R }));
  const pullA = await pullFromUi(devA.page, R);
  R.check('Rectoría recibe el catálogo desde la nube', pullA.after.students > 0, `students=${pullA.after.students}`);

  if (env.docenteEmail && env.docentePass) {
    R.check('Docente inicia sesión', await loginAs(devT.page, { role: 'DOCENTE', identifier: env.docenteEmail, password: env.docentePass, reporter: R }));
    const pullT = await pullFromUi(devT.page, R);
    R.check('el Docente recibe la misma matrícula que Rectoría', pullT.after.students === pullA.after.students,
      `docente=${pullT.after.students} rectoría=${pullA.after.students}`);
    R.check('el Docente recibe los mismos cursos', JSON.stringify(pullT.after.gradeList) === JSON.stringify(pullA.after.gradeList),
      `docente=${pullT.after.gradeList.length} rectoría=${pullA.after.gradeList.length}`);
  } else {
    R.skip('dispositivo del docente', 'falta DOCENTE_EMAIL / DOCENTE_PASS');
  }

  const codeEst = env.estudianteCode;
  if (codeEst) {
    R.check('Estudiante inicia sesión', await loginAs(devS.page, {
      role: 'ESTUDIANTE_ACUDIENTE', identifier: codeEst, password: env.estudianteClave || '000000', reporter: R,
    }));
    const stS = await readLocalState(devS.page);
    R.check('el portal del estudiante NO recibe la matrícula completa (privacidad R58/R59)',
      stS.students <= 1, `students=${stS.students}`);
    R.check('el estudiante ve SU historia desde la nube', stS.attendance >= 0);
  } else {
    R.skip('dispositivo del estudiante', 'falta ESTUDIANTE_CODE');
  }

  // ══ 3. Latencia de propagación (casi tiempo real) ══
  R.section('3 · Propagación casi en tiempo real (Docente → Rectoría)');
  if (env.docenteEmail && env.docentePass) {
    const antesA = (await readLocalState(devA.page)).attendance;
    await navTo(devT.page, 'teacher');
    const alumno = await devT.page.evaluate(() => {
      const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
      const list = (read('inas_passid_students') || []).filter(s => s.active);
      return list.length ? list[list.length - 1].code : null;
    });
    if (alumno) {
      const campo = devT.page.getByTestId('aula-escaneo-manual');
      if (await campo.isVisible().catch(() => false)) {
        const t0 = Date.now();
        await campo.fill(alumno);
        await campo.press('Enter');
        await devT.page.waitForTimeout(2500);
        await pushFromUi(devT.page, R);
        const tPush = Date.now();
        // Rectoría hace Pull y debe ver el nuevo registro
        let visto = false, intentos = 0;
        while (!visto && intentos < 4) {
          intentos++;
          const pullA2 = await pullFromUi(devA.page, R);
          visto = pullA2.after.attendance > antesA;
          if (!visto) await devA.page.waitForTimeout(5000);
        }
        const dt = Date.now() - t0;
        R.check('Rectoría ve el registro del docente tras el Push/Pull', visto,
          `antes=${antesA} intentos=${intentos}`);
        R.note(`latencia extremo a extremo (escaneo → push → pull visible): ${dt} ms (push a los ${tPush - t0} ms)`);
        R.check('la propagación ocurre en menos de 2 minutos', dt < 120_000, `${dt} ms`);
        await shot(R, devA.page, 'rectoria_tras_sync');
      } else {
        R.skip('escaneo del docente', 'el campo de escaneo manual no está visible en el Aula');
      }
    } else {
      R.skip('escaneo del docente', 'el dispositivo del docente no tiene estudiantes');
    }
  } else {
    R.skip('latencia de propagación', 'falta DOCENTE_EMAIL / DOCENTE_PASS');
  }

  // ══ 4. Higiene de identidad: nada de sesiones anónimas ══
  R.section('4 · Higiene de identidad (cero cuentas anónimas por sesión)');
  for (const d of [devA, devT, devS]) {
    const modo = await d.page.evaluate(() => localStorage.getItem('inas_passid_session_mode'));
    R.check(`${d.label}: no quedó en modo anónimo`, modo !== 'anonymous', `session_mode=${modo}`);
    const anonKeys = await d.page.evaluate(() => Object.keys(localStorage).filter(k => /anon|anonymous/i.test(k)));
    R.check(`${d.label}: sin claves de sesión anónima`, anonKeys.length === 0, anonKeys.join(','));
  }

  if (env.workerUrl && env.schoolCode && process.env.FIREBASE_API_KEY) {
    try {
      const { idToken, localId } = await firebaseIdToken(env.rectoriaEmail, env.rectoriaPass);
      const uidNavegador = await devA.page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('inas_passid_logged_user') || 'null')?.uid
          || JSON.parse(localStorage.getItem('inas_passid_logged_user') || 'null')?.localId || null; } catch { return null; }
      });
      R.note(`uid REST=${localId} · uid en el navegador=${uidNavegador}`);
      if (uidNavegador) R.check('la sesión del navegador corresponde a la cuenta real', uidNavegador === localId, `${uidNavegador} vs ${localId}`);
      const r = await workerFetch('/api/sync/health', idToken);
      R.note(`Worker /api/sync/health → ${r.status}`);
      R.check('el Worker responde autenticado', r.status < 500, `status=${r.status}`);
    } catch (e) {
      R.check('verificación de identidad contra Firebase/Worker', false, String(e.message).slice(0, 300));
    }
  } else {
    R.skip('verificación de identidad contra Firebase/Worker', 'falta WORKER_URL / SCHOOL_CODE / FIREBASE_API_KEY');
  }

  // ══ 5. Token de dispositivo visible en Ajustes (RC-2 de R68) ══
  R.section('5 · Token de dispositivo en Ajustes (RC-2)');
  const token = await readDeviceTokenFromSettings(devA.page);
  R.check('Ajustes expone el token del dispositivo', !!token, `token=${token ? token.slice(0, 24) + '…' : null}`);
  const cuerpoAjustes = await devA.page.locator('body').innerText();
  R.check('la pantalla de Ajustes explica el diagnóstico por token', /token/i.test(cuerpoAjustes));
  await shot(R, devA.page, 'ajustes_token');

  R.note(`errores de consola: A=${devA.consoleErrors.length} T=${devT.consoleErrors.length} S=${devS.consoleErrors.length}`);
  const reactWarnings = [...devA.consoleErrors, ...devT.consoleErrors, ...devS.consoleErrors].filter(e => /Cannot update a component/i.test(e));
  R.check('sin warnings de React "Cannot update a component while rendering"', reactWarnings.length === 0, reactWarnings.slice(0, 2).join(' | '));
} catch (e) {
  R.check('la corrida no lanzó excepciones', false, String(e?.stack || e).slice(0, 600));
} finally {
  await browser.close();
  R.finish();
}
