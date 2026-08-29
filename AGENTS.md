# Reglas y Convenciones del Proyecto: Sistema de Registro de Asistencia Escolar

Este archivo define la arquitectura, lineamientos de diseño, etapas del proyecto y convenciones técnicas para el Asistente de IA y futuros desarrollos.

---

## 1. Contexto y Visión del Proyecto
- **Propósito:** Sistema de control de asistencia escolar en portería con alta velocidad de captura (<0.5s por estudiante), soporte multiplataforma (PC, Android, iOS), prevención de fraudes mediante carnés con firma HMAC-SHA256 y cumplimiento estricto de protección de datos (Ley 1581).
- **Enfoque de Costo Cero ($0 Inicial - Etapa 1):**
  - Todo el procesamiento de escaneo, validación criptográfica y almacenamiento local se realiza en el cliente (LocalStorage / IndexedDB / WebCrypto API).
  - No requiere servidores de pago ni infraestructura pesada en la fase inicial.

---

## 2. Hoja de Ruta y Etapas (Roadmap)

### ✅ Etapa 1: Prototipo $0 y Núcleo de Portería (Completado)
1. **Lector de Código de Barras / QR USB HID:** Captura ultrarrápida por teclado por ráfaga (50ms) y enter sin necesidad de hacer clic.
2. **Cámara Web / Móvil QR:** Integración con jsQR, cambio de cámara (frontal/trasera), zoom táctico y linterna (Torch).
3. **Prevención de Teclado Virtual en Móviles:** Atributo `inputMode="none"` y foco no invasivo para evitar que el teclado táctil de Android/iOS tape la pantalla al conectar escáneres USB OTG o Bluetooth.
4. **Firma Criptográfica HMAC-SHA256:** Carnés escolares con firma determinista para evitar clonación o manipulación de códigos QR.
5. **Auditoría & Reglas de Horario:** Detección automática de "Puntual" vs "Tardanza" según horario escolar y minutos de tolerancia configurables.
6. **Efectos de Sonido Web Audio API:** Alertas sonoras sintetizadas sin archivos pesados para confirmación instantánea.
7. **Directorio Escolar & Generador de Carnés:** Vista con fotos, datos del estudiante, acudiente y opción de imprimir carné.
8. **Exportación de Reportes:** Descarga de planilla de asistencia diaria en formato CSV.
9. **Modo Claro / Modo Oscuro:** Sistema dual de temas con persistencia local y soporte visual adaptativo.
10. **Tutorial / Onboarding Interactivo:** Guía paso a paso adaptable para PC y móviles.

### ⏳ Etapa 2: Almacenamiento Centralizado y Sincronización (Futura)
- Integración con base de datos en tiempo real (Firebase / Cloud SQL) para sincronización entre múltiples porterías simultáneas.
- Roles de usuario (Administrador, Portero, Docente, Coordinador).
- Notificaciones automáticas a acudientes (SMS / WhatsApp / Webhook) ante inasistencia o tardanza.

### ⏳ Etapa 3: Analítica Avanzada e Inteligencia Artificial (Futura)
- Panel de reportes acumulados semanales/mensuales y detección temprana de ausentismo crónico.
- Reconocimiento facial asistido opcional o validaciones biométricas.
- Integración con sistemas de gestión académica institucional.

---

## 3. Principios de Diseño y Experiencia de Usuario (UI/UX)
1. **Estilo Moderno & Efecto de Relieve/Glassmorphism:**
   - Tarjetas con sutil elevación, bordes translúcidos con gradientes suaves (`border-slate-200/80` y `dark:border-slate-700/60`).
   - Fondos con desenfoque de fondo (`backdrop-blur-md`), iluminación perimetral y sombras de varias capas para dar profundidad tangible.
2. **Sistema Dual de Temas:**
   - **Modo Claro:** Estilo corporativo ejecutivo, fondo suave `#F8FAFC`, tarjetas blancas con sombras nítidas, textos contrastados y acentos índigo/esmeralda.
   - **Modo Oscuro:** Estilo tecnológico de alta visibilidad para turnos matutinos con poca luz, fondo `#020617` / `#0B1120`, acentos cian/neón y contrastes WCAG AA.
3. **No Disruptividad en Portería:**
   - Los modales deben cerrarse ágilmente con la tecla `Escape` o clic exterior.
   - Las alertas de confirmación deben desaparecer automáticamente tras 4 segundos o permitir escaneo continuo sin bloqueos.
4. **Responsive Total:**
   - PC: Tablas detalladas, atajos de teclado y vista panorámica.
   - Móvil: Tarjetas compactas, botones táctiles de mínimo 44px, selector de cámara y prevención de teclado virtual.

---

## 4. Convenciones Técnicas
- **Framework:** React 19 + TypeScript + Vite + Tailwind CSS v4.
- **Iconografía:** Únicamente `lucide-react`.
- **Animaciones:** `motion/react` para transiciones fluidas.
- **Audio:** Sintetizador Web Audio API puro (oscilador senoidal con envolvente gain) para evitar retardos de descarga.
- **Criptografía:** `crypto.subtle` (WebCrypto API) con algoritmo `HMAC-SHA256`.
