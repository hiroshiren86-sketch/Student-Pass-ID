-- ==============================================================================
-- ESQUEMA SQL PARA CLOUDFLARE D1 (SQLite Edge Database)
-- Sistema de Asistencia y Control Escolar - INAS 2026
-- ==============================================================================

-- 1. Tabla de Estudiantes Matriculados
CREATE TABLE IF NOT EXISTS students (
  code TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  document_type TEXT DEFAULT 'TI',
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  photo_url TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  status TEXT DEFAULT 'ACTIVO',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_students_grade ON students(grade);
CREATE INDEX IF NOT EXISTS idx_students_doc ON students(document_id);

-- 2. Tabla de Registros de Asistencia y Portería
CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  student_code TEXT NOT NULL,
  student_name TEXT NOT NULL,
  document_id TEXT,
  grade TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL, -- PUNTUAL, TARDANZA, AUSENTE
  method TEXT NOT NULL, -- QR_CAMERA, BARCODE_HID, MANUAL_KEYBOARD, AUTO_CIERRE
  verified_hmac INTEGER DEFAULT 0,
  scanned_by TEXT DEFAULT 'PORTERO',
  scanned_by_name TEXT,
  subject TEXT,
  slot_id TEXT,
  notes TEXT,
  excuse_id TEXT REFERENCES student_excuses(id) ON DELETE SET NULL, -- Ronda 21: overlay de excusa (overlay, no nuevo estado)
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (student_code) REFERENCES students(code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_records(student_code, date);
CREATE INDEX IF NOT EXISTS idx_attendance_grade_date ON attendance_records(grade, date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_records(status);
CREATE INDEX IF NOT EXISTS idx_attendance_excuse ON attendance_records(excuse_id);

-- 3. Tabla de Docentes y Personal Institucional
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  subject TEXT,
  assigned_grades_json TEXT, -- JSON array ['6°1', '6°2', '10°4']
  pin_hash TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 4. Tabla de Asignaciones de Horarios y Clases
CREATE TABLE IF NOT EXISTS schedule_assignments (
  id TEXT PRIMARY KEY,
  day_of_week INTEGER NOT NULL, -- 1 = Lunes ... 5 = Viernes
  grade TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  teacher_id TEXT,
  teacher_name TEXT,
  room TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_grade_day ON schedule_assignments(grade, day_of_week);

-- 5. Tabla de Bloques Horarios de Jornada (Day Templates)
CREATE TABLE IF NOT EXISTS schedule_slots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  type TEXT DEFAULT 'CLASS', -- CLASS, BREAK, LUNCH, ASSEMBLY
  order_index INTEGER DEFAULT 0
);

-- 6. Tabla de Snapshots y Sincronizaciones Completas (Resiliencia Multi-Terminal)
CREATE TABLE IF NOT EXISTS sync_snapshots (
  id TEXT PRIMARY KEY,
  school_code TEXT NOT NULL,
  school_name TEXT,
  synced_by_device TEXT,
  data_json TEXT NOT NULL,
  students_count INTEGER DEFAULT 0,
  records_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 7. Tabla de Excusas Médicas y Justificaciones de Inasistencia (Buzón Escolar)
-- Ronda 21 (spec-excusas-2026 §2): dos temporalidades en UNA entidad —
-- anticipada (Escudo, fechas futuras, sin source_attendance_id) y post-hoc
-- (justificación 1 toque sobre el AUSENTE, con source_attendance_id).
CREATE TABLE IF NOT EXISTS student_excuses (
  id TEXT PRIMARY KEY,
  student_code TEXT NOT NULL,
  student_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  start_date TEXT NOT NULL, -- YYYY-MM-DD
  end_date TEXT NOT NULL,   -- YYYY-MM-DD
  reason TEXT NOT NULL,     -- CITA_MEDICA, INCAPACIDAD, CALAMIDAD, DEPORTIVA, OTRA
  notes TEXT,
  status TEXT DEFAULT 'PENDIENTE', -- PENDIENTE (default Ronda 21), APROBADA, RECHAZADA
  submitted_by TEXT DEFAULT 'PORTAL_ESTUDIANTE',
  source_attendance_id TEXT REFERENCES attendance_records(id) ON DELETE SET NULL, -- post-hoc: el AUSENTE ancla
  attachment_path TEXT,     -- foto cifrada del soporte (P3)
  reviewed_by TEXT,         -- Rectoría que decidió
  reviewed_at TEXT,         -- timestamp de la decisión
  reject_reason TEXT,       -- obligatoria si RECHAZADA (R6)
  auto_approved INTEGER DEFAULT 0, -- 1 = ventana 72h (R8)
  audit_hash TEXT,          -- cadena HMAC tamper-evidente (§6.2)
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (student_code) REFERENCES students(code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_excuses_student_date ON student_excuses(student_code, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_excuses_dates ON student_excuses(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_excuses_attendance ON student_excuses(source_attendance_id);
-- R2: 1 excusa por AUSENTE (índice único parcial)
CREATE UNIQUE INDEX IF NOT EXISTS uq_excuses_attendance ON student_excuses(source_attendance_id) WHERE source_attendance_id IS NOT NULL;

-- 8. Tabla de Registro de Auditoría
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  ip_address TEXT,
  details_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ==============================================================================
-- Ronda 23 (Fase P4 — WEB PUSH de excusas): suscripciones de notificaciones.
-- endpoint ÚNICO por navegador; role: RECTORIA (buzón) | PORTAL (estudiante).
-- ==============================================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'PORTAL',
  student_code TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
