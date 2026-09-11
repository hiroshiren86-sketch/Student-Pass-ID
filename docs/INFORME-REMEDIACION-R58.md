# INFORME DE REMEDIACIÓN — RONDA 58
**Fecha:** 11/09/2026 · **Repo:** `hiroshiren86-sketch/Student-Pass-ID` (base `ae97105`, main)
**Insumo:** `INFORME-AUDITORIA-INAS-2026-09.md` (hallazgos F-1…F-25)
**Veredicto global:** **23 hallazgos confirmados y corregidos · 2 refutados/explicados con evidencia de código.** Cero regresiones: R43 **64✓** · R46 **40✓** · R47 **18✓** · R58 **36✓** (suite nueva) · R49 SKIP-limpio · `tsc` cliente y Worker **0 errores** · `vite build` OK (8 chunks).

> **Metodología:** cada hallazgo se verificó contra el código ANTES de tocarlo (evidencia citada con archivo:línea del estado PRE-corrección). Los fixes respetan la ingeniería existente (offline-first, Regla 6 "cero fallback silencioso", QA suites por ronda). Toda línea nueva lleva el marcador `Ronda 58 (F-xx)` para trazabilidad.

---

## Resumen ejecutivo por hallazgo

| # | Hallazgo (resumen) | Veredicto | Corrección | Acción del propietario |
|---|---|---|---|---|
| F-1 | `isSignatureValid`/`isExpired` calculados y NUNCA consultados: carné forjado/vencido se registraba | ✅ Confirmado | Política `requireSignedCards` (default ON) en `registerClassScan` + `verifiedHmac` honesto | Decidir si el colegio opera con lectores 1D planos (palanca en Ajustes) |
| F-2 | `DEFAULT_QR_SECRET` público en el repo firmaba carnés | ✅ Confirmado | Secret obligatorio en toda la API de crypto; portal usa `settings.qrSecret`; defaults sin secret | — |
| F-3 | `/api/excuses` sin verificación de identidad (Ley 1581) | ✅ Confirmado | `resolveAuthz` en todo el módulo; mínimo privilegio por rol/identidad | — |
| F-4 | `firestore.rules`: escritura universal incl. sesión anónima | ✅ Confirmado | `school_settings` read auth / write ADMIN; `attendance_records` solo ADMIN | **Desplegar reglas** (CI manual o `firebase deploy`) |
| F-5 | `verifyAuth` muerto + CORS `*` en respuestas de error | ✅ Confirmado | `verifyAuth` eliminado; `withCorsHeaders` en TODAS las respuestas | — |
| F-5a | Identidad ADMIN sin token ADMIN podía escribir catálogo | ✅ Confirmado | `canWriteCatalog = ADMIN && (!tokens ‖ tokenRole===ADMIN)` | — |
| F-6 | Snapshot pisado por pushes concurrentes (lost update) | ✅ Confirmado | `casWriteSnapshot`: guard CAS sobre `updated_at`, 3 intentos con re-fusión | — |
| F-7 | `stampServerVersion` re-sellaba TODO el snapshot | ✅ Confirmado | Sello solo a registros entrantes, antes del merge | — |
| F-8 | Re-matriculado quedaba muerto para siempre (tombstone sin fechas) | ✅ Confirmado | Comparación de fechas en `applyTombstones` + `clearTombstones` en add* + retiro en push admin | — |
| F-9 | Auto-cierre en N dispositivos → ausentes duplicados/inflados | ✅ Confirmado | Solo sesión ADMIN + IDs deterministas `rec-autoclose-<fecha>-<bloque>-<est>` | — |
| F-10 | 6.9 MB serializados por escaneo (9 lecturas de localStorage) | ✅ Confirmado | Cache de lectura + write-through + espejo de qrSecret | — |
| F-11 | Auto-sync quemaba ~2.9M rows/día (cuota D1 100k/día) | ✅ Confirmado | Push solo con sello dirty; Rectoría idle solo Pull; sin `slice(0,500)` | — |
| F-12 | opId FNV-1a de CONTEOS colisionaba → push descartado en silencio | ✅ Confirmado | opId = SHA-256 del contenido | — |
| F-13 | Firma HMAC de 64 bits (16 hex) | ✅ Confirmado | 32 hex (128 bits); legado 16-hex aceptado SOLO al verificar (carnés impresos) | — |
| F-14 | "PBKDF2 de 10 000 iteraciones protege contraseñas" | ❌ **REFUTADO** | `hashPasswordPbkdf2` era código MUERTO (0 llamadores) — eliminado igual como superficie, pero la afirmación del informe no correspondía al camino de autenticación | — |
| F-15 | API key de Gemini viajaba en `?key=` (query string logueada) | ✅ Confirmado | 4 usos migrados a header `x-goog-api-key` | — |
| F-16 | Sin CI/CD: Worker y reglas sin pipeline, suites sin gate | ✅ Confirmado | `.github/workflows/ci.yml` (verify en cada push/PR + deploys manuales) | **Configurar secrets** `CLOUDFLARE_API_TOKEN` y `FIREBASE_SERVICE_ACCOUNT` |
| F-17 | CORS reflectivo `*` | ✅ Confirmado | Allowlist de orígenes; preflight no permitido → 403 | Si hay dominio propio, añadirlo a `ALLOWED_ORIGINS` |
| F-18 | Login estudiante: búsqueda por nombre + PII + sin rate limit | ✅ Confirmado | Sin nombre en autenticación; mensajes genéricos; throttle con backoff persistido | — |
| F-19 | Suite R43 "siempre fallaba" (exit=2) | ⚠️ **Explicado** | El exit=2 era el watchdog del harness (90 s), NO un fallo: los 51 checks estaban en verde. Corregido igual: watchdog limpio + `exit(0)` | — |
| F-20 | 3 deps sin uso + reliquias en bundle de producción | ✅ Confirmado | Fuera `motion`/`@zxing/browser`/`zod`; server deps a devDependencies; sin `dist/server.cjs` | — |
| F-21 | Bundle monolítico de 2.64 MB | ✅ Confirmado | `manualChunks` → 8 chunks (react 69 KB gz, firebase 172, pdf 178, charts 111…) | Opcional: rev de cache del SW para completar |
| F-22 | `hour12:false` → "24:37" en runtimes h24 | ✅ Confirmado | `hourCycle:'h23'` explícito | — |
| F-23 | `tempPassword` en claro en el snapshot público por rol | ✅ Confirmado | Verificador HMAC en el push + strip en el Worker + `verifyStudentCredential` | — |
| F-24 | Portal: 'colegio2026'/código/'SJ-2026' abrían cualquier cuenta | ✅ Confirmado | Puerta trasera eliminada; autocompletado ya no muestra claves | — |
| F-25 | Token del Worker y contraseñas en scripts del repo | ✅ Confirmado | Scripts leen de env/`~/.inas-qa.env` | **ROTAR: AUTH_TOKEN del Worker, contraseñas Firebase, y (recomendado) qrSecret** |

---

## 1. Seguridad — detalle y evidencia

### F-1 · El escáner ignoraba la firma del carné (CRÍTICO)
**Evidencia (pre-fix):** `parseAndVerifyScan` devolvía `isSignatureValid`/`isExpired` y `registerClassScan` creaba el registro con `verifiedHmac: parsed.isSigned` — "empieza con IEDSJ:v1:" — sin consultar NINGUNA de las dos. El CSV reportaba "Token QR Firmado (VÁLIDO)" para un carné firmado con OTRO secret.
**Corrección:** `src/services/attendanceStorage.ts:2375` — política `requireSignedCards` (default ON, type en `src/types/attendance.ts`, palanca en `SettingsModal.tsx:900`): `UNSIGNED`/`BAD_SIGNATURE`/`EXPIRED`/`LEGACY_COL_ASIS` → rechazo con mensaje accionable (cada motivo con su guía). `verifiedHmac` ahora exige `parsed.isSignatureValid === true`.
**Hallazgo NUEVO cazado en la remediación:** los registros de AUTO_CIERRE nacían con `verifiedHmac: true` — un registro que JAMÁS pasó por un escaneo afirmaba verificación criptográfica en planilla y CSV. Corregido (`verifiedHmac: false`) + check E9c.
**Decisión de producto documentada:** el barcode 1D del carné impreso es el código PLANO (`pdfGenerator.ts`), así que el default estricto bloquearía lectores USB-HID 1D; por eso la palanca existe y está en Ajustes (el modo legado queda registrado como "sin verificación criptográfica", nunca como verificado).
**Pruebas:** verify_ronda43 §E (E1–E8, 10 checks).

### F-2 · Secret público del repo
**Evidencia (pre-fix):** `crypto.ts` tenía `const DEFAULT_QR_SECRET = 'PROTOTYPE-HMAC-QR-SECRET-COL-2026'` y `generateStudentQrPayload(student)` firmaba con él; el portal llamaba SIN secret → carné en vivo firmado con el secret del repo, jamás verificable en un terminal con secret institucional.
**Corrección:** API rompiente a propósito — `secret` obligatorio en `generateHmacSignature`/`generateStudentQrPayload`/`parseAndVerify*` (el compilador ahora OBLIGA a pasar el secret institucional). `StudentPortalView.tsx` firma con `settings.qrSecret`. `mockData.ts` sin secrets; `getSettings()` regenera aleatorio si aparece el literal viejo.
**Pruebas:** qa-r58 G1/G2; `tsc` garantiza que no queda ningún llamador sin secret.

### F-3 · Excusas sin gate (Ley 1581)
**Evidencia (pre-fix):** `handleExcusesRoutes` se montaba en el router SIN auth; cualquier poseedor de la URL listaba todas las excusas (datos de salud de menores) y el `role` venía del query string.
**Corrección:** `cloudflare-worker/src/excuses.ts` — `resolveAuthz` al frente (401 sin credencial); identidad estudiante → forzado a su propio código; token sin studentCode → 403; PATCH exige isAdmin real (`reviewedByRole` ignorado); adjuntos por identidad. `push.ts`: suscripción RECTORIA solo con admin real.
**Ruptura de retrocompat deliberada y documentada:** terminales OPERADOR sin studentCode ahora reciben 403 en GET /api/excuses (era la fuga).

### F-5/F-5a · Verificación y doble llave
`verifyAuth` (muerto) eliminado; todo pasa por `resolveAuthz` (`authz.ts`) con identidad Firebase verificada contra certs de Google (jose) + alcance por token. Escribir catálogo exige identidad ADMIN **Y** token ADMIN cuando hay tokens configurados — cierra el bypass "cuenta ADMIN de Firebase sin token" sobre `/api/sync/push` operador.
**Pruebas:** qa-r58 F1–F5.

### F-4 · firestore.rules
**Evidencia (pre-fix):** `allow write: if isAuthenticated()` y `isAuthenticated()` incluía `signInAnonymously()` — la terminal anónima (cuya Web API Key es pública por diseño) podía reescribir `school_settings` (incl. `cloudflareWorkerUrl` → redirección de credenciales) y leer/escribir TODA la asistencia.
**Corrección:** lectura para autenticados (la terminal hidrata ajustes — Ronda 18 depende de esto), escritura solo ADMIN; `attendance_records` solo ADMIN (su único escritor real, `backupAllToFirestore`, corre bajo sesión de Rectoría; `syncAttendanceRecord` estaba muerto).
**⚠️ Acción requerida:** las reglas no se auto-despliegan — usar el workflow manual del CI o `firebase deploy --only firestore:rules`.

### F-23 · Claves en claro en el snapshot
**Evidencia (pre-fix):** el push subía la ficha completa con `tempPassword` (la clave impresa del carné) y el snapshot se sirve por rol a docentes/operadores.
**Corrección (dos capas):** (1) cliente — `sanitizeStudentsForSync` sustituye la clave por `tempPasswordVerifier = HMAC-SHA256(qrSecret, "code|clave")` y los docentes viajan sin `password`/`passwordHash`/`tempPassword`; (2) Worker — `stripSnapshotCredentials` (defensa en profundidad para terminales viejas). Nuevo punto único `AttendanceStorageService.verifyStudentCredential` (acepta claro local O verificador, tolera rotación vía `legacyQrSecret`, rechaza sin credencial).
**Límite documentado con honestidad:** no es un KDF; quien tenga el snapshot Y el qrSecret (que viaja en el snapshot por decisión R56 del propietario) puede atacar el verificador offline. La verificación FUERTE sigue siendo Firebase Auth.
**Pruebas:** qa-r58 D1–D8.

### F-24 · La puerta trasera del portal
**Evidencia (pre-fix):** `StudentPortalView.handleLogin` aceptaba `'colegio2026'`, el propio `student.code`, o `'SJ-2026'` para fichas sin clave; `fillQuickStudent` ESCRIBÍA la contraseña en pantalla (patrón derivable `SJ-` + últimos 4 dígitos).
**Corrección:** los tres caminos eliminados; login del portal vía `verifyStudentCredential`; autocompletado solo prellena el CÓDIGO.
**Pruebas:** qa-r58 G3–G5.

### F-18 · Login de estudiante
Sin búsqueda por nombre en el camino de autenticación (era enumeración del roster); mensajes genéricos sin PII; throttle persistido por dispositivo: 5 fallos → 30 s, backoff exponencial hasta 15 min, contador a cero con éxito.
**Nota:** el login DOCENTE no se tocó (Firebase Auth + `hasCustomPassword` verificado contra perfil, no localStorage).

### F-25 · Credenciales en scripts
`r47_fases.mjs`, `r47_planilla.mjs` y `qa-r49-identity.ts` ya no contienen token ni contraseñas: leen `INAS_AUTH_TOKEN`/`INAS_REC_EMAIL`/`INAS_REC_PASS`/`INAS_DOC_*` de env o `~/.inas-qa.env` (chmod 600, fuera del repo).
**⚠️ ACCIÓN URGENTE DEL PROPIETARIO (la corrección del árbol NO cierra la fuga del historial git):**
1. **Rotar `AUTH_TOKEN`** del Worker (Cloudflare → Workers → Settings → Variables) — el token de 64 hex está en el historial público.
2. **Cambiar contraseñas** `rectoria@inas.edu.co` y `mrestrepo@inas.edu.co` en Firebase Auth.
3. Recomendado: **rotar `qrSecret`** (Rectoría lo cambia en Ajustes; `legacyQrSecret` mantiene los carnés impresos verificando durante la transición y el sistema recalcula verificadores al sincronizar).

---

## 2. Integridad de datos — detalle

### F-6 · Lost update del snapshot
**Evidencia (pre-fix):** el push hacía SELECT → escribir → sin comparar `updated_at` (y R48 había ensayado `updated_at = ?` sin retry).
**Corrección:** `casWriteSnapshot` (`cloudflare-worker/src/index.ts:326`): SELECT → mutar → `UPDATE … WHERE id=? AND updated_at=?`, 3 intentos RE-LEYENDO y re-fusionando sobre lo que el ganador escribió; creación con `INSERT OR IGNORE`; si todo falla: degradación honesta (última escritura gana + `console.warn`, y el operador NO refresca KV).
**Prueba con mock de D1 real:** qa-r58 §E — dos pushes con la misma vista base terminan con AMBOS conjuntos de hechos en el snapshot (antes: el segundo pisaba al primero).

### F-7 · Re-sello masivo
**Evidencia (pre-fix):** `stampServerVersion(snapshot.records)` re-sellaba TODO el histórico en cada push → cada push era "más nuevo" que el anterior para TODOS los registros (amplificación de escrituras + falsa monotonía).
**Corrección:** sellar SOLO los entrantes, ANTES de `mergeRecordsByUpdatedAt`. **Prueba:** qa-r58 §B (incluye el contraste B3 que demuestra que el patrón viejo efectivamente re-sellaba).

### F-8 · Re-matriculados muertos
**Evidencia (pre-fix):** `applyTombstones` filtraba por `id` sin comparar fechas; el comentario de R54 en `addStudent` decía "se descarta el tombstone al re-crear" pero NADIE llamaba `clearTombstones`.
**Corrección:** (1) `applyTombstones` compara `updatedAt/createdAt` de la entidad contra `deletedAt` del tombstone (más nueva → revive; legada sin fecha → el tombstone manda); (2) `addStudent`/`addTeacher` llaman `clearTombstones`; (3) el push admin RETIRA los tombstones de estudiantes/docentes presentes en el catálogo entrante.
**Pruebas:** qa-r58 §C (C1–C5).

### F-9 · Auto-cierre multi-dispositivo
**Evidencia (pre-fix):** `maybeAutoCloseDay` corría en cualquier dispositivo con la app abierta, y los AUSENTEs automáticos llevaban `rec-abs-${Date.now()}-…` — IDs distintos en cada terminal → el merge por id SUMABA series.
**Corrección:** (1) el tick de App.tsx solo ejecuta con sesión ADMIN; (2) IDs deterministas `rec-autoclose-<fecha>-<bloque>-<estudiante>` → dos dispositivos que cierran producen registros IDÉNTICOS y el merge deduplica.
**Pruebas:** verify_ronda43 E9/E9b/E9c.

### F-12 · Colisión de opIds
**Evidencia (pre-fix):** opId = FNV-1a 32 bits de un seed de CONTEOS (`students.length`, `records.length`…) — borrar un registro y crear otro dejaba los conteos iguales → mismo opId → el Worker respondía `deduplicated:true` y el push real se perdía EN SILENCIO.
**Corrección:** opId = SHA-256 (WebCrypto) del payload canónico (ids+updatedAt de catálogo y hechos). Mismo estado → mismo opId (reintento idempotente); cualquier cambio real → opId distinto. **Prueba:** qa-r58 §H (H2 demuestra el caso que colisionaba).

### F-11 · Quota-burn de D1
**Evidencia (pre-fix):** cada terminal pusheaba el snapshot completo cada 5 min estuviera o no sucia (20 terminales ≈ 2.9M rows/día vs. cuota D1 de 100k/día desde 01/09/2026) y el push truncaba `records.slice(0, 500)`.
**Corrección:** (a) el auto-sync solo pushea con sello dirty de R57; Rectoría idle hace solo Pull; dispositivo idle = **quota 0**; (b) `slice(0,500)` retirado del push de hechos (el Worker ya fusiona por id+updatedAt — aditivo y seguro; el tope de R53 sigue aplicando en el LADO DEL WORKER, que es donde pertenecía).

---

## 3. Infraestructura y calidad

- **F-17 CORS** (`cloudflare-worker/src/cors.ts`): allowlist (prod `pages.dev`, previews `*.pages.dev`, localhost, extras por `ALLOWED_ORIGINS`); preflight no permitido → 403; sin Origin (curl/QA) → sin headers CORS. Ciclo de imports resuelto (push.ts importa de `./cors`, no de `index`).
- **F-15** (`aiService.ts`): 4 endpoints de Gemini migrados de `?key=…` a header `x-goog-api-key` (la query string queda en logs de proxies).
- **F-22** (`attendanceStorage.ts:97`): `hourCycle:'h23'` — `hour12:false` producía "24:37" en runtimes h24 (y con eso, auto-cierre del día recién estrenado). Check E10.
- **F-19** (`verify_ronda43.ts`): watchdog con handle + `clearTimeout` + `process.exit(0)` — el exit=2 a los 90 s era el harness, no un fallo (los 51 checks estaban en verde; ahora son 64). `qa-r49-identity.ts`: sin `.firebase-sa.json` entra en SKIP explícito exit-0 (antes moría en cualquier clone limpio).
- **F-16** (`.github/workflows/ci.yml`): `verify` en TODO push/PR (tsc cliente+worker, vite build, 5 suites con `TZ=America/Bogota`, y contrato de marcadores del bundle servido — automatiza el `curl | rg marcador` de cada ronda); `deploy-worker` y `deploy-firestore-rules` SOLO por `workflow_dispatch` (el propietario decide cuándo toca producción — lección H-29-4). **Pendiente: configurar los secrets.**
- **F-20** (`package.json`): fuera `motion`, `@zxing/browser`, `zod` (0 imports); `@google/genai`/`express`/`dotenv` a devDependencies (solo las usa `server.ts`, reliquia dev); `build` = `vite build` (ya no genera `dist/server.cjs`); `start` = `vite preview`.
- **F-21** (`vite.config.ts`): `manualChunks` funcional (el meta-paquete `firebase` no tiene entry raíz — la forma objeto fallaba) → **8 chunks**: react 69 KB gz · firebase 172 · pdf 178 · charts 111 · qr 71 · icons 9 · app 157. *Pendiente documentado:* la mejora completa en navegadores que ya visitaron requiere rev de cache del service worker (el SW cachea por URL: nuevos hashes = nueva descarga, pero los chunks viejos quedan hasta la rev).
- **F-10** (`attendanceStorage.ts:176`): cache de lectura para las 6 colecciones/ajustes con **write-through** (los `save*` persisten y dejan el array como cache válido; `notify(false)`), invalidación por defecto para todo el resto de escrituras (verificado por grep: cero `setItem` directos a llaves de colección fuera del servicio). Además: `enqueueOfflineMutation` ya no invalida (era el invalidador oculto entre escaneos) y espejo `inas_qrsecret_mirror_v1` para que un JSON de settings corrupto NO regenere el qrSecret en silencio (el secreto se restaura del espejo — fin de las "firmas que dejan de verificar sin error visible").
  **Medición (scripts/perf-r58-probe.ts, 1 500 est./15 000 reg.):** 6.9 MB leídos por escaneo → **0.00 MB**; 61.5 ms → **~13 ms**. Las ~2.8 MB de escritura por escaneo son inherentes al diseño localStorage de array completo (migración a IndexedDB documentada como siguiente paso, no emprendida para no romper el offline-first en una ronda de seguridad).

---

## 4. Los 2 hallazgos refutados/explicados

- **F-14 — REFUTADO:** el informe afirmaba que el sistema "protege contraseñas con PBKDF2 de 10 000 iteraciones y salt estático" como si estuviera en uso. Evidencia: `hashPasswordPbkdf2` tenía **cero llamadores** (verificado por grep antes de eliminarlo) — era código muerto que nunca participó de ninguna autenticación. Se eliminó igual (superficie de ataque/confusión), pero la entrada del informe debe corregirse: el problema real era el que describe F-23.
- **F-19 — EXPLICADO:** la suite R43 NO "fallaba siempre": sus checks estaban en verde y el exit=2 venía del `setTimeout(90s)` del harness de timeout global, que mataba el proceso aunque la suite hubiera terminado. Corregido de todas formas (watchdog limpio, exit explícito), y qa-r49 ahora hace SKIP limpio en vez de morir.

---

## 5. Validación final (evidencia reproducible)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` (raíz) | **0 errores** |
| `npx tsc --noEmit` (cloudflare-worker) | **0 errores** (primera vez que el worker se typecheckea) |
| `npx vite build` | OK — 8 chunks (antes 1 de 2.64 MB / 771 KB gz) |
| `TZ=America/Bogota npx tsx scripts/verify_ronda43.ts` | **64 OK · 0 FALLO** (51→64: +13 checks de política F-1/F-9/F-22; exit 0 en ~1 s) |
| `TZ=America/Bogota npx tsx scripts/qa-r46-rep.ts` | **40 OK · 0 FALLO** |
| `TZ=America/Bogota npx tsx scripts/qa-r47-guard.ts` | **18 OK · 0 FALLO** |
| `TZ=America/Bogota npx tsx scripts/qa-r58-hardening.ts` | **36 OK · 0 FALLO** (NUEVA) |
| `TZ=America/Bogota npx tsx scripts/qa-r49-identity.ts` | **SKIP explícito, exit 0** (sin SA local) |
| `TZ=America/Bogota npx tsx scripts/perf-r58-probe.ts` | 6.9 MB → 0.00 MB leídos/escaneo · 61.5 → ~13 ms |

**Nota de compatibilidad deliberada:** las suites R43 §D y R46 corren ahora con `requireSignedCards:false` explícito porque ejercitan el flujo legado de códigos 1D planos; la política ACTIVA se prueba en R43 §E y qa-r58. Los carnés impresos con firma de 16 hex siguen verificando (transición); los tokens `COL_ASIS:v1` ya NO se auto-validan (fin del formato sin criptografía que se auto-aprobaba).

## 6. Pendientes que SOLO el propietario puede ejecutar

1. **ROTAR credenciales** (F-25 — urgente, el historial git las mantiene públicas aunque el árbol ya esté limpio): `AUTH_TOKEN` del Worker, contraseñas Firebase de Rectoría/Docente, y recomendado rotar `qrSecret` (la app ya tolera la transición con `legacyQrSecret`).
2. **Desplegar** el Worker (`wrangler deploy` tras `wrangler d1 migrations`) y las `firestore.rules` — con el CI manual o manualmente. El deploy de Pages sale solo con el push.
3. **Configurar secrets del CI**: `CLOUDFLARE_API_TOKEN`, `FIREBASE_SERVICE_ACCOUNT`.
4. Decidir la política operativa de lectores 1D (palanca "Exigir carné firmado" en Ajustes → Sync y Seguridad; default ON).


---

# ADDENDUM — RONDA 59 (mismo día): el secreto viaja por rol

**Pregunta del propietario:** *"¿Cómo se soluciona el problema de que el QR Secret viaje hacia los estudiantes? … Rectoría la pone en su panel y se le reparte automáticamente a todos los usuarios… según su rol."*

**Respuesta corta:** el flujo de Rectoría-una-vez + distribución automática por rol se CONSERVA exactamente igual. Lo que cambia es **qué** recibe cada rol, porque *verificar no es lo mismo que firmar*:

| Rol | ¿Qué recibía (R56)? | ¿Qué recibe (R59)? |
|---|---|---|
| Rectoría (ADMIN) | qrSecret | qrSecret (firma todo) — sin cambios |
| Terminal de escaneo (OPERATOR) | qrSecret | qrSecret (verifica firmas offline) — sin cambios |
| Docente (identidad) | qrSecret + fichas con verificador | qrSecret (verifica offline) + fichas SIN credenciales (deriva al vuelo) |
| **Estudiante** | **qrSecret completo** ← el problema | **NADA de secret.** Su carné pre-firmado en SU ficha + SU llave de login derivada |

## Las 3 piezas implementadas

1. **El Worker no lo envía (la corrección de verdad, servidor-side).** `filterSnapshotByRole` para `ESTUDIANTE_ACUDIENTE`: settings sin `qrSecret`/`legacyQrSecret`; la propia ficha intacta; los compañeros de grado sin `loginKey`/verificador/token/documento. Aunque el cliente fuera manipulado, el servidor ya no entrega el secret a ese rol.
2. **Carné pre-firmado (`signedCardToken`).** El push de Rectoría adjunta a cada ficha su token QR ya firmado — el mismo que se imprime en el PDF (`pdfGenerator` prefiere el token de la ficha → carné impreso y QR del portal son idénticos). El portal del estudiante **muestra** ese token; ya no firma nada en su dispositivo.
3. **Login offline sin secret institucional (`loginKey`).** `loginKey = HMAC(qrSecret, "loginkey:v1:"+código)` y `verifier = HMAC(loginKey, clave)`. La loginKey viaja **solo en la propia ficha** del estudiante: con ella su portal verifica **su** clave offline, pero no puede verificar ni falsificar la de ningún compañero. Las terminales (que sí tienen el qrSecret para verificar escaneos) derivan cualquier loginKey al vuelo. Bonus: el par es autocontenido → el login del estudiante **sigue funcionando tras una rotación del secret incluso antes del re-push de Rectoría**.

**Defensa en profundidad:** el cliente además rechaza instalar `qrSecret` si la sesión local es de estudiante (protege mientras el Worker nuevo no esté desplegado).

**Límite honesto que queda (documentado, no oculto):** con HMAC simétrico, un DOCENTE/terminal que verifica también podría firmar (verificar y firmar usan la misma llave). Eso es confianza de personal del colegio, no de estudiantes. La solución definitiva a ese residuo es **firma asimétrica Ed25519** (Rectoría firma con la llave privada; absolutamente todos —incluidos docentes— solo verifican con la pública; nadie más puede firmar nada). Queda como roadmap recomendado, no emprendido en esta ronda.

**Validación:** qa-r58 **51✓** (§D reescrita + §I nueva de scopeo, 9 checks) · R43 64✓ · R46 40✓ · R47 18✓ · `tsc` cliente+Worker 0 · build OK.
