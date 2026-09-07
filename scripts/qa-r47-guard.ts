/**
 * Ronda 47 (Fase 2 — Nube multi-flanco): QA del GUARD de sincronización.
 * Prueba las funciones PURAS del Worker (sin Cloudflare runtime) — las que deciden
 * el alcance del token (Flanco 1) y la fusión de hechos por updatedAt (Flanco 4).
 *   - resolveTokenScope: ADMIN / OPERATOR / null / modo abierto.
 *   - mergeRecordsByUpdatedAt: el updatedAt del DATO decide; gana el más nuevo.
 *
 * Ejecutar (sin red, determinista):  TZ=America/Bogota npx tsx scripts/qa-r47-guard.ts
 *
 * NOTA: importa el módulo del Worker; los imports de excuses/push son type-only en
 * tiempo de carga y no ejecutan APIs de Cloudflare, así que corren bajo Node/tsx.
 */
import { resolveTokenScope, mergeRecordsByUpdatedAt } from '../cloudflare-worker/src/index';

// ---- Test helpers -------------------------------------------------------------
let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function req(token: string | null): any {
  return {
    headers: {
      get(h: string) {
        if (h === 'Authorization') return token ? `Bearer ${token}` : null;
        if (h === 'User-Agent') return 'qa';
        return null;
      }
    }
  };
}

// ==============================================================================
// SECCIÓN A — resolveTokenScope (Flanco 1): alcance del token.
// ==============================================================================
function sectionA() {
  console.log('\n━━━ A — Alcance del token (ADMIN/OPERATOR/abierto) ━━━');
  const both = { AUTH_TOKEN: 'adm', OPERATOR_TOKEN: 'op' } as any;
  const onlyAdmin = { AUTH_TOKEN: 'adm' } as any;
  const open = {} as any; // sin tokens → modo abierto (desarrollo)

  check('A1 AUTH_TOKEN → ADMIN', resolveTokenScope(req('adm'), both) === 'ADMIN');
  check('A2 OPERATOR_TOKEN → OPERATOR', resolveTokenScope(req('op'), both) === 'OPERATOR');
  check('A3 token inválido → null', resolveTokenScope(req('x'), both) === null);
  check('A4 sin header + tokens configurados → null', resolveTokenScope(req(null), both) === null);
  check('A5 solo AUTH_TOKEN, sin OPERATOR → ADMIN si coincide', resolveTokenScope(req('adm'), onlyAdmin) === 'ADMIN');
  check('A6 sin tokens (abierto) + sin header → ADMIN', resolveTokenScope(req(null), open) === 'ADMIN');
  check('A7 sin tokens (abierto) + cualquier token → ADMIN (retrocompat)', resolveTokenScope(req('cualquiera'), open) === 'ADMIN');
  check('A8 AUTH_TOKEN vacío/undefined → no ADMIN por ese camino', resolveTokenScope(req('op'), { AUTH_TOKEN: '', OPERATOR_TOKEN: 'op' } as any) === 'OPERATOR');
}

// ==============================================================================
// SECCIÓN B — mergeRecordsByUpdatedAt (Flanco 4): el updatedAt del DATO decide.
// ==============================================================================
function sectionB() {
  console.log('\n━━━ B — Merge de hechos por id + updatedAt ━━━');
  const existing = [
    { id: 'a', updatedAt: '2026-01-01T09:00:00Z', status: 'PUNTUAL' },
    { id: 'b', updatedAt: '2026-01-01T09:00:00Z', status: 'TARDANZA' },
    { id: 'c', status: 'AUSENTE' } // sin updatedAt
  ];
  const incoming = [
    { id: 'a', updatedAt: '2026-01-01T10:00:00Z', status: 'TARDANZA' }, // más nuevo → gana
    { id: 'b', updatedAt: '2026-01-01T08:00:00Z', status: 'AUSENTE' },   // más viejo → pierde
    { id: 'c', updatedAt: '2026-01-01T10:00:00Z', status: 'PUNTUAL' },   // prev sin updatedAt → entrante gana
    { id: 'd', updatedAt: '2026-01-01T10:00:00Z', status: 'PUNTUAL' }    // nuevo id → entra
  ];
  const merged = mergeRecordsByUpdatedAt(existing, incoming);
  const byId = new Map(merged.map(r => [r.id, r]));

  check('B1 nuevo y más nuevo gana (a→TARDANZA)', byId.get('a')?.status === 'TARDANZA');
  check('B2 viejo pierde (b conserva TARDANZA)', byId.get('b')?.status === 'TARDANZA');
  check('B3 prev sin updatedAt → entrante gana (c→PUNTUAL)', byId.get('c')?.status === 'PUNTUAL' && byId.get('c')?.updatedAt === '2026-01-01T10:00:00Z');
  check('B4 id nuevo (d) se suma', byId.get('d')?.status === 'PUNTUAL');
  check('B5 total de registros = 4', merged.length === 4);
  check('B6 entrada sin id se omite', mergeRecordsByUpdatedAt([], [{ name: 'sinid' }]).length === 0);
  check('B7 sin incoming → conserva existing', mergeRecordsByUpdatedAt(existing, []).length === existing.length);
  check('B8 sin existing → solo incoming', mergeRecordsByUpdatedAt([], incoming).length === incoming.length);
  check('B9 updatedAt igual → entrante gana (empate a favor del push)', mergeRecordsByUpdatedAt(
    [{ id: 'x', updatedAt: '2026-01-01T09:00:00Z', v: 1 }],
    [{ id: 'x', updatedAt: '2026-01-01T09:00:00Z', v: 2 }]
  )[0].v === 2);
  // fallback por timestamp (registros sin updatedAt pero con timestamp)
  check('B10 fallback a timestamp cuando no hay updatedAt', mergeRecordsByUpdatedAt(
    [{ id: 'y', timestamp: '2026-01-01T09:00:00Z', v: 1 }],
    [{ id: 'y', timestamp: '2026-01-01T10:00:00Z', v: 2 }]
  )[0].v === 2);
}

// ==============================================================================
sectionA();
sectionB();

console.log('\n══════════════════════════════════════');
console.log(`  RONDA 47 GUARD (worker) — RESULTADO: ${passed} OK · ${failed} FALLO`);
if (failed > 0) {
  console.log('  FALLOS:');
  failures.forEach(f => console.log(`   - ${f}`));
  process.exit(1);
}
console.log('  GUARD DE SINCRONIZACIÓN EN VERDE');
process.exit(0);
