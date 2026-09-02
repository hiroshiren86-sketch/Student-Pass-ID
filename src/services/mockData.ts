import { Student, SchoolSettings, Teacher, ScheduleSlot, ClassScheduleAssignment, DayTemplateConfig } from '../types/attendance';

export const DEFAULT_SCHOOL_SETTINGS: SchoolSettings = {
  schoolName: 'Institución Educativa Antonia Santos (I.N.A.S)',
  schoolCode: 'INAS-ANTONIA-SANTOS-2026',
  dailyStartTime: '06:30',
  dailyEndTime: '12:30',
  shiftType: 'MANANA',
  activeDayTemplate: 'NORMAL',
  trimMinutes: 0,
  tardyGracePeriodMinutes: 10, // 06:40 AM
  qrSecret: 'INAS-HMAC-QR-SECRET-COL-2026',
  sessionSecret: 'INAS-SESSION-SECRET-2026',
  soundFeedback: true,
  autoFocusUsb: true,
  rateLimitMaxPerMin: 30,
  aiProvider: 'groq',
  aiModel: 'openai/gpt-oss-120b',
  aiPrivacyOptOut: true,
  cloudflareWorkerUrl: 'https://inas-attendance-worker.hiroshiren86.workers.dev',
  cloudflareKvNamespaceId: '3b249fb9b0014f918680646a5ae869f6',
  cloudflareAutoSync: true,
  cloudflareSyncIntervalMinutes: 5
};

export const DAY_TEMPLATES_DEFINITIONS: DayTemplateConfig[] = [
  {
    id: 'tmpl-normal',
    type: 'NORMAL',
    name: 'Plantilla A: Día Normal',
    badge: 'Jornada Ordinaria',
    description: '6 bloques estándar de 55 min (06:30 - 12:30) con 30 min de recreo. Aviso proporcional a T-11.',
    shift: 'MANANA',
    baseStartTime: '06:30',
    blockDurationMinutes: 55,
    trimMinutesPerBlock: 0,
    recessDurationMinutes: 30,
    totalBlocks: 6,
    proportionalNoticeMinutes: 11
  },
  {
    id: 'tmpl-recorte-10',
    type: 'RECORTE_10',
    name: 'Plantilla B: Recorte −10',
    badge: 'Jornada Pedagógica',
    description: '6 bloques de 45 min. La jornada culmina a las ~11:30 para reunión docente. Aviso a T-9.',
    shift: 'MANANA',
    baseStartTime: '06:30',
    blockDurationMinutes: 45,
    trimMinutesPerBlock: 10,
    recessDurationMinutes: 30,
    totalBlocks: 6,
    proportionalNoticeMinutes: 9
  },
  {
    id: 'tmpl-izada-bandera',
    type: 'IZADA_BANDERA',
    name: 'Plantilla C: Izada de Bandera',
    badge: 'Acto Cívico',
    description: 'Bloque 1 = Acto Cívico (no computable) + 5 bloques recortados de 45 min. Salida ~11:30.',
    shift: 'MANANA',
    baseStartTime: '06:30',
    blockDurationMinutes: 45,
    trimMinutesPerBlock: 10,
    recessDurationMinutes: 30,
    totalBlocks: 6,
    firstBlockSpecial: 'ACTO_CIVICO',
    proportionalNoticeMinutes: 9
  },
  {
    id: 'tmpl-asesoria-grupo',
    type: 'ASESORIA_GRUPO',
    name: 'Plantilla D: Asesoría de Grupo',
    badge: 'Dirección de Grupo',
    description: 'Bloque 1 = Dirección de Grupo (¡sí computable por el Director de Grupo!) + 5 bloques recortados.',
    shift: 'MANANA',
    baseStartTime: '06:30',
    blockDurationMinutes: 45,
    trimMinutesPerBlock: 10,
    recessDurationMinutes: 30,
    totalBlocks: 6,
    firstBlockSpecial: 'ASESORIA_GRUPO',
    proportionalNoticeMinutes: 9
  },
  {
    id: 'tmpl-dia-especial',
    type: 'DIA_ESPECIAL',
    name: 'Plantilla E: Día Especial',
    badge: 'Sin Ausencias Automáticas',
    description: 'Toda la jornada no computable (Día de la familia, salidas pedagógicas, elecciones personero). Cero ausencias.',
    shift: 'MANANA',
    baseStartTime: '06:30',
    blockDurationMinutes: 55,
    trimMinutesPerBlock: 0,
    recessDurationMinutes: 30,
    totalBlocks: 6,
    isNonComputableAllDay: true
  }
];

// Nombres y apellidos colombianos/latinoamericanos realistas
const FIRST_NAMES_M = ['Santiago', 'Mateo', 'Juan David', 'Alejandro', 'Daniel', 'Sebastián', 'Felipe', 'Tomás', 'Samuel', 'Emiliano', 'Nicolás', 'Lucas', 'Martín', 'Joaquín', 'Simón', 'Camilo', 'Gabriel', 'Matías', 'Andrés', 'David', 'Diego', 'Esteban', 'Javier', 'Leonardo', 'Miguel'];
const FIRST_NAMES_F = ['Valentina', 'Mariana', 'Isabella', 'Camila', 'Salomé', 'Luciana', 'Gabriela', 'Sara', 'Juliana', 'Valeria', 'María José', 'Antonia', 'Emma', 'Manuela', 'Julieta', 'Elena', 'Alicia', 'Sofía', 'Catalina', 'Paula', 'Laura', 'Carolina', 'Daniela', 'Natalia', 'Valery'];
const LAST_NAMES = ['Gómez', 'Martínez', 'Vargas', 'Zuluaga', 'Morales', 'Ríos', 'Mejía', 'Herrera', 'Quintero', 'Giraldo', 'Pérez', 'Arboleda', 'Montoya', 'Osorio', 'Echeverri', 'Villegas', 'Ceballos', 'Betancur', 'Gallego', 'Tamayo', 'Berrío', 'Correa', 'Guzmán', 'Rendón', 'Suárez', 'Ocampo', 'Espinosa', 'Álvarez', 'Restrepo', 'Botero', 'Castañeda', 'Saldarriaga', 'Trujillo', 'Valencia', 'Henao', 'Londoño', 'Cano', 'Castaño', 'Cardona', 'Jaramillo', 'Bedoya', 'Uribe', 'Tabares', 'Marín', 'Salazar', 'Cuartas', 'Duque', 'Posada', 'Sierra', 'Franco'];

// Cursos escolares estándar: 6°1, 6°2, 7°1, 7°2, 8°1, 9°1, 10°1, 11°1, 11°2
export const SCHOOL_GRADES_LIST = [
  '6°1', '6°2', 
  '7°1', '7°2', 
  '8°1', '8°2', 
  '9°1', '9°2', 
  '10°1', '10°2', 
  '11°1', '11°2'
];

export function generateSeedStudents(): Student[] {
  const students: Student[] = [];

  for (let i = 1; i <= 50; i++) {
    const codeNum = 1000000000 + i;
    const code = codeNum.toString();
    const documentId = code; // Identificación ficticia unificada
    const isFemale = i % 2 === 0;
    const firstName = isFemale 
      ? FIRST_NAMES_F[(i / 2 - 1) % FIRST_NAMES_F.length] 
      : FIRST_NAMES_M[Math.floor(i / 2) % FIRST_NAMES_M.length];
    const lastName = `${LAST_NAMES[(i - 1) % LAST_NAMES.length]} ${LAST_NAMES[(i + 5) % LAST_NAMES.length]}`;
    
    // Distribuir entre los cursos escolares (6°1, 6°2, etc.)
    const gradeIdx = (i - 1) % SCHOOL_GRADES_LIST.length;
    const grade = SCHOOL_GRADES_LIST[gradeIdx];
    const section = grade.includes('1') ? '1' : (grade.includes('2') ? '2' : 'A');

    // Contraseña de credencial temporal para carné
    const tempPassword = `SJ-${(1000 + (i * 137) % 9000)}`;

    // Representantes titulares y suplentes para jerarquía de 3 niveles
    const isTitularRep = code === '1000000002' || code === '1000000001'; // Valentina Gómez (6°1), Santiago Gómez (10°1)
    const isSubRep = code === '1000000004' || code === '1000000003';     // Mariana Martínez (6°1), Mateo Vargas (10°1)
    const repGrade = (isTitularRep || isSubRep) ? (grade === '6°1' ? '6°1' : (grade === '10°1' ? '10°1' : undefined)) : undefined;

    students.push({
      code,
      documentId,
      firstName,
      lastName,
      grade,
      section,
      active: true,
      createdAt: '2026-01-15T07:00:00.000Z',
      tempPassword,
      isRepresentative: isTitularRep,
      isSubstituteRepresentative: isSubRep,
      representativeGrade: repGrade
    });
  }

  return students;
}

export const INITIAL_STUDENTS: Student[] = generateSeedStudents();

export const INITIAL_TEACHERS: Teacher[] = [
  {
    id: 'prof-1',
    documentId: '71829301',
    fullName: 'Juan Pablo Pérez Gómez',
    email: 'jperez@inas.edu.co',
    phone: '3001234567',
    subjects: ['Matemáticas', 'Física', 'Geometría'],
    assignedGrades: ['10°1', '10°2', '11°1', '11°2'],
    username: 'jperez',
    tempPassword: 'Profe2026*Mat',
    active: true,
    createdAt: '2026-01-10T08:00:00.000Z',
    isGroupDirector: true,
    directorGrade: '10°1'
  },
  {
    id: 'prof-2',
    documentId: '43920192',
    fullName: 'María Camila Restrepo Henao',
    email: 'mrestrepo@inas.edu.co',
    phone: '3109876543',
    subjects: ['Lengua Castellana', 'Literatura', 'Comprensión Lectora'],
    assignedGrades: ['6°1', '6°2', '7°1', '7°2'],
    username: 'mrestrepo',
    tempPassword: 'Profe2026*Esp',
    active: true,
    createdAt: '2026-01-10T08:00:00.000Z',
    isGroupDirector: true,
    directorGrade: '6°1'
  },
  {
    id: 'prof-3',
    documentId: '98765432',
    fullName: 'Carlos Alberto Mendoza Jaramillo',
    email: 'cmendoza@inas.edu.co',
    phone: '3156781234',
    subjects: ['Ciencias Sociales', 'Historia', 'Democracia', 'Filosofía'],
    assignedGrades: ['8°1', '8°2', '9°1', '10°1', '11°2'],
    username: 'cmendoza',
    tempPassword: 'Profe2026*Soc',
    active: true,
    createdAt: '2026-01-10T08:00:00.000Z',
    isGroupDirector: true,
    directorGrade: '8°1'
  },
  {
    id: 'prof-4',
    documentId: '32109876',
    fullName: 'Diana Carolina Valencia Morales',
    email: 'dvalencia@inas.edu.co',
    phone: '3205432198',
    subjects: ['Ciencias Naturales', 'Química', 'Biología'],
    assignedGrades: ['9°1', '9°2', '10°1', '10°2', '11°2'],
    username: 'dvalencia',
    tempPassword: 'Profe2026*Nat',
    active: true,
    createdAt: '2026-01-10T08:00:00.000Z'
  },
  {
    id: 'prof-5',
    documentId: '10293847',
    fullName: 'Andrés Felipe Giraldo Duque',
    email: 'agiraldo@inas.edu.co',
    phone: '3012348765',
    subjects: ['Inglés', 'Bilingüismo'],
    assignedGrades: ['6°1', '8°1', '10°1', '11°1'],
    username: 'agiraldo',
    tempPassword: 'Profe2026*Ing',
    active: true,
    createdAt: '2026-01-10T08:00:00.000Z'
  },
  {
    id: 'prof-6',
    documentId: '80123456',
    fullName: 'Sebastián Morales Castro',
    email: 'smorales@inas.edu.co',
    phone: '3128765432',
    subjects: ['Tecnología e Informática', 'Robótica', 'Educación Física'],
    assignedGrades: ['7°1', '9°1', '10°1', '11°2'],
    username: 'smorales',
    tempPassword: 'Profe2026*Tec',
    active: true,
    createdAt: '2026-01-10T08:00:00.000Z'
  }
];

// Plantilla Base Jornada Mañana (06:30 - 12:30): 6 Bloques de 55 min + 1 Recreo de 30 min (09:15 - 09:45)
export const DEFAULT_SCHEDULE_SLOTS: import('../types/attendance').ScheduleSlot[] = [
  { id: 'slot-1', order: 1, type: 'CLASS', name: '1ª Hora de Clase', startTime: '06:30', endTime: '07:25', durationMinutes: 55, noticeMinutesBeforeEnd: 11, color: '#4f46e5' },
  { id: 'slot-2', order: 2, type: 'CLASS', name: '2ª Hora de Clase', startTime: '07:25', endTime: '08:20', durationMinutes: 55, noticeMinutesBeforeEnd: 11, color: '#4f46e5' },
  { id: 'slot-3', order: 3, type: 'CLASS', name: '3ª Hora de Clase', startTime: '08:20', endTime: '09:15', durationMinutes: 55, noticeMinutesBeforeEnd: 11, color: '#4f46e5' },
  { id: 'slot-4', order: 4, type: 'BREAK', name: 'Recreo / Descanso Principal', startTime: '09:15', endTime: '09:45', durationMinutes: 30, color: '#10b981' },
  { id: 'slot-5', order: 5, type: 'CLASS', name: '4ª Hora de Clase', startTime: '09:45', endTime: '10:40', durationMinutes: 55, noticeMinutesBeforeEnd: 11, color: '#4f46e5' },
  { id: 'slot-6', order: 6, type: 'CLASS', name: '5ª Hora de Clase', startTime: '10:40', endTime: '11:35', durationMinutes: 55, noticeMinutesBeforeEnd: 11, color: '#4f46e5' },
  { id: 'slot-7', order: 7, type: 'CLASS', name: '6ª Hora de Clase', startTime: '11:35', endTime: '12:30', durationMinutes: 55, noticeMinutesBeforeEnd: 11, color: '#4f46e5' }
];

export const INITIAL_SCHEDULE_ASSIGNMENTS: import('../types/attendance').ClassScheduleAssignment[] = [
  // 10°1 Lunes (Bloque Doble 1ª y 2ª hora: Matemáticas - Prof. Juan Pablo Pérez)
  { id: 'as-1', dayOfWeek: 1, slotId: 'slot-1', grade: '10°1', subject: 'Matemáticas', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 204', isDoubleBlock: true, doubleBlockRole: 'FIRST_HOUR', doubleBlockLinkedSlotId: 'slot-2' },
  { id: 'as-2', dayOfWeek: 1, slotId: 'slot-2', grade: '10°1', subject: 'Matemáticas', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 204', isDoubleBlock: true, doubleBlockRole: 'SECOND_HOUR', doubleBlockLinkedSlotId: 'slot-1' },
  { id: 'as-3', dayOfWeek: 1, slotId: 'slot-3', grade: '10°1', subject: 'Ciencias Sociales', teacherId: 'prof-3', teacherName: 'Carlos Alberto Mendoza Jaramillo', classroom: 'Aula 204' },
  { id: 'as-4', dayOfWeek: 1, slotId: 'slot-5', grade: '10°1', subject: 'Inglés', teacherId: 'prof-5', teacherName: 'Andrés Felipe Giraldo Duque', classroom: 'Laboratorio de Idiomas' },
  { id: 'as-5', dayOfWeek: 1, slotId: 'slot-6', grade: '10°1', subject: 'Tecnología e Informática', teacherId: 'prof-6', teacherName: 'Sebastián Morales Castro', classroom: 'Sala de Sistemas' },
  { id: 'as-6', dayOfWeek: 1, slotId: 'slot-7', grade: '10°1', subject: 'Química', teacherId: 'prof-4', teacherName: 'Diana Carolina Valencia Morales', classroom: 'Laboratorio de Ciencias' },

  // 11°2 Miércoles (Bloque Doble 1ª y 2ª hora: Matemáticas - Prof. Juan Pablo Pérez)
  { id: 'as-112-1', dayOfWeek: 3, slotId: 'slot-1', grade: '11°2', subject: 'Matemáticas', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 302', isDoubleBlock: true, doubleBlockRole: 'FIRST_HOUR', doubleBlockLinkedSlotId: 'slot-2' },
  { id: 'as-112-2', dayOfWeek: 3, slotId: 'slot-2', grade: '11°2', subject: 'Matemáticas', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 302', isDoubleBlock: true, doubleBlockRole: 'SECOND_HOUR', doubleBlockLinkedSlotId: 'slot-1' },
  { id: 'as-112-3', dayOfWeek: 3, slotId: 'slot-3', grade: '11°2', subject: 'Filosofía', teacherId: 'prof-3', teacherName: 'Carlos Alberto Mendoza Jaramillo', classroom: 'Aula 302' },
  // 11°2 Miércoles (Bloque Doble 4ª y 5ª hora: Química - Prof. Diana Valencia)
  { id: 'as-112-4', dayOfWeek: 3, slotId: 'slot-5', grade: '11°2', subject: 'Química', teacherId: 'prof-4', teacherName: 'Diana Carolina Valencia Morales', classroom: 'Laboratorio de Ciencias', isDoubleBlock: true, doubleBlockRole: 'FIRST_HOUR', doubleBlockLinkedSlotId: 'slot-6' },
  { id: 'as-112-5', dayOfWeek: 3, slotId: 'slot-6', grade: '11°2', subject: 'Química', teacherId: 'prof-4', teacherName: 'Diana Carolina Valencia Morales', classroom: 'Laboratorio de Ciencias', isDoubleBlock: true, doubleBlockRole: 'SECOND_HOUR', doubleBlockLinkedSlotId: 'slot-5' },
  { id: 'as-112-6', dayOfWeek: 3, slotId: 'slot-7', grade: '11°2', subject: 'Educación Física', teacherId: 'prof-6', teacherName: 'Sebastián Morales Castro', classroom: 'Cancha Polideportiva' },

  // 10°2 Lunes (Bloque Doble 1ª y 2ª hora: Lengua Castellana)
  { id: 'as-7', dayOfWeek: 1, slotId: 'slot-1', grade: '10°2', subject: 'Lengua Castellana', teacherId: 'prof-2', teacherName: 'María Camila Restrepo Henao', classroom: 'Aula 205', isDoubleBlock: true, doubleBlockRole: 'FIRST_HOUR', doubleBlockLinkedSlotId: 'slot-2' },
  { id: 'as-8', dayOfWeek: 1, slotId: 'slot-2', grade: '10°2', subject: 'Lengua Castellana', teacherId: 'prof-2', teacherName: 'María Camila Restrepo Henao', classroom: 'Aula 205', isDoubleBlock: true, doubleBlockRole: 'SECOND_HOUR', doubleBlockLinkedSlotId: 'slot-1' },
  { id: 'as-9', dayOfWeek: 1, slotId: 'slot-3', grade: '10°2', subject: 'Ciencias Sociales', teacherId: 'prof-3', teacherName: 'Carlos Alberto Mendoza Jaramillo', classroom: 'Aula 205' },
  { id: 'as-10', dayOfWeek: 1, slotId: 'slot-5', grade: '10°2', subject: 'Química', teacherId: 'prof-4', teacherName: 'Diana Carolina Valencia Morales', classroom: 'Laboratorio de Ciencias' },

  // 11°1 Lunes (Bloque Doble 1ª y 2ª hora: Física)
  { id: 'as-11', dayOfWeek: 1, slotId: 'slot-1', grade: '11°1', subject: 'Física', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 301', isDoubleBlock: true, doubleBlockRole: 'FIRST_HOUR', doubleBlockLinkedSlotId: 'slot-2' },
  { id: 'as-12', dayOfWeek: 1, slotId: 'slot-2', grade: '11°1', subject: 'Física', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 301', isDoubleBlock: true, doubleBlockRole: 'SECOND_HOUR', doubleBlockLinkedSlotId: 'slot-1' },
  { id: 'as-13', dayOfWeek: 1, slotId: 'slot-3', grade: '11°1', subject: 'Inglés', teacherId: 'prof-5', teacherName: 'Andrés Felipe Giraldo Duque', classroom: 'Aula 301' },

  // 6°1 Lunes
  { id: 'as-14', dayOfWeek: 1, slotId: 'slot-1', grade: '6°1', subject: 'Lengua Castellana', teacherId: 'prof-2', teacherName: 'María Camila Restrepo Henao', classroom: 'Aula 101' },
  { id: 'as-15', dayOfWeek: 1, slotId: 'slot-2', grade: '6°1', subject: 'Inglés', teacherId: 'prof-5', teacherName: 'Andrés Felipe Giraldo Duque', classroom: 'Aula 101' }
];
