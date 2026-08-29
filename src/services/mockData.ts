import { Student, SchoolSettings, Teacher, ScheduleSlot, ClassScheduleAssignment } from '../types/attendance';

export const DEFAULT_SCHOOL_SETTINGS: SchoolSettings = {
  schoolName: 'Institución Educativa Antonia Santos (I.N.A.S)',
  schoolCode: 'INAS-ANTONIA-SANTOS-2026',
  dailyStartTime: '07:00',
  dailyEndTime: '13:30',
  tardyGracePeriodMinutes: 15, // 07:15 AM
  qrSecret: 'INAS-HMAC-QR-SECRET-COL-2026',
  sessionSecret: 'INAS-SESSION-SECRET-2026',
  soundFeedback: true,
  autoFocusUsb: true,
  rateLimitMaxPerMin: 30
};

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

    students.push({
      code,
      documentId,
      firstName,
      lastName,
      grade,
      section,
      active: true,
      createdAt: '2026-01-15T07:00:00.000Z',
      tempPassword
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
    assignedGrades: ['10°1', '10°2', '11°1'],
    username: 'jperez',
    tempPassword: 'Profe2026*Mat',
    active: true,
    createdAt: '2026-01-10T08:00:00.000Z'
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
    createdAt: '2026-01-10T08:00:00.000Z'
  },
  {
    id: 'prof-3',
    documentId: '98765432',
    fullName: 'Carlos Alberto Mendoza Jaramillo',
    email: 'cmendoza@inas.edu.co',
    phone: '3156781234',
    subjects: ['Ciencias Sociales', 'Historia', 'Democracia'],
    assignedGrades: ['8°1', '8°2', '9°1', '10°1'],
    username: 'cmendoza',
    tempPassword: 'Profe2026*Soc',
    active: true,
    createdAt: '2026-01-10T08:00:00.000Z'
  },
  {
    id: 'prof-4',
    documentId: '32109876',
    fullName: 'Diana Carolina Valencia Morales',
    email: 'dvalencia@inas.edu.co',
    phone: '3205432198',
    subjects: ['Ciencias Naturales', 'Química', 'Biología'],
    assignedGrades: ['9°1', '9°2', '10°2', '11°2'],
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
    subjects: ['Tecnología e Informática', 'Robótica'],
    assignedGrades: ['7°1', '9°1', '10°1', '11°2'],
    username: 'smorales',
    tempPassword: 'Profe2026*Tec',
    active: true,
    createdAt: '2026-01-10T08:00:00.000Z'
  }
];

export const DEFAULT_SCHEDULE_SLOTS: import('../types/attendance').ScheduleSlot[] = [
  { id: 'slot-1', order: 1, type: 'CLASS', name: '1ª Hora de Clase', startTime: '07:00', endTime: '07:45', durationMinutes: 45, color: '#4f46e5' },
  { id: 'slot-2', order: 2, type: 'TRANSITION', name: 'Cambio de Salón / Aula', startTime: '07:45', endTime: '07:50', durationMinutes: 5, color: '#94a3b8' },
  { id: 'slot-3', order: 3, type: 'CLASS', name: '2ª Hora de Clase', startTime: '07:50', endTime: '08:35', durationMinutes: 45, color: '#4f46e5' },
  { id: 'slot-4', order: 4, type: 'CLASS', name: '3ª Hora de Clase', startTime: '08:35', endTime: '09:20', durationMinutes: 45, color: '#4f46e5' },
  { id: 'slot-5', order: 5, type: 'BREAK', name: 'Recreo / Descanso Principal', startTime: '09:20', endTime: '09:50', durationMinutes: 30, color: '#10b981' },
  { id: 'slot-6', order: 6, type: 'CLASS', name: '4ª Hora de Clase', startTime: '09:50', endTime: '10:35', durationMinutes: 45, color: '#4f46e5' },
  { id: 'slot-7', order: 7, type: 'TRANSITION', name: 'Cambio de Salón / Aula', startTime: '10:35', endTime: '10:40', durationMinutes: 5, color: '#94a3b8' },
  { id: 'slot-8', order: 8, type: 'CLASS', name: '5ª Hora de Clase', startTime: '10:40', endTime: '11:25', durationMinutes: 45, color: '#4f46e5' },
  { id: 'slot-9', order: 9, type: 'CLASS', name: '6ª Hora de Clase', startTime: '11:25', endTime: '12:10', durationMinutes: 45, color: '#4f46e5' },
  { id: 'slot-10', order: 10, type: 'LUNCH', name: 'Almuerzo / Pausa Activa', startTime: '12:10', endTime: '12:45', durationMinutes: 35, color: '#f59e0b' },
  { id: 'slot-11', order: 11, type: 'CLASS', name: '7ª Hora (Refuerzo / Taller)', startTime: '12:45', endTime: '13:30', durationMinutes: 45, color: '#6366f1' }
];

export const INITIAL_SCHEDULE_ASSIGNMENTS: import('../types/attendance').ClassScheduleAssignment[] = [
  // 10°1 Lunes (Bloque Doble 1ª y 2ª hora: Matemáticas)
  { id: 'as-1', dayOfWeek: 1, slotId: 'slot-1', grade: '10°1', subject: 'Matemáticas', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 204', isDoubleBlock: true, doubleBlockRole: 'FIRST_HOUR', doubleBlockLinkedSlotId: 'slot-3' },
  { id: 'as-2', dayOfWeek: 1, slotId: 'slot-3', grade: '10°1', subject: 'Matemáticas', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 204', isDoubleBlock: true, doubleBlockRole: 'SECOND_HOUR', doubleBlockLinkedSlotId: 'slot-1' },
  { id: 'as-3', dayOfWeek: 1, slotId: 'slot-4', grade: '10°1', subject: 'Ciencias Sociales', teacherId: 'prof-3', teacherName: 'Carlos Alberto Mendoza Jaramillo', classroom: 'Aula 204' },
  { id: 'as-4', dayOfWeek: 1, slotId: 'slot-6', grade: '10°1', subject: 'Inglés', teacherId: 'prof-5', teacherName: 'Andrés Felipe Giraldo Duque', classroom: 'Laboratorio de Idiomas' },
  { id: 'as-5', dayOfWeek: 1, slotId: 'slot-8', grade: '10°1', subject: 'Tecnología e Informática', teacherId: 'prof-6', teacherName: 'Sebastián Morales Castro', classroom: 'Sala de Sistemas' },
  { id: 'as-6', dayOfWeek: 1, slotId: 'slot-9', grade: '10°1', subject: 'Química', teacherId: 'prof-4', teacherName: 'Diana Carolina Valencia Morales', classroom: 'Laboratorio de Ciencias' },

  // 11°2 Miércoles (Bloque Doble 1ª y 2ª hora: Matemáticas - Prof. Juan Pablo Pérez)
  { id: 'as-112-1', dayOfWeek: 3, slotId: 'slot-1', grade: '11°2', subject: 'Matemáticas', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 302', isDoubleBlock: true, doubleBlockRole: 'FIRST_HOUR', doubleBlockLinkedSlotId: 'slot-3' },
  { id: 'as-112-2', dayOfWeek: 3, slotId: 'slot-3', grade: '11°2', subject: 'Matemáticas', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 302', isDoubleBlock: true, doubleBlockRole: 'SECOND_HOUR', doubleBlockLinkedSlotId: 'slot-1' },
  { id: 'as-112-3', dayOfWeek: 3, slotId: 'slot-4', grade: '11°2', subject: 'Filosofía', teacherId: 'prof-3', teacherName: 'Carlos Alberto Mendoza Jaramillo', classroom: 'Aula 302' },
  // 11°2 Miércoles (Bloque Doble 4ª y 5ª hora: Química - Prof. Diana Valencia)
  { id: 'as-112-4', dayOfWeek: 3, slotId: 'slot-6', grade: '11°2', subject: 'Química', teacherId: 'prof-4', teacherName: 'Diana Carolina Valencia Morales', classroom: 'Laboratorio de Ciencias', isDoubleBlock: true, doubleBlockRole: 'FIRST_HOUR', doubleBlockLinkedSlotId: 'slot-8' },
  { id: 'as-112-5', dayOfWeek: 3, slotId: 'slot-8', grade: '11°2', subject: 'Química', teacherId: 'prof-4', teacherName: 'Diana Carolina Valencia Morales', classroom: 'Laboratorio de Ciencias', isDoubleBlock: true, doubleBlockRole: 'SECOND_HOUR', doubleBlockLinkedSlotId: 'slot-6' },
  { id: 'as-112-6', dayOfWeek: 3, slotId: 'slot-9', grade: '11°2', subject: 'Educación Física', teacherId: 'prof-6', teacherName: 'Sebastián Morales Castro', classroom: 'Cancha Polideportiva' },

  // 10°2 Lunes (Bloque Doble 1ª y 2ª hora: Lengua Castellana)
  { id: 'as-7', dayOfWeek: 1, slotId: 'slot-1', grade: '10°2', subject: 'Lengua Castellana', teacherId: 'prof-2', teacherName: 'María Camila Restrepo Henao', classroom: 'Aula 205', isDoubleBlock: true, doubleBlockRole: 'FIRST_HOUR', doubleBlockLinkedSlotId: 'slot-3' },
  { id: 'as-8', dayOfWeek: 1, slotId: 'slot-3', grade: '10°2', subject: 'Lengua Castellana', teacherId: 'prof-2', teacherName: 'María Camila Restrepo Henao', classroom: 'Aula 205', isDoubleBlock: true, doubleBlockRole: 'SECOND_HOUR', doubleBlockLinkedSlotId: 'slot-1' },
  { id: 'as-9', dayOfWeek: 1, slotId: 'slot-4', grade: '10°2', subject: 'Ciencias Sociales', teacherId: 'prof-3', teacherName: 'Carlos Alberto Mendoza Jaramillo', classroom: 'Aula 205' },
  { id: 'as-10', dayOfWeek: 1, slotId: 'slot-6', grade: '10°2', subject: 'Química', teacherId: 'prof-4', teacherName: 'Diana Carolina Valencia Morales', classroom: 'Laboratorio de Ciencias' },

  // 11°1 Lunes (Bloque Doble 1ª y 2ª hora: Física)
  { id: 'as-11', dayOfWeek: 1, slotId: 'slot-1', grade: '11°1', subject: 'Física', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 301', isDoubleBlock: true, doubleBlockRole: 'FIRST_HOUR', doubleBlockLinkedSlotId: 'slot-3' },
  { id: 'as-12', dayOfWeek: 1, slotId: 'slot-3', grade: '11°1', subject: 'Física', teacherId: 'prof-1', teacherName: 'Juan Pablo Pérez Gómez', classroom: 'Aula 301', isDoubleBlock: true, doubleBlockRole: 'SECOND_HOUR', doubleBlockLinkedSlotId: 'slot-1' },
  { id: 'as-13', dayOfWeek: 1, slotId: 'slot-4', grade: '11°1', subject: 'Inglés', teacherId: 'prof-5', teacherName: 'Andrés Felipe Giraldo Duque', classroom: 'Aula 301' },

  // 6°1 Lunes
  { id: 'as-14', dayOfWeek: 1, slotId: 'slot-1', grade: '6°1', subject: 'Lengua Castellana', teacherId: 'prof-2', teacherName: 'María Camila Restrepo Henao', classroom: 'Aula 101' },
  { id: 'as-15', dayOfWeek: 1, slotId: 'slot-3', grade: '6°1', subject: 'Inglés', teacherId: 'prof-5', teacherName: 'Andrés Felipe Giraldo Duque', classroom: 'Aula 101' }
];
