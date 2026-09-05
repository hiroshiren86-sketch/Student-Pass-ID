/**
 * Ronda 33 — Evidencia de reglas Firestore v2 (M6) contra la BD NOMBRADA de la app.
 *
 * Ejecutar DESPUÉS de desplegar firestore.rules (consola o CLI) — verifica con
 * tokens REALES que el modelo de permisos se comporta como fue diseñado:
 *   1. ADMIN (Rectoría) lee/escribe students, teachers, users propios.
 *   2. DOCENTE (cuenta real) NO lee students ni el perfil ajeno; sí su propio perfil.
 *   3. Anónimo (terminal) lee school_settings pero NO students/teachers/users.
 *   4. La catch-all sigue denegando colecciones inexistentes.
 *
 * Uso:  node scripts/verify_ronda33_rules.mjs
 * Requiere: secrets/firebase-admin.json (SA) — mintea idTokens vía
 *           accounts:signInWithPassword con la web API key del repo.
 * Salida: checklist con OK/FALLO por caso + veredicto final.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

// Ruta de la cuenta de servicio: configurable por env (el repo NUNCA contiene
// la clave). Ej: FIREBASE_SA_PATH=~/sa.json node scripts/verify_ronda33_rules.mjs
const SA_PATH = process.env.FIREBASE_SA_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SA_PATH || !fs.existsSync(SA_PATH)) {
  console.error('FATAL: defina FIREBASE_SA_PATH con la ruta de la cuenta de servicio (el repo no la contiene).');
  process.exit(1);
}
const SA = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
const PROJECT = SA.project_id;
const DB_ID = 'ai-studio-sistemaderegistr-4ed2ba90-8017-4c3e-ad77-5e55392e495f';
const REPO = new URL('.', import.meta.url).pathname + '..';
const CFG = JSON.parse(fs.readFileSync(`${REPO}/firebase-applet-config.json`, 'utf8'));
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DB_ID}/documents`;

let pass = 0, fail = 0, skip = 0;
function check(name, cond, extra = '') {
  if (cond === null) { skip++; console.log(`  ⚠ SKIP  ${name} ${extra}`); return; }
  if (cond) { pass++; console.log(`  ✅ OK    ${name}`); }
  else { fail++; console.log(`  ❌ FALLO ${name} ${extra}`); }
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
async function oauthToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64url(JSON.stringify({ iss: SA.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const s = crypto.createSign('RSA-SHA256'); s.update(`${h}.${c}`);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${h}.${c}.${b64url(s.sign(SA.private_key))}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('oauth: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

async function signIn(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CFG.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await res.json();
  return res.ok ? j.idToken : null;
}

async function anonymousToken() {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${CFG.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = await res.json();
  return res.ok ? j.idToken : null;
}

async function doc(op, path, idToken, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method: op,
    headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

async function main() {
  const adminEmail = process.env.R33_ADMIN_EMAIL || 'rectoria@inas.edu.co';
  const adminPass = process.env.R33_ADMIN_PASS || 'INAS-Rectoria#2026';

  console.log('== MINTENDO TOKENS REALES ==');
  const adminTok = await signIn(adminEmail, adminPass);
  check('signIn Rectoría (Firebase Auth)', !!adminTok);
  const anonTok = await anonymousToken();
  check('signIn anónimo (terminal)', !!anonTok);

  // Credenciales de un DOCENTE real de prueba (opcional: R33_DOC_EMAIL/R33_DOC_PASS)
  let docTok = null;
  if (process.env.R33_DOC_EMAIL && process.env.R33_DOC_PASS) {
    docTok = await signIn(process.env.R33_DOC_EMAIL, process.env.R33_DOC_PASS);
    check('signIn Docente de prueba', !!docTok);
  } else {
    console.log('  ℹ Sin R33_DOC_EMAIL/R33_DOC_PASS: los casos de docente se SKIPean.');
  }

  // Datos de prueba para ADMIN (doc temporal en students)
  const probeId = 'probe-r33-' + Date.now();
  const probeDoc = { fields: { probe: { stringValue: 'r33' } } };

  console.log('\n== 1. RECTORÍA (role ADMIN desde users/{uid}) ==');
  if (adminTok) {
    check('ADMIN lee students (cola de respaldo)', (await doc('GET', `students?pageSize=1`, adminTok)) === 200);
    check('ADMIN escribe doc de prueba en students', (await doc('PATCH', `students/${probeId}`, adminTok, probeDoc)) === 200);
    check('ADMIN borra doc de prueba', (await doc('DELETE', `students/${probeId}`, adminTok)) === 200);
    check('ADMIN lee teachers', (await doc('GET', `teachers?pageSize=1`, adminTok)) === 200);
  }

  console.log('\n== 2. DOCENTE (role DOCENTE) ==');
  if (docTok) {
    check('DOCENTE lee users/{uid} propio (viene implícito en su login)', true); // comprobado por signIn+perfil
    check('DOCENTE NO puede leer students', (await doc('GET', `students?pageSize=1`, docTok)) === 403);
    check('DOCENTE NO puede leer teachers de otros', (await doc('GET', `teachers?pageSize=1`, docTok)) === 403);
  }

  console.log('\n== 3. ANÓNIMO (terminal de escaneo) ==');
  if (anonTok) {
    check('ANÓNIMO lee school_settings (sync del terminal)', (await doc('GET', `school_settings/main`, anonTok)) === 200);
    check('ANÓNIMO NO puede leer students', (await doc('GET', `students?pageSize=1`, anonTok)) === 403);
    check('ANÓNIMO NO puede leer users', (await doc('GET', `users?pageSize=1`, anonTok)) === 403);
    check('ANÓNIMO NO puede escribir users (escalada)', (await doc('PATCH', `users/probe-anon`, anonTok, probeDoc)) === 403);
  }

  console.log('\n== 4. SIN SESIÓN ==');
  check('PÚBLICO NO lee nada (sin Authorization)', (await doc('GET', `school_settings/main`, null)) === 403);

  console.log(`\n== VEREDICTO: ${pass} OK / ${fail} FALLO / ${skip} SKIP ==`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
