# INSTRUCCIÓN DE AUDITORÍA — Autosincronización del portal del representante (INAS)

> **Cómo usar este documento.** Es un paquete autocontenido para entregárselo a otro agente
> (o a varios) y pedirle una **comprobación independiente**. Copie desde "INICIO DEL ENCARGO"
> hasta "FIN DEL ENCARGO". Está pensado para que 4 agentes distintos respondan lo mismo o
> discrepen de forma comparable (rúbrica en §7).

--- INICIO DEL ENCARGO ---

# ENCARGO: auditoría independiente de un cambio de sincronización en la app INAS

## 0. Su rol y las reglas del encargo

Usted es un **auditor externo de código**. No escriba ni modifique código de producto, no haga commits,
no despliegue nada, no ejecute acciones contra producción. Su trabajo es **verificar o refutar** un análisis
de riesgos ya escrito, con evidencia del propio repositorio, y dar su propio veredicto.

Reglas de evidencia (obligatorias):
1. Cada afirmación suya debe ir con **archivo:línea** (o con la salida del comando que la demuestra).
2. Distinga siempre entre: **(i) leído en el código**, **(ii) ejecutado localmente**, **(iii) supuesto**,
   **(iv) no verificable con lo que tiene**.
3. Si algo del informe que se le entrega **no coincide con el código**, dígalo explícitamente y muestre la línea.
4. No invente cifras ni citas. Si no puede verificar un número, marque la afirmación como no verificable.
5. Puede ejecutar las pruebas locales del repositorio (no requieren red) y leer todo el código.
6. Termine con un veredicto claro y una recomendación. No se quede en "depende".

## 1. Contexto: qué es el sistema

Aplicación web escolar (React + TypeScript, un solo repo) para control de asistencia con:
- **App (PWA)**: se publica en Cloudflare Pages (`https://student-pass-id.pages.dev`). El estado vive en
  `localStorage` del navegador y se sincroniza con la nube.
- **Worker** (Cloudflare) + **D1** (SQL) + **KV** (caché/dedup): `cloudflare-worker/`.
- **Firebase**: autenticación por identidad (Google/email) y respaldo en Firestore de ajustes.

Roles: `ADMIN` (Rectoría), `DOCENTE`, `ESTUDIANTE_ACUDIENTE` (estudiante; algunos son **representantes de
curso** con permiso para registrar a sus compañeros escaneando el carné).

Sincronización (dos credenciales distintas):
- **Identidad**: `X-Firebase-Id-Token`; el Worker verifica la firma (RS256) y lee el rol del perfil en Firestore.
- **Token de dispositivo**: `Authorization: Bearer …` (`AUTH_TOKEN` = ADMIN, `OPERATOR_TOKEN` = operador de hechos).
- `POST /api/sync/push` sube un **snapshot** (catálogo + hechos). `GET /api/sync/pull` lo baja.
  Solo ADMIN (token ADMIN, o identidad ADMIN con token ADMIN cuando hay tokens configurados) escribe catálogo;
  los demás roles son "operadores": fusionan **solo hechos** (`records`) en el snapshot vigente.
- `POST /api/attendance` escribe **un hecho por fila** en la tabla `attendance_records` de D1 (idempotente por `opId`).
- **Outbox**: cada escaneo se guarda local y se encola en una cola durable (`localStorage`, tope 2000).
  `replayOutbox()` reenvía la cola por `POST /api/attendance`.
- **Sello `dirty`**: marca de "hay ediciones locales sin subir". Con `dirty` activo el ciclo automático hace push
  completo; sin `dirty` solo hace pull. El pull no pisa ajustes locales mientras `dirty` esté activo.

## 2. El cambio que se quiere auditar

Un informe de producción (15/09/2026, 29/30 comprobaciones) señaló que **el auto-registro del representante
quedó guardado en su teléfono y no llegó a la nube** en la ventana observada. Diagnóstico ya hecho por el
equipo: los hechos no sellan `dirty`, y el reenvío del outbox hoy solo se dispara desde el **Escáner** de
Docente/Rectoría (evento `online`). Es decir: **el portal del estudiante no tiene disparador propio**.

**Propuesta a auditar** (3 cambios aditivos, ~25 líneas; NO implementados todavía):
1. En `initAutoSync()`: si hay hechos pendientes en el outbox, reenviarlos aunque `dirty = null`.
2. Tras un registro exitoso del representante en `StudentPortalView` (`handleRepRegister`): llamar al reenvío.
3. Guarda al inicio de `replayOutbox()`: si no hay token de dispositivo **ni** ID token de Firebase, no intentar.

**Preguntas exactas que debe responder:**
- **P1.** ¿El diagnóstico es correcto? ¿O el hecho sí sube por algún camino que el informe no vio?
- **P2.** ¿Cuáles son los **riesgos reales** de implementar la propuesta? Clasifíquelos por severidad
  (crítico/alto/medio/bajo), probabilidad e impacto, y diga para cada uno si la propuesta lo crea, lo agrava o no lo toca.
- **P3.** ¿El diseño propuesto es el mejor camino? ¿Qué alternativa propone si no lo es?
- **P4.** ¿Qué pruebas habría que exigir antes de publicar, y cuáles son las 2-3 que usted consideraría **bloqueantes**?

## 3. Hechos que usted debe comprobar por sí mismo (no los dé por buenos)

Repo: `github.com/hiroshiren86-sketch/Student-Pass-ID`, rama `arena/01a0b6eb-student-pass-id`
(PR #2). Commit base de `main`: `f1bdbd2`. Si no tiene acceso al repo, adviértalo: podrá opinar con los
anexos de este documento, pero su verificación será parcial.

| # | Hecho afirmado | Dónde mirar |
|---|---|---|
| H1 | Los hechos de asistencia **no** sellan `dirty`; solo sellan ajustes/catálogo/horarios | `src/services/attendanceStorage.ts` (`saveAttendance` ~2245; sellos en 400, 543, 1160, 1235, 1535, 1703, 1745) |
| H2 | El único llamador de `syncOfflineQueue()`/`replayOutbox()` en producto es el `online` del Escáner de Docente/Rectoría | `src/components/ScanHubView.tsx:54-68`; `src/services/cloudflareSync.ts:1273` |
| H3 | El ciclo automático, sin `dirty`, hace **solo pull**; con `dirty`, push (y pull solo si la sesión es ADMIN) | `src/services/cloudflareSync.ts:53-114` |
| H4 | El reenvío usa `POST /api/attendance` con `opId`; dedup 24 h en KV y upsert por `id` | `src/services/cloudflareSync.ts:1273-1295`; `cloudflare-worker/src/index.ts:2661-2744` |
| H5 | `POST /api/attendance` **no** valida rol ni autoría: basta credencial válida + `studentCode` existente | `cloudflare-worker/src/index.ts:2661-2700` |
| H6 | `POST /api/attendance` escribe en `attendance_records` y **no** en el snapshot que sirve el pull | `index.ts:2703-2734` vs. `index.ts:1451-1510` |
| H7 | El catálogo solo lo escribe ADMIN: `canWriteCatalog` y `catalogWritten: isAdmin` | `cloudflare-worker/src/authz.ts:217-265`; `index.ts:866-867, 1442` |
| H8 | Con identidad válida, el rol del perfil manda sobre el token; **sin** identidad válida manda el token | `authz.ts:217-265` |
| H9 | El cliente, en sesión no-ADMIN, usa `cloudflareOperatorToken` y **cae al `cloudflareApiToken` (ADMIN)** si aquel no existe | `src/services/cloudflareSync.ts:187-215` |
| H10 | El camino ADMIN del `push` reemplaza `students` y `settings` del snapshot con los del payload | `index.ts:1095-1175` |
| H11 | El `qrSecret` institucional se elimina del pull para estudiantes y no se instala en el dispositivo | `authz.ts:327-352`; `cloudflareSync.ts:650-667` |
| H12 | `/api/verify/class-token` lee el `qrSecret` **del snapshot** y devuelve 409 si no está | `index.ts:1540-1556` |
| H13 | Las guardas anti-pérdida del push (anti-aplastado 409, CAS 409, terminal nuevo 409) **no** disparan con un catálogo parcial (p. ej. 20 de 80 estudiantes) | `index.ts:938-1005` |
| H14 | `/api/attendance` y `/api/sync/push` **no** tienen rate limit propio; otras rutas sí | `index.ts:525-625, 1771-1774, 1910-1920, 2168, 2408` |
| H15 | Un estudiante puede entrar con **login local** (código + clave) sin cuenta Firebase → sin identidad | `src/components/LoginScreen.tsx:199-300` |
| H16 | En sesión de estudiante, editar su ficha (foto) y cargar horario CSV **no** sellan `dirty` (R64 Fix A) | `attendanceStorage.ts:785-829, 1552-1559`; prueba ejecutable `tests/unit/r70_alcance_autosync.ts` |
| H17 | No hay cron/scheduled que vuelque `attendance_records` al snapshot | `cloudflare-worker/src/index.ts` (busque `scheduled`), `wrangler.toml` |
| H18 | La unicidad "estudiante+fecha+bloque" existe solo en el cliente; en D1 la PK es `id` | `attendanceStorage.ts:2738-2750`; `cloudflare-worker/schema.sql:26-45` |

**Comandos para reproducir sin red** (requiere Node 20+ y npm):
```bash
npm i --no-save jsdom pdfmake tsx
TZ=America/Bogota npx tsx tests/unit/r70_alcance_autosync.ts   # 12 checks
TZ=America/Bogota npx tsx tests/unit/r70_representante_nube.ts # 15 checks
TZ=America/Bogota npx tsx tests/unit/r70_guion_inventario_ui.ts # 9 checks
```

## 4. Afirmaciones del informe que debe intentar **refutar** (o confirmar con su propia evidencia)

- **A1.** "Hoy, sin `dirty`, el ciclo del teléfono del representante hace solo pull: el hecho no sube solo."
- **A2.** "Ninguna guarda del Worker detiene un push ADMIN cuyo catálogo sea un subconjunto (curso) del publicado."
- **A3.** "Si el portal del estudiante llegara a ejecutar un push en un navegador con `AUTH_TOKEN` y sin identidad
  (login local), el snapshot podría perder la matrícula de los otros cursos y el `qrSecret`."
- **A4.** "Los 3 cambios propuestos (solo hechos + guarda de credencial, sin sellar `dirty`) no permiten escribir
  catálogo ni sellar `dirty`, por lo que A2/A3 quedan fuera de alcance."
- **A5.** "El riesgo residual del diseño propuesto es: hechos que no suben (sin credencial), hechos que suben tarde,
  y divergencia D1 vs. snapshot. No hay pérdida de datos."
- **A6.** "El fallback al token ADMIN para sesiones no-ADMIN (`workerHeaders`) es una debilidad latente, existente
  hoy, independiente de este cambio."
- **A7.** "Existe doble conteo potencial cuando representante y docente registran el mismo estudiante/bloque,
  porque la unicidad es solo del lado cliente."

## 5. Lo que NO se puede verificar desde el repo (dígalo como incógnita, no lo suponga)

- Cuántos representantes tienen cuenta Firebase provisionada (y por tanto credencial para el reenvío).
- Si en los navegadores reales del colegio hay `AUTH_TOKEN` guardado junto con logins locales de estudiantes.
- Si existen reglas de rate limiting de Cloudflare (WAF) fuera del Worker.
- Los cupos reales de D1/KV de la cuenta y el tamaño actual del snapshot.
- El tamaño real de la matrícula y los registros en producción.

## 6. Entregable (formato exacto)

Responda **en este orden y con estos títulos**:

1. **Veredicto en 5 líneas** (¿el análisis es correcto? ¿la propuesta es segura? ¿la implementaría?).
2. **Tabla H1-H18**: `Hecho | Confirmado/Refutado/No verificable | Evidencia (archivo:línea o comando) | Nota`.
3. **Tabla A1-A7**: `Afirmación | Veredicto | Evidencia | Si difiere, por qué`.
4. **Riesgos**: tabla `Riesgo | Severidad (crítica/alta/media/baja) | Probabilidad | ¿Lo crea o lo agrava la propuesta? | Mitigación concreta`.
   Incluya al menos: seguridad/autorización, integridad de datos, cuotas, duplicados, privacidad, UX y operación.
5. **Riesgos que el informe NO menciona** (los más valiosos para el lector).
6. **Diseño recomendado** (qué cambiaría de los 3 cambios propuestos y por qué), con el contrato mínimo que exigiría.
7. **Pruebas bloqueantes** (2-3) y cómo se ejecutarían.
8. **Preguntas abiertas** que solo se responden en producción.
9. **Nivel de confianza** de su auditoría (alto/medio/bajo) y **qué le faltó** para subirlo.

## 7. Cómo se compararán las respuestas (para el usuario, no para el agente)

Rúbrica sugerida (1 punto cada una, máxima 8):
1. ¿Comprobó los H1-H18 con archivo:línea propio (no citó el informe)?
2. ¿Detectó al menos uno de los dos riesgos catastróficos (truncado de matrícula en el snapshot; borrado del `qrSecret`)?
3. ¿Explicó **por qué** las guardas del Worker no los detienen (anti-aplastado, CAS, terminal nuevo)?
4. ¿Identificó el papel de la credencial (identidad vs. token) y el fallback al token ADMIN?
5. ¿Marcó correctamente lo no verificable en vez de suponerlo?
6. ¿Distinguió "llegar a D1" de "llegar al snapshot" (R4/H6)?
7. ¿Propuso pruebas bloqueantes ejecutables (no genéricas)?
8. ¿Dio un veredicto claro y una recomendación de diseño, en vez de "depende"?

Señal de alarma: una respuesta que diga "es seguro, solo hay que sincronizar" sin mencionar la credencial,
el catálogo scopeado o el sello `dirty` es una auditoría incompleta.

## Anexo A — Extractos de código que importan (verbatim, para comprobar)

**A.1 · El rol efectivo y la doble llave** (`cloudflare-worker/src/authz.ts`, `resolveAuthz`):
```ts
const tokensConfigured = !!(env.AUTH_TOKEN || env.OPERATOR_TOKEN);
const canWriteCatalog = r === 'ADMIN' && (!tokensConfigured || tokenRole === 'ADMIN');
return { source: 'identity', role: r, uid: identity.uid, linkedTeacherId: …, linkedStudentCode: …, canWriteCatalog };
…
if (tokenRole === null) return null; // no autenticado
return { source: 'token', role: tokenRole, canWriteCatalog: tokenRole === 'ADMIN' };
```

**A.2 · El push decide por alcance** (`cloudflare-worker/src/index.ts`, `/api/sync/push`):
```ts
const isAdmin = authz.canWriteCatalog;   // solo ADMIN (token o identidad) escribe catálogo
const isOperator = !isAdmin;             // OPERATOR (token) o DOCENTE/ESTUDIANTE (identidad) → solo hechos
```

**A.3 · El camino ADMIN reemplaza catálogo y ajustes del snapshot** (`index.ts`):
```ts
const mergedStudents = (Array.isArray(data.students) ? data.students : []).map((s: any) => { … });
const snapshotData = stripSnapshotCredentials({
  ...data,
  ...(Array.isArray(data.students) ? { students: mergedStudents } : {}),
  records: mergedRecords, tombstones: mergedTombstones
});
```

**A.4 · Anti-aplastado: solo con 0 estudiantes** (`index.ts`):
```ts
if (isAdmin && students.length === 0 && !body.force && env.DB) { … 409 … }
```

**A.5 · El hecho por fila no valida autoría** (`index.ts`, `/api/attendance`):
```ts
if (!r || typeof r !== 'object' || !r.studentCode || !r.date || !r.time) return errorResponse('studentCode, date y time son requeridos.', 400);
…
const known = await env.DB.prepare(`SELECT 1 AS x FROM students WHERE code = ?`).bind(String(r.studentCode)).first();
if (!known) return errorResponse(…, 404);
```

**A.6 · La verificación de tarjetas depende del snapshot** (`index.ts`, `/api/verify/class-token`):
```ts
if (!settings || !(settings.qrSecret || settings.legacyQrSecret)) {
  return errorResponse('La institución no tiene clave de firma configurada en la nube. Rectoría debe sincronizar una vez (Push) para habilitar la verificación.', 409);
}
```

**A.7 · El ciclo automático** (`src/services/cloudflareSync.ts`):
```ts
const dirty = AttendanceStorageService.getLocalSyncDirty();
if (!dirty) { this.pullFromCloudflare().catch(() => {}); return; }
this.performCloudflareSync().then(async (pushResult) => { … if (pushResult?.success === true && session?.role === 'ADMIN') await this.pullFromCloudflare(); … });
```

**A.8 · El cliente elige el token** (`src/services/cloudflareSync.ts`):
```ts
const isAdmin = forceAdmin || session?.role === 'ADMIN';
const token = isAdmin ? (settings.cloudflareApiToken || '').trim()
                      : ((settings.cloudflareOperatorToken || '').trim() || (settings.cloudflareApiToken || '').trim());
```

## Anexo B — Glosario mínimo

- **Snapshot**: JSON con catálogo + hechos que el Worker guarda en D1/KV y sirve en el pull.
- **Hecho**: un registro de asistencia (un escaneo).
- **Catálogo**: estudiantes, docentes, horarios, plantillas, ajustes.
- **`dirty`**: sello local "hay cambios sin subir"; con él, el ciclo hace push; sin él, solo pull.
- **Outbox**: cola durable local de hechos; `replayOutbox()` los reenvía por `POST /api/attendance`.
- **`opId`**: clave de idempotencia por operación (24 h en KV) para que un reintento no duplique.
- **Scopeado**: el pull filtra por rol (un estudiante recibe solo su curso; un docente, sus cursos).

--- FIN DEL ENCARGO ---
