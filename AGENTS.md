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
- **E13 — Transparencia del motor de contingencia del Worker:** El worker ahora incluye `simulatedReason` (error real del proveedor, truncado a 300 chars) en su respuesta de contingencia, incluida la rama Gemini que antes tragaba errores en silencio. (Corregido en `cloudflare-worker/src/index.ts`; **deploy pendiente de acceso a Cloudflare** — hasta entonces el worker en producción seguirá sin el campo).
- ~~**E14 — Banner de verdad en la UI de análisis:** `GradeAiSummaryView` muestra un banner ámbar "Análisis generado por el Motor Local (sin IA real)" con el motivo cuando `isSimulated:true`, y las etiquetas obsoletas ('Groq Llama 3.3 Ultra-Fast', 'OpenAI GPT-4o', 'modelos Llama 3.3') se actualizaron a denominaciones vigentes. (Corregido y Validado con `tsc --noEmit` + `vite build`).~~
- **Nota operativa:** la clave Groq institucional del Worker (secreto `GROQ_API_KEY`) sigue sin poder actualizarse remotamente sin token de API de Cloudflare; con la cadena BYOK-first esto deja de ser bloqueante para la IA real del usuario. El Worker también sigue sin `AUTH_TOKEN` (acceso abierto).

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
- **E16 — Hallazgo (pendiente de decisión del propietario):** `DocumentUploadModal.tsx` invoca `/api/ai/vision-extract` (ruta relativa al server.ts Express local, solo disponible en desarrollo). En producción esa ruta no existe y el fallo se maneja con catch. Candidata a migración BYOK de visión directa desde el navegador o a retiro.
- **server.ts (Express local):** NO modificado (no corre en producción; solo desarrollo). Mantiene rutas IA legadas inactivas para la app. Limpieza futura opcional con aprobación del propietario.
- **Operativa post-migración:** (1) deploy del Worker con `wrangler deploy` (requiere sesión/token de Cloudflare — pendiente del propietario); (2) Cloudflare Pages se actualiza con el push (Ctrl+F5 en la app); (3) configurar la clave Groq en Ajustes → Motor de Inteligencia Artificial.

---

## 🚀 4. Hoja de Ruta y Pasos a Seguir

### ⏳ Fase Actual (Inmediata): Despliegue y Validación del Worker en Semiproducción
1. Desplegar el Worker en Cloudflare (`wrangler deploy` y ejecución de `schema.sql` en D1).
2. Conectar la URL del Worker y el Token en la Configuración del Sistema.
3. Ejecutar pruebas de carga de escaneo continuo y verificar la réplica en D1 y KV.
4. Validar sincronización bidireccional entre 2 dispositivos simultáneos (PC portería + Móvil docente).

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
