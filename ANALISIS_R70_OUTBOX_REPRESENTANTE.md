# Análisis R70 — Por qué el escaneo del representante quedó en su teléfono y qué riesgos tiene cablearlo

**Origen:** informe de prueba en producción del 15/09/2026 (18:20–19:15 Bogotá), *Pruebita del Representante* — 29 de 30 comprobaciones en verde, con **Nota 2**: el auto-registro del representante quedó guardado en el dispositivo y no llegó a la nube en la ventana observada (~5 min).
**Alcance de este documento:** (a) confirmar o desmentir la Nota 2 contra el código real; (b) riesgos de cablear el envío automático del outbox para el subrol representante; (c) propuesta mínima verificable. **No se ha tocado una línea de código de producto.**
**Regla vigente:** Regla 8 de `AGENTS.md` (prohibido modificar código para forzar una prueba). Este documento propone un cambio de **producto**, no de prueba; se aplica solo con tu visto bueno.

---

## 1. Qué dice el código (verificado línea por línea)

| # | Hecho | Evidencia |
|---|---|---|
| 1 | El escaneo del representante **sí** se encola en el outbox durable, con `opId` idempotente | `src/services/attendanceStorage.ts:2842-2845` (`enqueueOfflineMutation(newRecord, 'op-mutation-<id>')`) |
| 2 | El reenvío de esa cola existe y está probado: `POST /api/attendance` con `opId` | `src/services/cloudflareSync.ts:1273` (`replayOutbox()`), `attendanceStorage.ts:3384` (`syncOfflineQueue()`) |
| 3 | **Único llamador en producto:** el evento `online` dentro del **Escáner de Rectoría/Docente** | `src/components/ScanHubView.tsx:58` (pantalla de rol ADMIN/DOCENTE; el portal del estudiante no la monta) |
| 4 | El ciclo automático de 5 min **solo hace Pull** cuando no hay sello *dirty* | `src/services/cloudflareSync.ts:65-85`; `initAutoSync()` se llama para cualquier rol en `src/App.tsx:133` |
| 5 | Los **hechos de asistencia NO sellan *dirty*** | `saveAttendance` (`attendanceStorage.ts:2245`) no llama `markLocalSyncDirty`; solo sellan ajustes/catálogo/horarios (líneas 400, 543, 1160, 1235, 1535, 1703, 1745) |
| 6 | La clase activa vive en su propia clave, tampoco sella | `inas_active_class_v1` (`attendanceStorage.ts:63, 2369, 2542`) |
| 7 | Todas las rutas de datos exigen credencial válida (identidad o token) | `cloudflare-worker/src/index.ts:827-830` (401 sin credencial); la ruta de hechos en `index.ts:2661` |
| 8 | Un rol ESTUDIANTE_ACUDIENTE con identidad Firebase **sí** puede escribir hechos (nunca catálogo) | `cloudflare-worker/src/authz.ts:217+`; `index.ts:866-867` (`isOperator = !isAdmin`), `catalogWritten: isAdmin` (`index.ts:1442`) |

### Conclusión sobre la Nota 2

- **El diagnóstico del informe es correcto** en su primera mitad: los registros no activan el sello de publicación y el reenvío por outbox está cableado en el Escáner de Rectoría/Docente.
- **La segunda mitad se queda corta**: *"el registro viajará con el siguiente ciclo de 5 minutos"* **no se cumple hoy**. En el teléfono del representante, el ciclo de 5 minutos ve `dirty = null` y hace **solo Pull** (lectura). El hecho sube únicamente si:
  1. en **ese mismo teléfono** se entra al Escáner con sesión de Rectoría/Docente (o se dispara el evento `online` de esa pantalla), o
  2. algo sella *dirty* en ese dispositivo y el push automático sube el snapshot (por ejemplo, el estudiante **personaliza su foto** o **carga su horario por CSV**: `saveStudents` / `saveAllStudentSchedules` con origen `local`), o
  3. se hace un **push manual** en ese dispositivo — el portal del estudiante no tiene ese botón.
- Es decir: **la ruta del representante hoy es "captura garantizada, publicación diferida sin disparador"**. El dato no se pierde (cola durable de hasta 2000 operaciones, `attendanceStorage.ts:3326+`), pero nadie garantiza cuándo sale.

---

## 2. Riesgos de cablear el envío automático (lo que preguntaste)

La propuesta NO es "que el representante haga push" (snapshot completo), sino **reusar el reenvío de hechos que ya existe** (`POST /api/attendance`, idempotente por `opId`):

| Riesgo | Probabilidad | Impacto | Mitigación propuesta |
|---|---|---|---|
| **401 en bucle**: un teléfono con login **local** (sin cuenta Firebase) y sin token no puede autenticarse; cada reintento suma `retryCount` | Media (teléfonos personales sin identidad) | Bajo: el ítem queda en cola, no se pierde; ruido en consola | Guarda en `replayOutbox`: si no hay token de dispositivo **ni** ID token de Firebase, no intentar (ítem sigue PENDING) |
| **Cuota D1/KV**: subir hechos de más dispositivos | Baja | Bajo: 1 escritura por escaneo (~480/día por curso) vs. 100 000/día de cupo | El reenvío va al endpoint de hechos, **no** al snapshot; cero escrituras cuando la cola está vacía |
| **Duplicados** por respuesta perdida y reintento | Baja | Nulo | Ya resuelto: `att_opid_<opId>` en KV + `INSERT OR REPLACE` por `id` (`index.ts:2677-2687`) |
| **Que un teléfono de estudiante escriba catálogo** | Muy baja | **Alto si ocurriera** | Ya bloqueado por diseño: `catalogWritten: isAdmin`; la identidad ESTUDIANTE_ACUDIENTE es operador. El reenvío de hechos **no** toca el catálogo |
| **Sellar *dirty* desde el portal** (tentación fácil) | — | **Alto**: cada teléfono empujaría el snapshot completo cada 5 min → regresión directa de R58/F-11 y de la guarda anti-aplastado | **No se sella *dirty***: se reusa únicamente el replayer del outbox |
| **Repartir el AUTH_TOKEN a teléfonos de estudiantes** | — | **Muy alto**: daría escritura de catálogo a cualquier teléfono | Prohibido. El camino correcto es la identidad (rol) o nada |
| **Servidor confía en el hecho** (no revalida que quien envía sea el representante del grado, ni que el bloque esté en curso) | Media (ya existe hoy para docentes) | Medio: un terminal autorizado podría inyectar marcas de otro curso | Mitigación mayor (fuera de esta propuesta): endpoint de hechos con validación de autoridad/ventana, o firma del hecho con el `opId` + contexto de clase |
| **UX**: mostrar errores de red a un estudiante | Media | Bajo | Reenvío **silencioso** (sin toasts); el escaneo siempre se confirma en pantalla como hoy |

---

## 3. Propuesta mínima (3 cambios aditivos, ~25 líneas)

> Objetivo: que el hecho capturado en el portal del representante salga **solo** (endpoint de hechos, idempotente) sin cambiar ninguna regla de seguridad ni el comportamiento de Rectoría/Docente.

**Cambio 1 — `src/services/cloudflareSync.ts`, dentro del intervalo de `initAutoSync()` (≈línea 73, antes del `if (!dirty)`)**

```ts
// R70: hechos pendientes en el outbox se reenvían SIEMPRE — antes solo los reenviaba
// el Escáner de Rectoría/Docente (ScanHub), así que el auto-registro del representante
// quedaba varado en su teléfono. Es el endpoint de HECHOS (idempotente por opId):
// no toca catálogo, no sella dirty y no escribe nada si la cola está vacía.
const hayHechosPendientes = AttendanceStorageService
  .getOfflineQueue().some(i => i.status !== 'SENT');
if (hayHechosPendientes) this.replayOutbox().catch(() => {});
```

**Cambio 2 — `src/components/StudentPortalView.tsx`, en `handleRepRegister` tras un auto-registro exitoso (≈línea 473)**

```ts
// R70: publicar YA el hecho (si hay credencial). Sin red o sin credencial, la cola
// durable lo conserva y el ciclo de sync lo reintenta. Silencioso, no rompe el escaneo.
AttendanceStorageService.syncOfflineQueue().catch(() => {});
```

**Cambio 3 — `src/services/cloudflareSync.ts`, guarda al inicio de `replayOutbox()` (≈línea 1273)**

```ts
// R70: sin credencial utilizable (token de dispositivo o ID token de Firebase) no se
// intenta: evita 401 en bucle y el crecimiento de retryCount. El hecho queda PENDING.
const s = AttendanceStorageService.getSettings();
let hayIdentidad = false;
try { hayIdentidad = !!(await FirebaseService.getCurrentIdToken()); } catch {}
if (!s.cloudflareApiToken && !s.cloudflareOperatorToken && !hayIdentidad) return;
```

**Verificación propuesta (antes de publicar):** extender `tests/unit/r70_representante_nube.ts` con dos comprobaciones nuevas — (a) con el sello *dirty* en `null`, un ciclo de sync **igual** llama a `POST /api/attendance` con el `opId` del escaneo del representante; (b) sin credencial, no se emite ninguna petición y el ítem queda PENDING. Después, la fila 11 del informe (publicación al cierre) pasa a verde en la próxima corrida E2E.

**Costo estimado:** ~1 hora de cambio + pruebas; cero efectos sobre Rectoría/Docente (el Escáner sigue igual y el replayer es el mismo código).

---

## 4. Alternativa sin tocar código (para la demo)

Que el representante escanee **desde el dispositivo del aula** (sesión de Docente/Rectoría, pantalla "Escanear"): esa ruta ya publica sola. Sirve para la presentación, pero no resuelve el flujo real "el representante desde su propio teléfono".

---

## 5. Recomendación

1. **Corto plazo (presentación):** mantener el guion honesto — el escaneo del representante se guarda al instante y la publicación desde su teléfono queda en cola (hoy sin disparador automático). No prometer el ciclo de 5 minutos.
2. **Siguiente ronda:** aplicar los 3 cambios de §3 con las 2 comprobaciones nuevas y volver a correr la prueba del representante en producción. Con eso la Nota 2 desaparece sin abrir ninguna puerta de seguridad nueva.
