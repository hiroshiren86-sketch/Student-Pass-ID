# DESPLIEGUE FIREBASE — Guía paso a paso para la institución (sin línea de comandos)

> **Objetivo:** que la institución adoptante despliegue el sistema COMPLETO con SUS
> propias claves de Firebase, usando únicamente la Consola web (https://console.firebase.google.com)
> y el panel de Cloudflare. No se requiere instalar herramientas de línea de comandos.
>
> **Contexto:** la aplicación es la PWA de `student-pass-id.pages.dev`. La autenticación
> vive en Firebase Auth (correo + contraseña) y los perfiles de rol en Firestore.
> Esta guía cubre: crear el proyecto, activar el acceso, crear la cuenta de Rectoría,
> publicar las reglas de seguridad y dar de alta a los docentes.
>
> Tiempo estimado: 30–45 minutos.

---

## 0. Conceptos que debe conocer antes de empezar

| Concepto | Qué es | Dónde vive |
|---|---|---|
| **Firebase Auth** | El servicio que verifica correos y contraseñas (la autoridad de credenciales) | Consola Firebase → Authentication |
| **Firestore** | La base de datos en la nube (perfiles de rol, respaldos de configuración) | Consola Firebase → Firestore Database |
| **`users/{uid}.role`** | El documento que decide si una cuenta es `ADMIN` (Rectoría) o `DOCENTE` | Firestore → colección `users` |
| **Reglas de seguridad** | El guardián que decide quién puede leer/escribir cada dato | Consola Firebase → Firestore → Reglas |
| **Web API key** | Identificador PÚBLICO de la app (no es secreto; la seguridad la dan las reglas) | Consola Firebase → Configuración del proyecto |

> ⚠ **Nunca** suba contraseñas a Firestore ni las escriba en el código. Las contraseñas
> solo existen en Firebase Auth.

---

## 1. Crear el proyecto de Firebase

1. Entre a https://console.firebase.google.com con su cuenta Google institucional.
2. Clic en **Crear un proyecto** (o "Add project").
3. Nombre: `inas-asistencia` (o el que prefiera). Continúe.
4. Google Analytics: puede **desactivarlo** (no es necesario). Crear proyecto.

## 2. Registrar la aplicación web y conectar la PWA

1. En la página del proyecto, clic en el icono **`</>`** (Web) para registrar una app web.
2. Apodo: `PWA Asistencia INAS`. Registre.
3. Firebase le mostrará el objeto `firebaseConfig`. Copie **todos** los valores:
   `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.
4. Edite el archivo **`firebase-applet-config.json`** del repositorio del proyecto con
   esos valores (mismos nombres de campo) y haga commit/push — Cloudflare Pages
   publicará la app con su proyecto Firebase.
5. **Regla de seguridad de repositorio:** la `apiKey` web es pública por diseño; lo
   que NUNCA va al repositorio es la **clave de cuenta de servicio** (paso opcional 8).

## 3. Activar los métodos de acceso (Authentication)

1. Consola → **Authentication** → **Comencemos**.
2. Pestaña **Sign-in method**:
   - Active **Correo/contraseña** (Email/Password) → Guardar. *(Único proveedor necesario.)*
   - Active **Anónimo** → Guardar. *(Lo usan los terminales de escaneo para el respaldo
     de configuración; no da acceso a ningún portal.)*
   - NO active Google/Facebook/etc. (la app no los muestra).
3. Pestaña **Settings** (Configuración) → **Authorized domains** (Dominios autorizados):
   - Agregue **`student-pass-id.pages.dev`** (o el dominio Pages de su institución).
   - `localhost` viene por defecto (sirve para pruebas locales).

## 4. Crear la base de datos Firestore

1. Consola → **Firestore Database** → **Crear base de datos**.
2. Ubicación: `us-east1` (o la más cercana). Modo: **Producción** (las reglas vienen después).
3. ⚠ Anote el **ID de la base**: la app puede apuntar a una base con nombre
   (campo `firestoreDatabaseId` de `firebase-applet-config.json`). Si su base es la
   `(default)`, borre ese campo del JSON; si usa nombre, escríbalo tal cual.

## 5. Publicar las reglas de seguridad (paso CRÍTICO)

1. Abra el archivo **`firestore.rules`** de este repositorio (contenido completo).
2. Consola → **Firestore Database** → pestaña **Reglas**.
3. Verifique que el selector de base de datos (arriba) apunte a la base de su app.
4. **Borre todo** el contenido del editor y **pegue** el contenido de `firestore.rules`.
5. **Publicar**.

Qué protegen estas reglas (resumen):

- `users/{uid}`: cada cuenta solo lee/escribe SU perfil; el **rol es inmutable** para
  el cliente y al registrarse solo puede nacer `DOCENTE`.
- `students`, `teachers`, `schedule_assignments`: **solo Rectoría** (rol ADMIN).
- `school_settings`, `attendance_records`: sesiones autenticadas del sistema.
- Todo lo demás: denegado.

## 6. Crear la cuenta de Rectoría (role ADMIN)

La cuenta ADMIN **no** se crea desde la app (por diseño: ningún cliente puede elegir roles).

**Opción A — desde la Consola (recomendada para la primera cuenta):**

1. Consola → **Authentication** → **Users** → **Add user**.
2. Email: `rectoria@sucedaneo.institucion.edu.co` (el correo real de rectoría).
   Contraseña: una fuerte (mínimo 12 caracteres con mayúscula, número y símbolo).
3. Copie el **UID de usuario** generado (icono de copiar en la fila).
4. Consola → **Firestore Database** → colección **`users`** → **Agregar documento**:
   - ID del documento: **pegue el UID** copiado.
   - Campos (exactos):

   | Campo | Tipo | Valor |
   |---|---|---|
   | `uid` | string | el UID copiado |
   | `email` | string | el correo de Rectoría |
   | `displayName` | string | `Rectoría` |
   | `role` | string | **`ADMIN`** |
   | `createdAt` | timestamp | fecha actual |

5. Listo: en la PWA, pestaña **Rectoría / Admin**, ingrese ese correo y contraseña.

**Opción B — si ya tiene una cuenta de servicio (avanzado):** el agente de
infraestructura puede crearla por API (`accounts` + documento `users/{uid}`) como se
hizo en la Ronda 33 para el proyecto de desarrollo.

> Para promover a otra persona a ADMIN en el futuro: cree su cuenta (Authentication) y
> en Firestore cambie su `users/{uid}.role` a `ADMIN` **manualmente desde la consola**.

## 7. Dar de alta a los docentes (cuentas con contraseña temporal)

Ya no se gestionan contraseñas dentro del dispositivo: cada docente tiene una
**cuenta real de Firebase Auth**.

1. Entre a la PWA como **Rectoría** → **Gestión Docentes** → **Registrar Nuevo Docente**.
2. Complete la ficha. El campo **correo institucional** es OBLIGATORIO para el acceso
   (si lo deja vacío se genera `usuario@inas.edu.co` — cámbielo por el correo real).
3. Al guardar, la app **crea la cuenta automáticamente** con la clave temporal
   `Docente####*` mostrada en pantalla. **Comuníquele al docente su correo y esa clave.**
4. En el **primer ingreso** del docente, el sistema le **exige** definir su propia
   contraseña (cambio obligatorio, verificado por Firebase Auth).
5. Si un docente olvida su clave: su tarjeta en Gestión Docentes → **Reset por Correo** →
   el docente recibe el enlace oficial de Firebase y define una nueva.

> Fichas creadas antes de esta versión muestran el botón **"Crear Cuenta"**: úselo para
> provisionarles su acceso real sin volver a crear la ficha.

## 8. (Opcional) Cuenta de servicio para automatización

Si desea que un agente/ script administre Firebase por API (crear cuentas, verificar):

1. Consola → ⚙️ **Configuración del proyecto** → **Cuentas de servicio**.
2. **Generar nueva clave privada** → descarga un JSON.
3. **Guárdela fuera del repositorio** (p. ej. `~/secrets/`). NUNCA la suba a Git, nunca
   la incluya en la app web, nunca la exponga en el navegador.
4. Con ella puede ejecutar: `FIREBASE_SA_PATH=~/secrets/sa.json node scripts/verify_ronda33_rules.mjs`
   (verificación completa de reglas con evidencia).

## 9. Verificación final (checklist de aceptación)

- [ ] En la PWA, **Rectoría** ingresa con correo + contraseña (NO existe usuario "admin").
- [ ] Un docente entra con su correo + clave temporal → el sistema le **exige** cambiarla →
      sale → entra con la nueva clave → el portal docente funciona.
- [ ] Un docente **no** puede entrar por la pestaña de Rectoría (mensaje "Esta cuenta no
      tiene rol de Rectoría").
- [ ] Un estudiante entra con su código + clave del reverso del carné.
- [ ] En Firebase → Authentication → Users solo existen las cuentas creadas (sin registro
      público abierto).
- [ ] Las reglas publicadas coinciden con `firestore.rules` del repositorio.
- [ ] (Opcional) `verify_ronda33_rules.mjs` termina en **0 FALLO**.

## 10. Errores comunes

| Mensaje en la app | Causa | Solución |
|---|---|---|
| `auth/operation-not-allowed` | El proveedor Correo/contraseña no está activo | Paso 3.2 |
| `auth/unauthorized-domain` | El dominio de la PWA no está autorizado | Paso 3.3 |
| `Missing or insufficient permissions` | Reglas no publicadas o base equivocada | Paso 5 (verificar base seleccionada) |
| "Esta cuenta no tiene rol de Rectoría" | La cuenta existe pero `users/{uid}.role` ≠ `ADMIN` | Paso 6 (crear/corregir el documento) |
| Docente no puede entrar en otro dispositivo | La ficha docente aún no está en ese dispositivo | Rectoría → Probar Conexión / sincronizar dispositivo |

---

## 11. Fase-2 (opcional, hardening server-side para estudiantes) — Worker + Firebase Admin

Hoy el acceso del **portal estudiante** se verifica localmente en el dispositivo
(modelo endurecido Ronda 30: el error no revela la clave, las claves nunca suben a la
nube y las reglas v2 ya niegan `students` a sesiones no-ADMIN). Para migrar esa
verificación a **server-side real** (estándar idéntico a M1/M2), la ruta diseñada es:

1. **Endpoint del Worker** (Cloudflare, el mismo que ya sincroniza datos):
   - `POST /api/auth/student` — recibe `{ schoolCode, code, accessCode }`; consulta el
     hash PBKDF2 del estudiante en D1/Firestore (vía **Firebase Admin** con la cuenta
     de servicio en un **secret del Worker**: `wrangler secret put FIREBASE_SERVICE_ACCOUNT`);
     respuesta con perfil mínimo (jamás la clave). Rate limit 5/min/IP (patrón ya
     existente en el Worker).
   - `POST /api/auth/teacher/reset` — restablecimiento administrativo vía Admin SDK
     (alternativa al enlace por correo, para docentes sin buzón real).
2. **Frontend:** sustituir la verificación local de `LoginScreen` (modo estudiante) por
   la llamada al endpoint — un solo cambio, sin modos duplicados.
3. **Requisitos de despliegue:** `CLOUDFLARE_API_TOKEN` en el entorno + secret
   `FIREBASE_SERVICE_ACCOUNT` (JSON de cuenta de servicio, fuera de Git).

> Esta fase NO se implementó en Ronda 33 por decisión técnica del agente principal:
> el entorno no tenía credenciales de Cloudflare y dejar un cliente llamando a un
> endpoint sin desplegar habría roto el acceso estudiantil en producción (Regla 6:
> jamás un flujo que no termina de punta a punta). Todo lo demás de la MISIÓN AUTH
> quedó server-side real vía Firebase Auth.
