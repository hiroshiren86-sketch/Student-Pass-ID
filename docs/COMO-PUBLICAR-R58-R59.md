# Cómo publicar las Rondas 58–59 (paso a paso)

Este zip contiene el repo completo con dos commits nuevos sobre `main`:
- `a83165b` — Ronda 58: remediación de la auditoría (F-1…F-25)
- `7ff899b` — Ronda 59: el secreto viaja por rol (qrSecret jamás baja a estudiantes)

## 1. Subir el código a GitHub (publica la app en Pages automáticamente)

Opción A — desde esta copia (incluye `.git` con el historial):
```bash
cd Student-Pass-ID
git remote -v                      # confirma que apunta a tu repo
git push origin main               # Cloudflare Pages se despliega solo con el push
```

Opción B — desde tu clone local: descomprime este zip ENCIMA de tu clone existente
(conserva `.git/` del zip o el tuyo, cualquiera de los dos tiene el historial) y haz
`git add -A && git commit && git push`.

## 2. Desplegar el Worker (NO se despliega solo)

```bash
cd cloudflare-worker
npx wrangler d1 migrations apply inas_attendance_db --remote   # si hay migraciones pendientes
npx wrangler deploy
```
O usa el workflow manual del CI (Actions → CI → Run workflow → ✓ deploy_worker).

## 3. Desplegar firestore.rules (NO se despliega solo)

```bash
npx firebase deploy --only firestore:rules --project <tu-proyecto>
```
O Actions → CI → Run workflow → ✓ deploy_firestore_rules (requiere el secret
`FIREBASE_SERVICE_ACCOUNT`).

## 4. Configurar los secrets del CI (una sola vez)

En GitHub → Settings → Secrets and variables → Actions:
- `CLOUDFLARE_API_TOKEN` — token con permisos Workers Scripts + D1
- `FIREBASE_SERVICE_ACCOUNT` — JSON completo de la cuenta de servicio

## 5. ROTAR credenciales (URGENTE — el historial git las filtró públicas)

1. **AUTH_TOKEN del Worker**: Cloudflare → Workers → inas-attendance-worker →
   Settings → Variables → generar uno NUEVO y actualizarlo en los terminales.
2. **Contraseñas Firebase** de `rectoria@inas.edu.co` y `mrestrepo@inas.edu.co`.
3. Recomendado: **rotar el qrSecret** en Ajustes (Rectoría). El sistema ya lo tolera:
   `legacyQrSecret` mantiene verificando lo firmado con el viejo, los carnés
   pre-firmados se re-emiten en el próximo push y los pares loginKey+verifier de los
   estudiantes siguen funcionando (son autocontenidos).

## 6. Verificación post-deploy (2 minutos)

- Abre la app en producción y verifica en la consola del navegador que el bundle
  cargado tenga los chunks nuevos (`vendor-react-*.js`, `vendor-firebase-*.js`…).
- Como estudiante: inicia sesión → tu QR del carné debe verse (token pre-firmado);
  en Ajustes de ese dispositivo NO debe aparecer qrSecret (si inspeccionas
  localStorage, `inas_school_settings_v1` llega SIN `qrSecret` para ese rol).
- Como docente: escanea un carné impreso — debe verificar; un QR forjado con otro
  secret debe rechazarse con "Carné no verificado".

## Resumen de qué contiene cada pieza

| Pieza | Qué hace |
|---|---|
| `.github/workflows/ci.yml` | CI: typecheck+build+5 suites en cada push/PR; deploys manuales |
| `cloudflare-worker/` | CORS allowlist, authz por rol, CAS del snapshot, excusas con gate, secret por rol |
| `src/` | política de carné firmado, portal sin puerta trasera, credenciales fuera del push, cache de lectura, login con throttle |
| `firestore.rules` | escritura solo ADMIN (terminal anónima solo lee) |
| `docs/INFORME-REMEDIACION-R58.md` | informe completo F-1…F-25 + addendum Ronda 59 |
| `scripts/qa-r58-hardening.ts` | suite de verificación (51 checks) — `TZ=America/Bogota npx tsx scripts/qa-r58-hardening.ts` |
