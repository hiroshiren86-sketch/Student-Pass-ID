# SPEC-F4 — Despliegue de las reglas de Firestore (Ronda 58/60-b)

> **Documento operativo para el agente AUTH/infraestructura.** Este es el único
> paso pendiente de infraestructura del ciclo R58→R60-b. Todo el código ya está
> en `main` (commit `3b6bfe2` y siguientes) y verificado.

## 1. Qué cambia y por qué (F-4)

El diff de `firestore.rules` en la Ronda 58 endurece DOS match, ambos validados
por la auditoría de seguridad de 2026-09:

### 1.1 `school_settings/{settingId}` — escritura SOLO ADMIN

```
- allow read, write: if isAuthenticated();
+ allow read:  if isAuthenticated();
+ allow write: if isAdmin();
```

**Riesgo cerrado:** antes, cualquier sesión autenticada — incluida la ANÓNIMA
que el propio terminal abre con `ensureAnonymousAuth()`, cuya Web API Key es
pública por diseño — podía ESCRIBIR la configuración de toda la institución:
reemplazar `cloudflareWorkerUrl` (redirección de credenciales: el cliente manda
`Bearer <AUTH_TOKEN>` a esa URL) y envenenar jornada/plantilla/schoolCode.

**Por qué la escritura ADMIN no rompe nada:** la sincronización operativa de
ajustes ya NO depende de Firestore — la autoridad es el snapshot del Worker
(D1/KV) vía pull/push por identidad (Rondas 49–58). El canal Firestore queda
como espejo de lectura para hidratación y respaldo bajo sesión de Rectoría.
El cliente (Ronda 60-b) además ya no publica secretos ni metadatos de
protocolo en este doc (ver §2 y §3).

### 1.2 `attendance_records/{recordId}` — lectura y escritura SOLO ADMIN

```
- allow read:  if isAuthenticated();
- allow write: if isAuthenticated();
+ allow read:  if isAdmin();
+ allow write: if isAdmin();
```

**Riesgo cerrado:** este espejo de Firestore NO tiene consumidor crítico
(`syncAttendanceRecord` fue eliminado como código muerto en Ronda 60-b — 0
llamadores; el respaldo `backupAllToFirestore` corre bajo la sesión de
Rectoría). Antes, cualquier sesión ANÓNIMA podía leer TODA la asistencia del
colegio y escribir registros que el pull propagaba.

## 2. PURGA PREVIA OBLIGATORIA — 5 secretos históricos en `school_settings/main`

Antes o inmediatamente después de publicar las reglas, el doc
`school_settings/main` debe quedar LIMPIO de estos 5 campos heredados
(escritos por versiones ≤ Ronda 15, ya obsoletos):

| Campo                | Por qué sobra                                                            |
|----------------------|--------------------------------------------------------------------------|
| `cloudflareApiToken` | token legacy de la era R15; el AUTH_TOKEN real vive en el secret del Worker |
| `qrSecret`           | la clave canónica de firma vive en el SNAPSHOT del Worker (D1/KV), jamás en Firestore |
| `legacyQrSecret`     | idem — el Worker la lee del snapshot (`settings.legacyQrSecret` del snapshot), no de Firestore |
| `sessionSecret`      | secreto local por dispositivo; la nube jamás lo aporta ni lo pisa (R16)  |
| `customAiApiKey`     | clave IA personal (BYOK) — solo localStorage del admin                  |

**Garantía de no-regresión:** desde Ronda 60-b el cliente ya NO vuelve a
subirlos — `saveSchoolSettings` los elimina en la escritura (lista unificada
A-1: `qrSecret`, `sessionSecret`, `cloudflareApiToken`, `customAiApiKey`,
`legacyQrSecret`) y los consumidores del listener aplican el doble strip
(secretos + metadatos de protocolo M-4: `cloudflareCatalogVersion`,
`cloudflareLastSyncedAt`, `lastCloudflareSync`, `lastCloudSync`, `updatedAt`).

Cómo purgar (desde consola de Firebase o REST con la SA): eliminar esos 5
campos del doc `school_settings/main` (update con `FieldPath.delete()` o
reescritura del doc sin ellos). La purga es ADITIVA-SEGURA: ningún flujo
actual lee esos campos desde Firestore.

## 3. Cómo desplegar las reglas

### Opción A — GitHub Actions (recomendada)

1. En el repo: **Settings → Secrets and variables → Actions** → crear
   `FIREBASE_SERVICE_ACCOUNT` con el JSON COMPLETO de la cuenta de servicio
   (debe tener rol `firebaserules.rulesCreator`).
2. Pestaña **Actions → CI → Run workflow** → marcar solo
   `deploy_firestore_rules` → Run.
3. El job `deploy-firestore-rules` publica `firestore.rules` en el proyecto
   `gen-lang-client-0224520207`.

### Opción B — CLI local

```bash
firebase deploy --only firestore:rules --project gen-lang-client-0224520207
```

(Referencia completa: `docs/DESPLEGUE_FIREBASE.md`.)

**Nota:** publicar reglas NO redeploya la app ni toca el Worker. Es un cambio
independiente, seguro y reversible (las reglas previas están en el historial
git: commit `941b5b4`).

## 4. Matriz de verificación post-despliegue

Ejecutar desde un contexto anónimo limpio (incognito) y con sesión de Rectoría:

| # | Acción | Esperado |
|---|--------|----------|
| V1 | sesión anónima lee `school_settings/main` | 200 (hidratación al arrancar) |
| V2 | sesión anónima escribe `school_settings/main` | PERMISSION_DENIED |
| V3 | sesión ADMIN escribe `school_settings/main` | OK |
| V4 | sesión anónima lee `attendance_records` | PERMISSION_DENIED |
| V5 | sesión ADMIN lee `attendance_records` | OK |
| V6 | flujo real: login docente → aula → pull | sin errores 403 en consola |
| V7 | flujo real: portal estudiante → escanea tarjeta de clase | verificación OK vía Worker (no depende de reglas) |

## 5. Estado de referencia del repo al momento de esta spec

- `main` ≥ `3b6bfe2` (Ronda 60) + delta Ronda 60-b re-aplicado (H-2, H-3, B-1,
  M-2, M-4, A-1, rate-limit del verify, código muerto eliminado).
- `firestore.rules`: versión F-4 (Ronda 58).
- CI: `.github/workflows/ci.yml` con job manual de reglas (opción A).
- Worker en producción (`fd1d2fef`, sesión del 11/09): ya incorpora los
  fixes H-2/H-3/H-5; se recomienda un `wrangler deploy` de cortesía desde
  este estado del repo para bit-parity exacta (protocolo completo:
  backup D1 → deploy → verificación).
