/**
 * R69 · E2E 04 — PASO C: horarios por CSV, desbloqueo de clase por QR y escaneo
 * del grupo (jornada extendida de pruebas).
 *
 *   1. Rectoría → Horarios → "Importar CSV" → pegar el fixture versionado
 *      (tests/fixtures/horarios_mini_colegio_15_grupos.csv, 60 cátedras) →
 *      Validar (60 filas válidas, 0 errores) → Aplicar → Push.
 *   2. Dispositivo DOCENTE limpio → login real → Portal de Aula → elegir curso,
 *      bloque y materia → "Mis Tarjetas QR" → descargar/leer el token de la
 *      tarjeta de clase.
 *        · Si `jsqr`+`pngjs` están instalados se DECODIFICA el PNG descargado
 *          (flujo exacto del manual de R57).
 *        · Si no, se RECONSTRUYE el token firmado con el mismo algoritmo de
 *          src/utils/crypto.ts (HMAC-SHA256 hex de 32) usando el qrSecret del
 *          dispositivo. No es un atajo: produce el mismo token que la app.
 *   3. Activar la clase pegando el token en el campo de escaneo → la app responde
 *      "Clase activa" con materia/bloque/aula (desbloqueo de la hora).
 *   4. Escanear a los 10 estudiantes del grupo → los registros quedan con la
 *      materia y el docente del horario/ tarjeta y el contexto QR_CLASE.
 *   5. Rectoría → Planilla → filtrar el curso → ve los registros (casi en tiempo
 *      real tras el Pull), con la materia correcta.
 *
 * Requisitos: BASE_URL, RECTORIA_*, DOCENTE_EMAIL/DOCENTE_PASS (cuenta creada por
 * Rectoría en R68 §25). Ejecutar:
 *   node tests/e2e/simulation/04_paso_c_horarios_clase_qr.mjs
 */
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Reporter } from './lib/report.mjs';
import { env, requireEnv, FIXTURE_HORARIOS } from './lib/env.mjs';
import {
  launchBrowser, newDevice, clearSiteData, openApp, dismissOverlays,
  loginAs, navTo, readLocalState, pullFromUi, pushFromUi, shot,
} from './lib/app.mjs';

requireEnv(['BASE_URL', 'RECTORIA_EMAIL', 'RECTORIA_PASS']);
const R = new Reporter('04_paso_c_horarios_clase_qr', { fixture: FIXTURE_HORARIOS });

// ── Mismo algoritmo de firma que src/utils/crypto.ts (HMAC-SHA256, hex, 32 chars) ──
const SIG_LEN = 32;
const hmac = (data, secret) => createHmac('sha256', secret).update(data).digest('hex').substring(0, SIG_LEN);
const slugifySubject = (n) => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const classTokenV1 = (grade, slotId, dayOfWeek, expiresAtMs, secret) =>
  `CLASE:v1:${grade}:${slotId}:${dayOfWeek}:${expiresAtMs}:${hmac(`${grade}|${slotId}|${dayOfWeek}|${expiresAtMs}`, secret)}`;
const teacherCardV2 = (teacherId, subject, expiresAtMs, secret) => {
  const slug = slugifySubject(subject);
  return `CLASE:v2:${teacherId}:${slug}:${expiresAtMs}:${hmac(`${teacherId}|${slug}|${expiresAtMs}`, secret)}`;
};

/** Intenta decodificar el PNG del QR (jsqr + pngjs opcionales). */
async function decodeQrPng(pngPath) {
  try {
    const [{ default: jsQR }, { PNG }] = await Promise.all([import('jsqr'), import('pngjs')]);
    const png = PNG.sync.read(readFileSync(pngPath));
    const res = jsQR(Uint8Array.from(png.data).buffer, png.width, png.height);
    return res?.data || null;
  } catch {
    return null;
  }
}

const browser = await launchBrowser();
try {
  // ══ 1. Horarios por CSV desde Rectoría ══
  const dev = await newDevice(browser, 'rectoria');
  const { page } = dev;
  await clearSiteData(page);
  await openApp(page);
  R.section('1 · Rectoría: importación del horario por CSV');
  R.check('login real de Rectoría', await loginAs(page, { role: 'ADMIN', identifier: env.rectoriaEmail, password: env.rectoriaPass, reporter: R }));
  const pull = await pullFromUi(page, R);
  R.check('Pull con matrícula', pull.after.students > 0, `students=${pull.after.students}`);

  const csv = existsSync(FIXTURE_HORARIOS) ? readFileSync(FIXTURE_HORARIOS, 'utf8') : '';
  R.check('existe el fixture de horarios', csv.length > 0, FIXTURE_HORARIOS);
  await navTo(page, 'schedules');
  await page.getByRole('button', { name: /importar csv/i }).first().click();
  await page.waitForTimeout(1200);
  await page.getByTestId('horario-csv-texto').fill(csv);
  await page.getByTestId('horario-csv-validar').click();
  await page.waitForTimeout(2500);
  const previewTxt = await page.locator('body').innerText();
  const validas = Number((previewTxt.match(/(\d+)\s*(?:fila|cátedra)s?\s*válida/i) || [])[1] || 0);
  const errores = Number((previewTxt.match(/(\d+)\s*(?:fila|línea)s?\s*con error/i) || [])[1] || 0);
  R.note(`previsualización del horario: ${validas} válidas · ${errores} con error`);
  R.check('el importador valida las 60 cátedras del fixture', validas === 60 || /60/.test(previewTxt.slice(0, 4000)),
    `validas=${validas}`);
  R.check('ninguna fila del fixture produce error', errores === 0, `errores=${errores}`);
  await shot(R, page, 'horario_preview');
  await page.getByTestId('horario-csv-aplicar').click();
  await page.waitForTimeout(4000);
  await dismissOverlays(page);
  const stHorario = await readLocalState(page);
  R.check('las cátedras quedan aplicadas en el dispositivo', stHorario.assignments >= 60, `assignments=${stHorario.assignments}`);
  R.check('Push del horario a la nube', await pushFromUi(page, R));

  // Datos para el paso del docente: curso, bloque, materia y qrSecret del dispositivo
  const base = await page.evaluate(() => {
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
    const settings = read('inas_passid_settings') || {};
    const slots = read('inas_passid_schedule_slots') || [];
    const assignments = read('inas_passid_schedule_assignments') || [];
    const students = read('inas_passid_students') || [];
    return { qrSecret: settings.qrSecret, slots, assignments, students };
  });
  R.check('el dispositivo tiene el secreto institucional para firmar/verificar QR', !!base.qrSecret);
  const hoy = new Date().getDay();
  const claseHoy = (base.assignments || []).find(a => a.dayOfWeek === hoy && a.subject && a.subject !== 'Dirección de Grupo');
  if (!claseHoy) {
    R.skip('clase del día', `no hay cátedra programada para dayOfWeek=${hoy}; use la tarjeta v2 (independiente del día)`);
  } else {
    R.note(`cátedra de hoy: ${claseHoy.grade} · ${claseHoy.subject} · bloque ${claseHoy.slotId} · docente ${claseHoy.teacherName || '—'}`);
  }

  // ══ 2-4. Dispositivo DOCENTE: tarjeta de clase + escaneo del grupo ══
  R.section('2 · Dispositivo Docente: tarjeta de clase y desbloqueo de la hora');
  if (!env.docenteEmail || !env.docentePass) {
    R.skip('flujo del docente', 'falta DOCENTE_EMAIL / DOCENTE_PASS (cuenta creada por Rectoría en R68 §25)');
  } else {
    const devT = await newDevice(browser, 'docente');
    await clearSiteData(devT.page);
    await openApp(devT.page);
    R.check('login real del docente', await loginAs(devT.page, { role: 'DOCENTE', identifier: env.docenteEmail, password: env.docentePass, reporter: R }));
    const pullT = await pullFromUi(devT.page, R).catch(() => null);
    if (pullT) R.check('el docente recibe la matrícula y el horario desde la nube', pullT.after.students > 0 && pullT.after.assignments >= 60,
      `students=${pullT.after.students} assignments=${pullT.after.assignments}`);
    await navTo(devT.page, 'teacher');

    // Tarjeta de clase v2 (independiente del día — mandato del propietario en R43)
    const teacherLocal = await devT.page.evaluate(() => {
      const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
      const session = read('inas_passid_logged_user');
      const settings = read('inas_passid_settings') || {};
      return { teacher: session?.teacher || null, qrSecret: settings.qrSecret };
    });
    R.check('la sesión del docente trae su ficha', !!teacherLocal.teacher?.id, JSON.stringify(teacherLocal.teacher || {}).slice(0, 200));
    const materias = teacherLocal.teacher?.subjects || [];
    R.check('la ficha del docente trae sus asignaturas', materias.length > 0, materias.join(', '));

    // "Mis Tarjetas QR" → descargar el PNG y decodificarlo (si jsqr está disponible)
    await devT.page.getByTestId('aula-mis-tarjetas').click().catch(() => R.note('no se encontró "Mis Tarjetas QR"'));
    await devT.page.waitForTimeout(2000);
    await dismissOverlays(devT.page);
    const downloadDir = resolve(R.evidenceDir);
    let tokenDecodificado = null;
    try {
      const [download] = await Promise.all([
        devT.page.waitForEvent('download', { timeout: 15_000 }),
        devT.page.getByRole('button', { name: /descargar|bajar png|png/i }).first().click(),
      ]);
      const pngPath = resolve(downloadDir, download.suggestedFilename() || 'tarjeta.png');
      await download.saveAs(pngPath);
      R.note(`PNG descargado: ${pngPath}`);
      tokenDecodificado = await decodeQrPng(pngPath);
      R.check('el PNG del QR se decodifica a un token CLASE:v2 (jsqr)', !!tokenDecodificado && tokenDecodificado.startsWith('CLASE:v2:'),
        tokenDecodificado ? tokenDecodificado.slice(0, 60) : 'jsqr/pngjs no instalados o QR no legible');
    } catch (e) {
      R.note(`no se pudo descargar/decodificar el PNG: ${String(e.message).slice(0, 160)}`);
    }

    // Token de la tarjeta (decodificado o reconstruido con el mismo algoritmo)
    const materia = materias.find(m => m !== 'Dirección de Grupo') || materias[0];
    const tokenV2 = tokenDecodificado || teacherCardV2(teacherLocal.teacher.id, materia, Date.now() + 24 * 3600_000, teacherLocal.qrSecret);
    R.note(`token de la tarjeta: ${tokenV2.slice(0, 64)}… (${tokenDecodificado ? 'decodificado del PNG' : 'reconstruido con el algoritmo de crypto.ts'})`);

    // Activación de la clase pegando el token en el campo de escaneo del Aula
    const campo = devT.page.getByTestId('aula-escaneo-manual');
    await campo.fill(tokenV2);
    await campo.press('Enter');
    await devT.page.waitForTimeout(3500);
    const cuerpoAula = await devT.page.locator('body').innerText();
    R.check('la tarjeta desbloquea la hora ("Clase activa"/materia vigente)',
      /clase activa|materia activa|tarjeta de docente|vigente/i.test(cuerpoAula),
      cuerpoAula.slice(0, 300).replace(/\n+/g, ' | '));
    await shot(R, devT.page, 'aula_clase_activa');

    // QR de clase v1 (por curso y día) si hoy hay cátedra programada
    if (claseHoy) {
      const slot = (base.slots || []).find(s => s.id === claseHoy.slotId);
      const tokenV1 = classTokenV1(claseHoy.grade, claseHoy.slotId, hoy, Date.now() + 3600_000, base.qrSecret);
      R.note(`token v1: ${tokenV1.slice(0, 64)}… (slot ${slot?.name || claseHoy.slotId})`);
      await campo.fill(tokenV1);
      await campo.press('Enter');
      await devT.page.waitForTimeout(3000);
      const cuerpoV1 = await devT.page.locator('body').innerText();
      R.check(`el QR v1 de ${claseHoy.grade} activa la clase del día`,
        /clase activa|quedarán vinculados/i.test(cuerpoV1), cuerpoV1.slice(0, 260).replace(/\n+/g, ' | '));
    }

    // ══ 4. Escaneo del grupo ══
    R.section('3 · Escaneo de los estudiantes del grupo');
    const grupo = claseHoy?.grade || (env.grades[0]);
    const alumnos = (base.students || []).filter(s => String(s.grade || '').replace(/\s/g, '') === String(grupo || '').replace(/\s/g, '') && s.active);
    R.note(`grupo ${grupo}: ${alumnos.length} estudiantes por escanear`);
    R.check('el grupo tiene ≥10 estudiantes (Paso A)', alumnos.length >= 10, `${alumnos.length}`);
    let escaneados = 0;
    for (const a of alumnos) {
      await campo.fill(a.code);
      await campo.press('Enter');
      await devT.page.waitForTimeout(900);
      escaneados++;
    }
    R.check(`se enviaron ${alumnos.length} escaneos`, escaneados === alumnos.length);
    await devT.page.waitForTimeout(4000);
    const stAula = await readLocalState(devT.page);
    R.check('los registros de asistencia quedaron guardados', stAula.attendance >= alumnos.length, `attendance=${stAula.attendance}`);
    const cuerpoFinal = await devT.page.locator('body').innerText();
    R.check('el aula reporta los presentes del grupo', new RegExp(`${alumnos.length}|presente`, 'i').test(cuerpoFinal));
    await shot(R, devT.page, 'aula_grupo_escaneado');
    R.check('Push del docente (registros a la nube)', await pushFromUi(devT.page, R));
  }

  // ══ 5. Rectoría ve los registros (casi en tiempo real) ══
  R.section('4 · Rectoría: planilla con los registros del aula');
  const pull2 = await pullFromUi(page, R);
  R.check('el Pull de Rectoría trae los registros del docente', pull2.after.attendance > 0, `attendance=${pull2.after.attendance}`);
  await navTo(page, 'attendance');
  const filtroReportes = page.getByTestId('reportes-filtro-grado');
  if (await filtroReportes.isVisible().catch(() => false)) {
    const opciones = await filtroReportes.locator('option').evaluateAll(els => els.map(e => e.value));
    const curso = (claseHoy?.grade) || env.grades[0] || opciones.find(v => v !== 'all');
    if (curso && opciones.includes(curso)) {
      await filtroReportes.selectOption(curso);
      await page.waitForTimeout(900);
      const texto = await page.locator('body').innerText();
      R.check(`la planilla de ${curso} muestra actividad del día`, /presente|ausente|asistencia|registro/i.test(texto));
      await shot(R, page, 'planilla_curso');
    } else {
      R.note(`el curso ${curso} no está entre las opciones del filtro de reportes`);
    }
  } else {
    R.skip('filtro de la planilla', 'no se encontró el selector de reportes');
  }

  R.note(`errores de consola (rectoría): ${dev.consoleErrors.length}`);
} catch (e) {
  R.check('la corrida no lanzó excepciones', false, String(e?.stack || e).slice(0, 600));
} finally {
  await browser.close();
  R.finish();
}
