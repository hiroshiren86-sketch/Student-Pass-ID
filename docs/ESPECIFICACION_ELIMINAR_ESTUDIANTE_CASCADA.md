# 🔐 ESPECIFICACIÓN — ELIMINAR ESTUDIANTE EN CASCADA (ESTUDIANTE Y SU CUENTA DE ACCESO)

> **Estado:** Propuesta / visión a futuro — NO implementada todavía (decisión del propietario: "queda para visión al futuro; ellos pueden implementarlo").
> **Alcance:** Rectoría → Directorio de Estudiantes → engranaje (⚙) de la fila → **"Eliminar"**.
> **Objetivo:** que al eliminar un estudiante también se eliminen de forma permanente y controlada **su cuenta de acceso y sus datos en la nube**, con confirmación explícita.
> **Fecha de redacción:** 08/09/2026.

---

## 1. Qué se hace hoy (comportamiento actual)

Al pulsar **"Eliminar"** en la fila del estudiante (menú engranaje `⚙` → "Eliminar"), el código actual (`src/components/StudentsManagerView.tsx`, `handleDelete`) hace **SOLO**:

```ts
AttendanceStorageService.deleteStudent(code);  // borra la ficha LOCAL (students/)
refreshList();
```

**NO** borra: el documento de Firestore `users/{uid}`, la cuenta de Firebase Auth, ni los registros de asistencia ya guardados en la nube. Resultado: el estudiante desaparece del directorio local, pero su identidad y sus datos **quedan huérfanos** en Firebase (Auth + Firestore) y en el snapshot/KV del Worker.

---

## 2. Comportamiento deseado (a implementar)

Al pulsar **"Eliminar"**, después del cartel de confirmación, se debe ejecutar una **eliminación en cascada**:

### Paso A — Confirmación explícita (cartel)
El diálogo de confirmación actual (`deleteConfirm`) debe pasar a **dos estados** (o un cartel más explícito):

- **Confirmación 1 (local, hoy):** "¿Eliminar al estudiante **{nombre}** ({código})?"
- **Confirmación 2 (irreversible / nube):** cuando el estudiante **tenga cuenta de acceso** (`hasFirebaseAccount === true`), añadir un aviso destacado:

> **⚠️ Este estudiante tiene una cuenta de acceso activa.**
> Se eliminará **permanentemente** de la base de datos **y** de la nube (Firebase Auth + Firestore), y **ya no podrá iniciar sesión** desde su teléfono.
> ¿Deseas continuar?
> _(Botón: "Eliminar definitivamente")_

Si el estudiante **NO** tiene cuenta (`hasFirebaseAccount === false`), el mensaje no menciona la nube (solo dice "permanente").

### Paso B — Eliminar en cascada

1. **Capturarlo/identificar** el vínculo de la cuenta antes de borrar la ficha:
   - `authEmail` (formato interno `estudiante-<codigo>@inas.edu.co`) y `authUid` si están en la ficha local; o derivar el correo interno con `FirebaseService.studentInternalEmail(code)`.
2. **Borrar la identidad en Firebase (server-side, con la cuenta de servicio / SA):**
   - **Firestore:** `DELETE` del documento `users/{uid}` (rol `ESTUDIANTE_ACUDIENTE`).
   - **Firebase Auth:** borrar la cuenta (`projects/{projectId}/accounts:delete` con `localId`).
   - *Nota:* esto debe hacerse con un **endpoint/worker o función con credenciales Admin** (la app del navegador NO tiene permiso de borrar cuentas de Auth; hoy ni siquiera llega ahí). Es el punto de trabajo principal.
3. **Borrar la ficha local** (como hoy): `AttendanceStorageService.deleteStudent(code)`.
4. **Anonimizar/eliminar los registros de asistencia** (decisión de producto, recomendado por **Ley 1581**):
   - **Recomendado:** **anonimizar** — conservar la estadística/asistencia pero sin el identificador (nombre/código), para no perder datos agregados.
   - **Alternativa (más simple):** eliminar los registros de asistencia de ese código en el snapshot/KV y en D1.
5. **Excluirlo del snapshot en la nube** para que no reaparezca en próximos pulls: hacer un **PUSH** posterior (o purgar en el Worker vía `/api/sync/push` desde Rectoría).

### Paso C — Reflejar en la nube
Tras la cascada, Rectoría debe **subir (PUSH)** la matrícula actualizada para que la nube deje de incluir al estudiante y su cuenta deje de existir.

---

## 3. Arquitectura sugerida para el borrado server-side

La app web no puede borrar cuentas de Auth (requiere Admin SDK + rol de servicio). Opciones:

- **Opción 1 (recomendada):** añadir un **endpoint de Worker** (protegido, solo ADMIN con `AUTH_TOKEN` + sesión de Rectoría) tipo `POST /api/admin/student/delete` que reciba `{ code }` y ejecute: verifica el perfil `users/{uid}` → borra el doc → borra la cuenta Auth → anonimiza/elimina registros. El Worker usa las credenciales Admin (SA) como en el resto del backend.
- **Opción 2 (alternativa):** una **Cloud Function** de Firebase Admin que haga lo mismo, invocada por la app.

---

## 4. Puntos a tocar en el código (cuando se implemente)

| Archivo | Cambio |
|---|---|
| `src/components/StudentsManagerView.tsx` | En `handleDelete`: detectar `hasFirebaseAccount`, mensaje 2 de confirmación, y llamar al borrado server-side ANTES de `deleteStudent`. |
| `src/services/firebase.ts` | (Opcional) helper `studentInternalEmail(code)` ya existe; añadir `deleteStudentAccount(uid/email)` que llame al endpoint/function Admin. |
| Nuevo endpoint Worker / Cloud Function | Borrado real de Auth + Firestore doc + anonimización de registros. |
| `src/components/ConfirmDialog` / modal | Soporte para 2 mensajes / botón "Eliminar definitivamente" en rojo. |
| `src/services/attendanceStorage.ts` | Configurar que `deleteStudent` no deje enlaces huérfanos si se decide anonimizar. |

---

## 5. Reglas y salvaguardas (no negociables)

- **Confirmation explícita** en dos niveles; el borrado de la cuenta nube es **irreversible**.
- **Solo Rectoría (ADMIN)** puede eliminar en cascada (mismo `canWriteCatalog`).
- **No romper la retrocompat** de estudiantes sin cuenta (siguen siendo borrado local simple).
- **Ley 1581:** entre eliminar o anonimizar, **anonimizar** los registros de asistencia (conservar el agregado, quitar el identificador de menor).
- **Auditoría:** registrar el borrado en `device_sync_log` / `audit_logs` (quién, cuándo, a quién).

---

## 6. Criterios de aceptación (Definition of Done)

- [ ] Al eliminar un estudiante CON cuenta, aparece el cartel de irreversibilidad en la nube.
- [ ] Se borran: ficha local, doc `users/{uid}` y cuenta Firebase Auth.
- [ ] El estudiante ya NO puede iniciar sesión con su código/clave (login → rechazado).
- [ ] La nube (pull desde otro dispositivo) ya NO devuelve a ese estudiante.
- [ ] Los registros de asistencia del estudiante quedan **anonimizados** (o eliminados) sin romper las estadísticas del grado.
- [ ] Se registra en auditoría.
- [ ] `tsc` 0, build limpio y sin regresión en las suites de QA.
