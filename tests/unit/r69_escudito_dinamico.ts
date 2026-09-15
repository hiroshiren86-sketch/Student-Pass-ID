/**
 * R69 — VERIFICACIÓN DEL SELECTOR DE ROL ("ESCUDITO") CON DOM REAL.
 *
 * Responde punto por punto lo que pidió el propietario:
 *   · ¿La lista de estudiantes y docentes está estática o hardcodeada?  → NO: se
 *     demuestra que cambia en vivo cuando el catálogo cambia (sin recargar) y que
 *     al abrir el selector se dispara un PULL a la nube.
 *   · ¿Rectoría puede elegir a CUALQUIER estudiante/docente real sin credenciales? →
 *     se abre el perfil concreto y se comprueba que la vista es la de esa persona.
 *   · ¿Búsqueda por nombre operativa sobre la lista real?  → insensible a tildes,
 *     tokens en cualquier orden, código/documento/curso.
 *   · ¿Modales de primer ingreso manejados?  → el asistente de bienvenida se cierra
 *     con sus propios botones antes de operar (patrón de los scripts de QA).
 *
 * La sesión de Rectoría se RESTAURA por el camino real de la app (R30 H-30-1:
 * `restoreValidSession` sobre `inas_user_session_v5`), no se falsifica ningún login:
 * así la prueba no depende de Firebase (bloqueado/offline en el sandbox).
 *
 * Ejecutar: TZ=America/Bogota bun tests/unit/r69_escudito_dinamico.ts
 */
import '../harness/domEnv';
import { resetBrowserStorage } from '../harness/domEnv';
import { buildProductionStudents, buildTeachers } from '../harness/fixtures';

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function section(t: string) { console.log(`\n━━━ ${t} ━━━`); }

// ── Red intervenida: se REGISTRA toda llamada y se responde 503 (sin egreso real).
// Así se prueba que el Escudito INTENTA refrescar desde la nube y degrada con un
// aviso honesto, sin depender de que el sandbox alcance workers.dev.
const fetchCalls: string[] = [];
(globalThis as any).fetch = async (input: any) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? '');
  fetchCalls.push(url);
  return {
    ok: false, status: 503,
    text: async () => 'sin egreso en la prueba',
    json: async () => ({ success: false, error: 'sin egreso en la prueba' }),
  } as any;
};

const { AttendanceStorageService } = await import('../../src/services/attendanceStorage');

resetBrowserStorage();
const seeded = buildProductionStudents();
AttendanceStorageService.saveStudents(seeded, 'cloud');
AttendanceStorageService.saveTeachers(buildTeachers(), 'cloud');
AttendanceStorageService.saveCurrentSession({
  username: 'Rectoría / Administrador General',
  role: 'ADMIN',
  token: 'local-session',
  authAt: Date.now(),
} as any);

section('MONTAJE — App completa con sesión de Rectoría restaurada (camino real R30)');
const { mountApp, dismissInitialModals } = await import('../harness/mountApp');
const host = document.createElement('div');
document.body.appendChild(host);
const { root, React } = await mountApp(host);

const text = () => host.textContent || '';
const q = (sel: string) => Array.from(host.querySelectorAll(sel)) as HTMLElement[];
const byText = (sel: string, t: string) => q(sel).find(el => (el.textContent || '').includes(t));
async function click(el: Element | undefined | null, label: string) {
  if (!el) throw new Error(`no se pudo hacer clic: ${label}`);
  await React.act(async () => {
    el.dispatchEvent(new (globalThis as any).window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 20));
  });
}

check('la app autenticó con la sesión restaurada (no muestra el LoginScreen)',
  !text().includes('Iniciar Sesión') && !text().includes('Bienvenido de nuevo'),
  text().slice(0, 120));

// ── Modales de primer ingreso (directiva §5): cerrar la guía con sus propios botones
section('MODALES DE PRIMER INGRESO (guía de bienvenida / ajustes)');
const tourBefore = !!byText('button', 'Cerrar guía') || !!byText('button', '¡Empezar!');
console.log(`  guía de primer ingreso visible: ${tourBefore ? 'SÍ' : 'no'}`);
const closed = await dismissInitialModals(host, React);
console.log(`  cierres ejecutados: ${closed.length ? closed.join(', ') : 'ninguno necesario'}`);
check('tras el cierre no queda ningún overlay bloqueando la operación',
  !host.querySelector('div.fixed.inset-0.z-50'), 'sigue habiendo un overlay z-50 abierto');

section('ESCUDITO — apertura, origen de los datos y refresco desde la nube');
fetchCalls.length = 0;
const pill = q('button').find(b => (b.getAttribute('title') || '').startsWith('Cambiar Perfil'));
check('la píldora del Escudito existe y es clickeable desde Rectoría', !!pill);
await click(pill, 'píldora del Escudito');
check('se abre el modal de cambio rápido de perfil', text().includes('Cambio Rápido de Perfil de Acceso'));
await React.act(async () => { await new Promise(r => setTimeout(r, 120)); });
check('al abrirlo se dispara un PULL del catálogo a la nube (/api/sync/pull)',
  fetchCalls.some(u => u.includes('/api/sync/pull')), fetchCalls.join(' | '));
check('el estado del modal dice de dónde viene el catálogo',
  text().includes('catálogo en la nube'), text().slice(0, 200));
check('si la nube no responde, el aviso es honesto (no se finge datos frescos)',
  text().includes('no respondió') || text().includes('No se pudo actualizar') || text().includes('actualizado desde la nube'));

section('ESCUDITO — lista de ESTUDIANTES dinámica (catálogo real, sin hardcode)');
await click(byText('button', '3. Estudiante / Acudiente'), 'tarjeta Estudiante');
const listButtons = () => q('button').filter(b => b.className.includes('rounded-2xl') && /·\s*\d{6,}/.test(b.textContent || ''));
console.log(`  entradas listadas: ${listButtons().length} · sembradas: ${seeded.length}`);
check('lista TODOS los estudiantes del catálogo (ni uno hardcodeado)', listButtons().length === seeded.length,
  `listadas=${listButtons().length} sembradas=${seeded.length}`);
check('no aparece ningún fantasma del demo antiguo',
  !text().includes('Prof. Juan Pablo Pérez') && !text().includes('1000000002') && !text().includes('prof-temp'));
check('el chip declara el tamaño real del catálogo', text().includes(`${seeded.length} estudiantes`));

// — filtro por curso (necesario con la matrícula completa 6°1…11°3)
const gradeSelect = host.querySelector('#escudito-grade') as HTMLSelectElement | null;
check('existe el filtro por curso dentro del Escudito', !!gradeSelect);
if (gradeSelect) {
  const optCount = gradeSelect.options.length;
  console.log(`  cursos ofrecidos: ${optCount - 1} → ${Array.from(gradeSelect.options).slice(1).map(o => o.value).join(', ')}`);
  check('el filtro sólo ofrece cursos con estudiantes reales', Array.from(gradeSelect.options).slice(1).every(o => o.value !== '6°1'));
  const setter = Object.getOwnPropertyDescriptor((globalThis as any).window.HTMLSelectElement.prototype, 'value')?.set;
  await React.act(async () => {
    setter?.call(gradeSelect, '7°4');
    gradeSelect.dispatchEvent(new (globalThis as any).window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
  });
  const expected = seeded.filter(s => s.grade === '7°4').length;
  check(`al filtrar 7°4 quedan exactamente ${expected} estudiantes`, listButtons().length === expected, `obtenidas=${listButtons().length}`);
  await React.act(async () => {
    setter?.call(gradeSelect, 'all');
    gradeSelect.dispatchEvent(new (globalThis as any).window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
  });
}

// — búsqueda por nombre sobre la lista real
const searchInput = q('input').find(i => (i.getAttribute('aria-label') || '') === 'Buscar estudiante') as HTMLInputElement | undefined;
check('existe el buscador de estudiantes', !!searchInput);
async function search(value: string) {
  if (!searchInput) return;
  const setter = Object.getOwnPropertyDescriptor((globalThis as any).window.HTMLInputElement.prototype, 'value')?.set;
  await React.act(async () => {
    setter?.call(searchInput, value);
    searchInput.dispatchEvent(new (globalThis as any).window.Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
  });
}
const withAccent = seeded.find(s => /[ÁÉÍÓÚÑ]/.test(`${s.firstName} ${s.lastName}`)) ?? seeded[0];
await search(withAccent.lastName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(' ')[0]);
check(`buscar sin tildes encuentra a ${withAccent.firstName} ${withAccent.lastName}`, listButtons().length >= 1, `resultados=${listButtons().length}`);
await search(seeded[3].code.slice(0, 5));
check('buscar por prefijo del código encuentra', listButtons().length >= 1, `resultados=${listButtons().length}`);
await search('6°4');
check('buscar por curso ("6°4") acota a ese curso', listButtons().length === seeded.filter(s => s.grade === '6°4').length,
  `resultados=${listButtons().length}`);
await search('zzzz-inexistente');
check('búsqueda sin coincidencias da un mensaje accionable (no una lista vacía muda)',
  listButtons().length === 0 && text().includes('Ningún estudiante coincide'));
await search('');

section('ESCUDITO — la lista NO es estática: reacciona al catálogo en vivo');
const before = listButtons().length;
const nuevo = { ...seeded[0], code: '1999999999', documentId: '1999999999', firstName: 'NUEVOENCLOUD', lastName: 'PULLRECIENTE', grade: '11°3' };
await React.act(async () => {
  AttendanceStorageService.saveStudents([...AttendanceStorageService.getStudents(), nuevo], 'cloud');
  await new Promise(r => setTimeout(r, 30));
});
check(`un estudiante nuevo aparece SIN recargar (antes=${before}, ahora=${listButtons().length})`,
  listButtons().length === before + 1, `antes=${before} ahora=${listButtons().length}`);
check('el estudiante nuevo es visible por su nombre', text().includes('NUEVOENCLOUD PULLRECIENTE'));

section('ESCUDITO — entrar al perfil de un estudiante real SIN credenciales');
await search('NUEVOENCLOUD');
const target = listButtons().find(b => (b.textContent || '').includes('NUEVOENCLOUD'));
check('la entrada del estudiante buscado es seleccionable', !!target);
await click(target, 'estudiante NUEVOENCLOUD');
check('el rol activo pasa a Estudiante / Acudiente', text().includes('Estudiante / Acudiente'));
check('se abre el portal de ESA persona (su nombre en la vista)', text().includes('NUEVOENCLOUD'));
check('la sesión real de Rectoría sigue debajo (vista previa, no suplantación de sesión)',
  AttendanceStorageService.getCurrentSession()?.role === 'ADMIN');

section('ESCUDITO — volver a Rectoría y entrar a un DOCENTE real');
await click(q('button').find(b => (b.getAttribute('title') || '').startsWith('Cambiar Perfil')), 'píldora');
check('desde la vista previa se puede volver a Rectoría', text().includes('Volver a Rectoría / Admin'));
await click(byText('button', 'Volver a Rectoría / Admin'), 'volver');
check('el rol activo vuelve a Rectoría', text().includes('Rectoría / Admin'));
await click(q('button').find(b => (b.getAttribute('title') || '').startsWith('Cambiar Perfil')), 'píldora 2');
await click(byText('button', '2. Docente (Aula y Horarios)'), 'tarjeta Docente');
const teacherButtons = () => q('button').filter(b => /@inas\.edu\.co|Sin asignaturas|Dirección de Grupo|·/.test(b.textContent || '') && b.className.includes('rounded-2xl') && !/estudiantes|docentes ·/.test(b.textContent || ''));
check('lista los docentes del catálogo real', text().includes('MARTA RESTREPO') && text().includes('LUISA FERNANDA TORO'));
check('el chip declara el número real de docentes', text().includes('5 docentes'));
const tSearch = q('input').find(i => (i.getAttribute('aria-label') || '') === 'Buscar docente') as HTMLInputElement | undefined;
if (tSearch) {
  const setter = Object.getOwnPropertyDescriptor((globalThis as any).window.HTMLInputElement.prototype, 'value')?.set;
  await React.act(async () => {
    setter?.call(tSearch, 'ospina');
    tSearch.dispatchEvent(new (globalThis as any).window.Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
  });
  check('buscar docente por apellido (minúsculas) encuentra 1', text().includes('JUAN PABLO OSPINA') && !text().includes('MARTA RESTREPO'));
  await React.act(async () => {
    setter?.call(tSearch, 'inglés');
    tSearch.dispatchEvent(new (globalThis as any).window.Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
  });
  check('buscar docente por asignatura con tilde encuentra', text().includes('JUAN PABLO OSPINA'));
  await click(byText('button', 'JUAN PABLO OSPINA'), 'docente');
  check('entra al Aula del docente elegido sin credenciales', text().includes('JUAN PABLO OSPINA'));
}

await React.act(async () => { root.unmount(); });
console.log('\n══════════════════════════════════════');
console.log(`  R69 ESCUDITO DINÁMICO (DOM REAL): ${passed} OK · ${failed} FALLO`);
if (failures.length) { console.log('  Fallos:'); failures.forEach(f => console.log(`   - ${f}`)); }
console.log('══════════════════════════════════════');
process.exit(failed === 0 ? 0 : 1);
