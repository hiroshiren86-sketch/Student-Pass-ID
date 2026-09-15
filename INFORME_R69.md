# INFORME FINAL — RONDA 69 (Directiva Máster: regresión del filtro por curso, Escudito dinámico y simulación "Mini Colegio")

**Repo:** `hiroshiren86-sketch/Student-Pass-ID` · **Rama de trabajo:** `arena/01a0a588-student-pass-id` (base `1a0b817` = `origin/main`)
**Fecha:** 2026-09-15 · **Entrega:** Pull Request hacia `main` (el propietario fusiona; GitHub Pages despliega desde `main`).
**Lectura previa obligatoria (cumplida):** `AGENTS.md` e `INFORME_R68.md`. Las soluciones RC-1…RC-6 de R68 se conservan intactas (§7).

---

## 1. RESUMEN EJECUTIVO

| Punto de la directiva | Estado | Dónde se prueba |
|---|---|---|
| 3a · Regresión del filtro por curso (6°1 vacío, "Todos" con datos) | **CAUSA RAÍZ PROBADA → CORREGIDA → VERIFICADA** | §2, §3, suites `r69_grade_catalog` (66) y `r69_filtro_grado_dom` (32) |
| 3b · Escudito: lista NO hardcodeada, 100 % dinámica del catálogo de la nube | **CORREGIDO → VERIFICADO** | §4, suite `r69_escudito_dinamico` (31) |
| 4 · Simulación E2E "Mini Colegio" (Pasos A, B, C) con datos en la nube y cero inyección hardcodeada | **Guiones versionados + cadena ensayada localmente (49 checks)**; ejecución en producción **PENDIENTE** (sin egreso de red en el sandbox) | §5, §6, §9 |
| 5 · Verificación entre dispositivos con navegadores limpios y modales de primer inicio cerrados | **Implementada en los guiones E2E**; ejecución **PENDIENTE** | §6 (`06_sync_cross_device.mjs`) |
| 6 · Guardar y versionar todos los scripts de simulación/prueba | **HECHO** (`tests/`) | §6 |
| 1 · Publicar sólo con verificación 100 % en entorno real | **Se publica el código + la verificación local completa; la verificación en la nube NO se pudo hacer aquí** y se entrega como guiones ejecutables por el propietario/QA | §9, §10 |
| 2 · Conservar RC-1…RC-6 de R68 | **VERIFICADO** | §7 |

Resultado de verificación local (sandbox sin red): **611 comprobaciones en verde, 0 fallos** (§8), `tsc --noEmit` limpio y `vite build` limpio.

---

## 2. EL BUG REPORTADO — REPRODUCIDO → CAUSA RAÍZ → CORREGIDO

**Síntoma del propietario:** al filtrar el Directorio por `6°1` la tabla sale vacía, mientras "Todos los grados" muestra los estudiantes.

**Reproducción con evidencia (pre-fix):** `tests/evidence/r69_PRE-FIX_filtro_grado_dom.txt`
— la suite `tests/unit/r69_filtro_grado_dom.ts` montó el `StudentsManagerView` **real** sobre jsdom con la matrícula real de producción y falló con **10 comprobaciones** antes del arreglo (exit 1).

**Causa raíz (dos defectos que se suman):**

- **RC-7a — El selector ofrecía cursos fantasma.** El `<select>` se construía con `getUniqueGrades()`, que mezclaba la matrícula real con el catálogo **demo estático** `SCHOOL_GRADES_LIST` de `src/services/mockData.ts` (L140: 6°1, 6°2, 7°1 … 11°2) y ordenaba alfabéticamente. En producción la matrícula real vive en 6°4, 7°4, 8°4, 9°3, 10°3 y 11°3 → de las 19 opciones, **12 no tenían un solo estudiante**. Elegir "6°1" filtraba *correctamente* sobre un conjunto vacío: el filtro no estaba roto, estaba mostrando un curso que no existe en la nube. `getUniqueGrades()` además validaba una copia recortada y luego agregaba el valor CRUD al conjunto (podía duplicar variantes).
- **RC-7b — Comparación literal de cursos.** En ~20 puntos del código el curso se comparaba con `===` sobre la cadena cruda. Cualquier diferencia de escritura (`°` vs `º` vs `ᵒ`, espacio de no separación, `6-1`, `601`, `GRADO 6°1`, tildes) partía el emparejamiento: la misma cátedra, la misma planilla o el mismo estudiante quedaban fuera.
- **Agravantes:** búsqueda del Escudito con `.includes()` sensible a tildes; `pullFromCloudflare()` sin canonicalizar los cursos entrantes; y en el Escudito, un pull que sólo cambia estudiantes devuelve **la misma referencia** de `settings` → React hace *bail-out* → la lista quedaba congelada aunque la nube hubiera respondido.

---

## 3. CORRECCIÓN DEL FILTRO (RC-7a / RC-7b) — TODAS LAS VISTAS

**Nuevo módulo canónico:** `src/utils/gradeCatalog.ts`

| API | Comportamiento |
|---|---|
| `canonicalGrade(raw)` | Normaliza `°/º/ᵒ/˚`, NBSP, guiones/espacios/puntos, prefijos `GRADO/CURSO/GRUPO/CLASE`, formas compactas SIMAT (`601`, `1004`, `1103`, `0601`), cursos escritos en letras (`SEXTO`→6°1) y especiales (`TRANSICIÓN`, `JARDÍN`, `PÁRVULOS`, `ACELERACIÓN`, `BRICOL`). **Devuelve `null` ante basura** (nunca inventa un curso). |
| `gradesMatch(a, b)` | Comparación canónica en ambos lados. |
| `compareGrades(a, b)` | Orden natural (6°1…11°3, especiales primero). |
| `buildGradeCatalog({students, records, assignments, teachers, institutional, includeEmptyInstitutional})` | Catálogo **derivado de los datos reales**, con conteo por curso. |
| `resolveGradeSelection(selected, catalog)` | Si el curso seleccionado deja de existir (pull, localStorage viejo, variante) vuelve a `'all'` en vez de quedar clavado en una selección huérfana → tabla vacía. |
| `gradeOptionLabel(entry, {noun, short})` | Etiqueta con conteo: `Grado 6°4 · 14 estudiantes`. |

**Servicio (`src/services/attendanceStorage.ts`, +243/−…):** `getUniqueGrades()` ahora es *data-first* y canónico; nuevo `getGradeCatalog()`; sustitución de la comparación literal por `gradesMatch(...)` en ~20 sitios (planilla, cierre automático de jornada, `setActiveClassFromToken` L2341, representatividad, escaneo, reportes). `addStudent()` y `registerScan()` quedaron con emparejamiento **defensivo** (familia RC-1 de R68): leen `String(x?.campo ?? '').trim()` y sólo tratan como coincidencia los valores **no vacíos** — antes, con fichas de pull scopeado sin `documentId`, un `undefined === undefined` podía adjudicar un escaneo o marcar un duplicado falso.

**Vistas cableadas al catálogo derivado de datos** (decisión del propietario: *todas las vistas*): `StudentsManagerView` (filtro con conteo + reset de selección huérfana + estado vacío honesto y accionable), `AttendanceReportsView`, `CardsManagerView`, `GradeAiSummaryView`, `TeacherClassroomView`, `ScheduleBuilderView`.

**Búsqueda (`src/utils/searchHelper.ts`):** `matchStudentFuzzy` endurecido (una consulta de curso como `6°4`→`64` ya no se interpreta como substring de documento: se exige `length >= 4`), nuevo `matchTeacherFuzzy` y `matchesGradeFilter` canónico.

---

## 4. ESCUDITO 100 % DINÁMICO (RC-8)

`src/App.tsx` (+326/−…): el selector de identidad dejó de leer listas fijas.

- Lee el almacenamiento **en cada render** y un contador monotónico `catalogVersion` garantiza que un pull produzca render (corrige el *bail-out* por referencia estable).
- **`refreshCatalogFromCloud('escudito')` al abrir**: dispara `/api/sync/pull` real y muestra el aviso honesto cuando la nube no responde (nunca una lista "de muestra").
- Chip de estado: `N estudiantes · catálogo en la nube` / `N docentes`; aviso visible de degradación.
- Filtro por curso (catálogo canónico con conteos) + búsqueda sin tildes con las mismas utilidades del Directorio.
- Iniciales defensivas (`String(t.fullName ?? '')`): una ficha parcial ya no rompe el modal.
- **Vista previa, no suplantación**: abrir un perfil conserva la sesión real de Rectoría debajo (RC-4/R68) y "Volver a Rectoría / Admin" la restaura.

**Prueba:** `tests/unit/r69_escudito_dinamico.ts` — **31/31**: lista los 80 estudiantes reales (cero fantasmas), reacciona en vivo a un estudiante añadido sin recargar, dispara el pull al abrir y degrada con aviso cuando la nube falla (stub de `fetch` + 503), filtra por curso exacto (7°4 → 14), busca sin tildes y abre cualquier perfil real manteniendo la sesión ADMIN.

---

## 5. SIMULACIÓN "MINI COLEGIO" — DATOS Y ENSAYO LOCAL

**Decisión de alcance (delegada por el propietario): ADITIVO.** La matrícula real (80 fichas en 6°4/7°4/8°4 = 14, 9°3/10°3 = 13, 11°3 = 12) **no se toca**. Se agregan los 15 cursos que faltan para cubrir 6°1→11°3 con ≥10 por sección.

**Fixtures versionados** (datos de prueba, **no** código de la app; generados por `tests/scripts/gen_fixtures_mini_colegio.mjs`, semilla 20260915, determinista y auto-auditado):

| Archivo | Contenido |
|---|---|
| `tests/fixtures/matricula_mini_colegio_15_grupos.csv` | 150 estudiantes (15 cursos × 10) en formato SIMAT `TIPO_DOC,DOCUMENTO,APELLIDOS,NOMBRES,CURSO`; documentos en el rango 1.090.000.000+ para no chocar con la matrícula real; nombres colombianos con tildes. |
| `tests/fixtures/horarios_mini_colegio_15_grupos.csv` | 60 cátedras: Dirección de Grupo + Matemáticas + Lengua Castellana + Inglés por curso, con los **20 docentes reales** (nombres exactos, para que el importador resuelva `teacherId`). |

Auto-auditoría del generador (falla y sale con código 1 si): hay documentos duplicados, algún curso queda con <10, dos cátedras del mismo docente chocan en el mismo (día, bloque), o dos materias del mismo curso caen en la misma celda del horario (el upsert del importador las sobrescribiría). El CI verifica además que los CSV committed **coinciden byte a byte** con el generador (`--check`).

**Tras importar:** 21 cursos, 230 estudiantes, todos los cursos de 6°1 a 11°3 con ≥10.

**Ensayo local de la cadena operativa** — `tests/unit/r69_mini_colegio_local.ts`, **49/49** con el código real de la app (sin nube):

- **Paso A:** parser real (`parseTextOrCsvContent`) + alta real (`addStudent`, el mismo camino de `DocumentUploadModal`) → 150 altas, 0 rechazos, 230 en 21 cursos, cursos existentes intactos, re-importación **idempotente** (0 altas / 150 omitidas) y filtro por curso tolerante a `6-1` y `601`.
- **Paso B:** `setRepresentativeForGrade(grade, code)` — la llamada exacta del botón **"Hacer Rep"** — en los 21 cursos; invariante de **un solo representante por curso**; re-asignación mueve el rol sin duplicarlo; y el sub-rol se asigna buscando por `7°1` aunque la ficha esté guardada como `7-1` (RC-7b).
- **Paso C:** importador CSV real (`parseScheduleImport` + `applyScheduleImport`) → 60 cátedras, 0 errores, docentes resueltos por nombre; **tarjeta de clase v2** (`generateTeacherCardPayload` → `setActiveTeacherCard`) con jornada extendida → `class_activated`; escaneo de los 10 estudiantes del grupo → registros con la materia **firmada** en la tarjeta, `contextSource = QR_CLASE` y docente correcto; planilla legible con el curso escrito `6-1` y `601`; repetición sin duplicados; sin contaminación entre cursos. Y **QR de clase v1** firmado con el curso escrito `7-1` → activa la clase y resuelve la materia/día/bloque del horario.

---

## 6. GUIONES E2E PLAYWRIGHT (versionados, para el entorno con red)

`tests/e2e/simulation/` · corredor: `bash tests/e2e/simulation/run_all.sh` · configuración: `.env.example` (nunca commitear el `.env` real — Regla 9 de `AGENTS.md`).

| Guión | Qué prueba |
|---|---|
| `01_regresion_filtro_y_escudito.mjs` | Cada curso del selector devuelve sus filas (ninguno vacío), conteos en las opciones, cursos fantasma ausentes, búsqueda sin tildes y combinada con el filtro, sin fuga entre cursos, Escudito dinámico (chip con el conteo real, filtro, búsqueda, refresco en vivo) y vista previa de perfil sin perder la sesión de Rectoría. |
| `02_paso_a_carga_csv_y_claves.mjs` | **Paso A** real: Directorio → "Cargar Archivo(s)" → CSV → "Confirmar y Registrar (150)" → 15 cursos con ≥10, existentes intactos, Push, verificación **en la nube** con `/api/sync/pull` e idToken real, restablecimiento masivo de claves (`000000`) con reporte por usuario, y segundo navegador limpio que recibe los 150 desde la nube. |
| `03_paso_b_subroles_rep.mjs` | **Paso B** real: "Hacer Rep" curso por curso, insignia "Representante", Push, verificación del sub-rol en la nube y portal del Representante en otro dispositivo ("Modo Representante de Salón"). |
| `04_paso_c_horarios_clase_qr.mjs` | **Paso C** real: Horarios → Importar CSV (60 válidas / 0 errores) → Aplicar → Push; dispositivo Docente → "Mis Tarjetas QR" → descarga del PNG y **decodificación con jsQR** (o reconstrucción del token con el mismo algoritmo HMAC-SHA256/hex-32 de `src/utils/crypto.ts` si `jsqr` no está instalado) → desbloqueo de la hora → escaneo de los 10 estudiantes → planilla de Rectoría. Incluye el QR **v1** por curso/día. |
| `05_paso_c_excusas.mjs` | Ausencia real desde el Aula → excusa **anticipada** y **post-hoc** desde el portal → aprobación en el Buzón → "Excusada (verificada)" → verificación del verificador en la nube. |
| `06_sync_cross_device.mjs` | Tres navegadores limpios (localStorage + IndexedDB + caché borrados) reciben el mismo catálogo; latencia extremo a extremo Docente → Push → Rectoría Pull; **cero sesiones anónimas** (`session_mode ≠ anonymous`, uid = cuenta real vía login REST); token de dispositivo visible en Ajustes (RC-2). |

Convenciones exigidas por la directiva §5 e implementadas en `lib/app.mjs`: cada dispositivo es un `context` nuevo + `clearSiteData()` explícito; `dismissOverlays()` cierra los modales de primer inicio **en bucle con esperas ≥400 ms** (`FirstWelcomeTour.finish()` retrasa su `onClose` 180 ms: un solo clic deja el overlay vivo); selectores por `data-testid` estables añadidos en esta ronda (32 en login, navegación, Directorio, Escudito, Horarios, Aula, carga masiva, reportes, carnés e IA). Cada guión escribe su evidencia (`.json`, `.txt`, PNG) en `tests/evidence/` y sale con código ≠0 si algo falla.

---

## 7. RC-1…RC-6 DE RONDA 68 — CONSERVADOS

| Solución R68 | Estado en R69 |
|---|---|
| RC-1 · Login defensivo (fichas parciales/sin `documentId`) | **Intacto y extendido**: el mismo patrón defensivo se aplicó a `addStudent()` (duplicados) y a `registerScan()` (emparejamiento de fichas), donde un `undefined === undefined` podía adjudicar mal un escaneo. |
| RC-2 · Token de dispositivo visible/copiable en Ajustes | **Intacto**; el guión `06_sync_cross_device.mjs` lo verifica por UI. |
| RC-3 · Sin sign-in anónimo | **Intacto**; `06` afirma `session_mode ≠ anonymous` y que el uid del navegador coincide con la cuenta real. |
| RC-4 · Persistencia del sub-rol de representante | **Intacto**; `03` y el ensayo local (Paso B) lo ejercitan, incluida la invariante de un representante por curso. |
| RC-5 · Alta N+1 sin fuga / flujo de cuenta real | **Intacto** (no se tocó el camino de provisioning; sigue siendo sólo por la UI real de Rectoría — Regla 3 de `AGENTS.md`). |
| RC-6 · Higiene de credenciales y evidencia | **Intacto**; no se commiteó ninguna credencial y los guiones las leen de `.env` (ignorado). |

---

## 8. VERIFICACIÓN LOCAL — 611 COMPROBACIONES EN VERDE

Ejecutado en el sandbox (`TZ=America/Bogota`), sin red:

| Suite | Motor | Resultado |
|---|---|---|
| `scripts/verify_ronda43.ts` (tarjetas v1/v2 + política de carné) | bun | **64 OK · 0 FALLO** |
| `scripts/qa-r46-rep.ts` (flujo del representante) | bun | **40 OK · 0 FALLO** |
| `scripts/qa-r47-guard.ts` (guard del Worker: merge/CAS) | bun | **18 OK · 0 FALLO** |
| `scripts/qa-r58-hardening.ts` (F-1/F-6/F-7/F-8/F-12/F-23/F-24) | bun | **68 OK · 0 FALLO** |
| `scripts/verify_ronda18.ts` | bun | **40 OK · 0 FALLOS · 1 SKIP** |
| `scripts/verify_ronda19.ts` (QR de clase, sección K actualizada — ver nota) | bun | **111 OK · 0 FALLOS** |
| `scripts/verify_ronda22_sabado.ts` | bun | **26 OK · 0 FALLOS** |
| `scripts/verify_ronda28.ts` | bun | **21 PASS · 0 FAIL** |
| `scripts/qa-r50-m3-student.ts` | bun | **16 OK · 0 FALLO** |
| `scripts/verify_excuses_12casos_ui.ts` | bun | **29 OK · 0 FALLOS** |
| **`tests/unit/r69_grade_catalog.ts`** | tsx/bun | **66 OK · 0 FALLO** |
| **`tests/unit/r69_filtro_grado_dom.ts`** (DOM real) | tsx/bun | **32 OK · 0 FALLO** |
| **`tests/unit/r69_escudito_dinamico.ts`** (DOM real) | tsx/bun | **31 OK · 0 FALLO** |
| **`tests/unit/r69_mini_colegio_local.ts`** (Pasos A→B→C) | tsx/bun | **49 OK · 0 FALLO** |
| `npx tsc --noEmit` | — | **exit 0** |
| `npx vite build` | — | **✓ built** (sin errores) |
| Marcadores R69 en el bundle servido | grep | **4/4 presentes** |
| `gen_fixtures_mini_colegio.mjs --check` | node | **CSV idénticos al generador** |

Pre-existentes, **sin cambio** y no atribuibles a R69: `scripts/verify_dia_cero.ts` 34 OK / 7 FALLOS (idéntico a R68) y `scripts/qa-r49-identity.ts` en SKIP (requiere `.firebase-sa.json`, gitignored).

**Nota honesta sobre `verify_ronda19.ts`:** su sección K afirmaba un **marcador de texto fuente** (`storage.includes("student.grade === activeClass.grade")`) que la canonicalización reemplazó legítimamente por `gradesMatch(...)`. Se actualizó el marcador a `gradesMatch(student.grade, activeClass.grade)` **con comentario explicativo y puntero a la prueba de comportamiento** (que ya existía en la sección J de la misma suite). No es un "pintado de verde": la conducta sigue probada y la suite pasó de 110 OK/1 FALLO a **111 OK/0 FALLOS**.

**Efecto colateral corregido:** el warning de React *"Cannot update a component while rendering"* desapareció (0 apariciones). Origen: la inicialización perezosa de la primera lectura (`students`, `attendance`, `teachers`, `scheduleSlots`, `scheduleAssignments`) notificaba a los suscriptores durante el render; ahora persiste en silencio con `persistQuietly(...)`.

---

## 9. PUBLICACIÓN

- **Rama:** `arena/01a0a588-student-pass-id` (el entorno sólo permite publicar en esta rama).
- **Commit + push + PR hacia `main`**: el propietario fusiona; Pages despliega desde `main`.
- **Nada se desplegó en la nube** (Worker, D1/KV, Firebase, reglas de Firestore): el sandbox no tiene egreso y, además, `AGENTS.md` reserva esas acciones al propietario (Regla 7: sin credenciales → detenerse y preguntar; despliegue de reglas F-4 = `workflow_dispatch` manual).
- **Credenciales:** el propietario eligió "pegar credenciales", pero el paquete (claves de entorno + JSON de la Service Account) **no llegó a la sesión**. Por tanto **no se ejecutó** ningún paso que las requiera. En cuanto estén disponibles en el entorno de QA, la validación en la nube es: `cp tests/e2e/simulation/.env.example tests/e2e/simulation/.env` → completar → `npm i -D playwright jsqr pngjs && npx playwright install chromium` → `bash tests/e2e/simulation/run_all.sh`.

---

## 10. PENDIENTE / NO VERIFICADO (honesto)

1. **E2E en producción o preview**: los seis guiones están versionados y verificados sintácticamente (`node --check`), y su cadena operativa está ensayada localmente contra el código real (49 checks), pero **NO se ejecutaron contra la app desplegada** (sin egreso a `*.github.io` / `*.workers.dev` / `*.googleapis.com` y sin Chromium descargable en el sandbox). Los selectores por `data-testid` son nuevos: conviene una primera corrida asistida.
2. **Carga real de los 150 estudiantes y del horario a la nube** (Paso A/C en producción): pendiente de la corrida E2E; requiere Rectoría + Worker + Push.
3. **Claves por defecto masivas (`000000`)**: el restablecimiento usa `/api/admin/credential` (Worker + Service Account). Sin credenciales no se verificó en vivo; el guión `02` reporta por usuario y no finge éxito.
4. **Excusas en la nube** (Paso C): el flujo local está probado por las suites históricas; la verificación en nube con verificador (`approvedBy`/`approvedAt`) queda en el guión `05`.
5. **Cuentas anónimas huérfanas (~1165)** y **reglas de Firestore F-4**: siguen siendo decisión del propietario (sin cambio en R69).
6. **`SCHOOL_GRADES_LIST` de `mockData.ts`** permanece (se usa como catálogo *institucional* de referencia, nunca como fuente del filtro): las vistas ahora sólo lo muestran si `includeEmptyInstitutional` lo pide; el filtro del Directorio ya no lo usa.

---

## 11. ARCHIVOS DE LA RONDA

**Nuevos:** `src/utils/gradeCatalog.ts` · `tests/README.md` · `tests/harness/{domEnv,fixtures,mountApp}.ts` · `tests/unit/{r69_grade_catalog,r69_filtro_grado_dom,r69_escudito_dinamico,r69_mini_colegio_local}.ts` · `tests/scripts/gen_fixtures_mini_colegio.mjs` · `tests/fixtures/{matricula,horarios}_mini_colegio_15_grupos.csv` · `tests/e2e/simulation/**` (6 guiones + 3 libs + `.env.example` + `run_all.sh`) · `tests/evidence/r69_PRE-FIX_filtro_grado_dom.txt` · `INFORME_R69.md`.

**Modificados:** `src/services/attendanceStorage.ts`, `src/utils/searchHelper.ts`, `src/App.tsx`, `src/components/{StudentsManagerView,AttendanceReportsView,CardsManagerView,GradeAiSummaryView,TeacherClassroomView,ScheduleBuilderView,LoginScreen,DocumentUploadModal}.tsx`, `scripts/verify_ronda19.ts` (marcador de fuente), `.github/workflows/ci.yml` (jsdom + 4 suites R69 + `--check` de fixtures + marcadores del bundle).

**Total:** 13 archivos modificados (+752/−201) y 23 archivos nuevos (228 KB).
