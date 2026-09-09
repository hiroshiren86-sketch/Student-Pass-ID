# 📘 TRASPASO PARA EL AGENTE DEL MANUAL — RESUMEN DE QA + GUÍA DE IMPLEMENTACIÓN + ESPECIFICACIÓN DE PRODUCCIÓN

> **Documento de traspaso** (propietario → agente que elabora el manual oficial).
> Contiene: (A) resumen de las verificaciones/Q&A hechas, (B) referencia a la guía de implementación a futuro, (C) nota sobre auto-sync de Rectoría, y (D) **especificación de todos los secretos/claves para entrar a producción** — solo NOMBRES y función, **sin valores** (los valores viven en el paquete de credenciales gitignoreado, nunca en este repo público).
> **Origen:** sesión 08/09/2026. Estilo: para incluirlo textual o adaptado en el manual.

---

## A) RESUMEN DE VERIFICACIONES / Q&A (integrable en el manual)

Todas validadas en **navegador real contra producción** (`https://student-pass-id.pages.dev`).

1. **Flujo de sincronización del plan nube — CONFIRMADO CORRECTO.** Cuando Rectoría registra un docente (o estudiante) y esa persona entra por primera vez desde su propio teléfono, hace **automáticamente un pull por identidad**: el docente hidrata su ficha vía `linkedTeacherId`; el estudiante vía `linkedStudentCode`. Así se **descargan de la nube** su ficha y sus datos, **sin depender de Rectoría**. Y solo ven lo que su rol permite (docente: sus grados/cátedras; estudiante: solo su grado y su planilla — mínimo privilegio / Ley 1581), nunca todo el colegio.
2. **Escalabilidad (1000 estudiantes).** El catálogo se guarda en un snapshot en Cloudflare KV (con índice aparte) y el push inserta estudiantes en D1 en lotes de 50 (`batch`), así que escala bien. El límite real no es el número de estudiantes sino el **tamaño del snapshot** (KV máx. 25 MB) y sobre todo el **crecimiento de los registros de asistencia** (crecen todos los días). Con ~1000 estudiantes es muy probablemente seguro; para miles de estudiantes con meses de asistencias conviene **paginación** (hoy no pagina). En producción real la recomendación es **infraestructura privada propia** (Firestore/D1 con más capacidad) donde el catálogo viva en la nube; así 1000–10000 quedan holgados.
3. **Sincronización de Rectoría (PUSH auto / PULL manual).** Rectoría hace **PUSH automático cada 5 min** (sus cambios sí los consumen docentes y estudiantes), pero para **VER** los escaneos que generaron los demás hace **PULL manual** (Configuración → Sync y Seguridad → "Descargar"). No hay auto-pull al recargar para Rectoría. (Ver nota C.)
4. **Excusas — NO son un problema.** Viajan por un **canal aparte** del auto-sync: al radicar, el estudiante/acudiente/docente sube la excusa **al instante** vía `POST /api/excuses`. Rectoría las recibe con un **sondeo del buzón cada 30 s** (`GET /api/excuses?status=PENDIENTE`), que suena **chime** y enciende **el punto rojo** si hay nuevas → llegan **casi en tiempo real**, sin pull manual.
5. **Sincronización de los escaneos del representante — SÍ.** El representante sube cada hecho al momento, y además hay auto-sync periódico y al recargar/volver a entrar hace **pull por identidad** que le devuelve sus datos sincronizados. Ya verificado en navegador real.
6. **Eliminación de estudiantes (estado actual).** Hoy **NO** es en cascada: al pulsar "Eliminar" solo borra la ficha local; **NO** borra la cuenta de Auth, ni el doc de Firestore, ni los registros de asistencia → quedan "huérfanos". (Ver guía B para implementarlo.)

---

## B) GUÍA DE IMPLEMENTACIÓN A FUTURO — ELIMINAR ESTUDIANTE EN CASCADA

📄 **Archivo:** `docs/ESPECIFICACION_ELIMINAR_ESTUDIANTE_CASCADA.md` (ya creado, se entrega junto a este traspaso).

Resumen de lo que pide (para que el manual lo mencione como visión a futuro):
- Al pulsar **"Eliminar"** (engranaje ⚙ → fila del estudiante, en Rectoría → Directorio), añadir **cartel de confirmación en dos niveles** con el aviso: *"Se eliminará permanentemente tanto de la base de datos como de la nube (Firebase Auth + Firestore)"* + botón "Eliminar definitivamente" (solo si el estudiante tiene cuenta `hasFirebaseAccount`).
- Ejecutar la **cascada**: borrar ficha local + doc `users/{uid}` + **cuenta de Firebase Auth** (requiere endpoint/Worker o Cloud Function con la cuenta de servicio Admin; el navegador NO puede borrar cuentas de Auth) + **anonimizar** los registros de asistencia (Ley 1581) + **PUSH** para que la nube deje de devolverlo.
- **Estado:** propuesta, **NO implementado**. Depende de la decisión del propietario.

---

## C) NOTA — AUTO-PULL DE RECTORÍA (depende del futuro)

- **Qué sería:** hacer que Rectoría también haga **auto-pull** (no destructivo) para ver los escaneos de docentes/estudiantes sin el pull manual actual.
- **Dependencia explícita del propietario:** esto es una **implementación de futuro**, **solo si el proyecto sale ganador**; y además **si la institución adopta su propia infraestructura** (comprar/alquilar servidores o servicio cloud), porque hoy el prototipo corre en plan de costo cero (Cloudflare gratis + Firebase free tier).
- **En el manual:** declararlo como "mejora futura / roadmap", NO como función actual.

---

## D) ESPECIFICACIÓN DE SECRETOS Y CLAVES PARA ENTRAR A PRODUCCIÓN

> ⚠️ Aquí SOLO se listan **nombres** y **función**. **Los valores NUNCA van en el repo público** (están en el paquete de credenciales gitignoreado y en secretos del Worker).
> Objetivo: que quien vaya a producción sepa **qué** configurar y **cuáles rotar**.

### D.1 — Secretos del Worker de Cloudflare (configurados vía `wrangler secret put <NOMBRE>`)
| Secret | Función | ¿Rotar en producción? |
|---|---|---|
| `AUTH_TOKEN` | Autoriza terminales de Rectoría (escribe catálogo + hechos). | ✅ sí |
| `OPERATOR_TOKEN` | Autoriza a docentes/acudientes (solo hechos/asistencia). | ✅ sí |
| `FIREBASE_SA_CLIENT_EMAIL` | Email de la cuenta de servicio (identidad de Firestore/Auth). | ✅ sí (junto a la SA) |
| `FIREBASE_SA_PRIVATE_KEY` | Llave privada de la SA (lee rol, verifica/escribe Firestore). | ✅ sí |
| `EXCUSE_CHAIN_SECRET` | Firma las excusas (HMAC de la cadena). | ✅ sí |
| `EXCUSE_ATTACHMENT_SECRET` | Cifra/descifra los adjuntos (soporte fotográfico, Ley 1581). | ✅ sí |
| `VAPID_PRIVATE_KEY` | Firma de notificaciones Push (Web Push). | ❌ **NO cambiar** (ver D.4) |
| `VAPID_PUBLIC_KEY` | Clave pública P-256 de las notificaciones Push. | ✅ rotable / sí |
| `VAPID_SUBJECT` | Identificador del remitente de notificaciones Push. | ✅ sí / editable |
| `EXCUSE_AUTO_APPROVE_HOURS` | Horas para la auto-aprobación de excusas (config). | ✅ sí (revisar valor) |
| `EXCUSE_RETENTION_MONTHS` | Meses de retención de excusas (config, Ley 1581). | ✅ sí (revisar valor) |

### D.2 — Vars no-secretas del Worker (`wrangler.toml → [vars]`)
| Var | Función | Nota |
|---|---|---|
| `SCHOOL_CODE` | Código institucional (`INAS-ANTONIA-SANTOS-2026`). | revisar por institución |
| `SCHOOL_NAME` | Nombre del colegio. | revisar por institución |
| `FIREBASE_PROJECT_ID` | ID del proyecto Firebase. | **vinculado** a la cuenta |
| `FIREBASE_DB_ID` | ID de la base Firestore nombrada. | **vinculado** a la cuenta |

### D.3 — Config del cliente (frontend, `firebase-applet-config.json`) + credenciales
| Elemento | Función | ¿Rotar en producción? |
|---|---|---|
| `apiKey`, `appId`, `authDomain`, `storageBucket`, `messagingSenderId`, `measurementId`, `projectId` | Config de Firebase Web. | ✅ sí (clave API de la web) |
| `firestoreDatabaseId` | Base nombrada de Firestore. | ✅ revisar |
| `oAuthClientId` | Cliente OAuth. | ✅ revisar |
| `recaptchaSiteKey` | (opcional) App Check / reCAPTCHA; hoy vacío. | ✅ si se activa |
| Cuenta de servicio JSON (`.firebase-sa.json`: `project_id`, `client_email`, `private_key`, `private_key_id`, …) | Admin para Firestore/Auth server-side. | ✅ **rotación total** |
| Contraseñas de usuarios (Rectoría, docentes, estudiantes) | Acceso de cada rol. | ✅ **rotación total** |
| Secretos de `.env` del entorno local (varios ya definidos) | Para ejecutar/tests locales. | ✅ revisar |

### D.4 — ⚠️ NOTA DEL PROPIETARIO (funciona como desarrollador, no como propietario) — VAPID
> **Este es el ÚNICO secreto que NO debe cambiarse.**
> La `VAPID_PRIVATE_KEY` **ya está subida en el Worker y funcionando** (las notificaciones Push envían bien). Su **valor se perdió** ("se nos olvidó": ni el propietario ni este agente lo tienen, y es **write-only** — no se puede leer de vuelta del dashboard). La `VAPID_PUBLIC_KEY` **sí la conoce el propietario** (es pública, no es secreta).
> **Conclusión:** **NO rotar `VAPID_PRIVATE_KEY`** — si se cambia, se rompe el envío de notificaciones Push y habría que re-suscribir todos los dispositivos. Es el único secreto que queda intocable.
> **Los demás secretos y contraseñas sí deben rotar de forma total** antes de producción real.

### D.5 — Licencia del contenido (nota)
Los secretos de **IA (Groq/Mistral/OpenRouter/etc.) se eliminaron** del Worker el 01/09/2026 (migración a IA local BYOK con clave del usuario) — no recrear secrets de IA en el Worker. Hoy el sistema NO depende de una clave de IA embebida.

---

## Cómo usarlo
- **Integrar la sección A** en el manual (sección "Cómo funciona la sincronización / roles").
- **Integrar la sección B** como "Roadmap / visión a futuro" (o adjuntar el archivo de especificación).
- **Integrar la sección C** como "Mejora futura: auto-pull de Rectoría (condicionada)".
- **Integrar la sección D** como "Checklist de configuración de producción / secretos", **siempre sin valores**.

**Recordatorio de seguridad:** este documento está pensado para el repo **público**. **Nunca** pegar aquí valores reales (ni en commits, ni en el manual si este va a GitHub). Los valores van solo en `scripts/credenciales/` (gitignoreado) y en secretos del Worker.
