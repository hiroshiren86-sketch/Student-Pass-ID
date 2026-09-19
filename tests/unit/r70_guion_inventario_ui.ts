/**
 * R70 — INVENTARIO UI VERIFICADO PARA EL GUION DE PRESENTACIÓN.
 *
 * Objetivo (pedido del propietario): que el guión de la exposición se apegue al 100 %
 * al prototipo FINAL. Este script monta la app REAL (mismo camino que `src/main.tsx`)
 * sobre jsdom, con la matrícula y los docentes de producción (fixtures de R69), navega
 * TODAS las pestañas, abre los modales clave (Escudito, Ajustes, Guía rápida) y — con
 * el cambio de perfil real del Escudito — entra al Portal Docente y al Portal Estudiante
 * / Representante. De cada pantalla escribe el TEXTO VISIBLE real y los controles
 * accionables: es la fuente con la que se redacta (y se audita) el guión — ningún botón
 * del guión existe si no aparece aquí, y ninguno se describe en otro lugar.
 *
 * Evidencia: tests/evidence/r70_inventario_ui_guion.txt (+ .json)
 * Ejecutar: TZ=America/Bogota npx tsx tests/unit/r70_guion_inventario_ui.ts
 */
import '../harness/domEnv';
import { resetBrowserStorage } from '../harness/domEnv';
import { buildProductionStudents, buildRealTeachers } from '../harness/fixtures';
import fs from 'node:fs';
import path from 'node:path';

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function section(t: string) { console.log(`\n━━━ ${t} ━━━`); }

// Sin egreso en el sandbox: toda llamada de red se registra y responde 503 (la app la
// degrada con avisos honestos, que también quedan inventariados).
const fetchCalls: string[] = [];
(globalThis as any).fetch = async (input: any) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? '');
  fetchCalls.push(url);
  return { ok: false, status: 503, text: async () => 'sin egreso en la prueba', json: async () => ({ success: false }) } as any;
};

const { AttendanceStorageService } = await import('../../src/services/attendanceStorage');

resetBrowserStorage();
// Matrícula real de producción (80 fichas) + los 20 docentes reales con sus materias.
const students = buildProductionStudents();
const teachers = buildRealTeachers({ '6°4': 'Juan Pablo Pérez Gómez', '11°3': 'Carlos Alberto Mendoza Jaramillo' });
AttendanceStorageService.saveStudents(students, 'cloud');
AttendanceStorageService.saveTeachers(teachers, 'cloud');
// Subrol Representante (botón "Hacer Rep" del Directorio): se asigna al primer estudiante
// de 6°4 para que el Portal lo muestre con su bloque "Modo Representante de Salón".
const repStudent = students.find(s => s.grade === '6°4' && s.firstName === 'EMILIANO') || students[0];
AttendanceStorageService.setRepresentativeForGrade(repStudent.grade, repStudent.code);
AttendanceStorageService.saveCurrentSession({
  username: 'Rectoría / Administrador General',
  role: 'ADMIN',
  token: 'local-session',
  authAt: Date.now(),
} as any);

const out: string[] = [];
const jsonOut: any = { generatedAt: new Date().toISOString(), screens: [] };
function log(line = '') { out.push(line); }

const { mountApp, dismissInitialModals } = await import('../harness/mountApp');
const host = document.createElement('div');
document.body.appendChild(host);
const { React } = await mountApp(host);

const text = () => (host.textContent || '').replace(/\s+/g, ' ').trim();
const q = (sel: string) => Array.from(host.querySelectorAll(sel)) as HTMLElement[];
const byText = (sel: string, t: string) => q(sel).find(el => (el.textContent || '').includes(t));
async function click(el: Element | undefined | null, label: string) {
  if (!el) throw new Error(`no se pudo hacer clic: ${label}`);
  await React.act(async () => {
    el.dispatchEvent(new (globalThis as any).window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 40));
  });
}

const closed = await dismissInitialModals(host, React, 4);
log(`Modales de primer ingreso cerrados: ${closed.join(', ') || '(ninguno)'}`);

/** Captura una pantalla: texto visible + botones + controles. */
function capture(name: string, selector: string) {
  const node = (host.querySelector(selector) as HTMLElement | null) || host;
  const visible = (node.textContent || '').replace(/\s+/g, ' ').trim();
  const buttons = Array.from(node.querySelectorAll('button'))
    .map(b => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const controls = Array.from(node.querySelectorAll('input,select,textarea'))
    .map(i => `${(i as any).tagName.toLowerCase()}${(i as any).type ? '[' + (i as any).type + ']' : ''}${(i as any).getAttribute('placeholder') ? ' placeholder="' + (i as any).getAttribute('placeholder') + '"' : ''}`);
  log('\n' + '='.repeat(78));
  log(`PANTALLA: ${name}`);
  log(`SELECTOR: ${selector}`);
  log('='.repeat(78));
  log('TEXTO: ' + visible);
  log('BOTONES: ' + JSON.stringify(buttons, null, 0));
  log('CONTROLES: ' + JSON.stringify(controls, null, 0));
  jsonOut.screens.push({ name, selector, visible, buttons, controls });
}

// ---------------------------------------------------------------------------
section('1 · CABECERA + DIRECTORIO (pestaña de aterrizaje de Rectoría)');
const headerText = (host.querySelector('header')?.textContent || '').replace(/\s+/g, ' ').trim();
log('CABECERA: ' + headerText);
log('PÍLDORA DE ROL: ' + (host.querySelector('[data-testid="escudito"]')?.textContent || '').replace(/\s+/g, ' ').trim());
check('la app entra con la sesión de Rectoría (no muestra LoginScreen)', !text().includes('Ingrese sus Credenciales'));
check('el header muestra el nombre del colegio', headerText.includes('Antonia Santos'));
check('la píldora del rol activo dice "Rectoría / Admin"', (host.querySelector('[data-testid="escudito"]')?.textContent || '').includes('Rectoría / Admin'));
check('el Directorio lista filas del catálogo sembrado', q('[data-testid^="directorio-fila-"]').length > 0, String(q('[data-testid^="directorio-fila-"]').length));
capture('Directorio Estudiantes (Rectoría)', '#students-manager-view');

const labels: Record<string, string> = {
  attendance: 'Planilla de Asistencia', excuses: 'Buzón de Justificaciones', scan: 'Escanear Asistencia',
  students: 'Directorio Estudiantes', schedules: 'Horarios Escolares', teachers: 'Gestión Docentes',
  cards: 'Generador de Carnés PDF', 'ai-grades': 'Analítica e IA por Grado',
};
const viewRoot: Record<string, string> = {
  attendance: '#attendance-reports-view', excuses: '#excuses-inbox-view', scan: '#scan-hub-view',
  students: '#students-manager-view', schedules: '#schedule-builder-view', teachers: '#teachers-manager-view',
  cards: '#cards-manager-view', 'ai-grades': '#grade-ai-summary-view',
};
for (const navId of ['scan', 'schedules', 'cards', 'teachers', 'ai-grades', 'attendance', 'excuses']) {
  // La barra segmentada sólo muestra los 4 primeros; el resto vive en el menú "Módulos".
  let btn = host.querySelector(`[data-testid="nav-${navId}"]`) as HTMLElement | null;
  if (!btn) {
    const modulesTrigger = byText('button', 'Módulos');
    await click(modulesTrigger, 'abrir menú Módulos');
    btn = host.querySelector(`[data-testid="nav-${navId}"]`) as HTMLElement | null;
  }
  await click(btn, labels[navId]);
  capture(`${labels[navId]} (Rectoría)`, viewRoot[navId]);
}

section('2 · ESCUDITO — cambio de perfil y elección de la persona concreta');
await click(host.querySelector('[data-testid="escudito"]'), 'escudito');
capture('Modal Escudito — elección de perfil', 'body');
await click(host.querySelector('[data-testid="escudito-rol-estudiante"]'), 'escudito-rol-estudiante');
capture('Escudito — buscador de Estudiante (con filtro por curso)', 'body');
await click(host.querySelector('[data-testid="escudito-atras"]'), 'volver al selector de perfil');
await click(host.querySelector('[data-testid="escudito-rol-docente"]'), 'escudito-rol-docente');
capture('Escudito — buscador de Docente', 'body');
const firstTeacherBtn = q('button').find(b => (b.getAttribute('data-testid') || '').startsWith('escudito-docente-'));
await click(firstTeacherBtn, 'primer docente real');
await React.act(async () => { await new Promise(r => setTimeout(r, 60)); });
capture('Portal Docente (Aula) — vista previa desde el Escudito', 'main');
check('la vista previa entra al Aula del docente elegido', text().includes('Aula de Clase'));

section('3 · PORTAL ESTUDIANTE / REPRESENTANTE (vista previa real)');
await click(host.querySelector('[data-testid="escudito"]'), 'escudito (desde Aula)');
const backToRectoria = host.querySelector('[data-testid="escudito-volver-rectoria"]');
check('el Escudito ofrece "Volver a Rectoría / Admin" en la vista previa', !!backToRectoria);
await click(host.querySelector('[data-testid="escudito-rol-estudiante"]'), 'escudito-rol-estudiante');
const firstStudentBtn = q('button').find(b => (b.getAttribute('data-testid') || '').startsWith('escudito-estudiante-'));
await click(firstStudentBtn, 'primer estudiante real');
await React.act(async () => { await new Promise(r => setTimeout(r, 60)); });
capture('Portal Estudiante / Acudiente — carné, historial y Representante', '#student-portal-dashboard');
check('el portal del estudiante renderiza el carné digital', text().includes('Visualizar Carné') || text().includes('Ver Carné'));

// El estudiante capturado ARRIBA es el Representante de 6°4 (subrol asignado con "Hacer
// Rep" en el Directorio): se comprueba su bloque y se abre su Escáner de Aula.
check('el Portal muestra la insignia "Representante de Salón" y el bloque "Modo Representante de Salón"',
  text().includes('Representante de Salón') && text().includes('Modo Representante de Salón'));
const openScanner = byText('button', 'Abrir Escáner de Aula');
check('el bloque del Representante ofrece "Abrir Escáner de Aula"', !!openScanner);
await click(openScanner, 'Abrir Escáner de Aula');
capture('Escáner de Aula del Representante (abierto desde el Portal)', '#student-portal-dashboard');

section('4 · AJUSTES (menú de usuario → Configuración & Motores IA)');
await click(host.querySelector('[data-testid="escudito"]'), 'escudito');
await click(host.querySelector('[data-testid="escudito-volver-rectoria"]'), 'Volver a Rectoría');
// Menú de usuario: el botón que abre Ajustes es el que contiene el nombre de la sesión.
const userMenuBtn = q('header button').find(b => (b.getAttribute('title') || '').includes('Menú de Usuario'));
await click(userMenuBtn, 'abrir menú de usuario');
const settingsEntry = byText('button', 'Configuración & Motores IA');
await click(settingsEntry, 'abrir Configuración');
capture('Modal Ajustes — pestaña Institución y Jornada', '#settings-modal');
const tabs = q('#settings-modal [role="tab"]');
log('\nPESTAÑAS DE AJUSTES: ' + JSON.stringify(tabs.map(t => (t.textContent || '').trim())));
if (tabs[1]) { await click(tabs[1], 'pestaña Inteligencia Artificial'); capture('Modal Ajustes — pestaña Inteligencia Artificial', '#settings-modal'); }
if (tabs[2]) { await click(tabs[2], 'pestaña Sync y Seguridad'); capture('Modal Ajustes — pestaña Sync y Seguridad', '#settings-modal'); }
await click(host.querySelector('#btn-close-settings'), 'cerrar Ajustes');

section('5 · GUÍA RÁPIDA (menú de usuario → Guía rápida)');
await click(userMenuBtn, 'abrir menú de usuario');
await click(byText('button', 'Guía rápida'), 'abrir Guía rápida');
capture('Guía rápida de bienvenida (reapertura manual)', 'body');
const closeTour =
  byText('button', 'Cerrar guía') ||
  q('button').find(b => (b.getAttribute('aria-label') || '') === 'Cerrar guía') ||
  byText('button', '¡Listo, empecemos!');
await click(closeTour, 'cerrar guía');
await React.act(async () => { await new Promise(r => setTimeout(r, 260)); });

// ---------------------------------------------------------------------------
const evidenceDir = path.join(process.cwd(), 'tests', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const txtPath = path.join(evidenceDir, 'r70_inventario_ui_guion.txt');
const jsonPath = path.join(evidenceDir, 'r70_inventario_ui_guion.json');
const header = [
  'INVENTARIO UI VERIFICADO — RONDA 70 (guion de presentación)',
  `Generado: ${new Date().toISOString()} (TZ del runtime: ${process.env.TZ || 'sin fijar'})`,
  `App montada: src/App.tsx + ThemeProvider sobre jsdom · matrícula sembrada: ${students.length} estudiantes · ${teachers.length} docentes`,
  `Checks del inventario: ${passed} OK · ${failed} FALLO`,
  `Llamadas de red interceptadas (sin egreso): ${fetchCalls.length}`,
  '',
].join('\n');
fs.writeFileSync(txtPath, header + out.join('\n') + '\n', 'utf8');
jsonOut.summary = { passed, failed, students: students.length, teachers: teachers.length, fetchCalls: fetchCalls.length, closedModals: closed };
fs.writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2), 'utf8');

console.log(`\n━━━ RESULTADO DEL INVENTARIO ━━━`);
console.log(`Checks: ${passed} OK · ${failed} FALLO`);
console.log(`Evidencia: ${path.relative(process.cwd(), txtPath)}`);
console.log(`JSON: ${path.relative(process.cwd(), jsonPath)}`);
if (failures.length) console.log('Fallos: ' + failures.join(' | '));
process.exit(failed > 0 ? 1 : 0);
