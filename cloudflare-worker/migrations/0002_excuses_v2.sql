-- ==============================================================================
-- MIGRACIÓN 0002 — Excusas v2 (spec-excusas-2026 §2.2, Ronda 21 P0)
-- 100% ADITIVA: solo ALTER TABLE ADD COLUMN (reversibles a NULL) + índices.
-- Cero migración de datos: la tabla student_excuses está vacía en producción.
--
-- NOTA sobre el default de `status`: SQLite no permite cambiar el DEFAULT de una
-- columna existente. El default 'APROBADA' queda en la tabla vieja pero es
-- IRRELEVANTE: el Worker (único escritor) SIEMPRE inserta status explícito,
-- defaulting a 'PENDIENTE' (Regla 6 del proyecto: nada se deja al azar).
-- En instalaciones frescas (schema.sql) la columna ya nace con 'PENDIENTE'.
--
-- Re-ejecución segura: ALTER fallará con "duplicate column name" si ya fue
-- aplicada — el script de aplicación tolera ese error concreto y continúa.
-- ==============================================================================

ALTER TABLE student_excuses ADD COLUMN source_attendance_id TEXT REFERENCES attendance_records(id) ON DELETE SET NULL;
ALTER TABLE student_excuses ADD COLUMN attachment_path TEXT;
ALTER TABLE student_excuses ADD COLUMN reviewed_by TEXT;
ALTER TABLE student_excuses ADD COLUMN reviewed_at TEXT;
ALTER TABLE student_excuses ADD COLUMN reject_reason TEXT;
ALTER TABLE student_excuses ADD COLUMN auto_approved INTEGER DEFAULT 0;
ALTER TABLE student_excuses ADD COLUMN audit_hash TEXT;

-- Post-hoc: 1 excusa por AUSENTE (índice único parcial, R2)
CREATE INDEX IF NOT EXISTS idx_excuses_attendance ON student_excuses(source_attendance_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_excuses_attendance ON student_excuses(source_attendance_id) WHERE source_attendance_id IS NOT NULL;

-- Overlay de protección en el registro (sin migrar histórico: filas nuevas/nulas)
ALTER TABLE attendance_records ADD COLUMN excuse_id TEXT REFERENCES student_excuses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_excuse ON attendance_records(excuse_id);

-- Auditoría: se REUTILIZA audit_logs con event_type:
--   EXCUSE_CREATED / EXCUSE_APPROVED / EXCUSE_REJECTED / EXCUSE_REMOVED / EXCUSE_AUTO_APPROVED
-- details_json: {excuseId, studentCode, status, prevHash, hash, ...}
