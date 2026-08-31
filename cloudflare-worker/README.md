# 🚀 Despliegue de Cloudflare Worker (D1 Relational DB + KV Storage + AI Proxy)
## Sistema de Registro y Control de Asistencia Escolar

Este módulo contiene el backend serverless de borde (Edge) para la **Institución Educativa Antonia Santos**. Unifica en un solo Worker:
1. **Base de Datos Relacional SQLite en el Edge (Cloudflare D1)** para almacenar estudiantes, planilla de asistencia, docentes y auditoría.
2. **Caché Clave-Valor de Ultra Baja Latencia (<20ms) (Cloudflare KV)** para validación instantánea de carnés QR en portería.
3. **Proxy Seguro de Inteligencia Artificial** multi-proveedor (Groq, Mistral, Gemini, OpenAI) con claves institucionales protegidas.

---

## 📋 Requisitos Previos
- Node.js 18 o superior.
- Cuenta gratuita en [Cloudflare](https://dash.cloudflare.com/).
- CLI de Cloudflare instalado (`wrangler`).

---

## 🛠️ Guía Rápida de Despliegue (Paso a Paso)

### 1. Iniciar sesión en Cloudflare
```bash
npx wrangler login
```

### 2. Crear la Base de Datos Relacional D1
Ejecuta el siguiente comando para aprovisionar la base de datos D1:
```bash
npx wrangler d1 create inas_attendance_db
```
Copia el `database_id` que te devuelve la terminal y pégalo en el archivo `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "inas_attendance_db"
database_id = "PEGA_AQUI_TU_DATABASE_ID"
```

### 3. Crear el Namespace de KV Storage
Ejecuta:
```bash
npx wrangler kv:namespace create ATTENDANCE_KV
```
Copia el `id` resultante y pégalo en `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "ATTENDANCE_KV"
id = "PEGA_AQUI_TU_KV_NAMESPACE_ID"
```

### 4. Inicializar las Tablas e Índices en D1
Ejecuta el script SQL en la nube:
```bash
npx wrangler d1 execute inas_attendance_db --remote --file=./schema.sql
```

### 5. Configurar los Secretos Institucionales
Configura el token de seguridad y las API keys que desees utilizar a nivel de colegio:
```bash
# Token para autorizar a los navegadores/terminales escolares
npx wrangler secret put AUTH_TOKEN

# Claves de IA (Opcionales si usas la API Key directamente en el Frontend)
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put MISTRAL_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENAI_API_KEY
```

### 6. Desplegar a Producción
```bash
npx wrangler deploy
```

Al terminar, la terminal te entregará una URL como:
`https://inas-attendance-worker.<tu-subdominio>.workers.dev`

---

## 🔗 Conexión con el Frontend de Asistencia
1. Abre el Sistema de Asistencia Escolar en el navegador.
2. Ve a **Configuración** (ícono de engranaje).
3. En la sección **"Conexión y Sincronización Automática Cloudflare D1"**:
   - Pega tu **Cloudflare Worker URL**: `https://inas-attendance-worker.<tu-subdominio>.workers.dev`
   - Pega tu **Cloudflare API Token / AUTH_TOKEN** configurado.
4. Haz clic en **"Sincronizar Cloudflare Ahora"** o activa la auto-sincronización.

---

## 📡 Endpoints Disponibles
- `GET /api/health` — Verifica el estado del Worker, D1, KV y los modelos de IA activos.
- `POST /api/sync/push` — Sube masivamente estudiantes y asistencias desde el terminal a D1 y KV.
- `GET /api/sync/pull` — Descarga los datos de asistencia para sincronizar una nueva terminal o teléfono.
- `POST /api/attendance` — Inserta un registro de escaneo instantáneo en D1.
- `POST /api/ai/grade-summary` — Genera análisis pedagógicos por grado con Groq/Mistral/Gemini/OpenAI.
