# 🧭 Estrategia — Acceso a la Nube por IDENTIDAD Y ROL (cerrar el dilema del token por persona)

> **Fecha:** 07/09/2026 · Autores de esta ronda (Fase 2). Este documento **diseña la estrategia** pedida por el propietario; **NO está implementado**. Es el plano para la fase siguiente y reemplaza a la idea de "repartir tokens a cada maestro".

---

## 1. La visión del propietario (objetivo real)

> *"Cualquier teléfono con una cuenta registrada (con sus permisos) pueda acceder a la nube. El representante lleva su teléfono, el docente su teléfono. Rectoría tiene su computador como cuenta de mando. Un solo centro de mando provee acceso a la nube con los permisos correspondientes — p. ej. los profesores ven las planillas que Rectoría actualiza, o ven los estudiantes escaneados hace 10 minutos. No en tiempo real exacto, pero sí cerca."*

Traducción técnica del objetivo:
1. **Acceso por identidad y rol**, no por token de dispositivo.
2. **Lectura por rol** desde la nube (los profes ven lo que Rectoría actualizó → planillas, matrícula).
3. **Escritura por rol** (representante/docente escriben asistencia; solo Rectoría escribe catálogo).
4. **Cerca de tiempo real** (sincronización al entrar la app + periódica corta, no un push manual).

---

## 2. El modelo ACTUAL y por qué choca con la visión (diagnóstico honesto)

| Aspecto | Modelo actual (Fase 1–2) | Visión del propietario |
|---|---|---|
| **Qué identifica a un terminal** | Un **token fijo por dispositivo** (`AUTH_TOKEN`/`OPERATOR_TOKEN` pegado en Ajustes) | La **cuenta logueada** (Firebase) del usuario |
| **Quién toca la nube** | El **dispositivo**, sin importar quién lo usa | El **usuario**, según su rol |
| **Qué puede leer/escribir** | Catálogo+hechos (ADMIN) o solo hechos (OPERATOR), definido por el token del aparato | Leer/escribir **según el rol** del usuario |
| **Tiempo** | Pull/Push **manual** o auto-sync cada 5 min | Sincronización al **entrar** + autosync corto (**cerca de tiempo real**) |
| **Matrícula/docentes** | Bajan por Pull al dispositivo | Los profes los **ven desde la nube** (pero se cachean offline) |
| **Secreto compartido** | Hay que **entregar el token** al usuario (papel/WhatsApp) | **NO se reparte nada**: tu propia cuenta es tu credencial |

**Conclusión del diagnóstico:** la app se construyó **offline-first por terminal** (fortaleza: funciona sin red). La visión exige **identidad/rol por usuario con lectura nube**. Son dos capas distintas que **pueden convivir** — el diseño correcto es **mantener offline-first como red de seguridad** y **añadir acceso identitario a la nube** (el "pull por rol" y el "push por rol"). No hay que tirar lo construido; hay que **elevar el Worker y el cliente** para autenticar por identidad.

---

## 3. Qué resuelve y qué **NO** se necesita

`❌` **NO se reparten tokens en papel/WhatsApp.** La visión se logra mejor si el token compartido desaparece del flujo humano: cada usuario entra con su cuenta Firebase (que ya existe) y **su identidad ES su credencial**.

`❌` **NO cambia a R2.** Esto es acceso/auth, no respaldo.

`✅` **SÍ se resuelve el dilema** de "quién le pone el token a cada maestro": nadie. Rectoría ya **crea** las cuentas (M2). Con identidad, el rol viaja con la cuenta.

---

## 4. Arquitectura objetivo (acceso identitario a la nube)

```
┌─ Cliente (cualquier teléfono) ───────────────────────────────────┐
│  Login Firebase → obtiene ID token (con claims de rol).          │
│  Al abrir la app / entrar: pull por rol → cache local (offline). │
│  Al escanear: push de hechos con ID token (atribuido al usuario).│
└──────────────┬───────────────────────────────────────────────────┘
               │  Authorization: Bearer <Firebase ID token>
               ▼
┌─ Cloudflare Worker ─────────────────────────────────────────────┐
│  1. Verifica el ID token (firma RS256 + aud + iss + exp).        │
│  2. Lee el ROL del usuario (claim o profile).                    │
│  3. Autoriza por rol en cada endpoint:                           │
│     • GET /pull?role=…  →  devuelve SOLO lo que ese rol ve.      │
│     • POST /push       →  escribe hechos; el catálogo solo Admin.│
└──────────────┬───────────────────────────────────────────────────┘
               ▼
        D1 (verdad) + KV (caché sub-20ms) + Firestore (perfil/rol)
```

### 4.1 Cómo confía el Worker en el rol (2 caminos verificables)

**Opción A — claims en el Custom Token (recomendada, más limpia en el edge).**
Al crear la cuenta (Rectoría, docente, acudiente) el sistema acuña un Firebase **custom token** con `role`, `linkedTeacherId`, `linkedStudentCode`. El Worker **verifica** el ID token (JWKS público de Google, `jose`/WebCrypto) y lee el `role` del claim **sin consultar Firestore** en cada petición. Rápido, sin latencia de base de datos.

**Opción B — el Worker lee el perfil en Firestore.**
El Worker verifica el ID token (obtiene `sub`=UID) y luego lee `users/{uid}.role` vía la cuenta de servicio. Más simple de montar, pero agrega una llamada a Firestore por petición (latencia y dependencia de la SA en el edge).

> **Ambas usan la cuenta de servicio para acuñar/leer.** La regla #7 del repo prohíbe *impersonación* y *creación de cuentas admin* con la SA; **acuñar un custom token para un usuario real con su rol legítimo no es impersonación ni escalada** (es el token de inicio de sesión de ese usuario). Aun así, **requiere el OK explícito del propietario** antes de tocar la SA para esto.

### 4.2 Matriz de permisos por rol (decisión clave a fijar)

| Rol | Leer (Pull) | Escribir hechos (asistencia) | Escribir catálogo |
|---|---|---|---|
| **ADMIN / Rectoría** | Todo | Sí | **Sí** (único) |
| **DOCENTE** | Sus grados/cátedras + planillas de sus cursos | Sí (sus cursos) | No |
| **REPRESENTANTE / acudiente** | Sus estudiantes vinculados + su planilla | Sí (su grado, como autoridad de escaneo) | No |

> ⚠️ El punto de autorización **más delicado es "¿quién puede escribir asistencia de quién?"** — un representante escanea a sus compañeros. Debe ser por **grado** (el representante es autoridad de escaneo de su grado), jamás a otro grado, jamás a otro colegio. Fijamos esta matriz explícita antes de codificar.

### 4.3 "Cerca de tiempo real"

- **Al entrar la app:** pull por rol (fresco).
- **Autosync corto** (p. ej. 60 s, igual que el sondeo de excusas, o al volver a primer plano `visibilitychange`) mientras la pestaña está abierta.
- Offline-first queda como red de seguridad: si no hay red, la última caché local se muestra y se re-sincroniza al reconectar.

---

## 5. Plan de implementación por fases (esfuerzo y riesgo REALES)

> ⚠️ **Honestidad:** esto **toca el Worker + autenticación + cliente** y es sensible (datos de menores, Ley 1581, mínimo privilegio). Es **el frente más grande y más delicado** de todos los pendientes. No es un parche de una tarde, pero es **la pieza que materializa tu visión**. Por eso va en fases, cada una con `tsc` + build + suites + verificación en vivo antes de avanzar.

| Fase | Qué entrega | Esfuerzo | Riesgo | Nota |
|---|---|---|---|---|
| **F1 — Pull por rol (lectura)** | El Worker verifica el ID token y filtra el `pull` por rol. Los profes/representantes **ven** la matrícula y las planillas que Rectoría actualizó, desde cualquier teléfono con su cuenta. | Medio | **Bajo** (es lectura; el catálogo no se modifica) | **La más valiosa y la más segura de arrancar. Aquí se resuelve el 80% de tu visión.** |
| **F2 — Push por rol (escritura)** | Representante/docente escriben hechos con su identidad; atribución y merge por `updatedAt`. El catálogo sigue siendo solo Rectoría. | Medio-Alto | Alto (autorización fina de "quién escribe de quién") | Requiere fijar la matriz §4.2 y probar mucho. |
| **F3 — Autosync corto / near-real-time** | Sincronización al entrar + autosync 60 s + al volver a foco. | Bajo | Bajo | Encima de F1+F2. |
| **F4 — Retiro gradual del token compartido** | El flujo por identidad se vuelve el camino único; el token fijo queda como fallback de emergencia. | Bajo | Medio | Requiere migrar dispositivos existentes. |

**Orden recomendado:** F1 (alto valor/bajo riesgo) → F3 (junto a F1, barato) → F2 (el delicado) → F4 (limpieza).

---

## 6. Salvaguardas innegociables (Ley 1581 y reglas del repo)

1. **Mínimo privilegio:** cada rol ve/escribe solo lo suyo. Un docente no lee la planilla de otro grado; un acudiente no ve a otro estudiante. Nunca se filtra asistencia ajena.
2. **Ley 1581 (menores / dato de salud):** el motivo de excusa y el soporte fotográfico siguen siendo accesibles **solo** para Rectoría y el titular; la planilla nunca los muestra (intacto de la Ronda 21).
3. **Regla #7 (SA):** **no impersonación, no escalada, no crear admins.** Acuñar custom tokens para usuarios reales con su rol legítimo **requiere tu OK escrito** antes de tocarlo.
4. **Offline-first intacto:** si no hay red, la app sigue funcionando con la caché local; la nube es la verdad cuando hay conexión.
5. **Cero regresiones** en la Fase 1/2 ya desplegada (catálogo Rectoría-write-only, merge de hechos, `device_sync_log`).
6. **Sin secretos en la nube** (política `safeSettingsCopy` / `saveSchoolSettings`).

---

## 7. Decisiones que te pido como propietario

1. **¿Aprobamos esta dirección?** (identidad/rol en la nube, vía Firebase ID token que verifica el Worker). Es la forma correcta de lograr tu visión.
2. **¿Autorizamos usar la cuenta de servicio para acuñar/leer el rol** (Opción A o B de §4.1)? — respetando la regla #7 (nada de impersonación/escalada).
3. **Fijar la matriz del §4.2** (sobre todo "¿un representante puede escribir asistencia de su grado?").
4. **¿Arrancamos por F1** (Pull por rol — lo más valioso y seguro) o prefieres una prioridad distinta?

---

## 8. Resumen de una frase

> **Hoy** la nube se autentica por **token de dispositivo** (por eso choca con "cada uno con su teléfono"). **La estrategia** es migrar a **identidad + rol de Firebase** verificada por el Worker: así **cualquier cuenta con permisos** accede desde cualquier teléfono, **Rectoría es el único que escribe el catálogo**, los profes ven las planillas actualizadas, y **nadie tiene que repartir tokens** — **sin exponer secretos y sin romper el offline-first.**
