-- Ronda 23 (Fase P4 — WEB PUSH de excusas): suscripciones de notificaciones.
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
