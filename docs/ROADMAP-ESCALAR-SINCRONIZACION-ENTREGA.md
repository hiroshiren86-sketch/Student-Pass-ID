# 🧭 ROADMAP — SUBIR DE NIVEL LA SINCRONIZACIÓN Y LA ARQUITECTURA (mejoras a futuro)

> **Propósito:** detectar cómo mejorar la implementación actual para acercarla a "lo más perfecta posible", aprendiendo de cómo lo hacen las plataformas institucionales establecidas (SIS/ERP educativos) y los patrones de sincronización offline-first.
> **Estado:** análisis/propuesta a futuro — NO implementado. Complementa el handover al otro agente.
> **Base:** auditoría del código real (`src/services/cloudflareSync.ts`, `attendanceStorage.ts`, `cloudflare-worker/src/index.ts`) + investigación web (patrones offline-first, Firestore, outbox, SIS educativos).
> **Fecha:** 08/09/2026.

---

## 0. Resumen ejecutivo (los 6 huecos reales que existen hoy)

| # | Hueco detectado | Impacto | Prioridad |
|---|---|---|---|
| 1 | **La "cola offline" no existe de verdad** (`syncOfflineQueue` solo vacía `[]`; no hay outbox con replay ordenado + idempotencia) | Cambios hechos sin red pueden perderse o duplicarse al reconectar | 🔴 Alta |
| 2 | **Sin idempotency key en push** (no hay `opId`/`dedup`; at-least-once sin dedup) | Reintentos → registros duplicados | 🔴 Alta |
| 3 | **Sin pull incremental** (el pull baja TODO el snapshot cada vez, no "cambios desde la última vez") | Payload grande → choca con límite KV 25MB con miles de estudiantes/meses de asistencias | 🔴 Alta |
| 4 | **Fusión por reloj local** (`updatedAt` = `Date.now()`, no timestamp de servidor) | Relojes de dispositivo desincronizados → LWW no determinista | 🟠 Media |
| 5 | **Sin tombstones / soft-delete** (eliminar estudiante solo borra la ficha local; no hay marca de borrado que se propague) | Un borrado puede "revivir" al hacer pull desde otro dispositivo | 🟠 Media |
| 6 | **Sin observabilidad de conflictos/reintentos** (no se mide cuántos conflictos, retries, tiempo de convergencia) | No se puede afinar ni detectar regresiones | 🟢 Baja |

Estos 6 son los que la industria (Back4App, Firestore, RxDB, patrón Outbox) marca como obligatorios para un sync "casi perfecto". Los detallo abajo con la solución y referencias.

---

## 1. Cómo lo hacen las plataformas establecidas (lo que conviene copiar)

De la investigación (SIS educativos + patrones de sync):

### a) Base de datos relacional normalizada (la norma en educación)
> *"La mayoría de los sistemas de gestión de estudiantes usan bases de datos relacionales… PostgreSQL y MySQL son los más comunes… la data educativa es inherentemente relacional."* — [3](https://openeducat.org/articles/student-management-system-database-guide/)
- Tablas típicas: `users` (login+Rol), `students`, `teachers`, `classes`+`sections`, `subjects`(materias↔clases↔docente), `attendance`, `notifications`, `reports`, `academic_sessions`.
- **Recomendación:** mantener el catálogo en tablas **relacionales** (D1 ya tiene varias: `students`, `catalog_versions`, `attendance_records`…). Hoy el snapshot es un **JSON plano** que se serializa entero; a futuro conviene servir **consultas por rol** desde las tablas y no un blob.

### b) Arquitectura en 3 capas + RBAC + sesión
> *"Arquitectura de 3 capas: presentación / lógica de negocio / datos… control de acceso basado en roles con sesión."* — [1](https://ijrpr.com/uploads/V6ISSUE4/IJRPR42274.pdf)
- El sistema ya separa frontend (React) / Worker (lógica+datos) / Firebase. Bien. El RBAC por rol ya está (identidad Firebase + `canWriteCatalog`).

### c) Single-tenant vs multi-tenant · Cloud vs on-prem
> *"Single-tenant: cada institución con su BD dedicada (máxima privacidad, más costo)… Multi-tenant: comparten BD con tenant_id."* — [3](https://openeducat.org/articles/student-management-system-database-guide/)
- Para la institución que lo adopte: **single-tenant** es lo recomendado (privacidad + cumplimiento Ley 1581). Hoy ya es single-tenant (una BD nombrada + `SCHOOL_CODE`).

### d) Offline-first = cola outbox + replay + idempotencia
> *"Writes entran a una cola outbox durable → replay en orden al reconectar… el servidor aplica resolución de conflictos… el cliente hace pull de cambios desde su último sync."* — [1](https://www.back4app.com/glossary/offline-first-data-sync/)
> *"Corrige el problema del doble-write… el patrón Outbox: escribe estado + evento de outbox en una sola transacción, un relay los publica."* — [2](https://zylos.ai/research/2026-06-02-transactional-outbox-pattern-ai-agent-coordination/)
- **Es el hueco #1 y #2.** La cola offline actual es un **no-op** (`syncOfflineQueue()` hace `localStorage.setItem(..., '[]')`). Falta: cola durable + replay ordenado + **idempotency key** (consumidor idempotente porque outbox = at-least-once).

### e) Incremental sync (no bajar el mundo entero)
> *"La carga inicial se reduce haciendo replicación incremental en los reinicios… usa un campo de timestamp de servidor para 'changes-since-x'."* — [3](https://rxdb.info/replication-firestore.html)
- **Hueco #3.** Hoy el pull baja todo el snapshot. A futuro: parámetro `since`/cursor + cambio incremental.

### f) Conflictos: LWW por campo, no una política global
> *"LWW es seguro para registros de un solo escritor y bajo riesgo (toggles, status)… peligroso para documentos compartidos y contadores. Elige estrategia por campo."* — [1](https://www.back4app.com/glossary/offline-first-data-sync/)
> *"Usar 'overwrite whole document' para cada cambio garantiza colisiones. Modela sets como unión, contadores como increment."* — [3](https://wild.codes/candidate-toolkit-question/how-do-you-design-offline-first-sync-conflict-resolution-on-firebase)
- El sistema ya usa LWW por `id+updatedAt` (razonable para registros de un solo escritor) y **overlay de excusas** (merge de hechos). A futuro: metadata por campo `{value, updatedAt, actor}` y escalar a merge de sets / count para "sobrescribir arrays".

### g) Tombstones para borrados (evitar resurrección)
> *"Los ítems borrados necesitan tombstones para evitar resucitar en el replay; retener tombstones por una ventana de retención (30–90 días) y compactar."* — [2](https://prachub.com/concepts/adobe-creative-cloud-offline-sync-and-conflict-resolution)
- **Hueco #5.** El borrado de estudiante hoy es local-only; falta tombstones para que el borrado se propague y no "reviva" en otro dispositivo.

### h) Clock skew → usar versión monotónica del servidor
> *"Confiar solo en relojes de cliente; el skew hace LWW no determinista. Prefiere IDs de versión monotónicos asignados por el servidor (ya usado para catálogo)."* — [1](https://www.back4app.com/glossary/offline-first-data-sync/)
- **Hueco #4.** El catálogo ya usa `catalog_version` (CAS). A futuro: un `_rev`/timestamp **de servidor** por registro, en vez de `Date.now()` del cliente.

### i) Observabilidad de conflictos/retries
> *"Mide conflictos resueltos, reintentos, tiempo para converger. Tunear UX y merge policies."* — [3](https://wild.codes/candidate-toolkit-question/how-do-you-design-offline-first-sync-conflict-resolution-on-firebase)
- **Hueco #6.** Un contador de conflictos/reintentos + alerta de "outbox lag" ayuda a detectar regresiones y afinar.

---

## 2. Plan de implementación por prioridad (a futuro, si el proyecto avanza)

### Fase A — Robustez de sync (corrige los 6 huecos)
1. **Outbox durable + replay ordenado + idempotency key** (reemplaza el no-op de `syncOfflineQueue`).
   - Cada mutación local entra a `inas_offline_queue_v5` con `{ opId, type, payload, actor, createdAt }`.
   - Al volver la red: se **re-play** en orden; cada `opId` se marca aplicado → **dedup** (no duplica).
   - `PATCH/POST` de excusas y `push` de registros: mandar `opId` como idempotency key.
2. **Pull incremental** (`since`/cursor) en `/api/sync/pull` + persistir `lastSync` (ya existe `updateLastSync`).
   - Reduce el payload → escala a miles de estudiantes. **Resuelve el límite KV 25MB.**
3. **Tombstones / soft-delete**: al eliminar estudiante → doc `users/{uid}` + marca `deleted`/`_rev` que se propaga (link con la especificación de eliminar en cascada).
4. **Versión de servidor por registro** (`updatedAt` de servidor, no `Date.now()` local) + política por campo (LWW para status, set-merge para arrays, count para métricas).

### Fase B — "Casi perfecto" (resiliencia + cumplimiento)
5. **Observabilidad**: contadores de conflictos/reintentos, alerta de outbox lag, dashboard de tiempo-de-convergencia.
6. **Separar caminos frío/caliente**: snapshot (durabilidad) + un canal en vivo para el "ahora" (presencia/escaneos) — como hacen las plataformas reales (live query).
7. **Seguridad**: validación de forma/relojes en Firestore Rules (rechazo de writes malformados) — ya hay rules; endurecer con monoticidad.
8. **Retención + backups**: aplicar `EXCUSE_RETENTION_MONTHS` (ya configurado), backups programados a la nube, y **Ley 1581**: consentimiento + minimización + anonimización en borrado.
9. **Multi-tab / multi-dispositivo**: consistencia entre pestañas del mismo rol (hoy localStorage por pestaña; Firestore advierte de persistencia una-pestaña); considerar BroadcastChannel para refresco cruzado.

### Fase C — Producción real (si la institución adopta infraestructura propia)
- **Base relacional** en tablas normalizadas (D1 o PostgreSQL) en **single-tenant**; consultas por rol en vez de un blob JSON.
- **Auth organizacional** (SAML/SSO) + **RBAC** reforzado + **auditoría** completa (quién/cuándo).
- **Residencia de datos + cumplimiento** (Ley 1581): rutas de consentimiento, retención, borrado/anonimización.
- **Alta disponibilidad**: redundancia de DB, backups, réplicas de lectura.
- Import/Batch de matrícula a escala (CSV/SIMAT → lotes con transacción y reporte de errores).

---

## 3. Qué NO hay que tocar (ya está bien y no debe romperse)

- **Identidad Firebase como fuente de permiso** (SA lee rol → mínimo privilegio). Ya es lo correcto.
- **Separación catálogo vs hechos** (Rectoría = catálogo, docentes/estudiantes = hechos) — es la base del modelo y la causa de que el auto-pull de "solo hechos" sea seguro.
- **Reglas Firestore byte-idénticas al repo** y el fix CORS R51. No reintroducir el riesgo de "Failed to fetch".
- **Mecanismo anti-clobber** (H-38-1: push vacío rechazado, CAS de catálogo) — protección valiosa.
- **VAPID_PRIVATE_KEY**: no rotar (valor perdido, write-only; rompería Push).

---

## 4. Conclusión

El sistema **ya implementa la base correcta** (identidad/rol como permiso, catálogo vs hechos, versionado de catálogo/CAS, merge de hechos por `updatedAt`). Los 6 huecos detectados son de **robustez de sincronización** (outbox/idempotencia/incremental/tombstones/clock-skew/observabilidad), no de concepto. Implementarlos lo acercaría a "lo más perfecta posible" y lo alinearía con cómo funcionan las plataformas institucionales establecidas (BD relacional, 3 capas, RBAC, offline-first con outbox, incremental sync, cumplimiento Ley 1581). → Ver la **guía de implementación** (`ESPECIFICACION_ELIMINAR_ESTUDIANTE_CASCADA.md`) y el **handover** (`INSTRUCCION_AGENTE_MANUAL_Y_PRODUCCION.md`) para el otro agente.
