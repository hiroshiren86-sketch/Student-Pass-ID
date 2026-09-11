/**
 * Ronda 49 (Fase 3 — Identidad-nube, Opción B): QA del acceso por IDENTIDAD Y ROL.
 * Verifica que el Worker:
 *   1. VERIFICA el ID token de Firebase (firma RS256 contra las llaves de Google).
 *   2. LEE el ROL del perfil users/{uid} en Firestore con la cuenta de servicio.
 *   3. AUTORIZA por rol (ADMIN / DOCENTE / ESTUDIANTE_ACUDIENTE).
 *   4. FILTRA el snapshot por rol (mínimo privilegio).
 *
 * Necesita credenciales REALES (viven en /home/user/spv/.env y .firebase-sa.json, gitignored):
 *   - Ejecuta el login de Rectoría vía REST para obtener un ID token fresco.
 *
 * Ejecutar:  TZ=America/Bogota npx tsx scripts/qa-r49-identity.ts
 */
import { verifyFirebaseIdentity, filterSnapshotByRole, type Authz } from '../cloudflare-worker/src/index';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const projectId = 'gen-lang-client-0224520207';
const dbId = 'ai-studio-sistemaderegistr-4ed2ba90-8017-4c3e-ad77-5e55392e495f';

// Cargar config de Firebase (apiKey pública) y SA.
// Ronda 58 (F-19): sin la SA (gitignored, vive SOLO en la máquina de QA), la suite
// entra en modo SKIP EXPLÍCITO con exit 0 — antes MORÍA en un clone limpio y ningún
// CI podía confiar en ella. El humano ve exactamente qué falta.
// Ronda 58 (F-25): la contraseña de Rectoría ya no vive aquí — viene del entorno
// (INAS_REC_EMAIL/INAS_REC_PASS o ~/.inas-qa.env).
let sa: any = null;
try {
  sa = JSON.parse(fs.readFileSync('.firebase-sa.json', 'utf8'));
} catch {
  console.log('SKIP: falta .firebase-sa.json (cuenta de servicio, gitignored). Esta suite requiere credenciales reales de QA; ejecútala en la máquina que las tenga.');
  console.log('  RONDA 49 IDENTIDAD — SKIP (0 ejecutados, 0 fallos)');
  process.exit(0);
}
const appConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

// Env con credenciales REALES de la SA + vars de Firebase (como el Worker en producción).
const env: any = {
  FIREBASE_PROJECT_ID: projectId,
  FIREBASE_DB_ID: dbId,
  FIREBASE_SA_CLIENT_EMAIL: sa.client_email,
  FIREBASE_SA_PRIVATE_KEY: sa.private_key,
  // Sin AUTH_TOKEN/OPERATOR_TOKEN => modo abierto (solo pruebas de identidad)
};

function mkReq(idToken: string | null): any {
  return new Request('http://localhost/api/sync/pull', {
    headers: idToken ? { 'X-Firebase-Id-Token': idToken } : {},
    method: 'GET'
  });
}

async function login(email: string, pass: string): Promise<string> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${appConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass, returnSecureToken: true })
  });
  const d = await res.json();
  if (!d.idToken) throw new Error('login falló: ' + (d.error?.message || JSON.stringify(d)));
  return d.idToken;
}

// ==============================================================================
// SECCIÓN A — Verificación del ID token + lectura del rol del perfil (Opción B)
// ==============================================================================
async function sectionA() {
  console.log('\n━━━ A — Verificación del ID token (firma RS256) + rol del perfil ━━━');
  const recEmail = process.env.INAS_REC_EMAIL || 'rectoria@inas.edu.co';
  const recPass = process.env.INAS_REC_PASS;
  if (!recPass) {
    console.log('SKIP: falta INAS_REC_PASS (contraseña de Rectoría para QA). Exporta la variable o crea ~/.inas-qa.env (chmod 600, FUERA del repo).');
    console.log('  RONDA 49 IDENTIDAD — SKIP (0 ejecutados, 0 fallos)');
    process.exit(0);
  }
  const token = await login(recEmail, recPass);

  check('A0 se obtuvo un ID token real de Rectoría', !!token);
  const identity = await verifyFirebaseIdentity(mkReq(token), env);
  check('A1 identidad resuelta (no null)', identity !== null);
  check('A2 uid = J71XOX8ExrXR2sXpm5p3MeFdJKw2', identity?.uid === 'J71XOX8ExrXR2sXpm5p3MeFdJKw2', identity?.uid);
  check('A3 rol ADMIN leído del perfil (Firestore / SA)', identity?.profile.role === 'ADMIN', identity?.profile.role);

  check('A4 sin ID token → identidad null', (await verifyFirebaseIdentity(mkReq(null), env)) === null);
  check('A5 token inválido (basura) → identidad null (firma rechazada)', (await verifyFirebaseIdentity(mkReq('token.invalido.abc'), env)) === null);
}

// ==============================================================================
// SECCIÓN B — Filtrado del snapshot por rol (mínimo privilegio)
// ==============================================================================
function sectionB() {
  console.log('\n━━━ B — Filtrado del snapshot por rol (mínimo privilegio) ━━━');
  const snapshot = {
    students: [
      { code: 'A', firstName: 'Ana', grade: '10°1' },
      { code: 'B', firstName: 'Beto', grade: '10°2' },
      { code: 'C', firstName: 'Carlos', grade: '9°3' }
    ],
    teachers: [
      { id: 'prof-1', fullName: 'Prof Uno', assignedGrades: ['10°1'] }
    ],
    assignments: [
      { id: 'asg1', grade: '10°1' },
      { id: 'asg2', grade: '10°2' },
      { id: 'asg3', grade: '9°3' }
    ],
    records: [
      { id: 'r1', studentCode: 'A', studentGrade: '10°1' },
      { id: 'r2', studentCode: 'B', studentGrade: '10°2' },
      { id: 'r3', studentCode: 'C', studentGrade: '9°3' }
    ]
  };

  // ADMIN (token) → todo (sin filtro)
  const adminAuthz: Authz = { source: 'token', role: 'ADMIN', canWriteCatalog: true };
  const adminOut = filterSnapshotByRole(snapshot, adminAuthz);
  check('B1 ADMIN ve todos los estudiantes (3)', adminOut.students.length === 3);
  check('B2 ADMIN ve todos los registros (3)', adminOut.records.length === 3);

  // DOCENTE con assignedGrades=['10°1'] → solo su curso
  const docAuthz: Authz = { source: 'identity', role: 'DOCENTE', uid: 'x', linkedTeacherId: 'prof-1', canWriteCatalog: false };
  const docOut = filterSnapshotByRole(snapshot, docAuthz);
  check('B3 DOCENTE ve solo 10°1 (1 estudiante)', docOut.students.length === 1 && docOut.students[0].grade === '10°1');
  check('B4 DOCENTE ve solo sus cátedras (1)', docOut.assignments.length === 1 && docOut.assignments[0].grade === '10°1');
  check('B5 DOCENTE ve solo su planilla (1 registro)', docOut.records.length === 1 && docOut.records[0].studentGrade === '10°1');
  check('B6 DOCENTE se ve a sí mismo en teachers', docOut.teachers.length === 1 && docOut.teachers[0].id === 'prof-1');
  check('B7 DOCENTE sin assignedGrades → 0 estudiantes (nada filtrado en falso)', filterSnapshotByRole(snapshot, { ...docAuthz, linkedTeacherId: 'prof-inexistente' }).teachers.length === 0);

  // ESTUDIANTE_ACUDIENTE con linkedStudentCode (su grado)
  const estudAuthz: Authz = { source: 'identity', role: 'ESTUDIANTE_ACUDIENTE', uid: 'y', linkedStudentCode: 'B', canWriteCatalog: false };
  const estudOut = filterSnapshotByRole(snapshot, estudAuthz);
  check('B8 ESTUDIANTE ve solo su grado (10°2: Beto)', estudOut.students.length === 1 && estudOut.students[0].grade === '10°2');
  check('B9 ESTUDIANTE ve solo su registro (r2)', estudOut.records.length === 1 && estudOut.records[0].studentCode === 'B');
}

// ==============================================================================
await sectionA();
await sectionB();

console.log('\n══════════════════════════════════════');
console.log(`  RONDA 49 IDENTIDAD (worker) — RESULTADO: ${passed} OK · ${failed} FALLO`);
if (failed > 0) { failures.forEach(f => console.log('   - ' + f)); process.exit(1); }
console.log('  ACCESO POR IDENTIDAD EN VERDE');
process.exit(0);
