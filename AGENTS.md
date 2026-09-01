# Manual Técnico, Convenciones y Bitácora de Desarrollo
## Sistema de Control de Asistencia Escolar y Carnetización Criptográfica (INAS)

Este documento es la **fuente única de verdad técnica (Single Source of Truth)** del proyecto. Define las reglas obligatorias de desarrollo, la arquitectura, el registro de correcciones y decisiones técnicas, así como la hoja de ruta por fases.

---

## 📌 1. Reglas Obligatorias de Desarrollo

1. **Regla de Estabilización Previa (Cero Regresiones):**
   - Siempre se debe verificar y asegurar el correcto funcionamiento del 100% de las características anteriores antes de agregar nuevas funciones.
   - Si se detecta un fallo, bug o inconsistencia en una fase previa, se detiene la adición de nuevas pantallas hasta corregirlo y validar con `lint_applet` y `compile_applet`.
2. **Regla de Documentación Oficial (Cero Suposiciones):**
   - Para cualquier integración interna o externa (Cloudflare D1/KV, WebCrypto, Web Audio, jsQR, pdf-lib, REST APIs de IA), se debe consultar e implementar estrictamente bajo la documentación oficial. Prohibido asumir esquemas, parámetros o comportamientos no verificados.
3. **Regla de Bitácora Continua en `AGENTS.md`:**
   - Todo cambio significativo, corrección de bug, optimización o decisión técnica debe quedar registrado en este archivo de forma directa, concisa y explicando el **por qué** técnico de la decisión.
4. **Regla de Seguimiento Obligatorio de Informes de Revisión de Errores:**
   - Cada informe de seguridad o comprobación de errores suministrado por la auditoría técnica debe ser ingresado íntegramente en la bitácora de este archivo. Conforme se solucionen y validen los fallos detectados, las partes correspondientes serán tachadas (`~~punto solucionado~~`) indicando la corrección técnica realizada.
5. **Regla de Desarrollo Modular y Fases Verificables:**
   - La construcción se realiza por módulos auto-contenidos, testeados en entorno escolar y listos para transición directa a semiproducción y producción real.

---

## 🏛️ 2. Arquitectura del Sistema

El sistema implementa una arquitectura híbrida de alta resiliencia y **Costo Cero ($0 Inicial)**:

- **Frontend / Cliente (React 19 + TypeScript + Tailwind CSS v4 + Vite):**
  - **Captura Ultrarrápida (<0.5s):** Soporte dual para escáneres de código de barras/QR USB HID (lectura ráfaga por teclado sin clic) y cámara web/móvil con `jsQR`.
  - **Criptografía Determinista:** Generación y verificación de tokens QR con firma `HMAC-SHA256` mediante `WebCrypto API` en el navegador (previene duplicación y falsificación de carnés).
  - **Audio Sintetizado:** Web Audio API puro (oscilador senoidal con envolvente gain) para feedback sonoro sin latencia de red ni archivos pesados.
  - **Persistencia Local y Resiliencia:** `LocalStorage` con respaldo automático y sincronización en segundo plano.
- **Backend Edge / Nube (Cloudflare Worker Unificado):**
  - **Base de Datos Relacional (Cloudflare D1 - SQLite Edge):** Almacena tablas de estudiantes, registros de asistencia, horarios, docentes y auditoría.
  - **Caché Clave-Valor (Cloudflare KV):** Acceso y validación de carnés en <20ms para porterías de alto tráfico.
  - **Proxy de Inteligencia Artificial:** Punto de enlace seguro para modelos de lenguaje (Groq Llama 3.3, Mistral Small, Google Gemini, OpenAI) protegiendo las credenciales institucionales.
- **Modo Híbrido de IA (BYOK o Proxy):**
  - Permite al usuario/docente usar su propia API Key directamente en el navegador (sin servidores intermediarios) O consumir el Worker central institucional sin exponer llaves privadas.

---

## 📋 3. Bitácora de Implementaciones y Correcciones Realizadas

### ✅ Fase 1: Núcleo de Portería, Criptografía y Gestión Escolar (Completada)
- **Lector USB HID y Prevención de Teclado Virtual en Móviles:**
  - *Motivo:* Al conectar lectores de código de barras OTG/Bluetooth en celulares, el teclado táctil de Android/iOS tapaba la pantalla de escaneo. Se solucionó con `inputMode="none"` y foco no invasivo.
- **Validación Criptográfica HMAC-SHA256:**
  - *Motivo:* Evitar que los estudiantes generen códigos QR falsos con su documento. El carné contiene una firma digital cifrada con la clave secreta institucional.
- **Carga Masiva e Importación de Estudiantes (JSON / CSV):**
  - *Motivo:* Los colegios manejan planillas con diversos encabezados (`identificacion`, `documentId`, `curso`, `grado`). Se normalizaron expresiones regulares para grados (`6°1`, `10°4`, `Transición`) y mapeo inteligente de columnas.
- **Planilla de Asistencia, Auto-Cierre y Filtros:**
  - *Motivo:* Se corrigió la asignación visual para que los estudiantes marcados como `AUSENTE` (incluyendo cierre automático de jornada) aparezcan con su badge rojo distintivo y no se confundan con tardanzas. Se añadió filtro de inasistencias y exportación fiel a CSV/Excel.
- **Impresión de Carnés Escolares (Estándar CR80):**
  - *Motivo:* Se eliminó la duplicación del texto "Documento de Identidad" en la previsualización y en el motor PDF (`pdf-lib`), logrando medidas milimétricas estándar de tarjeta PVC.
- **Cámara y Selector Multi-dispositivo:**
  - *Motivo:* Se optimizó el cambio de cámara (frontal/trasera/externa) asegurando que el stream anterior libere los tracks de video antes de iniciar el nuevo sensor.
- **Borrado en Cascada y Seguridad de Datos:**
  - *Motivo:* Al eliminar un estudiante, se limpian automáticamente delegaciones de representación, asistencias y se generan copias preventivas antes de resetear a datos demo.

### ✅ Fase 2: Arquitectura Cloudflare Worker (D1 + KV + AI Proxy) y Estabilización (Completada y Lista)
- **Creación de la suite `/cloudflare-worker/`:**
  - `wrangler.toml`: Configuración de bindings para D1 (`DB` = `c577c8b3-6f07-4a63-8671-f447871325d6`), KV (`ATTENDANCE_KV` = `3b249fb9b0014f918680646a5ae869f6`), variables de colegio y secretos.
  - `schema.sql`: Esquema D1 completo con tablas relacionales e índices para estudiantes, asistencias, horarios, docentes, excusas y snapshots.
  - `src/index.ts`: Worker TypeScript unificado que atiende `/api/health`, `/api/ai/status`, `/api/ai/models`, `/api/sync/push`, `/api/sync/pull`, `/api/attendance` y `/api/ai/grade-summary`.
- **Integración y Resiliencia en Frontend (`SettingsModal.tsx`, `cloudflareSync.ts` & `firebase.ts`):**
  - **Persistencia en la Nube con Firestore (`school_settings/main` y `users/{uid}`):** Al limpiar la caché del navegador o iniciar sesión desde cualquier dispositivo o celular de portería, la configuración institucional y la URL del Worker de Cloudflare se recuperan automáticamente desde Firebase Firestore en tiempo real.
  - **Resolución de Error 405 en Módulo de IA (`AiService.ts`):** Se implementó una arquitectura de cuatro niveles de redundancia para análisis de IA:
    1. *Nivel 1:* Cloudflare Worker Edge institucional (`https://inas-attendance-worker.hiroshiren86.workers.dev`).
    2. *Nivel 2:* Servidor Local Express con soporte para todas las rutas y métodos HTTP.
    3. *Nivel 3:* Cliente Directo BYOK (Groq, Mistral, OpenRouter, Google Gemini, OpenAI).
    4. *Nivel 4:* Motor Analítico Heurístico Local determinista ($0, cero fallos y respuesta en milisegundos).
  - **Manejo Resiliente de Modelos de IA y Corrección de Error 404 (Model Not Found):**
    - *Motivo:* Si una clave o cuenta no tiene habilitado un modelo específico (ej. `llama-3.3-70b-versatile` en cuentas sin acceso a 70B en Groq), el servidor y Worker ahora ejecutan un bucle de reintento automático de modelos (`llama-3.1-8b-instant`, `llama3-70b-8192`, `mixtral-8x7b-32768`, etc.). Si todos fallan por credenciales o cuota, el sistema activa automáticamente el motor analítico determinista local garantizando 100% de disponibilidad sin errores en la interfaz.
  - **Actualización del Catálogo Oficial de Modelos de IA (Agosto 2026):**
    - *Motivo:* Groq retiró de sus planes de desarrollador/gratuitos el identificador `llama-3.3-70b-versatile` el 16 de agosto de 2026 para migrar a su nueva generación de hardware LPU. Se actualizó el catálogo predeterminado de Groq hacia los modelos insignia activos: `openai/gpt-oss-120b`, `groq/compound`, `qwen/qwen3.6-27b`, `llama-3.1-8b-instant`, `openai/gpt-oss-20b` y `groq/compound-mini`. Se mantuvieron sincronizados los catálogos en vivo y curados para Mistral (`mistral-small-latest`, `pixtral-12b-2409`), Gemini (`gemini-2.5-flash`), OpenRouter (`meta-llama/llama-3.3-70b-instruct`) y OpenAI (`gpt-4o-mini`).
  - Botón **"Probar Conexión"**: Realiza ping a `/api/health` para validar el estado del Worker y las bases D1/KV.
  - Botón **"Descargar (Pull)"**: Sincroniza y descarga datos desde Cloudflare hacia nuevos terminales o celulares en portería.
  - Botón **"Sincronizar (Push)"**: Envía datos locales a D1 y actualiza la caché KV de alta velocidad.
  - Auto-sincronización periódica configurable por minutos.

### 🔍 Informe de Revisión y Manejo de Errores (Auditoría Técnica - 31/08/2026)

- ~~**E1 — Retiro del Modelo `llama-3.3-70b-versatile`:** Groq retiró el modelo el 16 de agosto de 2026. *Solución:* Se actualizó el modelo por defecto en `wrangler.toml`, `server.ts` y `aiService.ts` a `openai/gpt-oss-120b` y `groq/compound` (Corregido y Validado).~~
- ~~**E2 — Soporte de CORS y Rutas en Worker:** *Solución:* Se integraron encabezados OPTIONS y middleware en `/cloudflare-worker/src/index.ts` (Corregido y Validado).~~
- ~~**E3 — Foco No Invasivo e `inputMode="none"`:** Evita despliegue no deseado de teclado virtual en Android/iOS con escáneres USB HID/OTG (Corregido y Validado).~~
- ~~**E4 — Cierre de Streams de Cámara:** Garantiza que la cámara web o trasera libere los recursos del sensor al cambiar de dispositivo (Corregido y Validado).~~
- ~~**E5 — Fallback Redundante en 4 Niveles de IA:** Si falla el Worker Edge, la llamada conmuta automáticamente a Servidor Local -> Cliente BYOK -> Motor Determinista Local ($0) sin errores visibles (Corregido y Validado).~~
- **E6 — Error Groq 403 (REABIERTO por auditoría Super Z 01/09/2026):** El 403 de Groq NO era la clave ni los encabezados: **Groq bloquea el egreso de datacenters, incluido Cloudflare Workers**. Evidencia: (a) `api.groq.com/openai/v1/models` responde `403 {"error":{"message":"Forbidden"}}` idéntico con clave real, clave falsa y SIN clave (filtro por IP, no por autenticación); (b) `/api/ai/models` vía Worker cae al catálogo curado tanto con la clave del usuario como con la clave interna del Worker; (c) reportes públicos de bloqueos de LLM al egreso de COLOs de Workers (community.cloudflare.com). La IP residencial del navegador SÍ pasa. *Solución:* cadena reordenada a **Cliente Directo BYOK primero** (`aiService.generateGradeSummary`), Worker/Servidor Local aceptados solo si devuelven IA real, y resultado simulado siempre etiquetado. (Corregido en frontend; validación end-to-end de IA real pendiente desde la red residencial del usuario).
- **E7 — Catálogo Dinámico de Modelos (parcial):** El catálogo en vivo funciona desde el navegador (BYOK, `fetchDirectProviderModels`) y para proveedores que no bloquean el Worker; para Groq vía Worker el fetch en vivo muere por el bloqueo de IP (ver E6) y cae al catálogo curado. (Limitación documentada; no es corregible por código).
- ~~**E8 — Crash del Módulo de Análisis IA al Hacer Scroll:** *Solución:* Se corrigieron los hooks de renderizado y estructuras flexbox/overflow en `GradeAiSummaryView.tsx` (Corregido y Validado).~~
- ~~**E9 — Transmisión Segura de API Keys (Headers vs URL):** *Solución:* Se eliminó el parámetro `?apiKey=` en la URL. Las API keys ahora se transmiten de forma segura en los encabezados HTTP (`x-api-key` / `x-provider-key`) tanto en el Worker Edge como en el servidor Express (Corregido y Validado).~~
- ~~**E10 — Cierre de Modal de Ajustes con Tecla Escape:** *Solución:* Se añadió listener de teclado `KeyboardEvent` en `SettingsModal.tsx` para cerrar el modal al presionar Escape (Corregido y Validado).~~
- ~~**E11 — Etiqueta "Gemini" Obsoleta en Interfaz:** *Solución:* Se reemplazaron referencias fijas a Gemini en los estados de carga por descripciones agnósticas y dinámicas según el proveedor activo (Corregido y Validado).~~
- ~~**N1 a N6 — Seguridad, Criptografía HMAC-SHA256 y Resiliencia en D1/KV:** Verificación y validación de tokens de carné y base de datos (Corregido y Validado).~~
- ~~**N7 — Notificación Falsa de Sincronización:** *Solución:* Se corrigió `performCloudflareSync()` en `cloudflareSync.ts` para que si falla la comunicación con la URL del Worker configurada, retorne `success: false` con el mensaje de error explícito (Corregido y Validado).~~
- ~~**N8 — Manejo de `localStorage` Corrupto:** *Solución:* `AttendanceStorageService.getStudents()` detecta JSON malformado o corrupto, crea un respaldo automático `_corrupt_backup_...` y autorrecupera los datos demo iniciales (Corregido y Validado).~~
- ~~**N9 — Persistencia Inmediata de Configuración de Worker:** *Solución:* `SettingsModal.tsx` guarda inmediatamente en `localStorage` la URL del Worker y el Token antes de ejecutar las acciones de prueba o descarga (Corregido y Validado).~~
- ~~**N10 — Firma Criptográfica Determinista:** Carnés con firma digital HMAC inviolable (Corregido y Validado).~~

### 🔬 Auditoría Super Z (01/09/2026) — Causa raíz de "los análisis de IA se quedan estáticos"

**Diagnóstico:** el Worker, al fallar contra Groq (bloqueo de IP, ver E6), respondía `HTTP 200 + success:true + isSimulated:true + provider:worker-local-engine` con texto genérico; el frontend aceptaba esa respuesta como éxito en `generateGradeSummary` y **cortaba la cadena antes de llegar al cliente directo BYOK** — la clave válida del usuario jamás se usaba. Además `GradeAiSummaryView` nunca mostraba el flag `isSimulated`, así que el texto de relleno se veía como IA real.

- ~~**E12 — Cadena de resiliencia bloqueada por éxito fingido:** Se reordenó la cadena a Cliente Directo BYOK (primero, IP residencial) -> Worker (solo si IA real) -> Servidor Local (solo si IA real) -> Motor Local; un `isSimulated:true` de un servidor ya NO termina la cadena. Cada nivel fallido se registra en `simulatedReason`. (Corregido en `aiService.ts`; validado con `tsc --noEmit` + `vite build`).~~
- **E13 — Transparencia del motor de contingencia del Worker:** (Histórico) El worker llegó a incluir `simulatedReason` (error real del proveedor, truncado a 300 chars) en su respuesta de contingencia. **Obsoleto desde la Ronda 3 (01/09/2026):** el deploy de producción retiró la IA del Worker por completo (stub 410 en `/api/ai/*`); la transparencia ahora vive en el frontend (Motor Determinista Local siempre etiquetado con `simulatedReason`).
- ~~**E14 — Banner de verdad en la UI de análisis:** `GradeAiSummaryView` muestra un banner ámbar "Análisis generado por el Motor Local (sin IA real)" con el motivo cuando `isSimulated:true`, y las etiquetas obsoletas ('Groq Llama 3.3 Ultra-Fast', 'OpenAI GPT-4o', 'modelos Llama 3.3') se actualizaron a denominaciones vigentes. (Corregido y Validado con `tsc --noEmit` + `vite build`).~~
- **Nota operativa (ACTUALIZADA 01/09/2026, ver Ronda 3):** el secreto `GROQ_API_KEY` fue **ELIMINADO del dashboard** del Worker (residuo de la arquitectura antigua; eliminación vía API con token del propietario). El Worker quedó sin secrets. Sigue sin `AUTH_TOKEN` (acceso abierto — configurarlo sin coordinar rompería el sync de los dispositivos desplegados; decisión pendiente del propietario).

### 🏠 Decisión de Arquitectura: IA 100% Local BYOK (01/09/2026)

**Decisión del propietario:** eliminar la integración de IA del Cloudflare Worker; la IA se ejecuta exclusivamente en el navegador con la clave API del administrador (BYOK). Motivo técnico validado: los proveedores (Groq) bloquean el egreso de datacenters (403 desde Cloudflare Workers, ver E6), mientras que la IP residencial del navegador es aceptada — comprobado por el propio propietario al configurar su clave en la cuenta de administración y obtener IA real.

- **E15 — Retiro total del proxy IA del Worker (CORREGIDO y VALIDADO):**
  - `cloudflare-worker/src/index.ts`: eliminadas las rutas `/api/ai/status`, `/api/ai/models` y `/api/ai/grade-summary` (incluido el motor simulado `worker-local-engine` y la lectura de secrets IA). Stub `410 {code:'AI_REMOVED_FROM_WORKER'}` para clientes antiguos en caché. `/api/health` ahora reporta `ai.mode: 'client-side-byok'`. El `Env` ya no declara `DEFAULT_AI_PROVIDER/MODEL` ni secrets de proveedores. Rutas de datos (`/api/sync/push`, `/api/sync/pull`, `/api/attendance`, `verifyAuth`, CORS) intactas.
  - `cloudflare-worker/wrangler.toml`: retiradas `DEFAULT_AI_PROVIDER`/`DEFAULT_AI_MODEL`; nota sobre secrets IA obsoletos (pueden borrarse del dashboard: `GROQ_API_KEY`, `MISTRAL_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`).
  - `aiService.ts`: cadena simplificada a **2 niveles**: Cliente Directo BYOK (única IA real, clave solo en header hacia el proveedor) → Motor Determinista Local (único fallback, siempre etiquetado `isSimulated:true` + `simulatedReason`). Ya no se envían claves a ningún servidor intermediario (cierra el vector S1 por construcción). `getAvailableModels` ahora es directo→curado.
  - Catálogos alineados con docs oficiales (cero suposiciones): retirados `llama-3.1-8b-instant` (deprecado por Groq el 17/06/2026), `llama-3.2-11b-vision-preview`, `deepseek-r1-distill-llama-70b`, `qwen/qwen3.8-27b`, `pixtral-12b-2409`, `open-mistral-nemo`, `google/gemini-2.0-flash-001` (inexistente en OpenRouter), `gpt-4o`/`gpt-4o-mini`/`o3-mini` (retirados por OpenAI), `gemini-1.5-flash`. Añadidos `gpt-4.1`/`gpt-4.1-mini`. Catálogo Groq vigente: `openai/gpt-oss-120b` (flagship), `groq/compound`, `qwen/qwen3.6-27b`, `openai/gpt-oss-20b`, `groq/compound-mini`.
  - `SettingsModal.tsx`: la sección IA aclara "IA 100% local (BYOK)"; la sección Cloudflare Worker queda exclusivamente para sincronización de datos (D1/KV).
  - `mockData.ts`: modelo demo por defecto `llama-3.3-70b-versatile` (retirado) → `openai/gpt-oss-120b`.
  - Validación: `tsc` worker limpio; `tsc` frontend con los 9 errores pre-existentes documentados (cero nuevos); `vite build` OK; bundle sin rutas IA de servidor y con llamada directa a proveedores.
- **E16 — Hallazgo (RESUELTO en la Ronda 2, ver abajo):** `DocumentUploadModal.tsx` invocaba `/api/ai/vision-extract` (ruta relativa al server.ts Express local, solo disponible en desarrollo). En producción esa ruta no existía y el fallo se manejaba con catch. El propietario aprobó migrarla a visión BYOK directa desde el navegador — implementada con `AiService.extractStudentsFromImage()`.
- **server.ts (Express local):** NO modificado (no corre en producción; solo desarrollo). Mantiene rutas IA legadas inactivas para la app. Limpieza futura opcional con aprobación del propietario.
- **Operativa post-migración:** (1) ~~deploy del Worker~~ **EJECUTADO 01/09/2026 — ver Ronda 3**; (2) Cloudflare Pages se actualiza con el push (Ctrl+F5 en la app); (3) configurar la clave Groq en Ajustes → Motor de Inteligencia Artificial.

### ✅ Ronda 2 (01/09/2026): Respuestas del propietario e implementación aprobada

**Decisiones del propietario sobre las propuestas:**
- ~~Clave maestra de IA compartida~~ → **Aprobada la Opción A (panel local)**: cada docente pega la clave en su propio panel de Ajustes; queda solo en su dispositivo. NO se programa distribución automática por el Worker (más lógica + riesgo de desincronización con cuentas docentes). Documentado para futuros agentes: no reimplementar el proxy/distribución de claves sin nueva orden.
- ~~Horarios por plantilla global~~ → **Aprobado el modelo "horario opcional"**: las plantillas globales definen los bloques (cuándo escanear); la materia/asignación es OPCIONAL (quien quiera su horario lo carga por CSV con el importador existente). El registro ya guarda fecha y hora, por lo que la materia no es necesaria para la asistencia.
- ~~Notificación real T-{n}~~ → **Aprobada e IMPLEMENTADA** (ver abajo).
- ~~Asistencia fuera de jornada (post-1pm)~~ → **DESCARTADA por el propietario**: no fue pedida en el proyecto; no complicar con imprevistos/eventos no especificados. No implementar sin nueva orden.
- ~~E16 visión~~ → **Aprobada migración a BYOK local** (ver abajo).
- **Logos de proveedores IA** → **Aprobado e IMPLEMENTADO** (solicitud estética del propietario).

**Implementado en la ronda 2 (validado con tsc: cero errores nuevos; vite build OK):**
- **Notificación de fin de bloque (T-{n}) en `TeacherClassroomView.tsx`:** reloj vivo (`setInterval` 15 s) + ventana activa cuando faltan `noticeMinutesBeforeEnd` (proporcional 11/9/7/5) para el fin del bloque. Al entrar en ventana: banner rojo destacado con cuenta regresiva dinámica + "Faltan X de Y estudiantes por escanear" (usa `stats.unscanned` real del curso/bloque/día) + botón "Cerrar bloque ahora" (reusa `handleCloseBlock`) + botón "Entendido". Disparo ÚNICO por bloque/día (`notifiedSlotKey` con fecha+slot, sin spam). Sonido nuevo `SoundService.playNoticeBell()` (campana A5→E5, WebAudio, distinta de éxito/tardanza/error) y notificación push del navegador (Notification API, opt-in con botón "Activar notificaciones de fin de bloque"; no se pide permiso al montar). El banner estático T-{n} y la Regla de Oro se conservan fuera de la ventana.
- **Horario opcional en el aula:** chip "Horario opcional · Escaneo libre" en el título cuando el bloque no tiene asignación (`currentAssignment` undefined); el aula ya funcionaba sin asignación (asignatura editable, planilla y escáner siempre disponibles) — ahora lo comunica explícitamente. Cero cambios en lógica de escaneo/cierre.
- **Visión IA BYOK local (E16 migrado):** nueva `AiService.extractStudentsFromImage()` en `aiService.ts` — llamada DIRECTA desde el navegador al proveedor con la clave del administrador (mismo principio que el resumen por grado). Modelos de visión vigentes verificados en docs: Groq `meta-llama/llama-4-scout-17b-16e-instruct` (multimodal), Gemini `gemini-2.5-flash` (inlineData), OpenAI `gpt-4.1-mini`, OpenRouter `meta-llama/llama-4-scout`, Mistral `mistral-small-latest`. Respeta `settings.aiVisionModel` como override. `DocumentUploadModal` ya no llama a `/api/ai/vision-extract` (server Express legado); el fallback al parser local (`parseDocumentFile`) se conserva intacto. `documentType` de la IA se normaliza contra el union `DocumentType` (defensa anti-datos inválidos).
- **Logos oficiales de proveedores (`AiProviderMark.tsx`):** vectores oficiales inline con `fill="currentColor"` (Simple Icons CC0: Gemini/OpenAI/Mistral/OpenRouter; Wikimedia Commons: símbolo Groq). A todo color (color de marca) solo cuando hay proveedor con clave API configurada; gris tenue si no. Insertado en: chip de estado de la sección IA de `SettingsModal` ("Activa / Sin clave") y badge de proveedor de `GradeAiSummaryView`. Excepción aprobada a la regla lucide-react para marcas de terceros.
- Nota: los 9 grupos de errores pre-existentes de `tsc` (CameraScanner/ScanFeedbackBanner/ScanHubView/ScannerHub) son de TIPOS, no de runtime — los escáneres funcionan (comprobado por el propietario en campo). No tocar sin evidencia de fallo real.

### ✅ Ronda 3 (01/09/2026): Limpieza de residuos IA + Despliegue del Worker en producción

**Mandato del propietario:** "tú encárgate de eliminar los residuos y desplegar el worker, por favor. Y todo, comunícalo o tú sabes, la bitácora en agents.md".

**Ejecutado y verificado (versión desplegada `f04ead07-29ff-4a83-ba5f-0fd4a7cd9345`):**
1. **Token de API de Cloudflare** entregado por el propietario (verificado con `/user/tokens/verify` → `active`; cuenta `Hiroshiren86@gmail.com's Account`, id `5d4e4bd4e310c75d5b8e375944647026`). ⚠️ Tratar como secreto: NO committearlo ni dejarlo en logs persistentes.
2. **Residuos eliminados del dashboard:** secret `GROQ_API_KEY` borrado vía API (`DELETE /accounts/{id}/workers/scripts/inas-attendance-worker/secrets/GROQ_API_KEY`). El Worker quedó **sin secrets** (los demás de IA ya no existían). Las vars públicas `SCHOOL_CODE`/`SCHOOL_NAME` se conservan (declaradas en `wrangler.toml`).
3. **Deploy limpio:** `wrangler deploy` (3.114.17) desde `cloudflare-worker/` con `CLOUDFLARE_API_TOKEN` en el entorno (aviso "last published via Dashboard" → confirmado, el código local manda). Bindings intactos: D1 `inas_attendance_db` (`c577c8b3…`), KV `ATTENDANCE_KV` (`3b249fb9…`). 29.56 KiB / gzip 7.37 KiB, startup 20 ms.
4. **Verificación post-deploy (producción, `https://inas-attendance-worker.hiroshiren86.workers.dev`):**
   - `GET /api/health` → `"ai":{"mode":"client-side-byok",…}`, `d1: connected`, `kv: connected`. ✅
   - `GET /api/ai/status` → **HTTP 410** `AI_REMOVED_FROM_WORKER` con instrucción Ctrl+F5 para clientes en caché. ✅
   - `GET /api/sync/pull?schoolCode=INAS_2026` → ruta viva (el 404 "No se encontraron datos de sincronización previos" es el estado original: nunca hubo snapshot real en producción). ✅
   - `POST /api/sync/push` y `POST /api/attendance` → rutas vivas (responden sus validaciones). ✅
5. **Limpieza del efecto colateral de la prueba:** el push de prueba `{}` creó un snapshot vacío; se restauró el estado original borrando la key KV `latest_snapshot_INAS_2026` (`wrangler kv key delete --binding ATTENDANCE_KV`) y la fila D1 `sync_snapshots WHERE school_code='INAS_2026'` (`wrangler d1 execute --remote`). Verificado: pull volvió al 404 original.
6. **No se configuró `AUTH_TOKEN`:** el código lo trata como opcional (sin él, acceso abierto). Configurarlo sin coordinar rompería el sync de los dispositivos ya desplegados — decisión pendiente del propietario.

**Lecciones operativas para futuros agentes:**
- Para operar el Worker hace falta `CLOUDFLARE_API_TOKEN` en el entorno del comando (el propietario lo entrega por chat; puede rotarlo/revocarlo en el dashboard). Wrangler 3.x: `kv key delete` es remoto por defecto (no acepta `--remote`); `d1 execute` SÍ exige `--remote` para producción.
- `sync/pull` es **GET** con `?schoolCode=`; `sync/push` es **POST** con el snapshot completo (estudiantes + asistencias) desde el navegador. `POST /api/sync/push` con `{}` se acepta y guarda 0 registros (sobrescribe el snapshot): no usar como "ping" en producción.

### 🧭 Ronda 4 (noche del 01/09/2026): INVESTIGACIÓN + PLAN — Horarios a medida, interruptor "Solo plantillas" y Cierre de Jornada configurable

**Mandato del propietario (cita):** "que no te dejen modificar solamente las plantillas que están ahí hechas… que tú mismo crees tus propias plantillas… eso es solo para rectoría, ¿no?… darle la oportunidad a los estudiantes, el que quiera poner su horario lo pone en su perfil… desde rectoría, en la gestión de horarios, un interruptor de solo usar plantillas y pum, se deshabilite para todas las cuentas, ya sea maestros o estudiantes, la visualización de horarios… si ya se pasa de la una de la tarde ya se cierra la jornada y no deja escanear más nada y el contador se detiene y vuelve a iniciar otra vez el día siguiente conforme se haya puesto la plantilla (si dice inicio 7:00, cuenta desde 7:00; si dice fin 13:30 o 14:00, se detiene ahí). Todo debe ser sincronizado y revisado antes de cualquier push. Planifica bien, te reviso mañana." — **Orden explícito: NO tocar código hoy** ("basta de hacer cambios hoy, para no hacer algo que podría dañar el código"). Hoy solo: investigar + planificar + documentar.

**Confirmación al propietario:** la gestión de horarios YA es exclusiva de Rectoría (tab "Horarios Escolares" → `ScheduleBuilderView` y `SettingsModal`, ambos con guard `currentRole === 'ADMIN'` en `App.tsx` L135/L270/L362). Nada cambia en eso.

**Hallazgos de la investigación (verificados sobre 72e5cef):**
1. **Plantillas**: 5 definiciones FIJAS hardcodeadas `DAY_TEMPLATES_DEFINITIONS` (`mockData.ts` L27-100) de tipo paramétrico `DayTemplateConfig` (`types/attendance.ts` L32-47: `baseStartTime`, `blockDurationMinutes`, `trimMinutesPerBlock`, `recessDurationMinutes`, `totalBlocks`, `firstBlockSpecial`, `isNonComputableAllDay`, `proportionalNoticeMinutes`). El union `DayTemplateType` YA incluye `'CUSTOM'` (L26) sin uso. `getDayTemplates()` (`attendanceStorage.ts` L530) devuelve la constante: **no hay CRUD de plantillas**.
2. **Aplicar plantilla**: `applyDayTemplate(type)` (L547+) regenera slots paramétricamente y guarda `settings.activeDayTemplate` + `inas_schedule_slots_v5`. Solo se invoca desde `SettingsModal` (selector L265). La edición FINA ya existe: `ScheduleBuilderView` (1002 l) con sub-vistas `grid | weekly-matrix | slots-editor` (crear/editar/borrar slots, asignar materia/docente/aula por día).
3. **Horario personal del estudiante**: NO existe (grep 0 matches) — greenfield. El CSV existente es de estudiantes/reportes, no de horarios.
4. **Ventana de jornada**: `settings.dailyStartTime/dailyEndTime` EXISTEN (`types/attendance.ts` L214-215; `dailyStartTime` editable en SettingsModal L281-295, `dailyEndTime` sin UI) pero **NINGUNA línea de código los usa para validar escaneos**. `registerClassScan` NO valida horario: un escaneo a las 3 p.m. sale TARDANZA. `getCurrentActiveSlot()` ya retorna `isWithin: boolean` (L746-767) — ignorado por todos los llamadores. Feedback types `block_closed`/`pending_review` declarados sin uso (`types/attendance.ts` L203).
5. **Punto único de registro**: TODOS los escaneos convergen en `AttendanceStorageService.registerClassScan` (L1127) — aula (`TeacherClassroomView` L207), portería vía wrapper `registerScan` (L1554-1583), representante (`StudentPortalView` L183). Excepciones que escriben directo: `handleToggleStatus` (override humano del docente, L240-277), `closeBlockAttendance` (cierre), merge del pull (SYNC). Riesgo asociado hoy: la rama AUSENTE→TARDANZA (L1196-1212) permitiría a un escaneo a las 2 p.m. convertir ausentes del cierre en tardanzas.
6. **Cierre**: 100% MANUAL por bloque: `handleCloseBlock` → `closeBlockAttendance` (L1281-1397) con Regla de Oro (0 escaneos = no computable), regla 30% (→ `PENDIENTE_REVISION` → confirm force) e inserción `AUSENTE method:'AUTO_CIERRE'` idempotente. **NO existe scheduler ni cierre de jornada/día completo**. `DayScheduleState.pendingReviewSlots` sin uso.
7. **Notificación T-{n} (Ronda 2, ya implementada)**: reloj vivo `setInterval` (TeacherClassroomView L127), ventana proporcional (L181-189), disparo único `notifiedSlotKey`, `SoundService.playNoticeBell()`, Notification API opt-in. Está construida por BLOQUE — el cierre de jornada será otra capa superior (por DÍA).
8. **Contadores**: `stats.unscanned` por curso+bloque (L175-199); `getSummary(date)` por día (attendanceStorage L1455-1479). Ambos SON derivados de records filtrados por fecha → al cerrar la jornada quedan "congelados" naturalmente y al día siguiente parten de cero (todo se deriva de `r.date === getTodayDateString()`, hora Bogotá: `getTodayDateString/getCurrentTimeString`, L47-65). No hay módulo `bogota.ts` (supuesto corregido: helpers viven en attendanceStorage).
9. **Sync**: snapshot push/pull guarda `data` verbatim (settings+students+teachers+records[últimos 500]+assignments+slots; `cloudflareSync.ts` L87-101) sin `schemaVersion`; push = full-replace (riesgo: cliente VIEJO pisa campos nuevos del snapshot); pull SOLO manual (SettingsModal L141-160); push automático cada 5 min (`initAutoSync` L20-34). Settings viajan TAMBIÉN por Firestore realtime (`initCloudSettingsSync`, doc `school_settings/main`) — canal ideal para un interruptor de política. `getSettings()` hace spread sobre defaults → forward-compatible.
10. **Deuda de seguridad detectada (NO tocar hoy)**: el push sube `settings` completas al snapshot CF — incluidos `qrSecret`, `sessionSecret`, `cloudflareApiToken` y API keys IA — y quedan en D1/KV. Futura limpieza: excluir secretos del snapshot. Documentado como deuda.
11. **Incidente operativo resuelto en esta ronda**: el workspace local amaneció con un checkout viejo (mezcla de épocas; reflog terminaba en 6f3425c). Verificado con `git diff origin/main --numstat` que solo faltaba contenido (Rondas 2-3) y no había nada local superior → recuperación con `git config core.fileMode false` + `git reset --hard origin/main` (72e5cef). Lección: ante un workspace sospechoso, comparar SIEMPRE contra origin/main antes de tocar nada; GitHub es la verdad canónica.

---

**PLAN APROBADO PARA IMPLEMENTACIÓN (esperando luz verde del propietario mañana 02/09/2026):**

**F1 — CRUD de plantillas propias (solo Rectoría)**
- Nueva persistencia `inas_custom_templates_v1: DayTemplateConfig[]` (type `'CUSTOM'`). `getDayTemplates()` pasa a devolver FIJAS + CUSTOM (las fijas quedan como semilla; se pueden duplicar→editar; las fijas no se eliminan).
- Extraer el generador de slots de `applyDayTemplate` a función pura `generateSlotsFromTemplate(tmpl)` reutilizable SIN cambiar comportamiento actual.
- UI: nueva sub-vista "Plantillas" en `ScheduleBuilderView` (ya es solo ADMIN): lista fijas(candado)+custom(editar/eliminar), editor paramétrico con validaciones (bloques ≥1, horas coherentes, recreo ≥0) y **previsualización de slots**.
- NUEVOS campos opcionales en `DayTemplateConfig`: `dayStartTime?` / `dayEndTime?` (ej. "07:00"/"14:00") que gobiernan F3; fallback: `baseStartTime` y fin del último slot.
- El selector de plantillas de `SettingsModal` lista fijas+custom.

**F2 — Interruptor maestro "Solo plantillas oficiales" (Rectoría)**
- Nuevo `SchoolSettings.templatesOnlyMode?: boolean` (default `false`). Toggle en la sección Política de Horarios de `ScheduleBuilderView` (reusa `ToggleSwitch`).
- Cuando está ON: se oculta/bloquea con mensaje claro la carga de horarios personales (F4) para estudiantes Y docentes; las plantillas/slots oficiales siguen mandando el escaneo igual; los datos personales ya cargados NO se borran (OFF → reaparecen).
- Propagación automática: `SchoolSettings` ya se sincroniza por Firestore realtime + va dentro del snapshot CF → todos los dispositivos reciben el interruptor sin lógica nueva. Fuente única de lectura: `getSettings().templatesOnlyMode`.

**F3 — Cierre de Jornada configurable (la regla del reloj del propietario)**
- Ventana por día lectivo: `dayStartTime/dayEndTime` de la plantilla activa → fallback `settings.dailyStartTime/dailyEndTime` → fallback primer/último slot. Funciones puras nuevas en `attendanceStorage`: `getSchoolDayWindow(dateStr)` → `{startMin, endMin} | null` (null = día no lectivo), `isWithinSchoolDay(timeStr?)`, `getDayEndMinutes()`.
- **Validación central ÚNICA en `registerClassScan`** (la puerta común de los 3 puntos de escaneo): fuera de ventana → feedback NUEVO `'out_of_window'` (extender el union `ScanResultFeedback`; mensaje "Jornada cerrada: inicia X / termina Y"; `playBeepError`) sin registrar nada. La rama AUSENTE→TARDANZA también queda gobernada por la ventana (fuera de jornada NO reabre). Excepciones deliberadas que NO se bloquean: `handleToggleStatus` (override humano), cierres, merge de pull.
- **Cierre automático de jornada**: nuevo `closeDayAttendance({dateStr})` que itera grados × slots CLASS computables sin cerrar reutilizando `closeBlockAttendance` (respeta Regla de Oro, 30% y no-computables). Ejecución perezosa idempotente ("lazy close" al primer acceso tras `dayEndTime`) + timer de respaldo en `App.tsx` (patrón `initAutoSync`). Flag por fecha `inas_day_closed_v1` para no re-procesar.
- **Contador**: no requiere lógica nueva — los KPIs son derivados de records; tras el cierre quedan congelados y el día siguiente inicia en cero con la ventana de LA plantilla de ese día (NORMAL 06:30-12:30, RECORTE_10 ~11:30, o custom hasta 14:00). Este es exactamente el comportamiento pedido.
- UX: banner "Jornada cerrada" distinto del banner T-{n}; la notificación T-{n} por bloque queda intacta.

**F4 — Horario opcional del estudiante (perfil)**
- Modelo `StudentPersonalSchedule { studentCode, entries: [{dayOfWeek, slotId, subject}], updatedAt }` en `inas_student_schedules_v1`. Visible SOLO si `!templatesOnlyMode`.
- UI en `StudentPortalView`: sección "Mi horario (opcional)" con importación CSV simple (día, hora/slot, asignatura) validada + tabla legible + eliminar. Informativo: NO interfiere con asistencia/KPIs/cierres (decisión del propietario de la Ronda 2: el escaneo registra fecha y hora; la materia no es necesaria). Cada cuenta solo ve/edita SU horario.

**F5 — Sincronización de plantillas custom**
- Añadir `customTemplates: DayTemplateConfig[]` al `data` del snapshot (`cloudflareSync.ts` L87-101 push; pull con reemplazo total igual que slots/assignments L267-273; lectura con spread-sobre-vacío → clientes tolerantes).
- Orden de adopción documentado: actualizar TODOS los dispositivos primero → rectoría edita plantillas → push → resto hace pull (botón manual existente). Mitigación del riesgo cliente-viejo: no editar plantillas hasta tener todos los dispositivos actualizados. (Opcional futuro con aprobación: merge defensivo en el worker; auto-pull ligero.)

**Orden de implementación**: F1 → F3 → F2 → F4 → F5 (primero la base paramétrica, luego la regla crítica del reloj, después el interruptor, lo informativo y al final la propagación). Cada fase: `tsc --noEmit` (cero errores NUEVOS) + `vite build` + prueba manual del flujo + commit/push incremental + bitácora.

**Decisiones abiertas para el propietario (mínimas, con propuesta):**
1. ¿Fin de jornada por plantilla con fallback a settings? → PROPUESTO: sí (F1/F3).
2. ¿Fines de semana: escaneo bloqueado? → PROPUESTO: sí (hoy se puede; la ventana null lo bloquea; el docente conserva el override manual).
3. ¿DIA_ESPECIAL: escaneo permitido en ventana y cero ausencias? → PROPUESTO: sí (no-computable ya lo garantiza en el cierre).
4. ¿Pull manual o auto-pull para plantillas? → PROPUESTO: manual al inicio (menos riesgo).

**Pasos NO realizados hoy (por orden explícita de no tocar código):** todo el código de F1-F5 queda pendiente; hoy solo investigación, este plan y documentación. El worker NO requiere re-deploy para F1-F5 (es frontend + datos del snapshot).

---

## 🚀 4. Hoja de Ruta y Pasos a Seguir

### ⏳ Fase Actual (Inmediata): Validación de campo del Worker desplegado
1. ~~Desplegar el Worker en Cloudflare~~ **HECHO (Ronda 3, 01/09/2026 — versión `f04ead07`)**.
2. Conectar la URL del Worker en la Configuración del Sistema (`https://inas-attendance-worker.hiroshiren86.workers.dev` — ya es la URL por defecto).
3. Ejecutar pruebas de escaneo continuo y verificar la réplica en D1 y KV (usar la guía de prueba de sincronización entregada al propietario; el primer "Sincronizar ahora" desde la app creará el snapshot real).
4. Validar sincronización bidireccional entre 2 dispositivos simultáneos (PC + Móvil docente).
5. Decidir si se configura `AUTH_TOKEN` (hoy: acceso abierto).
6. **Siguiente frente (plan completo arriba, Ronda 4): implementar F1→F3→F2→F4→F5 cuando el propietario dé luz verde (revisión 02/09/2026).**

### ⏳ Fase Futura Planificada: Módulo de Excusas Médicas / Permisos Anticipados y Buzón Escolar
- **Propósito:** Permitir a los estudiantes/acudientes reportar inasistencias programadas (citas médicas, incapacidades, calamidades) fuera del horario lectivo (después de la 1:00 p.m. o fines de semana) para proteger su registro de asistencia.
- **Mecanismo de "Escudo de Justificación":**
  - No es un formulario burocrático engorroso, sino un selector rápido en el Portal de Estudiante donde se define el rango de fechas (ej. 1 día específico o varios días por incapacidad médica).
  - Al registrarse la excusa, el sistema le asigna un estado justificado a esas fechas futuras.
  - Cuando el escáner de portería o el algoritmo de auto-cierre de jornada procesa el día, el estudiante **no es marcado como ausente injustificado**, sino como `EXCUSA / JUSTIFICADO`.
- **Buzón en Rectoría / Coordinación:**
  - Panel administrativo para revisar, validar y auditar las justificaciones radicadas por los estudiantes con soporte físico o digital.
- **Preparación en Base de Datos:**
  - La tabla `student_excuses` ya ha sido incorporada preventivamente en `schema.sql` de Cloudflare D1.

---

## 🛠️ 5. Convenciones de Código
- **Estilo:** TypeScript estricto, componentes funcionales, React hooks.
- **Iconografía:** Exclusivamente `lucide-react`.
- **Animaciones:** `motion/react` para transiciones fluidas de interfaz.
- **Estilos:** Tailwind CSS v4.
- **Validaciones:** Linter (`tsc --noEmit`) y build (`vite build`) antes de dar por cerrada cualquier tarea.
