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
4. **Regla de Desarrollo Modular y Fases Verificables:**
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

### ✅ Fase 2: Arquitectura Cloudflare Worker (D1 + KV + AI Proxy) (Completada y Lista)
- **Creación de la suite `/cloudflare-worker/`:**
  - `wrangler.toml`: Configuración de bindings para D1 (`DB`), KV (`ATTENDANCE_KV`), variables de colegio y secretos.
  - `schema.sql`: Esquema D1 completo con tablas relacionales e índices para estudiantes, asistencias, horarios, docentes y snapshots.
  - `src/index.ts`: Worker TypeScript unificado que atiende `/api/health`, `/api/sync/push`, `/api/sync/pull`, `/api/attendance` y `/api/ai/grade-summary`.
- **Integración en el Frontend (`SettingsModal.tsx` & `cloudflareSync.ts`):**
  - Botón **"Probar Conexión"**: Realiza ping a `/api/health` para validar el estado del Worker y las bases D1/KV.
  - Botón **"Descargar (Pull)"**: Sincroniza y descarga datos desde Cloudflare hacia nuevos terminales o celulares en portería.
  - Botón **"Sincronizar (Push)"**: Envía datos locales a D1 y actualiza la caché KV de alta velocidad.
  - Auto-sincronización periódica configurable por minutos.

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
