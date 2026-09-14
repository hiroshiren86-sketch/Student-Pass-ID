# Informe de Auditoría Visual Conservadora — Ronda 65

**Fecha:** 14/09/2026 · **Alcance:** Rondas 60 → 64 de `AGENTS.md` (bitácora) + contexto del propietario
**Repositorio:** `Student-Pass-ID` @ `origin/main` (`a6619fd`, ronda 64 docs) + 3 commits de esta ronda
**Directiva:** corregir únicamente inconsistencias visuales reales entre lo documentado y lo que muestra la interfaz; exclusión explícita de credenciales aprovisionadas por API; criterio conservador ante la duda: no tocar.

---

## 1. Resumen de lo leído y entendido desde `AGENTS.md` (R60 → R64)

Se leyó la bitácora completa desde la Ronda 60 (11/09/2026) hasta la Ronda 64 (13-14/09/2026), que es la ronda donde quedó registrado el estado funcional completo subido a GitHub (CI verde, Pages desplegado). Lo documentado que define cómo debería verse la interfaz:

- **Ronda 60-g — PIN como campo explícito:** el formulario de crear/editar estudiante tiene el campo "5. PIN / Clave de Acceso Portal"; vacío = el carné muestra "Solicitar en Rectoría"; fin de la derivación `SJ-` + últimos 4 del documento en los 6 puntos donde persistía (pdfGenerator, StudentsManagerView ×2, DocumentUploadModal, mockData, CardsManagerView).
- **Ronda 61-b / 61-b.2 — PIN↔cuenta:** editar el PIN de un estudiante con cuenta de acceso sincroniza la contraseña Firebase en el mismo guardado (`syncStudentAccountPassword`, provisioner idempotente); toasts honestos de divergencia; **el formulario avisa del mínimo de 6 caracteres para estudiantes con cuenta**.
- **Ronda 62 — requisito real de Firebase:** "Firebase exige ≥6; un PIN de 4 no puede ser contraseña de cuenta" (remediación de las 6 cuentas estudiantiles con claves de 6 dígitos). Además: KPIs honestos en Reportes (ARV-1), guard de 0 bloques (TCV-3), "Seguir en segundo plano" en el overlay de sync (SO-1), errores de parseo visibles (DUM-1/2), y demás fixes de UI listados.
- **Ronda 64 — directiva máster:** Firebase rechaza `0000` (`auth/weak-password`, demostrado por REST y por la UI del portal) → se asignó `000000` a los 80 estudiantes y 20 docentes vía UI; cambio de clave del portal exige nueva clave ≥6 (límite Firebase); Escudito con objetivo explícito y "Volver a Rectoría"; navItems "Portal Docente (Aula)" y "Portal Estudiante" retirados del menú de Rectoría; eliminación en cascada con confirmación de 2 pasos (texto ELIMINAR).
- **Ronda 60 — verificación vía Worker:** mensaje honesto "Firma verificada por la nube del colegio" en el fallback del portal; aviso ámbar en superficies generadoras de tarjetas cuando el dispositivo no tiene el sello `qrSecretSyncedAt`.

**Restricciones vigentes respetadas:** Regla 7 (SA solo diagnóstico), Regla 8 (jamás modificar código para pasar pruebas), Regla 9 (credenciales FIJAS, no rotar), Regla 10 (respaldo/subida al cierre), Regla 6 (nada de éxitos falsos ni fallbacks estáticos).

## 2. Contexto del propietario aplicado (exclusión)

Las credenciales creadas por API/método de bajo nivel en rondas anteriores (R37 clave de Rectoría restaurada por Admin API, R39 docente E2E, R50 M3 estudiantes, R62 remediación de 6 cuentas, R64 asignación masiva) **funcionan** aunque algunos indicadores visuales puedan no reflejarlas. Por directiva del propietario esto **no se considera bug ni regresión, no se interviene y no se sincroniza**. Este caso se trató como estado conocido y aceptado del prototipo (ver §5).

## 3. Inconsistencias visuales encontradas

### I-1 (hallazgo principal, señalado por el propietario) — El formulario de PIN sugería 4 dígitos
- **Dónde:** `StudentsManagerView.tsx`, campo "5. PIN / Clave de Acceso Portal" (aplica a "Registrar nuevo estudiante" y "Editar ficha").
- **Estado anterior:** placeholder `Ej: 8392 (déjalo vacío si el estudiante no tiene PIN)` — ejemplo de 4 dígitos — y texto de ayuda sin mención del requisito. El único aviso del mínimo de 6 era el condicional ámbar visible **solo** cuando el estudiante ya tenía cuenta (`editingStudent?.hasFirebaseAccount`).
- **Por qué es inconsistencia documental:** la bitácora R60-g describes ese placeholder, pero R61-b.2, R62 y R64 (posteriores) establecieron que el PIN es también la contraseña de la cuenta de acceso y que **Firebase exige 6 o más caracteres** (un PIN de 4 dígitos no podrá usarse para crear la cuenta; `0000` rechazado con `auth/weak-password`; los 80 estudiantes reales llevan `000000` desde R64). El texto estático quedó desfasado respecto del conocimiento documentado: invitaba a introducir exactamente el formato que luego fallaría en "Crear Cuenta de Acceso".
- **Clasificación:** texto estático desactualizado + mensaje de ayuda incompleto. **Puramente cosmético** — no se tocó ninguna validación ni lógica.

### I-2 — Error visible engañoso ante `auth/weak-password`
- **Dónde:** `firebase.ts`, `mapAuthError` (usado por "Crear Cuenta de Acceso" del estudiante y docente, sincronización PIN↔cuenta, y login).
- **Estado anterior:** `auth/weak-password` no tenía caso propio y caía al default *"No se pudo iniciar sesión. Intente de nuevo o contacte a Rectoría."* — engañoso: aparecía en flujos de **creación/sincronización** (no de inicio de sesión), atribuía la causa a credenciales incorrectas y sugería reintentar, lo cual es inútil mientras el PIN siga teniendo 4 dígitos.
- **Por qué procede el fix:** la directiva permite "mensajes de error visibles que ya estén respaldados por una validación existente". La validación existe: Firebase la aplica (demostrada en R64 §3), y el propio código ya la enuncia en otros caminos (`syncTeacherAccountPassword:545` → "La nueva clave debe tener al menos 6 caracteres (requisito de Firebase)"; `changeOwnPassword:646` → "La nueva contraseña es demasiado débil. Use al menos 6 caracteres."). El cambio es solo el mapeo del código de error a su mensaje correcto.

### Verificaciones sin hallazgos (UI alineada con lo documentado)
Se verificó la presencia y corrección de los textos documentados en R60–R64, sin encontrar más desfaces:

| Superficie documentada | Evidencia | Estado |
|---|---|---|
| "Solicitar en Rectoría" en carné impreso, visor y tarjetas | `pdfGenerator.ts:29`, `StudentsManagerView.tsx:1073/1225`, `CardsManagerView.tsx:468`, `StudentPortalView.tsx:996` | ✅ Alineado |
| Aviso ámbar 6+ chars para estudiantes con cuenta (R61-b.2) | `StudentsManagerView.tsx:850-854` | ✅ Alineado (se conserva) |
| Cambio de clave portal con ≥6 (R64 Fix A) | `StudentPortalView.tsx:251/1526/1552` | ✅ Alineado |
| Cambio de clave docente ≥6 | `ChangePasswordModal.tsx:61/184` | ✅ Alineado |
| Portales fuera del menú de Rectoría (R64 Fix C) | `App.tsx:332/334` — roles solo `DOCENTE`/`ESTUDIANTE_ACUDIENTE` | ✅ Alineado |
| Cascada con confirmación "ELIMINAR" en 2 pasos (R64 §5) | `StudentsManagerView.tsx:335-346` | ✅ Alineado |
| "Volver a Rectoría / Admin" del Escudito (R64 Fix B) | `App.tsx:711` | ✅ Alineado |
| "Seguir en segundo plano" (R62 SO-1) | `SyncOverlay.tsx:110` | ✅ Alineado |
| KPI honesto "Presentes (hoy/fecha)" (R62 ARV-1) | `AttendanceReportsView.tsx:146` | ✅ Alineado |
| Guard + banner de 0 bloques (R62 TCV-3) | `TeacherClassroomView.tsx:261/704-713` | ✅ Alineado |
| "Firma verificada por la nube del colegio" (R60) | `StudentPortalView.tsx:425` | ✅ Alineado |
| Login sin claves precargadas ni textos de 4 dígitos | `LoginScreen.tsx:451-478` | ✅ Alineado |
| Carga masiva crea estudiantes SIN PIN (R60-g) | `DocumentUploadModal.tsx:237-240` | ✅ Alineado |
| Sin patrón `SJ-` en la UI | gate de bundle: 0 apariciones | ✅ Alineado |

## 4. Cambios realizados (archivo por archivo)

### 4.1 `src/components/StudentsManagerView.tsx` (2 líneas)
1. **Placeholder del campo PIN (línea 843):**
   - Antes: `Ej: 8392 (déjalo vacío si el estudiante no tiene PIN)`
   - Ahora: `Ej: 839274 · usa 6 o más caracteres (déjalo vacío si el estudiante no tiene PIN)`
2. **Texto de ayuda bajo el campo (línea 848):** se añadió una sola oración documentada, sin eliminar nada:
   > "El PIN es la clave que el estudiante usa para entrar a su portal **y, si tiene o tendrá cuenta de acceso, es también la contraseña de esa cuenta: Firebase exige 6 o más caracteres (un PIN de 4 dígitos no podrá usarse para crear la cuenta).** Si lo dejas vacío, el carné impreso mostrará "Solicitar en Rectoría" como estado vacío claro. Nunca se deriva automáticamente del documento."

   La oración es factual para ambos caminos: el PIN de 4 dígitos sigue funcionando localmente en fichas sin cuenta (no se afirma lo contrario); lo que se informa es que no **podrá usarse para crear la cuenta** (validación existente de Firebase). El aviso ámbar condicionado a `hasFirebaseAccount` (R61-b.2) **queda intacto**.

### 4.2 `src/services/firebase.ts` (3 líneas: caso nuevo + comentario)
- `mapAuthError`: nuevo caso `auth/weak-password` → *"La clave es demasiado corta: Firebase exige al menos 6 caracteres. Use 6 o más caracteres e intente de nuevo."*
- Es un mapeo de mensaje, no de comportamiento: los flujos fallan igual que antes; solo cambia el texto que ve Rectoría. En login el código no ocurre (no hay riesgo de contaminar ese mensaje); en creación de cuentas docente/estudiante y en la sincronización PIN↔cuenta (estudiante y docente) el mensaje ahora es exacto y accionable.

**Total del diff: 2 archivos, +6/−2 líneas. Cero cambios de lógica, validación, estado o flujos.**

## 5. Cambios NO realizados y motivo

| Hallazgo | Motivo de no intervención |
|---|---|
| Indicadores visuales que no reflejan cuentas aprovisionadas por API (p. ej. `hasFirebaseAccount` desactualizado tras aprovisionamiento de bajo nivel) | **Exclusión explícita del propietario.** Estado conocido, funcional y aceptado del prototipo; no hay fuente de verdad clara expuesta en la UI que permita alinear el indicador sin inferir estado; intervine­rlo implicaría tocar datos/credenciales. Queda como hallazgo informativo. |
| `mockData.ts:168` — PIN de demostración de 4 dígitos | Son **datos de semilla** (modo demo `SEED_DEMO`), no texto de UI. Cambiarlos alteraría datos generados (fuera del alcance cosmético). Los estudiantes demo no tienen cuenta Firebase real. |
| `syncStudentAccountPassword` sin guard previo de longitud (a diferencia de `syncTeacherAccountPassword:545`) | Añadir el guard sería **añadir lógica de validación** (prohibido). El resultado funcional es equivalente: Firebase rechaza el update y, con el fix I-2, el mensaje visible ahora sí es honesto. |
| Comentario `pdfGenerator.ts:295` "(4-6 dígitos)" | Comentario interno, no visible en UI, y exacto: el renderizador tolera PINs legacy/demo de 4 dígitos y los de 6 (ajusta fuente 6.8pt vs 5.5pt). |
| Añadir aviso de 6+ también al flujo de carga masiva | La carga masiva crea estudiantes **sin** PIN por diseño (R60-g); no hay texto que corrija alinearlo. |
| Cualquier ajuste a `hasFirebaseAccount`, `authEmail`, `authUid`, verifiers o `tempPassword` existentes | Depende del aprovisionamiento por API — excluido por la directiva. |

## 6. Puntos excluidos por el contexto de credenciales aprovisionadas por API

Se confirma que durante toda la ronda **no se ejecutó ninguna** de estas acciones:
- No se repararon, reasignaron ni sincronizaron credenciales aprovisionadas por API.
- No se modificó backend alguno: Firebase, Firestore, Worker, D1, KV, localStorage persistido, endpoints ni servicios externos permanecen intactos (el diff completo lo demuestra: solo 2 archivos de texto de UI y mensajes).
- No se hardcodearon textos de estado, estados fijos, valores por defecto, credenciales fijas ni fallbacks estáticos.
- No se alteró lógica para que la interfaz "parezca" correcta ni se simularon actualizaciones de UI que no pasan por el flujo normal.
- El hallazgo queda registrado como **informativo** (§5, fila 1), pendiente de decisión del propietario.

## 7. Pruebas ejecutadas y resultado

Protocolo de verificación del proyecto (entorno exacto del CI, `TZ=America/Bogota`):

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` (cliente) | **0 errores** ✅ |
| `npx vite build` | **limpio, 9.5s, 9 chunks** ✅ (warning de tamaño de chunks preexistente y documentado) |
| `scripts/verify_ronda43.ts` | **64/64 OK** ✅ |
| `scripts/qa-r46-rep.ts` | **40/40 OK** ✅ |
| `scripts/qa-r47-guard.ts` | **18/18 OK** ✅ |
| `scripts/qa-r58-hardening.ts` | **68/68 OK** ✅ |
| **Total batería local** | **190/190** ✅ |
| Gate anti-regresión del bundle (`DEFAULT_QR_SECRET`, `colegio2026`, `admin2026`, `SJ-`) | **0 apariciones** ✅ |
| Textos nuevos presentes en el bundle (`dist/assets/index-*.js`) | verificados (placeholder y mensaje nuevos = 1 aparición cada uno) ✅ |

Si alguna prueba hubiera fallado de forma atribuible a los cambios, el cambio se habría revertido (no fue necesario: el diff no toca ninguna ruta ejecutada por las suites).

## 8. Confirmaciones explícitas

1. **No se modificó lógica funcional sensible.** El diff completo es: 1 placeholder, 1 oración de ayuda, 1 caso de mapeo de mensaje de error con su comentario. Ninguna rama, validación, flujo, estado ni firma de función fue alterada.
2. **No se tocaron credenciales, autenticación, backend ni estados aprovisionados por API.** Ningún cambio en Firebase/Firestore/Worker/D1/KV/endpoints; ninguna operación con la Service Account; ninguna rotación ni modificación de claves (Regla 9); ningún dato de producción fue escrito.
3. No se reabrieron tareas cerradas, no se agregaron funcionalidades y no se introdujeron fallbacks estáticos.

## 9. Entrega

- **Commit:** `ronda 65 (auditoría visual conservadora): ...` — hash registrado en `worklog.md` y en el mensaje final de la sesión (el informe se incluye en el propio commit).
- **Archivos modificados:** `src/components/StudentsManagerView.tsx`, `src/services/firebase.ts`, `AGENTS.md` (bitácora R65), `docs/INFORME-AUDITORIA-VISUAL-R65.md` (este informe).
- **Pendiente del propietario (no bloqueante):** verificar en producción la presentación del formulario tras el despliegue de Pages; decidir en el futuro si regulariza los indicadores de las cuentas aprovisionadas por API desde el flujo normal de la interfaz.
