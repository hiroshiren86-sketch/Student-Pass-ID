# Informe de QA — Ronda 54 (Roadmap de sincronización, 6 huecos)

**Fecha:** miércoles 09/09/2026 (día lectivo, Bogotá).
**App bajo prueba:** `https://student-pass-id.pages.dev` (producción).
**Worker:** `https://inas-attendance-worker.hiroshiren86.workers.dev` (versión `bf8a13c8`, desplegada en esta sesión).
**Método:** navegador **Chromium headless real** (Playwright) conduciendo la app desplegada **como usuario normal** (Rectoría, login por Firebase real con identidad), más verificación de las respuestas del Worker usando el **mismo mecanismo de autenticación de la app** (`X-Firebase-Id-Token`).
**Permiso del propietario:** ensuciar la BD está autorizado ("No importa si la base de datos puede ser ensucia").

---

## Resultado global: 6/6 huecos del roadmap verificados · Plantilla A restaurada

| # | Hueco del roadmap | Estado | Evidencia |
|---|---|---|---|
| 1 | **Outbox durable** + replay ordenado + idempotente | ✅ PASS | item `PENDING` → evento `online` → `replayOutbox` POST `/api/attendance` con `opId` → `status=SENT` |
| 2 | **Idempotencia `opId`** (push y `/api/attendance`) | ✅ PASS | reenvío del mismo `opId` → `deduplicated:true` sin re-aplicar |
| 3 | **Pull incremental** (`since`) + **pull de hechos** (`scope=facts`) | ✅ PASS | `scope=facts` solo baja `records`; `since` → `incremental=true`; pull completo intacto |
| 4 | **Versión de servidor** (merge por `serverUpdatedAt`) | ✅ (por código + `recordsMerged`) | merge determinista; `recordsMerged`/`pushFusedCount` en el handler |
| 5 | **Tombstones / soft-delete** | ✅ PASS | alta→push(81)→borrado(tombstone)→push(80)→pull muestra estudiante ausente + tombstone presente |
| 6 | **Observabilidad** (`/api/sync/metrics`) | ✅ PASS | agrega `pushesByAction/ByRole`, `totalRecordsFused`, `retriedOperations`, `lastOperationAt` |

---

## Detalle de las pruebas

### T0 · Sin regresión en el pull completo (Admin)
`GET /api/sync/pull` (identidad Rectoría → ADMIN):
- **students=80 · teachers=20 · assignments=180 · records=2** → **idéntico al estado previo de la Ronda 53**. Sin pérdida de datos.
- Rutas nuevas responden `401` con guard (no `404`) → enrutan correctamente.

### T1 · Aplicar Plantilla T (Jornada de Pruebas) + Push + propagación
- Desde **Horarios → Plantillas → "Aplicar hoy"** en la **Plantilla T: Jornada de Pruebas** (usuario real).
- Local: `activeDayTemplate: tmpl-normal → tmpl-pruebas-extendida`, **slots: 7 → 31**.
- Push → `success:true, catalogVersion:6, studentsSaved:80`.
- **Nube verificada:** `settings.activeDayTemplate=tmpl-pruebas-extendida`, `slots=31` (primer bloque **00:05–00:50**), catálogo intacto.
- **La Plantilla T extiende la jornada a 00:05–23:50** → el escaneo funciona a cualquier hora (no choca con la guarda de cierre de 12:30). Es el mecanismo equivalente a "congelar el tiempo", usando la plantilla de pruebas que ya existía en el producto. **No se modificó código.**

### T2 · Idempotencia por `opId` en **push** (hueco 2)
Reenvío del mismo `opId` a `/api/sync/push` (el opId que devolvió el push real):
```
{"deduplicated":true, "success":true, "message":"Push ya procesado (opId duplicado): resultado devuelto sin re-aplicar."}
```
→ el Worker NO re-aplica el snapshot ni re-incrementa `catalog_version`.

### T3 · Idempotencia por `opId` en `/api/attendance` (hueco 1/2)
```
1er envío:  {"success":true,"id":"196555769_2026-09-09_08:00","message":"Asistencia registrada en Cloudflare D1"}
Reintento:  {"success":true,"id":"196555769_2026-09-09_08:00","deduplicated":true,"message":"Asistencia ya registrada (opId duplicado)."}
```

### T4 · Outbox durable offline→online (hueco 1)
Se siembra un item **PENDING** en `inas_offline_queue_v5` (misma forma que `enqueueOfflineMutation`), se dispara `window.dispatchEvent(new Event('online'))` (transición a online, la misma que al volver la red):
- `POST /api/attendance` enviado con `{...payload, opId}`.
- Cola después: **`status: SENT`**, `retryCount:0`, `opId` conservado.

### T5 · Tombstone / soft-delete (hueco 5)
1. Pull → 80 estudiantes locales.
2. **Alta** de estudiante de prueba `999999999` (UI) → 81 locales → **Push#1** = "81 estudiantes … catálogo v7" (llegó a la nube).
3. **Eliminar** (UI) → tombstone en localStorage: `[{"id":"999999999","type":"student","deletedAt":"2026-09-09T17:00:25.507Z"}]`.
4. **Push#2** = "80 estudiantes … catálogo v8".
5. **Nube verificada:** `students=80`, `999999999` **ausente**, `tombstones=[{id:999999999,type:student}]` **devuelto en el pull** → el borrado se **propaga** (no resucita).

### T6 · Observabilidad (hueco 6)
`GET /api/sync/metrics` (identidad Rectoría):
```
totalOperations=19 · pushesByAction={PUSH_FACTS:10, PUSH_CATALOG:9}
pushesByRole={OPERATOR:1, ADMIN:6, ESTUDIANTE_ACUDIENTE:9}
totalRecordsFused=0 · retriedOperations=0 · lastOperationAt=2026-09-09 17:04
```

### Restauración (crítico)
Tras terminar las pruebas se aplicó de nuevo la **Plantilla A: Día Normal** (Horarios → Plantillas → "Aplicar hoy") + Push:
- **Nube final:** `settings.activeDayTemplate=tmpl-normal`, `slots=7` (bloque 06:30–07:25), `students=80 · teachers=20 · assignments=180`.
- La **Plantilla T NO queda en producción** (regla de la Ronda 21).

---

## Artefactos que quedan en la BD (permitidos por el propietario)
- **2 registros de asistencia de prueba** para el estudiante real `196555769` (`2026-09-09 08:00` y `09:15`) en la tabla `attendance_records` (fuera del snapshot de 2 registros).
- **1 tombstone** para `999999999` (estudiante de prueba que se dio de alta y luego se eliminó; la matrícula quedó en **80**, sin cambios netos).
- El catálogo (80/20/180) y la Plantilla A están **exactamente** como estaban.

## Notas de método / límites
- **Hueco 3 (pull incremental)** y **hueco 6 (metrics)** se verificaron vía la API del Worker con la identidad Firebase de la app (no hay botón de UI visible para `since`/`scope=facts`; son internos del auto-sync).
- **Hueco 4 (merge por `serverUpdatedAt`)**: no se dispararon conflictos de escritura en las pruebas (por eso `recordsMerged=0`); el mecanismo de versión de servidor está en el handler del push (`stampServerVersion`/`recordVersion`/`mergeRecordsByUpdatedAt`) y en el pull.
- El **outbox** se probó sembrando el item (simular una captura offline por escáner requiere un dispositivo físico/terminal de docente); el flujo real `enqueueOfflineMutation` (de `registerClassScan`) y el `replayOutbox` verificados por código y por replay real contra el Worker.

---

## Adenda — Plantillas NORMALES con reloj real (mié 09/09/2026, 12:24–12:28 Bogotá)

El propietario pidió probar las plantillas A y B **con el reloj real** (sin Plantilla T, sin congelar tiempo), dentro de la jornada (12:24 antes del cierre de 12:30).

- **PLANTILLA A «Día Normal» (06:30–12:30)** — a las **12:25**:
  - Banner: `Jornada abierta (06:30 – 12:30)`.
  - **Escaneo ACEPTADO** → registró a `JULIANA ANDRÉS JIMÉNEZ BOTERO` (6°4, doc 196555769) con estado **TARDANZA** (feedback `success_tardy`). ✅
- **PLANTILLA B «Recorte −10»** — a las **12:27**:
  - Banner: `Jornada abierta (06:30 – 12:30)`.
  - **Escaneo RECHAZADO** → `"Ahora no hay clase en curso (12:27) y no quedan más bloques de clase por hoy. No se registra asistencia por escáner."` ✅
  - La guarda de los **6 bloques × 45 min** de B termina ~11:30, por lo que a las 12:27 no hay bloque activo → rechazo. **Hallazgo:** el banner muestra la ventana 06:30–12:30 (heredada de `dailyEndTime`), aunque el escaneo ya esté bloqueado por falta de bloques — comportamiento vigente, sin regresión, no se tocó código.
- **Restauración:** se aplicó de nuevo la **Plantilla A** al término. Nube final: `tmpl-normal`, `slots=7`, `students=80 · teachers=20 · assignments=180 · records=2` (sin regresión).
- Capturas: `r54_AB_A_scan.png`, `r54_AB_B_scan.png`.

---

## Evidencia visual
Capturas en `./` (este directorio), tomadas del app **real desplegado**:
- `r54_T01_plantillaT_aplicada.png` — Plantilla T activa (Horarios → Plantillas).
- `r54_T01_push_result.png` — resultado del push.
- `r54_T02_pull.png` — pull completo.
- `r54_T04_outbox_replay.png` — hub de escaneo tras el replay del outbox.
- `r54_T05_alta.png` / `r54_T05_borrado.png` — alta y borrado del estudiante de prueba (el código `999999999` desaparece del Directorio).
- `r54_restore_A.png` — Plantilla A aplicada de nuevo.

## Scripts reproducibles
`qa_*.mjs` / `lib*.mjs` en `./` (requieren Playwright con Chromium). Autentican con las credenciales de Rectoría de `.env`.
