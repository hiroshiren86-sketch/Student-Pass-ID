/**
 * Ronda 43/44 — Suite LOCAL (determinista, sin red). Ejecutar: TZ=America/Bogota bun scripts/verify_ronda43.ts
 * Cubre el protocolo CLASE:v2 (Tarjetas QR de Docente — mandato del propietario:
 * "cada profesor tenga su tarjeta; no depende del horario"), sus REFINAMIENTOS Ronda 44
 * (handoff QR_v2_refinements_HANDOFF.md) y su integración:
 *   A: slugifySubject/prettifySubjectSlug + generador + parser v2 (formato/firma/tamper/expiración/guards C.1)
 *   B: setActiveTeacherCard (orden de validación §2.2 + A/grade:'*', C.2/C.3/D2, B/bloque-por-reloj)
 *   C: 1-toque v2 en Aula Docente (activateTeacherSubjectDirect)
 *   D: registerScan sin gate de grado (grado del carné + slotId del reloj) + unicidad + v1 intacto
 * La v1 (CLASE:v1) NO se toca: coexistencia por prefijo, verificada al final. Su UI quedó
 * OCULTA por completo (mandato del propietario, Ronda 44).
 * NOTA de reloj: TODA la app deriva el tiempo de America/Bogota (getCurrentTimeString/getTodayDateString)
 * y Date.parse interpreta en la TZ del runtime — la suite DEBE correr con TZ=America/Bogota.
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
// Ronda 58 (F-19): el watchdog se GUARDA y se limpia al terminar. Antes quedaba
// vivo 90 s tras el último check → la suite imprimía "TIMEOUT GLOBAL" y terminaba
// con exit code 2 AUNQUE los 51 checks estuvieran en verde (CI siempre rojo).
const SUITE_WATCHDOG = setTimeout(() => { console.log('⏱ TIMEOUT GLOBAL DE LA SUITE LOCAL'); process.exit(2); }, 90000);
if (typeof SUITE_WATCHDOG.unref === 'function') SUITE_WATCHDOG.unref();

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
const { AttendanceStorageService, schoolYearEndEpochMs, getCurrentTimeString, getTodayDateString } = await import('../src/services/attendanceStorage');
const svc = AttendanceStorageService;

// Ronda 60-c — bloques de prueba HORA-SEGUROS. timePlus(±) generaba bloques tipo
// 23:53→00:43 que CRUZAN la medianoche cuando la suite corre entre ~23:20-00:10;
// el localizador de bloques por reloj del producto (correctamente para el dominio
// escolar) no soporta cruce de medianoche → falsas fallas C2/C6/D0 reproducidas
// idénticas en baseline (stash, evidencia qa_logs/r43_baseline.txt). Aserciones
// intactas: solo el fixture es seguro por construcción.
function currentMinuteOfDay(): number {
  const [h, m] = getCurrentTimeString().split(':').map(Number);
  return h * 60 + m;
}
function fmtMinuteOfDay(t: number): string {
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
// Bloque ACTIVO por construcción: contiene "ahora", jamás cruza medianoche.
function safeBlock(backMin: number, fwdMin: number): { start: string; end: string } {
  const nowMin = currentMinuteOfDay();
  return { start: fmtMinuteOfDay(Math.max(0, nowMin - backMin)), end: fmtMinuteOfDay(Math.min(1439, nowMin + fwdMin)) };
}
// Bloque YA FINALIZADO por construcción: termina antes de ahora, mismo día.
function safePastBlock(): { start: string; end: string } {
  const nowMin = currentMinuteOfDay();
  return { start: fmtMinuteOfDay(Math.max(0, nowMin - 30)), end: fmtMinuteOfDay(Math.max(0, nowMin - 20)) };
}

/** Ejecuta fn y captura su mensaje de error (para probar los guards que lanzan). */
async function safe(fn: () => Promise<unknown>): Promise<{ error?: string }> {
  try { await fn(); return {}; }
  catch (e: any) { return { error: e?.message || String(e) };
  }
}

await section('A — slugifySubject / prettifySubjectSlug / guards del generador (C.1)', () => {
  check('A1 sin tildes: Lengua Castellana', crypto.slugifySubject('Lengua Castellana') === 'lengua-castellana');
  check('A2 puntuación/tildes: C. Naturales (Biología)', crypto.slugifySubject('C. Naturales (Biología)') === 'c-naturales-biologia');
  check('A3 colapsa guiones y recorta', crypto.slugifySubject('Educación   Física --y-- Deporte ') === 'educacion-fisica-y-deporte');
  check('A4 mayúsculas y ñ: Español Ñandú', crypto.slugifySubject('Español Ñandú') === 'espanol-nandu');
  const problematic = ['Matemáticas', 'C. Económicas y Políticas', 'Informática', 'Artística', 'Religión', 'Ética', 'Sociales'];
  check('A5 ningún slug institucional contiene ":" o "|"', problematic.every(s => !crypto.slugifySubject(s).includes(':') && !crypto.slugifySubject(s).includes('|')));
  check('A6 prettify: c-naturales-biologia → C Naturales Biologia', crypto.prettifySubjectSlug('c-naturales-biologia') === 'C Naturales Biologia');
  check('A7 prettify: lengua-castellana → Lengua Castellana', crypto.prettifySubjectSlug('lengua-castellana') === 'Lengua Castellana');
});

await section('B — protocolo CLASE:v2 (generador + parser)', async () => {
  const secret = 'r43-secret-unit';
  const exp = schoolYearEndEpochMs();
  const payload = await crypto.generateTeacherCardPayload('prof-1788591549776', 'lengua-castellana', exp, secret);
  const parts = payload.split(':');
  check('B1 formato: prefijo + 6 partes exactas', payload.startsWith('CLASE:v2:') && parts.length === 6);
  check('B2 teacherId y slug viajan en el token', parts[2] === 'prof-1788591549776' && parts[3] === 'lengua-castellana');
  // Ronda 58 (F-13): la firma viaja a 32 hex (128 bits); el parser además acepta
  // las legacy de 16 hex de carnés ya impresos (transición).
  check('B3 firma 32 hex (128 bits)', !!parts[5] && /^[0-9a-f]{32}$/.test(parts[5]));

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

  // Ronda 44 — Refinamiento C.1: el generador RECHAZA con error explícito en español
  const g1 = await safe(() => crypto.generateTeacherCardPayload('', 'matematicas', exp, secret));
  check('B14 guard C.1: falta teacherId → error explícito', g1.error === 'Falta el identificador del docente.');
  const g2 = await safe(() => crypto.generateTeacherCardPayload('prof-x', '', exp, secret));
  check('B15 guard C.1: falta asignatura → error explícito', g2.error === 'Falta la asignatura de la tarjeta.');
  const g3 = await safe(() => crypto.generateTeacherCardPayload('pro:f-x', 'matematicas', exp, secret));
  check('B16 guard C.1: teacherId con ":" reservado → error explícito', g3.error === 'El identificador del docente contiene caracteres reservados (:) o (|).');
  const g4 = await safe(() => crypto.generateTeacherCardPayload('prof-x', 'mate|rias', exp, secret));
  check('B17 guard C.1: asignatura con "|" reservado → error explícito', g4.error === 'La asignatura contiene caracteres reservados (:) o (|). Usa el catálogo institucional.');

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
  const pastBlk = safePastBlock(); // ya finalizado a cualquier hora (antes: 00:00-00:05 fijo era landmine 00:00-00:05)
  svc.saveScheduleSlots([
    { id: 'slot-r43-past', order: 1, type: 'CLASS', name: '1ª Hora', startTime: pastBlk.start, endTime: pastBlk.end, durationMinutes: 5 }
  ]);
  const outOfBlock = await svc.setActiveTeacherCard(cardMatematicas);
  check('C1 fuera de bloque CLASE → no_active_slot', outOfBlock.type === 'no_active_slot');

  // Bloque vigente que cubre AHORA (hora-seguro)
  const blkNow = safeBlock(10, 40);
  svc.saveScheduleSlots([
    { id: 'slot-r43-now', order: 1, type: 'CLASS', name: '1ª Hora', startTime: blkNow.start, endTime: blkNow.end, durationMinutes: 50 }
  ]);
  const activated = await svc.setActiveTeacherCard(cardMatematicas);
  check('C2 tarjeta válida dentro de bloque → class_activated', activated.type === 'class_activated', JSON.stringify(activated).slice(0, 160));

  const ctx = svc.getActiveClass();
  check('C3 contexto v2 guardado: materia/docente/teacherId', !!ctx && ctx.subject === 'Matemáticas' && ctx.teacherName === 'María Camila Restrepo Henao' && ctx.teacherId === 'prof-r43-1');
  check('C4 contexto v2: grade="*" (Refinamiento A), sin día, source QR_CLASE_V2, teacherVerified', !!ctx && ctx.grade === '*' && ctx.dayOfWeek === undefined && ctx.source === 'QR_CLASE_V2' && ctx.teacherVerified === true && ctx.slotId === 'slot-r43-now');

  // (8) Enriquecimiento opcional con horario: aula de la cátedra coincidente
  const todayDow = new Date().getDay() || 1;
  svc.saveScheduleAssignments([
    { id: 'asg-r43', dayOfWeek: todayDow, slotId: 'slot-r43-now', grade: '10°3', subject: 'Matemáticas', teacherId: 'prof-r43-1', teacherName: 'María Camila Restrepo Henao', classroom: 'Aula 204' }
  ]);
  const enriched = await svc.setActiveTeacherCard(cardMatematicas);
  const ctx2 = svc.getActiveClass();
  check('C5 enriquecimiento: aula de la cátedra coincidente (sin bloquear nada)', enriched.type === 'class_activated' && ctx2?.classroom === 'Aula 204');

  // (5) docente INACTIVO sí se rechaza (conocimiento local positivo); NO encontrado se acepta (C.3/D2)
  const ghost = await crypto.generateTeacherCardPayload('prof-fantasma', 'matematicas', exp, secret);
  const ghostRes = await svc.setActiveTeacherCard(ghost);
  check('C6 docente NO hallado en el dispositivo → tarjeta ACEPTADA (Refinamiento C.3/D2)', ghostRes.type === 'class_activated', JSON.stringify(ghostRes).slice(0, 160));
  const ghostCtx = svc.getActiveClass();
  check('C6b contexto fantasma: teacherVerified=false + credencial por id + slug formateado', !!ghostCtx && ghostCtx.teacherVerified === false && ghostCtx.teacherName === 'Docente (id prof-fantasma)' && ghostCtx.subject === 'Matematicas' && ghostCtx.teacherId === 'prof-fantasma');
  const inactiveCard = await crypto.generateTeacherCardPayload('prof-r43-2', crypto.slugifySubject('Química'), exp, secret);
  const inactiveRes = await svc.setActiveTeacherCard(inactiveCard);
  check('C7 docente inactivo → rechazo', inactiveRes.type === 'error' && inactiveRes.title === 'Docente inactivo');

  // (6) asignatura fuera de la ficha (ficha POBLADA) → rechazo con lista de vigentes (C.2)
  const wrongSubj = await crypto.generateTeacherCardPayload('prof-r43-1', 'quimica-avanzada', exp, secret);
  const wrongRes = await svc.setActiveTeacherCard(wrongSubj);
  check('C8 asignatura ya no asignada → pedir regeneración listando vigentes', wrongRes.type === 'error' && wrongRes.title === 'Asignatura ya no asignada' && wrongRes.message.includes('Lengua Castellana, Matemáticas'));

  // (6-C.2) ficha VACÍA: no se puede probar obsolescencia → se acepta con el slug formateado
  const emptyCard = await crypto.generateTeacherCardPayload('prof-r43-3', 'biologia', exp, secret);
  const emptyRes = await svc.setActiveTeacherCard(emptyCard);
  check('C13 ficha sin asignaturas → aceptada (D2) con subject del propio slug', emptyRes.type === 'class_activated' && svc.getActiveClass()?.subject === 'Biologia' && svc.getActiveClass()?.teacherVerified === true);

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
  check('C11b 1-toque: source AULA_DOCENTE_V2 + grade "*" + teacherVerified', svc.getActiveClass()?.source === 'AULA_DOCENTE_V2' && svc.getActiveClass()?.grade === '*' && svc.getActiveClass()?.teacherVerified === true);
  const directBad = svc.activateTeacherSubjectDirect('prof-r43-1', 'Filosofía');
  check('C12 1-toque con materia ajena a la ficha → rechazo', directBad.type === 'error');

  // Ronda 44 — normalización legacy de getActiveClass (contextos pre-R44 en localStorage)
  const legacyV2 = { slotId: 'slot-r43-now', slotName: '1ª Hora', slotStartTime: '00:00', slotEndTime: '23:59', subject: 'Matemáticas', teacherName: 'María Camila Restrepo Henao', teacherId: 'prof-r43-1', activatedAt: new Date().toISOString(), expiresAt: Date.now() + 3600_000, activatedBy: 'QR_CLASE_V2', tokenSignature: 'LEGACY' };
  localStorage.setItem('inas_active_class_v1', JSON.stringify(legacyV2));
  const legacyCtx = svc.getActiveClass();
  check('C14 legacy R43 (activatedBy, sin grade) → source QR_CLASE_V2 + grade "*"', !!legacyCtx && legacyCtx.source === 'QR_CLASE_V2' && legacyCtx.grade === '*' && (legacyCtx as any).activatedBy === undefined);
  const legacyV1 = { ...legacyV2, grade: '10°3', dayOfWeek: 1, activatedBy: 'QR_CLASE', teacherId: undefined };
  localStorage.setItem('inas_active_class_v1', JSON.stringify(legacyV1));
  const legacyCtx1 = svc.getActiveClass();
  check('C15 legacy v1 (activatedBy QR_CLASE) → source QR_CLASE con grado intacto', !!legacyCtx1 && legacyCtx1.source === 'QR_CLASE' && legacyCtx1.grade === '10°3');
  svc.clearActiveClass();
});

await section('D — registerScan con clase v2 activa (sin gate de grado)', async () => {
  // Ronda 58 (F-1): esta sección ejercita el flujo USB-HID de códigos 1D PLANOS →
  // corre con la política de carné firmado DESACTIVADA (modo legado explícito, igual
  // que un colegio que opera con lectores 1D). La política ACTIVADA se prueba en E.
  svc.saveSettings({ ...svc.getSettings(), requireSignedCards: false }, false);
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
  const blkV1 = safeBlock(10, 40);
  svc.saveScheduleSlots([
    { id: 'slot-r43-v1', order: 1, type: 'CLASS', name: '2ª Hora', startTime: blkV1.start, endTime: blkV1.end, durationMinutes: 50 }
  ]);
  const dowToday = new Date().getDay(); // el check real de v1 compara contra esto SIN fallback
  const v1Token = await crypto.generateClassQrPayload('10°3', 'slot-r43-v1', dowToday, Date.now() + 3600_000, secret);
  const v1Act = await svc.setActiveClassFromToken(v1Token);
  check('D5 v1 intacto: activación por cátedra funciona', v1Act.type === 'class_activated', JSON.stringify(v1Act).slice(0, 160));
  check('D6 v1: contexto trae grado y source QR_CLASE', svc.getActiveClass()?.grade === '10°3' && svc.getActiveClass()?.source === 'QR_CLASE');

  const r4 = await svc.registerScan({ scanInput: '2000000002', method: 'USB' });
  check('D7 v1 conserva el gate de grado: 6°4 NO se contamina (ruta HORA)', r4.type !== 'already_scanned' && r4.record?.contextSource === 'HORA' && r4.record?.subject !== 'Matemáticas');
  const r5 = await svc.registerScan({ scanInput: '1000000001', method: 'USB' });
  check('D8 v1: estudiante del mismo grado SÍ se vincula a la cátedra', r5.type !== 'already_scanned' && r5.record?.contextSource === 'QR_CLASE' && r5.record?.classQrVerified === true);

  svc.clearActiveClass();
  check('D9 clearActiveClass apaga el contexto', svc.getActiveClass() === null);
});

// =====================================================================
// Ronda 58 (F-1) — POLÍTICA DE VERIFICACIÓN DEL CARNÉ EN EL PUNTO DE ESCANEO
// Los 4 casos que la auditoría pidió explícitos: forjado → rechazado;
// vencido → rechazado; plano con política ON → rechazado; plano con política
// OFF → aceptado con verifiedHmac:false (honesto). Más: firma válida → aceptado
// con verifiedHmac:true, y COL_ASIS legado → honesto (nunca auto-válido).
// =====================================================================
await section('E — Ronda 58 (F-1): política de carné firmado en el escaneo', async () => {
  const settings = svc.getSettings();
  const secret = settings.qrSecret;
  svc.saveSettings({ ...settings, requireSignedCards: true }, false);
  (svc as any).getSchoolDayWindow = () => ({ start: '00:00', end: '23:59', startMin: 0, endMin: 1439 });

  const std = { code: '3000000003', documentId: '3000000003', firstName: 'Prueba', lastName: 'Firma', grade: '10°3', section: '3', active: true, createdAt: new Date().toISOString() };
  svc.saveStudents([std] as any);
  const blkE = safeBlock(10, 40);
  svc.saveScheduleSlots([
    { id: 'slot-r58-e', order: 1, type: 'CLASS', name: '1ª Hora', startTime: blkE.start, endTime: blkE.end, durationMinutes: 50 }
  ] as any);

  // E1: carné FIRMADO CON SECRET AJENO (forjado) → rechazado, NO se registra
  const forged = await crypto.generateStudentQrPayload(std as any, 'secret-de-otra-institucion');
  const rForged = await svc.registerScan({ scanInput: forged, method: 'CAMERA' });
  check('E1 carné forjado (secret ajeno) → RECHAZADO', rForged.type === 'invalid_signature', JSON.stringify(rForged).slice(0, 120));
  check('E1b el forjado NO quedó registrado ni marcado verificado', !rForged.record);

  // E2: carné VENCIDO firmado correctamente → rechazado
  const expiredData = `IEDSJ:v1:${std.code}:${std.documentId}:${std.grade}:${std.section}:${Date.now() - 1000}:`;
  const expiredSig = await crypto.generateHmacSignature(`${std.code}|${std.documentId}|${std.grade}|${std.section}|${Date.now() - 1000}`, secret);
  const expiredCard = expiredData + expiredSig;
  const rExpired = await svc.registerScan({ scanInput: expiredCard, method: 'CAMERA' });
  check('E2 carné vencido → RECHAZADO', rExpired.type === 'invalid_signature');

  // E3: código PLANO (1D/tecleado) con política ON → rechazado
  const rPlainOn = await svc.registerScan({ scanInput: std.code, method: 'USB' });
  check('E3 código plano con política ON → RECHAZADO', rPlainOn.type === 'invalid_signature');

  // E4: COL_ASIS legado → parser honesto (jamás isSignatureValid:true)
  const colAsis = await crypto.parseAndVerifyScan('COL_ASIS:v1:3000000003:extra', secret);
  check('E4 COL_ASIS legado → isSignatureValid FALSE (fin del formato que se auto-validaba)', colAsis.isSigned === true && colAsis.isSignatureValid === false && colAsis.reason === 'LEGACY_COL_ASIS');

  // E5: carné VÁLIDO firmado con el secret institucional → aceptado + verifiedHmac TRUE
  const valid = await crypto.generateStudentQrPayload(std as any, secret);
  const rValid = await svc.registerScan({ scanInput: valid, method: 'CAMERA' });
  check('E5 carné válido → registrado con verifiedHmac TRUE', (rValid.type === 'success_punctual' || rValid.type === 'success_tardy') && rValid.record?.verifiedHmac === true, JSON.stringify(rValid).slice(0, 140));

  // E6: firma legacy de 16 hex (carnés impresos pre-R58) sigue verificando
  const legacyParts = valid.split(':');
  const legacyCard = [...legacyParts.slice(0, 7), legacyParts[7].slice(0, 16)].join(':');
  const legacyParse = await crypto.parseAndVerifyScan(legacyCard, secret);
  check('E6 firma legacy 16 hex → verifica (transición)', legacyParse.isSignatureValid === true && legacyParse.reason === 'OK');

  // E7: política OFF → el código plano se acepta PERO con verifiedHmac FALSE (honesto)
  svc.saveSettings({ ...svc.getSettings(), requireSignedCards: false }, false);
  // limpiar unicidad del E5: nuevo estudiante/bloque para el caso plano
  const std2 = { code: '4000000004', documentId: '4000000004', firstName: 'Plano', lastName: 'Legado', grade: '10°3', section: '3', active: true, createdAt: new Date().toISOString() };
  svc.saveStudents([std, std2] as any);
  const rPlainOff = await svc.registerScan({ scanInput: std2.code, method: 'USB' });
  check('E7 código plano con política OFF → aceptado y verifiedHmac FALSE', (rPlainOff.type === 'success_punctual' || rPlainOff.type === 'success_tardy') && rPlainOff.record?.verifiedHmac === false);

  // E8: forjado con política OFF → registrado PERO verifiedHmac FALSE (nunca "VÁLIDO")
  const forged2 = await crypto.generateStudentQrPayload({ ...std, code: '5000000005', documentId: '5000000005' } as any, 'secret-ajeno');
  svc.saveStudents([std, std2, { code: '5000000005', documentId: '5000000005', firstName: 'Forjado', lastName: 'Legado', grade: '10°3', section: '3', active: true, createdAt: new Date().toISOString() }] as any);
  const rForgedOff = await svc.registerScan({ scanInput: forged2, method: 'CAMERA' });
  check('E8 forjado con política OFF → aceptado PERO verifiedHmac FALSE (evidencia honesta)', (rForgedOff.type === 'success_punctual' || rForgedOff.type === 'success_tardy') && rForgedOff.record?.verifiedHmac === false);

  // E9 (F-9): auto-cierre con ID DETERMINISTA — dos dispositivos que cierran el
  // MISMO bloque producen registros con IDs IDÉNTICOS → el merge de la nube los
  // deduplica por id en vez de SUMAR dos series de AUSENTE (planillas infladas).
  // El estudiante 6000000006 NO tiene ningún escaneo: es quien recibirá el AUSENTE.
  svc.saveStudents([std, std2, { code: '5000000005', documentId: '5000000005', firstName: 'Forjado', lastName: 'Legado', grade: '10°3', section: '3', active: true, createdAt: new Date().toISOString() }, { code: '6000000006', documentId: '6000000006', firstName: 'Ausente', lastName: 'Prueba', grade: '10°3', section: '3', active: true, createdAt: new Date().toISOString() }] as any);
  const todayE9 = getTodayDateString();
  await svc.closeBlockAttendance({ grade: '10°3', slotId: 'slot-r58-e', subject: 'Prueba', dateStr: todayE9, forceClose: true });
  const idsClose1 = svc.getAllAttendance()
    .filter(r => r.slotId === 'slot-r58-e' && r.method === 'AUTO_CIERRE')
    .map(r => r.id).sort();
  // Simula el SEGUNDO dispositivo: no conoce los AUSENTEs del primero, cierra igual
  svc.saveAttendance(svc.getAllAttendance().filter(r => !(r.slotId === 'slot-r58-e' && r.method === 'AUTO_CIERRE')));
  await svc.closeBlockAttendance({ grade: '10°3', slotId: 'slot-r58-e', subject: 'Prueba', dateStr: todayE9, forceClose: true });
  const idsClose2 = svc.getAllAttendance()
    .filter(r => r.slotId === 'slot-r58-e' && r.method === 'AUTO_CIERRE')
    .map(r => r.id).sort();
  check('E9 dos cierres del mismo bloque → IDs IDÉNTICOS (merge deduplica, no suma)', idsClose1.length > 0 && JSON.stringify(idsClose1) === JSON.stringify(idsClose2), `n=${idsClose1.length}`);
  check('E9b formato determinista rec-autoclose-<fecha>-<bloque>-<estudiante>', idsClose2.every(id => id.startsWith(`rec-autoclose-${todayE9}-slot-r58-e-`)));
  check('E9c registros de auto-cierre SIN verifiedHmac falso', svc.getAllAttendance().filter(r => r.method === 'AUTO_CIERRE').every(r => r.verifiedHmac === false));

  // E10 (F-22): getCurrentTimeString jamás devuelve hora "24:xx"
  const nowStr = getCurrentTimeString();
  check('E10 reloj h23: la hora jamás empieza por "24"', !nowStr.startsWith('24'), nowStr);

  // restaurar política para no contaminar a otras suites que compartan storage
  svc.saveSettings({ ...svc.getSettings(), requireSignedCards: true }, false);
});

clearTimeout(SUITE_WATCHDOG);
console.log(`\n══════════════════════════════════════`);
console.log(`  RESULTADO: ${passed} OK · ${failed} FALLO`);
if (failures.length) {
  console.log('  Fallos:');
  failures.forEach(f => console.log(`   - ${f}`));
  process.exit(1);
}
console.log('  SUITE RONDA 43 EN VERDE');
process.exit(0);
