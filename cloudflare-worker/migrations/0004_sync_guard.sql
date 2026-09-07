-- ==============================================================================
-- RONDA 47 (Fase 2 — NUBE MULTI-FLANCO): GUARD DE SINCRONIZACIÓN
-- Flanco 2 (deviceId + device_sync_log) + Flanco 3 (catalog_version CAS).
--
-- Backwards-compatible: la migración es idempotente (CREATE TABLE IF NOT EXISTS /
-- ALTER TABLE con PRAGMA guardada). Un Worker viejo que aún no conoce estas tablas
-- sigue funcionando; el Worker nuevo las crea bajo demanda vía ensureSyncGuardTables.
--
-- Flanco 1 (tokens con alcance) no necesita tabla: se resuelve en verifyAuth.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- TABLA: catalog_versions — versión monotónica del CATÁLOGO (Rectoría-write-only).
-- Solo los push de catálogo ADMIN la incrementan. Un operador jamás la toca. Así
-- un dispositivo con un catálogo obsoleto detecta DESFASE antes de aplastar la nube.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_versions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  school_code TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_by_device TEXT,
  updated_by_role TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------------------------
-- TABLA: device_sync_log — registro APPEND-ONLY de cada push/purge por dispositivo.
-- Quién (deviceId + nombre amigable), con qué rol (ADMIN/OPERATOR), qué hizo y cuándo.
-- El Worker SOLO inserta; jamás UPDATE/DELETE por API → trazabilidad forense.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_sync_log (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  device_name TEXT,
  role TEXT NOT NULL,            -- 'ADMIN' | 'OPERATOR' | 'PURGE'
  action TEXT NOT NULL,          -- 'PUSH_CATALOG' | 'PUSH_FACTS' | 'PURGE'
  school_code TEXT,
  catalog_version INTEGER,
  students_count INTEGER,
  records_count INTEGER,
  details_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_devicelog_device ON device_sync_log(device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_devicelog_created ON device_sync_log(created_at);
