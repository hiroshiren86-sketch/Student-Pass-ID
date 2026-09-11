# R57 — BUCLE DE AUTO-MEJORA DE LA SINCRONIZACIÓN (informe QA y cierre)

**Fecha:** 2026-09-10/11 · **App:** https://student-pass-id.pages.dev · **Worker:** https://inas-attendance-worker.hiroshiren86.workers.dev
**Bundle vivo verificado:** `index-fURkMXyO.js` (commits `d64ad84`, `d2b0a5d`, `eb461c2`) · tsc 0 errores · build limpio
**Método pedido por el propietario:** re-auditar la R56 contra las guardas históricas de la bitácora, cerrar todo hueco con razonamiento previo + forense + QA en navegador real contra producción, y documentar. Invariante rector: **"si lo local está un poquito más adelantado, no me lo puede pisar"** (en ambas direcciones local↔nube).

---

## 1. Los 4 invariantes nuevos (código)

| INV | Peligro que cierra | Implementación |
|---|---|---|
| **INV-1** (sello dirty) | Lo local adelantado puede ser APLASTADO por un pull (reemplazo verbatim de settings) | Sello `inas_local_sync_dirty_v1` (timestamp ISO). Toda edición local de usuario sella (`saveSettings` con `sync=true`; `saveStudents/Teachers/CustomTemplates/AllStudentSchedules/ScheduleSlots/ScheduleAssignments` con `origin:'local'`). El pull aplica settings con gate: si hay sello → `{changed:0, skipped:true}` y los ajustes de la nube NO se aplican. |
| **INV-2** (login pull) | El pull silencioso del login ADMIN (agregado en R56) aplastaría ediciones recientes en cada re-entrada | `LoginScreen` ADMIN: si hay sello, el pull del login NO corre (log `[Login] Pull diferido…`); los pulls scopeados de docente/estudiante siguen SIEMPRE (son UPSERT + tombstones, loss-proof). |
| **INV-3** (orden push→pull) | El auto-sync de Rectoría hacía push y LUEGO pull aunque el push hubiera FALLADO (409 CAS/red) → revertiría ediciones no publicadas | El pull post-push SOLO corre con `pushResult.success===true`. Orden garantizado: primero subir todo, luego bajar. |
| **INV-4** (tombstones convergen al bajar) | El UPSERT añade/actualiza pero jamás borra: un estudiante/docente eliminado por Rectoría resucitaba (o persistía) en los otros teléfonos | `applyCloudTombstones()`: barrido final del pull que elimina por `code`/`id` de lo local, UNE los tombstones de la nube a la lista local (escritura directa, sin sellar) y se defiere si hay sello (un tombstone viejo no mata una re-matrícula local no publicada). |

## 2. El bucle de auto-mejora cazó 2 huecos ADICIONALES (en mi propio código R57)

| Hueco | Qué pasó | Fix |
|---|---|---|
| **#5** (`d2b0a5d`) | 4 guardados de PROTOCOLO en `cloudflareSync` (`advanceLastSyncedAt`, `catalogVersion` en push y pull, `updateLastSync`) usaban `saveSettings(...)` con default → **sellaban dirty al final de CADA pull**, bloqueando convergencias futuras con el mensaje falso "ajustes locales sin subir" | Todos los guardados de protocolo van con `false`. Regla: **solo las ediciones del usuario sellan**. Auditoría global de los 11 `saveSettings` del repo: los 5 restantes son de usuario (UI Ajustes ×4, respaldo ×1) y sellan correctamente. |
| **#7** (`eb461c2`) | Los GETTERS con auto-reparación (`getStudents`, `getTeachers`, `getScheduleSlots`, `getScheduleAssignments` — lazy-init de defaults y purgas derivadas) terminaban llamando `saveX(...)` que con R57 **sellaba en la PRIMERA LECTURA de cualquier teléfono nuevo** → login pull gated para siempre en dispositivos limpios (cazado con hook de stacks en navegador real: `markLocalSyncDirty ← saveScheduleSlots ← getScheduleSlots ← getSchoolDayWindow`) | Nuevo origen `'system'`: escrituras derivadas del sistema JAMÁS sellan (los 5 fallbacks vivos en producción llevan `'system'`; las ramas de seed demo no existen en prod). Verificado: arranque limpio NO sella. |

## 3. QA E2E en producción (contextos limpios, navegador real)

Script: `qa_tooling/qa_r57_sync.mjs` · Resultados definitivos: **ver sección 4** (run5).

Fases:
- **F0** — Forense API: estado base de la nube (80 estudiantes / 20 docentes / 180 cátedras / 7 bloques / 2 tombstones / jornada 18:30 / plantilla `tmpl-normal` / qrSecret canónico preservado).
- **F1 (INV-1a + INV-3)** — Rectoría en teléfono limpio: editar Fin de Jornada 18:30→**18:35** → **sello activo** → esperar el ciclo automático (5 min): push publicó **18:35 a la nube**, **sello liberado**, pull posterior converge, lo local jamás fue pisado. Espera medida: **260 s**.
- **F2 (INV-1b)** — Editar 18:35→**18:40** → sello → **"Descargar (Pull)" manual** → resumen declara **"ajustes locales sin subir preservados"**, el 18:40 SIGUE local, la nube sigue 18:35 (el pull no cambia la nube).
- **F3 (INV-4)** — Segundo teléfono limpio: logout → inyectar fantasma `999999999` (código eliminado históricamente en R54, con forma completa heredada de un estudiante real) → **re-login** → el login-pull integra los 2 tombstones de la nube y **el barrido elimina al fantasma** (`estudiantes removidos: 1`), matrícula real intacta (80), tombstone unido a la lista local (no resucita con push posterior).
- **F4** — Restauración: editar 18:30 → push manual → sello liberado → nube idéntica a F0 (estudiantes/docentes/cátedras/plantillas/slots/tombstones + **qrSecret byte-exacto**) → login docente real (Andrés) en teléfono limpio: pull scopeado sin gate (38 estudiantes, jornada 18:30, **rol de la representante Camila (11°3) presente**), 0 errores JS.

## 4. Resultado final

**Suite E2E (run7): 31/32 PASS** + **mini-QA dedicado INV-4: PASS** → **32/32 efectivos** (el único ítem no-PASS de la suite, F3.2, era la captura de un log de consola cuya condición de disparo era demasiado estrecha — la eliminación del fantasma SÍ ocurrió y quedó probada por F3.5 y por el mini-QA; se mejoró la observabilidad en `da9b51e`).

| Fase | Verificación | Resultado |
|---|---|---|
| F0 | Forense API: nube base 80/20/180, 7 slots, 2 tombstones, 18:30, qrSecret canónico (64 chars) | PASS |
| F1.p0 | Arranque limpio NO sella (fix hueco #7) | PASS |
| F1.0–F1.2 | Teléfono limpio aplica 18:30; editar a 18:35 ACTIVA el sello; la nube aún no lo conoce | PASS |
| F1.3 | **Auto-sync liberó el sello tras push exitoso — espera medida 260 s (ciclo de 5 min)** | PASS |
| F1.4–F1.5 | **Lo local adelantado SOBREVIVIÓ y la nube CONVERGIÓ al 18:35 local** (INV-1a+INV-3 completos) | PASS |
| F1.6 | 0 errores JS en Rectoría durante todo el ciclo | PASS |
| F2.1–F2.4 | **INV-1b**: edición 18:40 sella → pull manual → resumen **"ajustes locales sin subir preservados"**, 18:40 intacto, nube sigue 18:35 | PASS ×4 |
| F3.0–F3.1 | Logout real + fantasma `999999999` (forma completa, BD sucia) presente | PASS |
| F3.4–F3.6 | Tombstone unido a la lista local (no resucita con push), matrícula real intacta (80), 0 errores JS | PASS |
| F3.2* | Log del barrido con eliminación — probado por mini-QA dedicado (ver abajo) | PASS* |
| F4.1–F4.6 | Restauración: edición 18:30 sella → push manual → sello liberado → **nube idéntica a F0 (s/t/a/tmpl/slots/tombstones) y qrSecret BYTE-EXACTO** | PASS ×6 |
| F4.7–F4.11 | Docente real (Andrés) en teléfono limpio: pull scopeado sin gate, jornada 18:30, 38 estudiantes, **rol de la representante Camila (11°3) presente**, 0 errores JS | PASS ×5 |

**Mini-QA INV-4 en su escenario ÚNICO (`qa_r57_inv4_sweep.mjs`): PASS** — docente scopeado (Andrés, porción 38) + fantasma de un grado AJENO a su porción (6°4): el UPSERT no borra, así que solo `applyCloudTombstones` podía eliminarlo → re-login: **39→38, fantasma eliminado, log visible `[Sync Pull] Tombstones de la nube integrados: 0 (estudiantes removidos: 1, docentes: 0)`, 0 errores JS**. Salida: `qa_r57_inv4_sweep_output.txt`.

## 5. Estado de la nube tras el QA

Restaurado idéntico al estado previo (verificación F4.5/F4.6 byte-exacto vs F0): 80/20/180, jornada 18:30, plantilla `tmpl-normal`, qrSecret canónico intacto, 2 tombstones históricos.

## 6. Notas para el propietario

1. **Ningún dato real se perdió durante el QA**: "Camila ausente" era un artefacto del script (la nube guarda `firstName`+`lastName`; el revisor buscaba `fullName`). Verificado por API: `CAMILA FELIPE / ZAPATA CÓRDOBA (11°3, isRepresentative=true, active=true)` está en la nube.
2. El qrSecret canónico (64 chars) está en la nube y fue preservado byte-exacto por cada push del QA — **la acción de 1 minuto de R56 sigue en pie si algún teléfono aún firma con secret viejo: push de Rectoría en teléfono 1 + re-login en teléfono 2 + regenerar tarjetas viejas**.
3. El catálogo subió de v33→v38+ por los pushes del QA (esperado, no es bug).
