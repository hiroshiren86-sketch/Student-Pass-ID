-- ==============================================================================
-- Migración R61 — tabla de rate limit global (D1).
--
-- El rate limit por-isolate del Worker (Map en memoria) se pierde entre
-- reciclajes de Cloudflare (R60-h lo midió: 345 requests de prueba → 0×429).
-- D1 es fuertemente consistente (una sola primaria SQLite): el contador upsert
-- atómico por clave (verify:<ip> / purge:<ip>) sirve de ventana global REAL.
--
-- Ventana fija deslizante (la lógica vive en el Worker):
--   INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
--   ON CONFLICT(key) DO UPDATE SET
--     count = CASE WHEN rate_limits.window_start < :expiredBefore THEN 1
--                  ELSE rate_limits.count + 1 END,
--     window_start = CASE WHEN rate_limits.window_start < :expiredBefore THEN :now
--                         ELSE rate_limits.window_start END
--   RETURNING count
--
-- Limpieza oportunista: DELETE FROM rate_limits WHERE window_start < (now - 24h).
--
-- Se crea también en runtime (ensureRateLimitsTable, CREATE IF NOT EXISTS);
-- esta migración documenta el esquema para bootstraps futuros.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL
);
