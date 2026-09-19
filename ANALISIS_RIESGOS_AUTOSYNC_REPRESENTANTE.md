# Análisis de riesgos — Autosincronización del portal del representante (R70)

**Objetivo:** responder, con código en mano, *qué pasaría de verdad* si se implementa el envío automático
de los hechos del representante (subrol `ESTUDIANTE_ACUDIENTE`) hacia la nube, y **qué puede salir mal**.
**Alcance:** análisis + diseño recomendado. **No se ha modificado una sola línea de código de producto.**
**Fecha:** 18/09/2026 · Rama `arena/01a0b6eb-student-pass-id` · `origin/main` = `f1bdbd2`.
**Documento hermano:** `ANALISIS_R70_OUTBOX_REPRESENTANTE.md` (diagnóstico de la Nota 2 + propuesta de 3 cambios).
**Paquete para auditar con otros agentes:** `INSTRUCCION_AUDITORIA_AUTOSYNC.md`.

---

## 0. Cómo se investigó (trazabilidad)

Todo lo que sigue sale de leer el código real y, donde se dice "probado", de ejecutarlo sin red
(`tests/unit/r70_alcance_autosync.ts` → 12 OK · `tests/evidence/r70_alcance_autosync.txt`).

| Pieza | Archivo | Qué se leyó |
|---|---|---|
| Autorización unificada | `cloudflare-worker/src/authz.ts` (375 líneas) | `resolveTokenScope`, verificación de identidad Firebase, `resolveAuthz`, `filterSnapshotByRole` |
| Push de hechos/catálogo | `cloudflare-worker/src/index.ts:835-1450` | rol efectivo, cuarentena, `opId`, CAS de catálogo, anti-aplastado, camino ADMIN vs operador |
| Hechos por fila | `cloudflare-worker/src/index.ts:2661-2735` | `POST /api/attendance`: dedup, FK, upsert, campos |
| Verificación de tarjetas | `cloudflare-worker/src/index.ts:1519-1580` | de dónde saca el `qrSecret` |
| Límites de tráfico | `cloudflare-worker/src/index.ts:525-625, 1771, 1910-1920, 2168, 2408` | qué rutas tienen rate limit y cuáles no |
| Cliente de sync | `src/services/cloudflareSync.ts` | `initAutoSync`, `workerHeaders`, `performCloudflareSync`, `replayOutbox`, `pullFromCloudflare` |
| Almacén + outbox | `src/services/attendanceStorage.ts` | sellos *dirty*, outbox, `saveSettings`, `updateStudent`, `registerClassScan`, `registerRepresentativeSelf` |
| Portales | `src/components/StudentPortalView.tsx`, `ScanHubView.tsx`, `SettingsModal.tsx`, `src/App.tsx` | quién puede sellar *dirty*, quién abre Ajustes, quién dispara el reenvío |
| Esquema | `cloudflare-worker/schema.sql` | claves de `attendance_records` / `sync_snapshots` |

---

## 1. El cambio que se está evaluando (y su contrato)

Publicar automáticamente los hechos del representante **sin** tocar el catálogo, reusando lo que ya existe:
`outbox durable → replayOutbox() → POST /api/attendance` (idempotente por `opId`).

Contrato que **debe** respetarse para que el cambio sea seguro:

1. **Solo hechos.** Nunca `performCloudflareSync()` (que envía el snapshot completo) desde el portal del estudiante.
2. **Nunca sellar *dirty*** desde el portal (R64 Fix A / R58 F-11: el sello bloquea los pulls y dispara el push completo).
3. **Nunca repartir el `AUTH_TOKEN`** (token ADMIN) a teléfonos de estudiantes.
4. **Sin credencial → no intentar** (evita 401 en bucle).
5. **El fallo debe ser silencioso para el estudiante** y el hecho debe quedar en la cola (no perderse).

Los 3 cambios propuestos cumplen 1-5 (ver `ANALISIS_R70_OUTBOX_REPRESENTANTE.md` §3). El riesgo no está en
*esos* 3 cambios: está en **las variantes naturales que un implementador tomaría** si no se conoce este contrato.

---

## 2. Modelo de confianza actual (quién puede escribir qué)

El Worker decide con **dos credenciales independientes** (`authz.ts:217-265`):

- **Identidad** (`X-Firebase-Id-Token`, verificada RS256 + rol leído de Firestore `users/{uid}`) → aporta el **rol**:
  `ADMIN` / `DOCENTE` / `ESTUDIANTE_ACUDIENTE`.
- **Token de dispositivo** (`Authorization: Bearer`) → aporta el **alcance del terminal**: `ADMIN` (`AUTH_TOKEN`) u
  `OPERATOR` (`OPERATOR_TOKEN`); en modo abierto (sin tokens) equivale a ADMIN.

Reglas resultantes:

| Credencial | Rol efectivo | Puede escribir catálogo | Puede escribir hechos |
|---|---|---|---|
| Ninguna | — | 401 en todas las rutas de datos (`index.ts:827-830`) | 401 |
| Token ADMIN (`AUTH_TOKEN`) | ADMIN | **Sí** (`canWriteCatalog = true`) | Sí |
| Token OPERATOR | OPERATOR | No (`isOperator = !isAdmin`) | Sí (merge en el snapshot) |
| Identidad ADMIN + token ADMIN | ADMIN | Sí — **doble llave F-5a** | Sí |
| Identidad ADMIN sin token configurado | ADMIN | Sí | Sí |
| Identidad DOCENTE / ESTUDIANTE_ACUDIENTE (con o sin token) | ese rol | **No, nunca** (`canWriteCatalog = r === 'ADMIN' && …`) | Sí |

Consecuencias clave que gobiernan todo el análisis:

- Un estudiante con cuenta Firebase **jamás** escribe catálogo, aunque su teléfono tuviera el `AUTH_TOKEN`
  guardado (la identidad tiene prioridad y fija el rol).
- **Sin identidad válida, manda el token.** Un terminal con `AUTH_TOKEN` almacenado y una sesión *local*
  (sin Firebase) es, a ojos del Worker, **Rectoría**.
- El cliente elige el token según la sesión activa y, si no hay token de operador, **cae al token ADMIN**
  (`cloudflareSync.ts:190-196`). Ese fallback es deliberado (retrocompatibilidad) y es la pieza que convierte
  un "login local" en un push con alcance ADMIN.

Además, el Worker separa **dos canales de verdad**:

- `sync_snapshots.data_json` (+ espejo KV): lo que **reparte el pull** a todos los dispositivos.
- `attendance_records` (D1): lo que escriben `POST /api/attendance`, los exports y las métricas.

No hay ningún cron ni proceso que vuelque `attendance_records` al snapshot (verificado: no existe handler
`scheduled` en el Worker). Es decir: **un hecho reenviado por `/api/attendance` entra a D1, pero no
necesariamente al snapshot que ven los demás teléfonos.**

---

## 3. Riesgos identificados

Severidad = daño potencial si ocurre. Probabilidad = qué tan fácil es llegar a ese estado.

### R1 · CATASTRÓFICO — Push con alcance ADMIN desde un terminal "scopeado" (pérdida de matrícula en el snapshot)

**Escenario:** un equipo con `AUTH_TOKEN` guardado (porque Rectoría lo configuró alguna vez en ese navegador)
donde alguien entra con **login local de estudiante** (código + clave, sin cuenta Firebase → sin identidad) y el
portal del estudiante llega a ejecutar un push (`performCloudflareSync`). El Worker lo ve como ADMIN.

**Por qué es grave:** el camino ADMIN del Worker **reemplaza el arreglo `students` del snapshot con lo que traiga
el payload** (`index.ts:1095-1145`: `mergedStudents = data.students.map(...)`), y también reemplaza `settings`
con `data.settings` (`index.ts:1146-1175`). El teléfono del estudiante tiene una matrícula **scopeada** a su curso
(`filterSnapshotByRole`, `authz.ts:330-352`, + upsert del pull, `cloudflareSync.ts:706-718`). Resultado:
la matrícula del snapshot queda reducida a ese curso, y todos los dispositivos que hagan pull reciben esa
porción. El catálogo D1 (`students`) no se borra (el upsert no elimina), pero el snapshot —el canal de
distribución— sí queda truncado.

**Por qué ninguna guarda lo detiene:**
- Anti-aplastado (`index.ts:992-1010`) solo dispara con **0 estudiantes**; un curso tiene ~20.
- CAS de catálogo (`index.ts:951-969`) solo rechaza si la versión declarada es **menor**; el pull dejó la versión
  al día en ese teléfono.
- Guarda de "terminal nuevo" (`index.ts:970-990`) solo aplica a `catalogVersion === null`; tras un pull **no** lo es.
- La cuarentena (`index.ts:880-905`) solo filtra hechos con códigos inexistentes; no dice nada del catálogo.

**Probabilidad:** baja-media (requiere token ADMIN en el navegador + login local + que el portal llegue a pushear).
**Mitigación:** el diseño recomendado (§5) **no llama nunca** a `performCloudflareSync` desde el portal del
estudiante, por lo que este escenario es inalcanzable. Como defensa en profundidad se propone además:
(a) retirar el fallback al token ADMIN para sesiones no-ADMIN, o (b) guarda server-side que rechace un push ADMIN
cuyo catálogo sea un subconjunto estricto del publicado. Cualquiera de las dos es un cambio de producto aparte.

### R2 · CATASTRÓFICO — Borrado del `qrSecret` del snapshot (verificación de tarjetas rota para todo el colegio)

Mismo escenario de R1 y mismo camino: `settings` del snapshot pasan a ser las del payload. El teléfono del
estudiante **no tiene** `qrSecret` (por diseño R59: `authz.ts:327-352` lo elimina del pull y
`cloudflareSync.ts:667` se niega a instalarlo en sesión de estudiante). Si ese payload llegara como ADMIN,
el snapshot quedaría sin clave de firma y `POST /api/verify/class-token` devolvería 409 a **todas** las
verificaciones de tarjeta del colegio ("La institución no tiene clave de firma configurada en la nube",
`index.ts:1540-1556`) hasta que Rectoría vuelva a hacer push. Añadido: el `catalog_version` subiría, y los
terminales de Rectoría/Docencia empezarían a recibir 409 de CAS hasta hacer pull (recuperable, pero disruptivo).

**Mitigación:** idéntica a R1 (nunca push desde el portal) + prueba de regresión específica (§6, prueba C).

### R3 · ALTO — "Sellar *dirty*" desde el portal (la solución intuitiva que rompe la sincronización)

Si para "que suba" alguien hace que el portal del estudiante marque `markLocalSyncDirty()` (o llame a
`performCloudflareSync`), se rompen dos invariantes documentados:

- **R58/F-11 (cuota):** todo terminal con sello sube el snapshot completo cada 5 min; el comentario del propio
  código documenta el antecedente: *"20 terminales × 288 ciclos/día ≈ 2.9M rows written/día contra un cupo de
  100 000/día de D1 y 1 000 escrituras/día de KV"* (`cloudflareSync.ts:63-79`).
- **R57/INV-1 (pulls congelados):** con el sello activo, `applyCloudSettingsToDevice` se niega a aplicar ajustes
  de la nube (`cloudflareSync.ts:648-654`) y el pull solo corre tras un push exitoso; si el push no puede
  completarse (sin credencial), el dispositivo queda **congelado** sin recibir catálogo ni secret.
- Con el token ADMIN en el navegador, además habilita R1/R2.

**Estado actual:** verificado que **hoy ningún camino del portal del estudiante sella *dirty*** (probado en
`r70_alcance_autosync.ts`: escaneo, foto y CSV dejan el sello en `null`). Este riesgo es de **implementación
futura**, no presente.

### R4 · MEDIO — Dos verdades: D1 vs. snapshot (el hecho "llega" pero no se ve igual en todas partes)

`POST /api/attendance` escribe en `attendance_records` (D1) y **nunca** en `sync_snapshots`; el pull sirve el
snapshot. Un hecho reenviado por el outbox aparecerá en exportaciones/métricas D1, pero en la planilla de otro
teléfono solo cuando **algún** dispositivo haga push de un snapshot que incluya ese registro. El efecto ya
existe hoy para docentes (su push solo ocurre si algo sella *dirty* o hay sync manual); al habilitar el
representante se amplifica. **Mitigación:** comunicar la semántica ("hechos garantizados en D1; distribución a
móviles en el siguiente push") y, a futuro, un job de cierre que vuelque hechos D1 al snapshot.

### R5 · MEDIO — El Worker no valida el contenido del hecho (confía en quien lo envía)

`POST /api/attendance` solo exige: credencial válida, `studentCode` existente en D1, `date` y `time`
(`index.ts:2661-2700`). **No** valida rol del emisor, ni que el bloque esté en curso, ni que el emisor sea el
representante del curso de ese estudiante, ni la autoría de los campos `verifiedHmac`, `scannedBy`, `status`.
Los registros que entran por esta ruta **no** aplican las reglas de la ventana de jornada ni de unicidad que sí
aplica el cliente (`registerClassScan`: estudiante+fecha+bloque, `attendanceStorage.ts:2738-2750`).
Consecuencias: (a) cualquier identidad válida puede marcar a cualquier estudiante del colegio; (b) es posible
insertar hechos con fecha/hora pasada o futura; (c) el auto-registro del representante es, por diseño, una
autodeclaración de presencia. Habilitar el autosync **no crea** el hueco (ya es alcanzable con `curl`), pero
**lo convierte en el camino normal** y lo multiplica por dispositivo. Mitigación (ronda aparte, recomendada):
exigir evidencia verificable en la misma petición (p. ej. el token de clase ya verificado por
`/api/verify/class-token` + ventana de jornada) y restringir por rol lo que cada identidad puede escribir.

### R6 · MEDIO — Duplicados entre dispositivos (representante y docente en el mismo bloque)

La unicidad "estudiante + fecha + bloque" se aplica **en el cliente** (`attendanceStorage.ts:2738-2750`). En D1
no hay restricción: la PK es `id` (generado por cliente) y no existe unicidad por `(student_code, date, slot_id)`
(`schema.sql:26-45`). Si el representante registra al curso y además el docente pasa lista en su dispositivo,
quedan **dos filas** del mismo estudiante/bloque. La vista de aula deduplica por mapa (`TeacherClassroomView.tsx:330-332`),
pero el consolidado por fecha lista los registros tal cual (`AttendanceReportsView`) → riesgo de doble conteo
en totales/CSV. Habilitar el autosync aumenta la probabilidad de que ambas capturas lleguen.

### R7 · MEDIO-BAJO — Cuotas (D1 y KV)

Cada operación reenviada cuesta 1 escritura D1 + 1 escritura KV (dedup `att_opid_*`, TTL 24 h,
`index.ts:2737-2743`) + lecturas. Un curso ≈ 30 hechos/día; 30 representantes ≈ 900 escrituras KV/día, es decir
prácticamente todo el cupo gratuito de KV (1 000/día, cifra que el propio código cita) y <1 % del cupo de D1
(100 000/día). El ciclo con la cola vacía **no escribe** (0 costo) y el pull idle es una lectura. Conclusión: el
diseño por hechos escala aceptablemente; **el diseño por snapshot (R3) no escala** y ya se midió en su momento.

### R8 · MEDIO-BAJO — 401 en bucle y reintentos infinitos

`replayOutbox` marca `FAILED` + `retryCount++` ante cualquier respuesta no-OK (`cloudflareSync.ts:1289-1294`), y
el ítem **nunca se descarta**. En un teléfono con login local (sin Firebase) y sin token, cada ciclo reintentaría
y fallaría para siempre (ruido, batería, datos) sin que el usuario lo entienda. La guarda del cambio 3 lo evita.
Contrapartida honesta: con la guarda, **en esos teléfonos el autosync no publica nada** (queda en cola). Es una
limitación de cobertura que debe comunicarse (¿cuántos representantes tienen cuenta Firebase provisionada?).

### R9 · BAJO — Sin rate limit en las rutas de hechos/push

`/api/attendance` y `/api/sync/push` son las dos únicas rutas de datos **sin** límite de tasa (los límites
existentes cubren purga 3/h, verify 60/ventana, clave 10/h, restablecimientos 240/h, borrados 30/h;
`d1RateLimited` degrada a fail-open, `index.ts:604-625`). Multiplicar dispositivos que empujan automáticamente
aumenta la superficie de abuso/estampida. Mitigación: límite por dispositivo/IP en ambas rutas (aditivo).

### R10 · BAJO-MEDIO — Privacidad (Ley 1581) y datos de menores en el teléfono del representante

El teléfono del representante ya contiene la matrícula **de su curso** con nombres y acudientes (sin documento,
sin foto, sin credenciales: minimización R59/R61) y ahora también hechos de asistencia de sus compañeros. El
autosync **envía al mismo colegio** esos hechos por HTTPS; no los expone a terceros. El riesgo real es el que ya
existe: dispositivo personal, no administrado, con datos de menores. Mitigación organizativa: política de uso,
borrado al terminar el año lectivo, y —a futuro— cifrado/expiración del outbox local.

### R11 · BAJO — Riesgo institucional/legal del rol

Convertir a un estudiante en operador de captura de datos de asistencia de sus pares es una decisión
institucional, no técnica: conviene que quede formalizada (autorización del acudiente del representante,
instructivo, y trazabilidad `scannedBy = REPRESENTANTE_TITULAR` que ya existe en los registros).

### R12 · MEDIO — Riesgos de ejecución del cambio (proceso, no seguridad)

- Se toca `initAutoSync`, un camino **compartido** con Rectoría y Docencia (lo que hoy funciona). Cualquier
  regresión ahí afecta la sincronización de los adultos.
- No es verificable end-to-end desde el sandbox (sin egreso a `*.workers.dev` / `*.pages.dev`); la validación
  real es: suites locales + una corrida en producción con el informe de siempre.
- El cambio 3 (guarda de credencial) puede **enmascarar** la no-cobertura: si no se registra nada visible, un
  representante con login local creerá que sincronizó.
- Despliegue: la app se publica automáticamente con push a `main` (Pages) y el Worker va por workflow manual;
  conviene desplegar primero el Worker (aditivo, sin cambios) y luego la app, o al revés según el plan del PR.

### R13 · MEDIO — Expectativa del usuario (la promesa "llegó a la nube")

Con el diseño por hechos, "llegó a la nube" significa: **fila en `attendance_records` de D1** (visible en
exportaciones y métricas). No significa: visible al instante en el pull de otros teléfonos (R4), ni
necesariamente dentro de 5 minutos si el teléfono está offline o sin credencial (R8). El guion y el informe
deben decirlo así.

---

## 4. Lo que NO es un riesgo (descartes verificados)

| Afirmación | Veredicto | Evidencia |
|---|---|---|
| "Un estudiante con identidad puede escribir catálogo" | **Falso** | `authz.ts:247` (`canWriteCatalog = r === 'ADMIN' && …`); `index.ts:1442` (`catalogWritten: isAdmin`) |
| "El reenvío de hechos toca el catálogo" | **Falso** | `/api/attendance` solo hace upsert en `attendance_records` (`index.ts:2703-2734`) |
| "Un reintento duplica la asistencia" | **Falso** | Dedup por `opId` en KV (24 h) + upsert por `id` (`index.ts:2679-2688, 2737-2743`) |
| "El teléfono del representante guarda el secreto de firma" | **Falso** | R59: se elimina en el pull (`authz.ts:327-352`) y se ignora al aplicar settings (`cloudflareSync.ts:667`) |
| "La cola se pierde si se cierra la app" | **Falso** | Outbox durable en localStorage, tope 2000 ítems (`attendanceStorage.ts:3326-3350`); solo se marca `SENT` cuando el Worker responde OK |
| "Con la guarda del cambio 3 se pierden hechos" | **Falso** | El ítem queda pendiente; se publicará cuando el dispositivo tenga credencial utilizable |

---

## 5. Diseño recomendado (contrato del autosync del representante)

1. **Publicar solo hechos** vía `replayOutbox()` → `POST /api/attendance` (idempotente).
2. **No sellar *dirty*** y **no llamar** a `performCloudflareSync()` desde el portal del estudiante.
3. **Disparadores:** (a) tras un registro exitoso del representante (silencioso), (b) en el ciclo de sync
   **solo si hay hechos pendientes**, (c) al recuperar la conexión (ya existe en el Escáner; puede reusarse).
4. **Guarda de credencial** antes de intentar (token de dispositivo **o** ID token de Firebase vigente).
5. **Visibilidad mínima:** contador discreto de "pendientes por enviar" en el portal (evita la falsa sensación
   de sincronizado) sin exponer errores técnicos.
6. **Sin cambios de permisos:** no se reparte ningún token; el rol del estudiante sigue siendo operador de hechos.
7. **Pruebas obligatorias** (ver §6) y **una corrida en producción** con la prueba del representante.
8. **Fuera de alcance (rondas aparte, recomendadas):** validación server-side del hecho (evidencia/ventana/rol),
   rate limit en `/api/attendance`, unicidad server-side por estudiante+fecha+bloque, y job de volcado D1→snapshot.

---

## 6. Pruebas que deben existir antes de publicar (y por qué)

| # | Prueba | Qué demuestra |
|---|---|---|
| A | Con `dirty = null` y un hecho en cola, el ciclo llama `POST /api/attendance` con el `opId` correcto | El cambio 1 funciona sin encender el push de catálogo |
| B | Sin credencial, no se emite ninguna petición y el ítem queda `PENDING` | La guarda evita 401 en bucle y no pierde el hecho |
| C | Con `AUTH_TOKEN` presente y sesión de estudiante, **ningún** camino del portal llama a `/api/sync/push` ni sella *dirty* | R1/R2/R3 quedan fuera de alcance (regresión blindada) |
| D | Doble escaneo del mismo estudiante/bloque (representante y docente) no genera doble fila en el snapshot local | R6 contenido en el cliente (y visibiliza el hueco server-side) |
| E | Un fallo de red en el reenvío no altera el mensaje de éxito del escaneo | UX del representante intacta |

Las pruebas A, B y C son las que este análisis considera **imprescindibles**; D y E son recomendables.
Las suites existentes (`tests/unit/r70_representante_nube.ts` 15 OK, `r70_alcance_autosync.ts` 12 OK) son la base.

---

## 7. Incógnitas que solo se resuelven en producción

- ¿Cuántos representantes tienen **cuenta Firebase provisionada** (R67) y por tanto credencial utilizable? Sin eso,
  la guarda del cambio 3 convierte el autosync en no-op para ellos.
- ¿Quedan terminales con `AUTH_TOKEN` guardado en navegadores compartidos donde también entra un estudiante? (R1/R2).
- ¿Hay reglas de rate limiting de Cloudflare (WAF) fuera del Worker que no son visibles en el repo?
- Cupos reales de la cuenta (D1/KV) y tamaño del snapshot actual (número de estudiantes y registros).
- ¿El colegio usa dispositivos compartidos aula/portería donde el representante inicie sesión con el login local?

---

## 8. Veredicto

- **Implementar los 3 cambios propuestos tal como están (solo hechos, sin *dirty*, con guarda) es de riesgo bajo**:
  el peor caso razonable es un hecho que no sube (queda en cola) o que sube tarde; no hay pérdida de datos ni
  escritura de catálogo posible.
- **El riesgo catastrófico aparece si el implementador se desvía del contrato** (§1), en particular sellando
  *dirty* o llamando al push completo desde el portal. La combinación que lo vuelve devastador es
  "login local sin identidad + `AUTH_TOKEN` en el navegador" → alcance ADMIN con catálogo scopeado (R1/R2).
- **Se recomienda:** implementar el contrato de §5 con las pruebas A-C, y tratar R5/R6/R9 como deuda técnica
  explícita (no como bloqueantes de esta ronda).
