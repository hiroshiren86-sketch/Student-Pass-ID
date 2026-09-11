/**
 * ==============================================================================
 * Ronda 58 (F-17) — CORS CON ALLOWLIST DE ORÍGENES.
 *
 * ANTES: `Access-Control-Allow-Origin: '*'` en TODAS las respuestas. Sin
 * Allow-Credentials no había lectura cross-origin, pero un POST autenticado
 * desde cualquier origen (CSRF-style: una pestaña maligna que tenga el token
 * del Worker en su almacenamiento) era aceptado y ejecutado.
 *
 * AHORA: el origen del request se valida contra una allowlist:
 *   1. El dominio de producción de Pages: https://student-pass-id.pages.dev
 *   2. CUALQUIER preview de Pages del proyecto: *.student-pass-id.pages.dev
 *      (los despliegues por rama/PR viven en <hash>.student-pass-id.pages.dev).
 *   3. Desarrollo local: http://localhost:* y http://127.0.0.1:*
 *   4. Orígenes extra configurables en la var ALLOWED_ORIGINS del Worker
 *      (coma-separados, p. ej. el dominio real del colegio cuando lo tenga).
 *
 * Comportamiento:
 *   - Request de navegador con origen NO permitido → la respuesta NO lleva
 *     Access-Control-Allow-Origin (el navegador la bloquea para JS). Los
 *     preflight OPTIONS de orígenes no permitidos reciben 403 directo.
 *   - Requests SIN header Origin (curl, Node, healthchecks, las suites QA)
 *     → respuesta normal sin header CORS: CORS es una política de NAVEGADOR,
 *     no del servidor; no se rompe ningún consumidor no-navegador.
 * ==============================================================================
 */

/** Headers CORS comunes (SIN el Allow-Origin, que se resuelve por request). */
export const corsBaseHeaders: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-School-Code, X-Requested-With, X-Device-Id, X-Device-Name, X-Firebase-Id-Token',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
};

const PAGES_PROD_ORIGIN = 'https://student-pass-id.pages.dev';
const PAGES_PREVIEW_SUFFIX = '.student-pass-id.pages.dev';

function extraAllowedOrigins(env: any): string[] {
  const raw = (env && env.ALLOWED_ORIGINS) || '';
  return String(raw)
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
}

/** ¿El origen del request está en la allowlist de esta instalación? */
export function originAllowed(origin: string, env: any): boolean {
  if (!origin) return false; // sin origen no hay CORS que negociar
  if (origin === PAGES_PROD_ORIGIN) return true;
  try {
    const u = new URL(origin);
    // Solo http(s): otros esquemas (chrome-extension:, null, file:) se rechazan.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.protocol === 'https:' && u.hostname.endsWith(PAGES_PREVIEW_SUFFIX)) return true;
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
  } catch {
    return false;
  }
  return extraAllowedOrigins(env).includes(origin);
}

/** Headers CORS completos para un request concreto (o undefined si el origen no aplica). */
export function corsHeadersFor(request: Request, env: any): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  if (!originAllowed(origin, env)) return {};
  return { ...corsBaseHeaders, 'Access-Control-Allow-Origin': origin };
}

/** Respuesta de preflight OPTIONS (403 si el origen no está permitido). */
export function corsPreflightResponse(request: Request, env: any): Response {
  const origin = request.headers.get('Origin') || '';
  if (!originAllowed(origin, env)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { headers: { ...corsBaseHeaders, 'Access-Control-Allow-Origin': origin } });
}

/** Clona una respuesta añadiéndole los headers CORS si el origen está permitido. */
export function withCorsHeaders(res: Response, request: Request, env: any): Response {
  const extra = corsHeadersFor(request, env);
  if (Object.keys(extra).length === 0) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'Vary') {
      // Preservar un Vary existente
      const prev = headers.get('Vary');
      if (!prev || !prev.split(',').map(s => s.trim()).includes('Origin')) headers.set('Vary', prev ? `${prev}, Origin` : 'Origin');
    } else {
      headers.set(k, v);
    }
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
