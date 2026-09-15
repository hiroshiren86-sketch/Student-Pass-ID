/**
 * R69 · E2E "Mini Colegio" — utilidades de navegador.
 *
 * Convenciones (heredadas de las QA R54-R58 y exigidas por la directiva R69 §5):
 *  · Cada dispositivo = un `context` NUEVO de Playwright (perfil limpio: sin
 *    localStorage, sin IndexedDB, sin caché). Además `clearSiteData()` limpia
 *    explícitamente antes de cada login, para que nada se lea "de caché".
 *  · Los modales de primer inicio (tour de bienvenida, guía, aviso de
 *    notificaciones) se cierran en bucle con esperas > 180 ms: `FirstWelcomeTour`
 *    retrasa su `onClose` 180 ms, así que un solo clic deja el overlay vivo.
 *  · Los selectores usan `data-testid` estables añadidos en R69 (login, nav,
 *    directorio, escudito, horarios, aula, carga masiva).
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { env } from './env.mjs';

export const LS_KEYS = {
  students: 'inas_passid_students',
  teachers: 'inas_passid_teachers',
  settings: 'inas_passid_settings',
  attendance: 'inas_passid_attendance',
  assignments: 'inas_passid_schedule_assignments',
  slots: 'inas_passid_schedule_slots',
  session: 'inas_passid_logged_user',
  lastPullAt: 'inas_passid_lastPullAt',
  lastPushAt: 'inas_passid_lastPushAt',
  deviceToken: 'inas_passid_device_token',
};

export async function launchBrowser() {
  return chromium.launch({ headless: env.headless, slowMo: env.slowMo });
}

/** Contexto/dispositivo nuevo = almacenamiento limpio por construcción. */
export async function newDevice(browser, label = 'dispositivo') {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e?.message || e)));
  return { context, page, label, consoleErrors };
}

/** Limpieza explícita de localStorage + sessionStorage + IndexedDB + caches. */
export async function clearSiteData(page) {
  await page.evaluate(async () => {
    try { localStorage.clear(); } catch { /* noop */ }
    try { sessionStorage.clear(); } catch { /* noop */ }
    const dbs = await (indexedDB.databases ? indexedDB.databases() : Promise.resolve([]));
    await Promise.all((dbs || []).map(db => db.name && indexedDB.deleteDatabase(db.name)));
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  }).catch(() => { /* la página aún no cargó: el contexto nuevo ya está limpio */ });
}

export async function openApp(page) {
  await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await dismissOverlays(page);
}

/** Cierra en bucle los modales de primer inicio (tour, guía, avisos). */
export async function dismissOverlays(page, rounds = 8) {
  const closeSelectors = [
    '#btn-close-settings',
    '[data-testid="btn-close-settings"]',
    'button[aria-label="Cerrar"]',
    'button[aria-label="Cerrar guía"]',
    'button[aria-label="Cerrar tutorial"]',
    'button[aria-label="Cerrar tour de bienvenida"]',
    'button[aria-label="Cerrar aviso de privacidad"]',
    'button[aria-label="Cerrar modal de subida de documentos"]',
    'button[aria-label="Cerrar menú de navegación"]',
  ];
  for (let i = 0; i < rounds; i++) {
    let acted = false;
    for (const sel of closeSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click({ timeout: 3000 }).catch(() => {});
        acted = true;
        // El tour retrasa su onClose 180 ms: esperar más que eso antes de reintentar.
        await page.waitForTimeout(400);
      }
    }
    // Botones textuales de cierre del tour/guía (sin aria-label estable).
    for (const label of ['Finalizar', 'Omitir', 'Entendido', 'Cerrar', 'Saltar tour']) {
      const btn = page.getByRole('button', { name: new RegExp(`^${label}`, 'i') }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 2500 }).catch(() => {});
        acted = true;
        await page.waitForTimeout(400);
      }
    }
    if (!acted) break;
  }
  return page;
}

/** Login REAL por UI (el sistema no crea cuentas anónimas — R68 RC-3). */
export async function loginAs(page, { role, identifier, password, reporter }) {
  const roleTestid = { ADMIN: 'login-rol-ADMIN', DOCENTE: 'login-rol-DOCENTE', ESTUDIANTE_ACUDIENTE: 'login-rol-ESTUDIANTE_ACUDIENTE' }[role];
  if (!roleTestid) throw new Error(`rol desconocido: ${role}`);
  await dismissOverlays(page);
  await page.getByTestId(roleTestid).click();
  await page.waitForTimeout(250);
  await page.getByTestId('login-identificador').fill(identifier);
  await page.getByTestId('login-clave').fill(password);
  await page.getByTestId('login-submit').click();
  // Espera a que aparezca la navegación de la app (sesión iniciada) o un error visible.
  const ok = await page.getByTestId('nav-students').or(page.getByTestId('nav-teacher')).or(page.getByTestId('nav-portal'))
    .first().waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false);
  if (!ok) {
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
    reporter?.note(`login ${role} no llegó al dashboard; texto visible: ${body.replace(/\n+/g, ' | ')}`);
  }
  await dismissOverlays(page);
  return ok;
}

/** Navega a una vista por su testid (con fallback al menú móvil). */
export async function navTo(page, view) {
  const btn = page.getByTestId(`nav-${view}`);
  if (await btn.isVisible().catch(() => false)) { await btn.click(); }
  else {
    const burger = page.locator('button[aria-label*="menú" i], button[aria-label*="menu" i]').first();
    if (await burger.isVisible().catch(() => false)) { await burger.click(); await page.waitForTimeout(300); }
    await page.getByTestId(`nav-${view}`).click();
  }
  await page.waitForTimeout(700);
  await dismissOverlays(page);
}

/** Lee el estado persistido en el navegador (lo que el dispositivo ve de verdad). */
export async function readLocalState(page) {
  return page.evaluate((keys) => {
    const read = (k) => { try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch { return null; } };
    const students = read(keys.students) || [];
    const teachers = read(keys.teachers) || [];
    const settings = read(keys.settings) || {};
    const attendance = read(keys.attendance) || [];
    const assignments = read(keys.assignments) || [];
    const session = read(keys.session);
    const grades = {};
    for (const s of students) { const g = String(s?.grade ?? '').trim(); if (g) grades[g] = (grades[g] || 0) + 1; }
    return {
      students: students.length,
      teachers: teachers.length,
      attendance: attendance.length,
      assignments: assignments.length,
      grades,
      gradeList: Object.keys(grades).sort(),
      settings: {
        lastPushAt: settings.lastPushAt ?? null,
        lastPullAt: settings.lastPullAt ?? null,
        requireSignedCards: settings.requireSignedCards ?? null,
        defaultAccessPassword: settings.defaultAccessPassword ?? null,
      },
      sessionRole: session?.role ?? null,
      sessionEmail: session?.email ?? session?.teacher?.email ?? null,
      deviceToken: read(keys.deviceToken),
      storageKeys: Object.keys(localStorage).filter(k => k.startsWith('inas_passid_')),
    };
  }, LS_KEYS);
}

/** Fuerza un pull desde la UI (botón Sincronizar/Datos de Rectoría) y devuelve el resultado. */
export async function pullFromUi(page, reporter) {
  await navTo(page, 'settings');
  const before = await readLocalState(page);
  const btn = page.getByRole('button', { name: /pull|descargar datos|sincronizar/i }).first();
  if (!(await btn.isVisible().catch(() => false))) {
    reporter?.note('no se encontró el botón de Pull en Ajustes; se omite la acción');
    return { ok: false, before, after: before };
  }
  await btn.click();
  await page.waitForTimeout(12_000); // pull de la matrícula completa + docentes
  await dismissOverlays(page);
  const after = await readLocalState(page);
  return { ok: after.students >= before.students, before, after };
}

/** Fuerza un push desde la UI. */
export async function pushFromUi(page, reporter) {
  await navTo(page, 'settings');
  const btn = page.getByRole('button', { name: /push|subir datos|sincronizar/i }).first();
  if (!(await btn.isVisible().catch(() => false))) {
    reporter?.note('no se encontró el botón de Push en Ajustes');
    return false;
  }
  await btn.click();
  await page.waitForTimeout(15_000);
  await dismissOverlays(page);
  return true;
}

/** Copia el token de dispositivo desde Ajustes (RC-2 de R68) y lo devuelve. */
export async function readDeviceTokenFromSettings(page) {
  await navTo(page, 'settings');
  const btn = page.getByRole('button', { name: /copiar/i }).first();
  if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
  const st = await readLocalState(page);
  return st.deviceToken || null;
}

export async function shot(reporter, page, name) {
  try {
    const path = resolve(reporter.evidenceDir, `${reporter.scriptName}_${name}.png`);
    await page.screenshot({ path, fullPage: false });
    reporter.note(`captura: ${path}`);
    return path;
  } catch (e) {
    reporter.note(`captura fallida (${name}): ${e.message}`);
    return null;
  }
}

// ── API directa (Worker + Firebase REST) para asserts "en la nube, no en caché" ──

/** Login REST de Firebase → idToken real (para consultar el Worker como el dispositivo). */
export async function firebaseIdToken(email, password) {
  const key = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!key) throw new Error('Falta FIREBASE_API_KEY para el login REST (ver .env.example)');
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`login REST falló: ${JSON.stringify(j).slice(0, 300)}`);
  return { idToken: j.idToken, localId: j.localId };
}

export async function workerFetch(path, token) {
  const url = `${env.workerUrl.replace(/\/$/, '')}${path}`;
  return fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
}

export async function workerPost(path, token, body) {
  const url = `${env.workerUrl.replace(/\/$/, '')}${path}`;
  return fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/**
 * Censura credenciales antes de escribirlas en la evidencia.
 */
export function censor(obj) {
  const s = JSON.stringify(obj ?? {});
  return s
    .replace(/"(RECTORIA_PASS|DOCENTE_PASS|ESTUDIANTE_CLAVE|AUTH_TOKEN|password|idToken)":"[^"]*"/gi, '"$1":"***"')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***');
}
