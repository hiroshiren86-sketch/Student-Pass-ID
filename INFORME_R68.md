# INFORME FINAL — RONDA 68 (Directiva Máster: auditoría forense + cierre definitivo)

**Fecha:** martes 15/09/2026 (America/Bogota) · **Proyecto:** INAS — Student-Pass-ID
**Repo:** `hiroshiren86-sketch/Student-Pass-ID` (público) · **App:** https://student-pass-id.pages.dev
**Commits R68:** `c8dda07` (fixes cliente + bitácora) → `9326818` (fix RC-6) → `df3aa85` (docs/cierre). Remoto = `df3aa85`, working tree limpio, SA gitignored, PAT del §5b usado solo en el push (remote restaurado a HTTPS limpio, sin rastro en config ni repo).

**Nota metodológica:** el informe R67 NO se tomó como confiable; cada afirmación de este informe tiene evidencia propia generada en esta ronda (playwright vs producción, REST/SA, D1 vía Worker, inventarios). Lo que no se pudo verificar se marca explícitamente.

---

## 1. EL BUG REPORTADO — REPRODUCIDO → CAUSA RAÍZ → CORREGIDO → VERIFICADO

> *"Firebase valida al estudiante pero la app muestra 'Su cuenta es válida, pero este dispositivo aún no tiene la ficha del estudiante'"*

**REPRODUCIDO 100 % sin trucos de red** (playwright headless vs producción, pre-fix, instrumentos con `addInitScript`):
- Dispositivo LIMPIO (sin storage), ALEJANDRO 17329759 (7°4, **7° registro de su grado en el array**), sin delays: login Firebase OK → pull 200 (14 estudiantes, **el propio incluido**) → localStorage íntegro con los 14 → **la UI igualmente mostraba el mensaje reportado**.
- Intento 2 (datos ya locales): lookup pre-pull sin pull, error "No se pudo iniciar sesión" y SIN `console.error('Error in email login')` → el throw era del flujo de login, no de Firebase.

**CAUSA RAÍZ (RC-1):** `AttendanceStorageService.getStudentByCodeOrDoc()` hacía `s.documentId.toLowerCase()` **sin defensa**. El pull por rol despoja las fichas de terceros por diseño (R59, `authz.ts`: `stripStudentRecord`/`Deep` quitan `documentId`, `loginKey`, `tempPasswordVerifier`, `signedCardToken`, `photoUrl`). En un terminal de estudiante, 13 de 14 fichas carecen de `documentId` a nivel runtime. Si un compañero despojado **precede** al propio en el array, el callback del `find()` lanza `TypeError` antes de llegar a la ficha propia; en `LoginScreen` el lookup post-pull está en un `try/catch` **silencioso** → mensaje "Su cuenta es válida…". JULIANA (196555769) "pasaba" porque es la **primera** del array de 6°4: el `find()` la matchea en el elemento 1 sin evaluar callbacks ajenos.

**CORREGIDO (solo cliente — el Worker NO se tocó ni re-desplegó):**
- **RC-1:** lookup defensivo `String(s?.code ?? '')` / `String(s?.documentId ?? '')` — `code` (nunca se despoja) sigue siendo el identificador canónico. **NO se reintroduce `documentId` en compañeros** (la despoja es minimización de datos, R59/R61).
- **RC-1b:** las 4 escrituras de registro que hacían `studentDocument: student.documentId` ahora `String(x ?? '')` (escaneo de docente sobre estudiantes despojados ya no escribe `undefined` en el JSON).
- **RC-2:** excusas 401 en dispositivos de identidad → `ExcuseService.workerHeaders()` ahora `async` y viaja `X-Firebase-Id-Token` con sesión real (los 7 call sites a `await`). Verificado en campo: `/api/excuses?studentCode=…` → **200** en los 3 E2E limpios.
- **RC-3:** el badge de excusas ya no sondea `/api/excuses` desde la pantalla de login (0 401 pre-login en campo).
- **RC-4:** **fin de la creación automática de cuentas anónimas** en el arranque (`App.tsx`). Evidencia del fugue: R67 = 993 órfanas → R68 = 1274 (~1167 órfanas; **+174 en 24 h**, una por navegador limpio). Verificado en campo: 0 llamadas a `signInAnonymously` en los 3 E2E limpios.
- **RC-5:** el `catch {}` silencioso del pull/lookup ahora loguea; `mapAuthError` distingue errores no-Firebase con mensaje honesto.
- **RC-6 (hallazgo nuevo, N+1):** el modal de Ajustes descartaba **en silencio** el `AUTH_TOKEN` si se cerraba con X sin pulsar «Guardar Cambios» → el terminal empujaba sin permiso de catálogo y la cascada rebotaba 403. Fix: los tokens de dispositivo persisten **al escribir** (los demás campos conservan el guardado explícito) + nota visible en el campo. Verificado en campo: token pegado + cierre con X → cascada **200** (antes 403).

**VERIFICADO post-deploy (build con marker R68 en el bundle servido):**
| Dispositivo limpio | Resultado |
|---|---|
| **ALEJANDRO 17329759** (7° del array — **el caso reportado**) | ✅ ficha real: nombre, 7°4, código, estadísticas, carné |
| JULIANA 196555769 (1° del array) | ✅ ficha real + «Modo Representante de Salón (6°4)» |
| NATALIA 17015599 (8°4, cross-grade) | ✅ ficha real |

En los tres: **cero 401** (pre y post-login), **cero cuentas anónimas creadas**, excusas **200**.

---

## 2. CUENTAS ANÓNIMAS — AUDITADAS + FUGA CERRADA

- **Inventario SA (Worker ADMIN, SA en memoria, jamás en repo):** 1274 cuentas = 107 password (las provisionadas) + 1164 sin proveedor (órfanas de `signInAnonymously`) + 3 google.
- **BASELINE post-deploy + 3 E2E limpios: Δ total = 0, Δ órfanas = -3.** La fuga está cerrada para el bundle nuevo.
- **Nota honesta:** una órfana nueva apareció a las 05:37:09 UTC (antes del E2E final, con producción ya sirviendo el bundle RC-4). Causa más probable: un **dispositivo real con el bundle PRE-RC-4 en caché** (cada carga de un terminal con JS viejo crea su anónima, como siempre). El bundle nuevo queda probado que no crea cuentas.
- **PENDIENTE:** limpieza de las ~1165 órfanas históricas = **decisión del propietario** (la vía SA de eliminación de cuentas EXISTENTES está autorizada desde R67 vía `/api/admin/entity/delete`).

---

## 3. AUDITORÍA FIRESTORE §19 — VERIFICADO (solo lectura)

- **Reglas DESPLEGADAS ≠ repo (diff exacto):** la ruleset vigente `2c5edd0f` (publicada 08-09) **NO contiene F-4**. Diferencia con `firestore.rules` del repo = **exactamente el bloque F-4**: `school_settings` desplegado = `read,write: isAuthenticated()` (cualquier sesión, incluso anónima, podía **escribir** la configuración de la institución); repo/F-4 = `read: isAuthenticated() + write: isAdmin()`. `attendance_records`: desplegado = autenticado; F-4 = solo ADMIN. **F-4 queda en el repo listo; NO se desplegó** (mandato: zona del propietario; job CI `deploy-firestore-rules` = `workflow_dispatch`).
- **`school_settings/main` (base nombrada `ai-studio-sistemaderegistr-…`):** 30 campos y **CERO secretos con valor** (qrSecret, legacyQrSecret, sessionSecret, cloudflareApiToken, customAiApiKey, vapidPrivateKey — todos vacíos). schoolName I.N.A.S, plantilla normal, `defaultAccessPassword: 000000`, workerUrl presente. El hallazgo R37 (token Cloudflare en Firestore) sigue erradicado.
- **Colecciones (espejo de lectura; la autoridad es Worker/D1):** users 168 (107 ESTUDIANTE_ACUDIENTE / 34 DOCENTE / 1 ADMIN / 26 sin rol) · students 51 · teachers 38 · schedule_assignments 21 · attendance_records 56 · student_excuses 0 · school_settings 1.

---

## 4. N+1 (estudiante 81) — VERIFICADO (ciclo completo, UI real de Rectoría, dispositivo NUEVO)

Cadena completa en producción (build con RC-6):
1. Ficha **PRUEBA ESCALA N1** (TI 209876543, 11°3) creada por el drawer «+ Nuevo Estudiante» con clave manual → modal «¡Estudiante Registrado con Éxito!» con código + clave.
2. «Crear Cuenta de Acceso» → cuenta `estudiante-209876543@inas.edu.co` provisionada + **push inmediato (R67 §36) que publicó el catálogo 81 en la nube** (KV v305, `hasFirebaseAccount: true` — verificado con pull de Rectoría).
3. **LOGIN LIMPIO 81: PASS** — ficha real desde la nube en dispositivo sin storage.
4. **Eliminación EN CASCADA por UI** (2 pasos + texto ELIMINAR) → `/api/admin/entity/delete` **200**: D1 + snapshot + KV + **cuenta Firebase purgada** (el endpoint exige el token ADMIN del terminal por diseño: 403 con solo identidad — verificado por sonda directa).
5. **Re-creación + cuenta nueva → LOGIN LIMPIO 81 (ciclo 2): PASS.**
6. Cascada final → **estado final verificado con Rectoría fresca: nube 80 estudiantes, cuenta PURGED, búsqueda del código = «Sin resultados»**. (Los "1 fila" de scripts intermedios era el `<tr>` placeholder «Sin resultados» — artifact de selector, documentado.)

**Lección operacional documentada:** en terminal de Rectoría NUEVO, el push de catálogo con identidad ADMIN sí escribe, pero la eliminación en cascada exige el token del dispositivo — y el token ya no se pierde al cerrar Ajustes (RC-6).

---

## 5. §26 REPRESENTANTE — VERIFICADO (cadena de datos completa)

- Nube: ficha de JULIANA 196555769 con `isRepresentative: true, representativeGrade: '6°4'` (2 fichas con el rol en el snapshot).
- Dispositivo limpio (E2E R68): al entrar, la UI mostró **«Modo Representante de Salón (6°4) | Tienes permiso para escanear carnés de tus compañeros…»**.
- Cadena: cambio hecho en Rectoría → push → navegador limpio → pull → **persistencia real desde la nube** (nube = fuente, local = caché).

---

## 6. UI §32 (Directorio Estudiantes + Gestión Docentes) — CORREGIDO + VERIFICADO

- Encabezado queda solo informativo; las acciones pasan a una **tira bento** (1 celda por acción: icono en chip + título + descripción corta; grid 1 columna en móvil con altura de toque cómoda y 2–3 columnas en escritorio). Directorio: «Cargar Archivo(s)» / «Restablecer claves (todos)» / «+ Nuevo Estudiante». Docentes: «Registrar Nuevo Docente» / «Restablecer claves (todos)».
- Accesible: botones reales, `focus-visible:ring`, `aria-label`, `role="group"`, contraste AA; estilo consistente (rounded-3xl, bordes, backdrop-blur).
- **Verificado visualmente en producción** (capturas del E2E: bento renderizado en desktop y móvil en el flujo de Rectoría).
- `tsc` 0 + `vite build` limpio antes del commit.

---

## 7. CONTRASEÑAS / RESET / VER CARNÉ — VERIFICADO (heredado R66/R67 + re-verificado)

- Clave docente `mrestrepo@inas.edu.co` (`DocenteR68#Aula2026`): reset individual por Rectoría (terminal limpio) → **login limpio con la nueva clave: OK** + pull scoped (teachers=1 propio, 14 estudiantes) + portal Aula (E2E `docente_reset_clean.mjs`, pre-fix y re-ejecutable).
- 80/80 estudiantes con `verifyPassword(000000)` OK contra la nube (clave del CSV de la directiva).
- «Ver carné» refleja el estado real: las 3 fichas limpias mostraron carné + QR; la cascada purga cuenta y ficha (estado final 80).
- Sin `SJ-`, sin claves derivadas del documento, sin last-4: las claves del CSV son `000000` (predeterminada, por mandato) y las de prueba se generan/assignan por UI.

---

## 8. SUITES (TZ=America/Bogota, bun) — post-fix, pre y post-commit

| Suite | Resultado |
|---|---|
| **BASELINE 190/190** | `verify_ronda43` 64/0 · `qa-r46-rep` 40/0 · `qa-r47-guard` 18/0 · `qa-r58-hardening` 68/0 |
| `verify_ronda18` | 40/0/1 (SKIP canvas, histórico) — 6 aserciones obsoletas sincronizadas al contrato R58 **con prueba del contrato** (no pintadas verdes) |
| `verify_ronda19` | 111/0 — 10 aserciones obsoletas sincronizadas (F-2 orden de reset/firma; F-1 `requireSignedCards` con camino clásico código-solo) |
| `verify_ronda22_sabado` | 26/0 (readCache F-10 con instancia fresca — simulación honesta) |
| `verify_ronda28` | 21/0 |
| `qa-r50-m3-student` | 16/0 |
| `qa-r49-identity` | 15/0 (SA real + Rectoría real: firma RS256, rol de Firestore, scoping) |
| `verify_excuses_12casos_ui` | 29/0 |
| `verify_dia_cero` | 34/7 — **PREEXISTENTE en HEAD limpio** (suite R37 con contrato cambiado en R38 H-38-2 y tamaño demo evolucionado 50→53) — documentada, NO pintada verde |
| `tsc --noEmit` / `vite build` | 0 / limpio (tras cada cambio, incluido §32 y RC-6) |

---

## 9. COMMIT → PUSH → DEPLOY → VERIFICAR — COMPLETADO (sin esperar)

- 3 commits R68 empujados por el protocolo §5b (PAT temporal embebido en el remote SOLO durante el push; remote restaurado a HTTPS limpio; git config sin usuario; SA gitignored verificado; cero credenciales en el repo).
- Pages auto-deployó en ambos builds: **marker R68** detectado en `assets/index-CAafgCN4.js` (fixes RC-1…5 + UI §32) y **marker RC-6** en `assets/index-Bg5DwhSi.js`.
- Los E2E finales corrieron **contra los builds desplegados**, no contra local.

---

## 10. PENDIENTE / NO VERIFICADO (honesto)

1. **Despliegue de F-4 = propietario** (CI manual `deploy-firestore-rules`). El archivo está listo y auditado; el diff vs el ruleset desplegado es exactamente el bloque F-4.
2. **Limpieza de las ~1165 órfanas históricas:** decisión del propietario (vía autorizada existe).
3. **IA por grado (motor Groq BYOK):** no se ejecutó en vivo esta ronda (el datacenter puede seguir bloqueado por Groq — sin evidencia nueva). Queda documentado el fallback local elegante de R38. **NO VERIFICADO en vivo.**
4. **Jornada extendida sobreviviendo guardados de configuración:** la protección R61 (no re-aplicar plantilla al guardar ajustes) está vigente y cubierta por suites (R22 26/0, R28 21/0), pero **sin test de UI en vivo esta ronda** — documentado, no probado en vivo.
5. **E2E completo del rol DOCENTE post-RC-6** contra el build final: el flujo docente se verificó contra el build RC-1…5 (pre RC-6, sin cambios en ese flujo); el build RC-6 solo toca `SettingsModal` (campos token) y la bitácora. Riesgo residual nulo-práctico, pero no se re-ejecutó el E2E docente contra `Bg5DwhSi`.
6. Los 26 users "sin rol" en Firestore (legado) — inventariados, no migrados (fuera de alcance de la directiva).

**Nada marcado "VERIFICADO" lo está sin evidencia de esta ronda; nada se declaró "100 % funcional".**
