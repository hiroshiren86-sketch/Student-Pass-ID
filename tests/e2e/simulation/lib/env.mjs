/**
 * R69 · E2E "Mini Colegio" — carga de configuración.
 * Lee un archivo .env SIN dependencias externas (mismo patrón que las QA de
 * R54-R58) y expone los valores ya tipados. Nunca commitee un .env real.
 *
 * Orden de búsqueda: $E2E_ENV_FILE → tests/e2e/simulation/.env → .env de la raíz
 * del repo → /home/user/spv/.env (el que usaron las QA anteriores).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const SIM_ROOT = resolve(HERE, '..');
export const REPO_ROOT = resolve(SIM_ROOT, '../..');

function parseEnvFile(path) {
  const out = {};
  try {
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (val && !(key in process.env)) out[key] = val;
    }
  } catch { /* archivo inexistente o ilegible: se ignora */ }
  return out;
}

const candidates = [
  process.env.E2E_ENV_FILE,
  resolve(SIM_ROOT, '.env'),
  resolve(REPO_ROOT, '.env'),
  '/home/user/spv/.env',
].filter(Boolean);

let loadedFrom = null;
for (const c of candidates) {
  if (existsSync(c)) {
    const parsed = parseEnvFile(c);
    for (const [k, v] of Object.entries(parsed)) if (process.env[k] === undefined) process.env[k] = v;
    loadedFrom = loadedFrom || c;
  }
}

const bool = (v, dflt = false) => (v === undefined ? dflt : ['1', 'true', 'yes', 'si', 'sí'].includes(String(v).toLowerCase()));
const num = (v, dflt) => (v === undefined || v === '' ? dflt : Number(v));

export const env = {
  loadedFrom,
  baseUrl: (process.env.BASE_URL || 'https://hiroshiren86-sketch.github.io/Student-Pass-ID/').replace(/\/$/, '') + '/',
  workerUrl: process.env.WORKER_URL || '',
  authToken: process.env.AUTH_TOKEN || '',
  schoolCode: process.env.SCHOOL_CODE || '',
  rectoriaEmail: process.env.RECTORIA_EMAIL || '',
  rectoriaPass: process.env.RECTORIA_PASS || '',
  docenteEmail: process.env.DOCENTE_EMAIL || '',
  docentePass: process.env.DOCENTE_PASS || '',
  estudianteCode: process.env.ESTUDIANTE_CODE || '',
  estudianteClave: process.env.ESTUDIANTE_CLAVE || '',
  headless: bool(process.env.HEADLESS, true),
  slowMo: num(process.env.SLOWMO_MS, 0),
  evidenceDir: process.env.EVIDENCE_DIR || '',
  grades: (process.env.E2E_GRADES || '').split(',').map(s => s.trim()).filter(Boolean),
};

export const fixturesDir = resolve(REPO_ROOT, 'tests/fixtures');
export const FIXTURE_MATRICULA = resolve(fixturesDir, 'matricula_mini_colegio_15_grupos.csv');
export const FIXTURE_HORARIOS = resolve(fixturesDir, 'horarios_mini_colegio_15_grupos.csv');

/** Falla rápido con un mensaje accionable si falta una variable obligatoria. */
export function requireEnv(names) {
  const missing = names.filter(n => !process.env[n] || !String(process.env[n]).trim());
  if (missing.length) {
    throw new Error(
      `Faltan variables de entorno: ${missing.join(', ')}.\n` +
      `Complete tests/e2e/simulation/.env (ver .env.example) o exporte las variables.\n` +
      `Archivo cargado: ${loadedFrom || '(ninguno — no se encontró .env)'}`
    );
  }
}
