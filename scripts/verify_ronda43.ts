/**
 * Ronda 43 — Suite LOCAL (determinista, sin red). Ejecutar: TZ=America/Bogota bun scripts/verify_ronda43.ts
 * Cubre el protocolo CLASE:v2 (Tarjetas QR de Docente — mandato del propietario:
 * "cada profesor tenga su tarjeta; no depende del horario") y su integración:
 *   A: slugifySubject + generador + parser v2 (formato/firma/tamper/expiración)
 *   B: setActiveTeacherCard (orden de validación §2.2 del manual v2)
 *   C: 1-toque v2 en Aula Docente (activateTeacherSubjectDirect)
 *   D: registerScan sin gate de grado (el grado lo aporta el carné) + unicidad + v1 intacto
 * La v1 (CLASE:v1) NO se toca: coexistencia por prefijo, verificada al final.
 * NOTA de reloj: TODA la app deriva el tiempo de America/Bogota (getCurrentTimeString/getTodayDateString)
 * y Date.parse interpreta en la TZ del runtime — la suite DEBE correr con TZ=America/Bogota.
 * En sección D se simula SOLO la ventana de jornada (día lectivo) porque el guard real L–V
 * (Ronda 22) bloquearía un domingo real y NO es el objeto de esta suite (se verifica en E2E
 * con page.clock). Los bloques, el gate v2 y la unicidad usan el código real.
 */
(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear()
    };
  }
  // crypto.ts usa window.crypto.subtle (WebCrypto). En bun: alias al propio globalThis.
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = globalThis;
  }
})();
setTimeout(() => { console.log('⏱ TIMEOUT GLOBAL DE LA SUITE LOCAL'); process.exit(2); }, 90000);

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
async function section(title: string, fn: () => Promise<void> | void) {
  console.log(`\n━━━ ${title} ━━━`);
  try { await fn(); }
  catch (e: any) { failed++; failures.push(`${title} (excepción: ${e?.message || e})`); console.log(`  ✗ EXCEPCIÓN: ${e?.message || e}`); }
}

const crypto = await import('../src/utils/crypto');
const { AttendanceStorageService, schoolYearEndEpochMs, getCurrentTimeString } = await import('../src/services/attendanceStorage');
const svc = AttendanceStorageService;

function timePlus(minutes: number): string {
  const [h, m] = getCurrentTimeString().split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

await section('A — slugifySubject (nombres reales del colegio)', () => {
  check('A1 sin tildes: Lengua Castellana', crypto.slugifySubject('Lengua Castellana') === 'lengua-castellana');
  check('A2 puntuación/tildes: C. Naturales (Biología)', crypto.slugifySubject('C. Naturales (Biología)') === 'c-naturales-biologia');
  check('A3 colapsa guiones y recorta', crypto.slugifySubject('Educación   Física --y-- Deporte ') === 'educacion-fisica-y-deporte');
  check('A4 mayúsculas y ñ: Español Ñandú', crypto.slugifySubject('Español Ñandú') === 'espanol-nandu');
  const problematic = ['Matemáticas', 'C. Económicas y Políticas', 'Informática', 'Artística', 'Religión', 'Ética', 'Sociales'];
  check('A5 ningún slug institucional contiene ":" o "|"', problematic.every(s => !crypto.slugifySubject(s).includes(':') && !crypto.slugifySubject(s).includes('|')));
});

await section('B — protocolo CLASE:v2 (generador + parser)', async () => {
  const secret = 'r43-secret-unit';
  const exp = schoolYearEndEpochMs();
  const payload = await crypto.generateTeacherCardPayload('prof-1788591549776', 'lengua-castellana', exp, secret);
  const parts = payload.split(':');
  check('B1 formato: prefijo + 6 partes exactas', payload.startsWith('CLASE:v2:') && parts.length === 6);
  check('B2 teacherId y slug viajan en el token', parts[2] === 'prof-1788591549776' && parts[3] === 'lengua-castellana');
  check('B3 firma 16 hex', !!parts[5] && /^[0-9a-f]{16}$/.test(parts[5]));

  const ok = await crypto.parseAndVerifyTeacherCard(payload, secret);
  check('B4 parse válido', ok.isTeacherCard && ok.isValidFormat && ok.isSignatureValid === true && !ok.isExpired);
  check('B5 campos decodificados', ok.teacherId === 'prof-1788591549776' && ok.subjectSlug === 'lengua-castellana' && ok.expiresAt === exp);

  const tampered = payload.slice(0, -1) + (payload.endsWith('0') ? '1' : '0');
  const bad = await crypto.parseAndVerifyTeacherCard(tampered, secret);
  check('B6 tamper 1 hex → firma inválida', bad.isTeacherCard && bad.isSignatureValid === false);

  const short = 'CLASE:v2:prof-x:solo-cuatro-partes:' + exp;
  const malformed = await crypto.parseAndVerifyTeacherCard(short, secret);
  check('B7 malformado (5 partes) → isValidFormat false, isTeacherCard true', malformed.isTeacherCard && !malformed.isValidFormat);

  const tooMany = 'CLASE:v2:prof-x:slug:extra:' + exp + ':abcdef0123456789';
  const tooManyParsed = await crypto.parseAndVerifyTeacherCard(tooMany, secret);
  check('B8 malformado (7 partes) → isValidFormat false', tooManyParsed.isTeacherCard && !tooManyParsed.isValidFormat);

  const expiredPayload = await crypto.generateTeacherCardPayload('prof-x', 'materia', Date.now() - 1000, secret);
  const expired = await crypto.parseAndVerifyTeacherCard(expiredPayload, secret);
  check('B9 expirado → isExpired + firma global inválida', expired.isExpired === true && expired.isSignatureValid === false);

  const foreign = await crypto.parseAndVerifyTeacherCard(payload, 'otra-institucion');
  check('B10 qrSecret distinto → firma inválida (otra institución)', foreign.isSignatureValid === false);

  // Coexistencia v1/v2 por prefijo (los parsers se excluyen mutuamente)
  const v1 = await crypto.generateClassQrPayload('10°1', 'slot-4', 4, Date.now() + 3600_000, secret);
  const v1AsV2 = await crypto.parseAndVerifyTeacherCard(v1, secret);
  const v2AsV1 = await crypto.parseAndVerifyClassScan(payload, secret);
  check('B11 token v1 NO es tarjeta v2 (parser excluyente)', v1AsV2.isTeacherCard === false);
  check('B12 token v2 NO es QR de Clase v1', v2AsV1.isClassToken === false);
  const v1Ok = await crypto.parseAndVerifyClassScan(v1, secret);
  check('B13 v1 intacto: parse v1 sigue funcionando', v1Ok.isClassToken && v1Ok.isValidFormat && v1Ok.isSignatureValid === true);
});

await section('C — setActiveTeacherCard (orden de validación §2.2)', async () => {
  const settings = svc.getSettings();
  const secret = settings.qrSecret;
  const exp = schoolYearEndEpochMs();

  svc.saveTeachers([
    { id: 'prof-r43-1', documentId: 'T1', fullName: 'María Camila Restrepo Henao', email: 'mrestrepo@inas.edu.co', subjects: ['Lengua Castellana', 'Matemáticas'], assignedGrades: ['10°3'], username: 't1', active: true, createdAt: new Date().toISOString() },
    { id: 'prof-r43-2', documentId: 'T2', fullName: 'Docente Inactivo Prueba', email: 'x@inas.edu.co', subjects: ['Química'], assignedGrades: [], username: 't2', active: false, createdAt: new Date().toISOString() },
    { id: 'prof-r43-3', documentId: 'T3', fullName: 'Docente Sin Materia', email: 'y@inas.edu.co', subjects: [], assignedGrades: [], username: 't3', active: true, createdAt: new Date().toISOString() }
  ] as any);

  const cardMatematicas = await crypto.generateTeacherCardPayload('prof-r43-1', crypto.slugifySubject('Matemáticas'), exp, secret);

  // (7) Bloque por RELOJ: fuera de bloque → no_active_slot (capa anti-abuso de v2)
  svc.saveScheduleSlots([
    { id: 'slot-r43-past', order: 1, type: 'CLASS', name: '1ª Hora', startTime: '00:00', endTime: '00:05', durationMinutes: 5 }
  ]);
  const outOfBlock = await svc.setActiveTeacherCard(cardMatematicas);
  check('C1 fuera de bloque CLASE → no_active_slot', outOfBlock.type === 'no_active_slot');

  // Bloque vigente que cubre AHORA
  svc.saveScheduleSlots([
    { id: 'slot-r43-now', order: 1, type: 'CLASS', name: '1ª Hora', startTime: timePlus(-10), endTime: timePlus(+40), durationMinutes: 50 }
  ]);
  const activated = await svc.setActiveTeacherCard(cardMatematicas);
  check('C2 tarjeta válida dentro de bloque → class_activated', activated.type === 'class_activated', JSON.stringify(activated).slice(0, 160));

  const ctx = svc.getActiveClass();
  check('C3 contexto v2 guardado: materia/docente/teacherId', !!ctx && ctx.subject === 'Matemáticas' && ctx.teacherName === 'María Camila Restrepo Henao' && ctx.teacherId === 'prof-r43-1');
  check('C4 contexto v2: SIN grado ni día (sourceVersion v2, bloque del reloj)', !!ctx && ctx.grade === undefined && ctx.dayOfWeek === undefined && ctx.sourceVersion === 'v2' && ctx.slotId === 'slot-r43-now');

  // (8) Enriquecimiento opcional con horario: aula de la cátedra coincidente
  const todayDow = new Date().getDay() || 1;
  svc.saveScheduleAssignments([
    { id: 'asg-r43', dayOfWeek: todayDow, slotId: 'slot-r43-now', grade: '10°3', subject: 'Matemáticas', teacherId: 'prof-r43-1', teacherName: 'María Camila Restrepo Henao', classroom: 'Aula 204' }
  ]);
  const enriched = await svc.setActiveTeacherCard(cardMatematicas);
  const ctx2 = svc.getActiveClass();
  check('C5 enriquecimiento: aula de la cátedra coincidente (sin bloquear nada)', enriched.type === 'class_activated' && ctx2?.classroom === 'Aula 204');

  // (5) docente inexistente / inactivo
  const ghost = await crypto.generateTeacherCardPayload('prof-fantasma', 'matematicas', exp, secret);
  const ghostRes = await svc.setActiveTeacherCard(ghost);
  check('C6 docente inexistente → rechazo con mensaje claro', ghostRes.type === 'error' && ghostRes.title === 'Docente no encontrado');
  const inactiveCard = await crypto.generateTeacherCardPayload('prof-r43-2', crypto.slugifySubject('Química'), exp, secret);
  const inactiveRes = await svc.setActiveTeacherCard(inactiveCard);
  check('C7 docente inactivo → rechazo', inactiveRes.type === 'error' && inactiveRes.title === 'Docente inactivo');

  // (6) asignatura fuera de la ficha
  const wrongSubj = await crypto.generateTeacherCardPayload('prof-r43-1', 'quimica-avanzada', exp, secret);
  const wrongRes = await svc.setActiveTeacherCard(wrongSubj);
  check('C8 asignatura no vigente → pedir regeneración', wrongRes.type === 'error' && wrongRes.title === 'Asignatura no vigente');

  // firma inválida
  const evil = cardMatematicas.slice(0, -1) + (cardMatematicas.endsWith('0') ? '1' : '0');
  const evilRes = await svc.setActiveTeacherCard(evil);
  check('C9 tarjeta alterada → firma inválida', evilRes.type === 'error' && evilRes.title === 'Tarjeta con firma inválida');

  // match por slug devuelve el nombre EXACTO de la ficha
  const lengua = await crypto.generateTeacherCardPayload('prof-r43-1', crypto.slugifySubject('Lengua Castellana'), exp, secret);
  const lenguaRes = await svc.setActiveTeacherCard(lengua);
  check('C10 match por slug → nombre exacto de la ficha', lenguaRes.type === 'class_activated' && svc.getActiveClass()?.subject === 'Lengua Castellana');

  // 1-toque v2 en Aula Docente
  const direct = svc.activateTeacherSubjectDirect('prof-r43-1', 'Matemáticas');
  check('C11 1-toque v2 (sin escanear) → activa la asignatura del docente', direct.type === 'class_activated' && svc.getActiveClass()?.teacherId === 'prof-r43-1');
  const directBad = svc.activateTeacherSubjectDirect('prof-r43-1', 'Filosofía');
  check('C12 1-toque con materia ajena a la ficha → rechazo', directBad.type === 'error');
});

await section('D — registerScan con clase v2 activa (sin gate de grado)', async () => {
  const settings = svc.getSettings();
  const exp = schoolYearEndEpochMs();
  const secret = settings.qrSecret;

  // Simulación de día lectivo SOLO para la ventana de jornada (ver NOTA de reloj del encabezado):
  // domingo real → la guardia L–V devolvería null y ningún escaneo se registraría (correcto en
  // producción, pero ajeno a lo que esta suite prueba). El bloque y todo lo demás es código real.
  (svc as any).getSchoolDayWindow = () => ({ start: '00:00', end: '23:59', startMin: 0, endMin: 1439 });

  svc.saveStudents([
    { code: '1000000001', documentId: '1000000001', firstName: 'Daniel', lastName: 'Quintero Echeverri', grade: '10°3', section: '3', active: true, createdAt: new Date().toISOString() },
    { code: '2000000002', documentId: '2000000002', firstName: 'Juliana', lastName: 'Martínez Pérez', grade: '6°4', section: '4', active: true, createdAt: new Date().toISOString() }
  ] as any);

  // —— PARTE 1: v2 activa (bloque slot-r43-now) ——
  const cardMat = await crypto.generateTeacherCardPayload('prof-r43-1', crypto.slugifySubject('Matemáticas'), exp, secret);
  const act = await svc.setActiveTeacherCard(cardMat);
  check('D0 precondición: clase v2 activa', act.type === 'class_activated', JSON.stringify(act).slice(0, 160));

  const r1 = await svc.registerScan({ scanInput: '1000000001', method: 'USB' });
  check('D1 estudiante de 10°3 → registrado con la materia de la tarjeta', (r1.type === 'success_punctual' || r1.type === 'success_tardy') && r1.record?.subject === 'Matemáticas' && r1.record?.teacherId === 'prof-r43-1');
  check('D2 transparencia: grado del CARNÉ + contexto QR_CLASE firmado', r1.record?.studentGrade === '10°3' && r1.record?.contextSource === 'QR_CLASE' && r1.record?.classQrVerified === true);

  const r2 = await svc.registerScan({ scanInput: '2000000002', method: 'USB' });
  check('D3 estudiante de OTRO grado (6°4) → TAMBIÉN se registra (sin gate de grado)', (r2.type === 'success_punctual' || r2.type === 'success_tardy') && r2.record?.studentGrade === '6°4' && r2.record?.subject === 'Matemáticas' && r2.record?.teacherId === 'prof-r43-1');

  const r3 = await svc.registerScan({ scanInput: '1000000001', method: 'USB' });
  check('D4 unicidad estudiante+fecha+bloque → already_scanned', r3.type === 'already_scanned');

  // —— PARTE 2: regresión v1 (bloque NUEVO slot-r43-v1, sin registros previos) ——
  svc.clearActiveClass();
  svc.saveScheduleSlots([
    { id: 'slot-r43-v1', order: 1, type: 'CLASS', name: '2ª Hora', startTime: timePlus(-10), endTime: timePlus(+40), durationMinutes: 50 }
  ]);
  const dowToday = new Date().getDay(); // el check real de v1 compara contra esto SIN fallback
  const v1Token = await crypto.generateClassQrPayload('10°3', 'slot-r43-v1', dowToday, Date.now() + 3600_000, secret);
  const v1Act = await svc.setActiveClassFromToken(v1Token);
  check('D5 v1 intacto: activación por cátedra funciona', v1Act.type === 'class_activated', JSON.stringify(v1Act).slice(0, 160));
  check('D6 v1: contexto trae grado y sin sourceVersion', svc.getActiveClass()?.grade === '10°3' && svc.getActiveClass()?.sourceVersion === undefined);

  const r4 = await svc.registerScan({ scanInput: '2000000002', method: 'USB' });
  check('D7 v1 conserva el gate de grado: 6°4 NO se contamina (ruta HORA)', r4.type !== 'already_scanned' && r4.record?.contextSource === 'HORA' && r4.record?.subject !== 'Matemáticas');
  const r5 = await svc.registerScan({ scanInput: '1000000001', method: 'USB' });
  check('D8 v1: estudiante del mismo grado SÍ se vincula a la cátedra', r5.type !== 'already_scanned' && r5.record?.contextSource === 'QR_CLASE' && r5.record?.classQrVerified === true);

  svc.clearActiveClass();
  check('D9 clearActiveClass apaga el contexto', svc.getActiveClass() === null);
});

console.log(`\n══════════════════════════════════════`);
console.log(`  RESULTADO: ${passed} OK · ${failed} FALLO`);
if (failures.length) {
  console.log('  Fallos:');
  failures.forEach(f => console.log(`   - ${f}`));
  process.exit(1);
}
console.log('  SUITE RONDA 43 EN VERDE');
