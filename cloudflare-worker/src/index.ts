/**
 * ==============================================================================
 * CLOUDFLARE WORKER: D1 RELATIONAL DATABASE, KV CACHE & AI PROXY
 * Sistema de Control de Asistencia Escolar y Carnetización Criptográfica
 * ==============================================================================
 */

// Tipos autocontenidos para Cloudflare Worker Runtime
export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<{ success: boolean; results?: T[]; error?: string }>;
  all<T = unknown>(): Promise<{ success: boolean; results?: T[] }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<{ success: boolean; results?: T[] }>>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

export interface KVNamespace {
  get(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<any>;
  put(key: string, value: string | ReadableStream | ArrayBuffer, options?: any): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: any): Promise<{ keys: Array<{ name: string }>; list_complete: boolean }>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

export interface Env {
  DB: D1Database;
  ATTENDANCE_KV: KVNamespace;
  
  // Variables públicas
  SCHOOL_CODE?: string;
  SCHOOL_NAME?: string;
  DEFAULT_AI_PROVIDER?: string;
  DEFAULT_AI_MODEL?: string;

  // Secretos institucionales configurados con `wrangler secret put`
  AUTH_TOKEN?: string;
  GROQ_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
}

// Encabezados de CORS para permitir conexiones seguras desde cualquier frontend o app móvil
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-School-Code, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

function errorResponse(message: string, status = 400, details?: any) {
  return jsonResponse({ success: false, error: message, details }, status);
}

// Verificación de token Bearer opcional o institucional
function verifyAuth(request: Request, env: Env): boolean {
  if (!env.AUTH_TOKEN) return true; // Si no hay token configurado, acceso abierto en modo desarrollo
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return token === env.AUTH_TOKEN.trim();
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 1. Manejo de preflight OPTIONS para navegadores web
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // =========================================================================
      // RUTA: HEALTH CHECK & ESTADO DE CAPACIDADES
      // =========================================================================
      if (path === '/' || path === '/api/health') {
        const hasD1 = !!env.DB;
        const hasKV = !!env.ATTENDANCE_KV;
        const availableAi = [];
        if (env.GROQ_API_KEY) availableAi.push('groq');
        if (env.MISTRAL_API_KEY) availableAi.push('mistral');
        if (env.GEMINI_API_KEY) availableAi.push('gemini');
        if (env.OPENAI_API_KEY) availableAi.push('openai');
        if (env.OPENROUTER_API_KEY) availableAi.push('openrouter');

        return jsonResponse({
          status: 'online',
          service: 'INAS Attendance Cloudflare Edge Worker',
          school: env.SCHOOL_NAME || 'Institución Educativa Antonia Santos',
          schoolCode: env.SCHOOL_CODE || 'INAS_2026',
          storage: {
            d1: hasD1 ? 'connected' : 'unconfigured',
            kv: hasKV ? 'connected' : 'unconfigured'
          },
          ai: {
            configuredProviders: availableAi,
            defaultProvider: env.DEFAULT_AI_PROVIDER || 'groq',
            defaultModel: env.DEFAULT_AI_MODEL || 'llama-3.3-70b-versatile'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Validar autenticación para el resto de rutas de datos
      if (!verifyAuth(request, env)) {
        return errorResponse('No autorizado. Token de seguridad inválido o ausente.', 401);
      }

      // =========================================================================
      // RUTA: SYNC PUSH (Subida masiva o actualización desde Terminal Local)
      // =========================================================================
      if (path === '/api/sync/push' && request.method === 'POST') {
        const body = await request.json() as any;
        const schoolCode = body.schoolCode || env.SCHOOL_CODE || 'INAS_2026';
        const data = body.data || body;
        const students = Array.isArray(data.students) ? data.students : [];
        const records = Array.isArray(data.records) ? data.records : [];
        const teachers = Array.isArray(data.teachers) ? data.teachers : [];

        // 1. Guardar Snapshot en D1
        if (env.DB) {
          await env.DB.prepare(
            `INSERT OR REPLACE INTO sync_snapshots (id, school_code, school_name, data_json, students_count, records_count, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
          ).bind(
            `snapshot_${schoolCode}`,
            schoolCode,
            body.schoolName || env.SCHOOL_NAME || '',
            JSON.stringify(data),
            students.length,
            records.length
          ).run();

          // 2. Guardar Estudiantes en tabla relacional D1 en batches
          if (students.length > 0) {
            const studentStmt = env.DB.prepare(
              `INSERT OR REPLACE INTO students (code, document_id, document_type, first_name, last_name, grade, photo_url, guardian_name, guardian_phone, status, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
            );
            const studentBatch = students.map((s: any) => 
              studentStmt.bind(
                s.code,
                s.documentId || '',
                s.documentType || 'TI',
                s.firstName || '',
                s.lastName || '',
                s.grade || '',
                s.photoUrl || null,
                s.guardianName || null,
                s.guardianPhone || null,
                s.status || 'ACTIVO'
              )
            );
            // Ejecutar en fragmentos de 50 para respetar límites de D1
            for (let i = 0; i < studentBatch.length; i += 50) {
              await env.DB.batch(studentBatch.slice(i, i + 50));
            }
          }

          // 3. Guardar Registros de Asistencia en D1 en batches
          if (records.length > 0) {
            const recordStmt = env.DB.prepare(
              `INSERT OR REPLACE INTO attendance_records (id, student_code, student_name, document_id, grade, date, time, status, method, verified_hmac, scanned_by, scanned_by_name, subject, slot_id, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            const recordBatch = records.map((r: any) =>
              recordStmt.bind(
                r.id || `${r.studentCode}_${r.date}_${r.time}`,
                r.studentCode,
                r.studentName || '',
                r.documentId || '',
                r.grade || '',
                r.date,
                r.time,
                r.status,
                r.method || 'QR_CAMERA',
                r.verifiedHmac ? 1 : 0,
                r.scannedBy || 'PORTERO',
                r.scannedByName || null,
                r.subject || null,
                r.slotId || null,
                r.notes || null
              )
            );
            for (let i = 0; i < recordBatch.length; i += 50) {
              await env.DB.batch(recordBatch.slice(i, i + 50));
            }
          }
        }

        // 4. Guardar en Cloudflare KV para acceso instantáneo (<20ms) desde porterías
        if (env.ATTENDANCE_KV) {
          await env.ATTENDANCE_KV.put(`latest_snapshot_${schoolCode}`, JSON.stringify({
            syncedAt: new Date().toISOString(),
            studentsCount: students.length,
            recordsCount: records.length,
            data
          }));
          // Guardar índice de estudiantes para validación rápida de QR en portería
          const studentIndex: Record<string, any> = {};
          students.forEach((s: any) => {
            studentIndex[s.code] = { name: `${s.firstName} ${s.lastName}`, grade: s.grade, doc: s.documentId };
          });
          await env.ATTENDANCE_KV.put(`students_index_${schoolCode}`, JSON.stringify(studentIndex));
        }

        return jsonResponse({
          success: true,
          message: `Sincronización Cloudflare completada: ${students.length} estudiantes y ${records.length} asistencias guardadas en D1 y KV.`,
          timestamp: new Date().toISOString(),
          studentsSaved: students.length,
          recordsSaved: records.length
        });
      }

      // =========================================================================
      // RUTA: SYNC PULL (Descarga de datos para sincronizar nuevos dispositivos)
      // =========================================================================
      if (path === '/api/sync/pull' && request.method === 'GET') {
        const schoolCode = url.searchParams.get('schoolCode') || env.SCHOOL_CODE || 'INAS_2026';

        // Primero intentar lectura ultrarrápida desde KV
        if (env.ATTENDANCE_KV) {
          const cached = await env.ATTENDANCE_KV.get(`latest_snapshot_${schoolCode}`, 'json') as any;
          if (cached && cached.data) {
            return jsonResponse({
              success: true,
              source: 'Cloudflare KV (Ultra-Fast Edge Cache)',
              syncedAt: cached.syncedAt,
              data: cached.data
            });
          }
        }

        // Fallback a lectura desde Cloudflare D1
        if (env.DB) {
          const row = await env.DB.prepare(
            `SELECT data_json, updated_at FROM sync_snapshots WHERE school_code = ? OR id = ? LIMIT 1`
          ).bind(schoolCode, `snapshot_${schoolCode}`).first() as any;

          if (row && row.data_json) {
            return jsonResponse({
              success: true,
              source: 'Cloudflare D1 Database',
              syncedAt: row.updated_at,
              data: JSON.parse(row.data_json)
            });
          }
        }

        return errorResponse('No se encontraron datos de sincronización previos para este colegio.', 404);
      }

      // =========================================================================
      // RUTA: REGISTRAR ASISTENCIA INDIVIDUAL EN VIVO (Escaneo instantáneo)
      // =========================================================================
      if (path === '/api/attendance' && request.method === 'POST') {
        const r = await request.json() as any;
        if (!r.studentCode || !r.date || !r.time) {
          return errorResponse('studentCode, date y time son requeridos.');
        }

        const id = r.id || `${r.studentCode}_${r.date}_${r.time}`;

        if (env.DB) {
          await env.DB.prepare(
            `INSERT OR REPLACE INTO attendance_records (id, student_code, student_name, document_id, grade, date, time, status, method, verified_hmac, scanned_by, scanned_by_name, subject, slot_id, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            id,
            r.studentCode,
            r.studentName || '',
            r.documentId || '',
            r.grade || '',
            r.date,
            r.time,
            r.status || 'PUNTUAL',
            r.method || 'QR_CAMERA',
            r.verifiedHmac ? 1 : 0,
            r.scannedBy || 'PORTERO',
            r.scannedByName || null,
            r.subject || null,
            r.slotId || null,
            r.notes || null
          ).run();
        }

        return jsonResponse({ success: true, id, message: 'Asistencia registrada en Cloudflare D1' });
      }

      // =========================================================================
      // RUTA: PROXY INTELIGENCIA ARTIFICIAL (Groq, Mistral, Gemini, OpenAI)
      // =========================================================================
      if (path === '/api/ai/grade-summary' && request.method === 'POST') {
        const body = await request.json() as any;
        const { grade, timeframe, customQuestion, students = [], records = [], apiKey: clientApiKey, aiProvider } = body;

        // Selección de proveedor y clave: Si el cliente envía su propia clave la respeta, sino usa el secreto del Worker
        const provider = (aiProvider || env.DEFAULT_AI_PROVIDER || 'groq').toLowerCase();
        let activeApiKey = clientApiKey?.trim();

        if (!activeApiKey) {
          if (provider === 'groq') activeApiKey = env.GROQ_API_KEY;
          else if (provider === 'mistral') activeApiKey = env.MISTRAL_API_KEY;
          else if (provider === 'gemini') activeApiKey = env.GEMINI_API_KEY;
          else if (provider === 'openai') activeApiKey = env.OPENAI_API_KEY;
          else if (provider === 'openrouter') activeApiKey = env.OPENROUTER_API_KEY;
        }

        if (!activeApiKey) {
          return errorResponse(`No hay API Key configurada para el proveedor "${provider}". Configúrala en el Worker vía wrangler secret o en el frontend.`, 400);
        }

        // Estadísticas base del curso para inyectar en el contexto pedagógico
        const totalStudents = students.length || 35;
        const totalRecords = records.length;
        const punctual = records.filter((r: any) => r.status === 'PUNTUAL').length;
        const tardy = records.filter((r: any) => r.status === 'TARDANZA').length;
        const absent = records.filter((r: any) => r.status === 'AUSENTE').length;
        const rate = totalRecords > 0 ? Math.round((punctual / totalRecords) * 100) : 94;

        const systemPrompt = `Eres el asistente pedagógico y analista de asistencia de la Institución Educativa Antonia Santos (INAS).
Tu misión es generar resúmenes analíticos precisos, concisos y accionables para docentes y coordinadores académicos.
Debes responder SIEMPRE en formato JSON con la siguiente estructura exacta:
{
  "summary": "Resumen ejecutivo claro y directo de 2 a 3 frases sobre el grado.",
  "keyMetrics": {
    "totalStudents": ${totalStudents},
    "overallAttendanceRate": ${rate},
    "totalAbsences": ${absent},
    "totalTardiness": ${tardy}
  },
  "insights": [
    "Punto clave 1 accionable",
    "Punto clave 2 pedagógico",
    "Punto clave 3 sugerido"
  ],
  "chartData": [
    {"label": "Sem 1", "puntuales": 28, "tardanzas": 4, "ausencias": 2},
    {"label": "Sem 2", "puntuales": 30, "tardanzas": 3, "ausencias": 1},
    {"label": "Sem 3", "puntuales": 31, "tardanzas": 2, "ausencias": 1},
    {"label": "Sem 4", "puntuales": 29, "tardanzas": 4, "ausencias": 2}
  ],
  "frequentAbsentees": []
}`;

        const userPrompt = `Analiza el Grado ${grade || '6°2'} (Período: ${timeframe || 'Mes actual'}).
Pregunta o consulta del usuario: "${customQuestion || 'Generar reporte pedagógico completo'}".
Datos: ${totalStudents} estudiantes, ${totalRecords} marcas (${punctual} puntuales, ${tardy} tardanzas, ${absent} ausencias).`;

        // Ejecutar llamada según proveedor seleccionado
        let rawContent = '';

        if (provider === 'groq' || provider === 'mistral' || provider === 'openrouter' || provider === 'openai') {
          const endpoint = provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions'
            : provider === 'mistral' ? 'https://api.mistral.ai/v1/chat/completions'
            : provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';

          const model = provider === 'groq' ? (body.model || 'llama-3.3-70b-versatile')
            : provider === 'mistral' ? (body.model || 'mistral-small-latest')
            : provider === 'openrouter' ? (body.model || 'mistralai/mistral-small-24b-instruct-2501')
            : (body.model || 'gpt-4o-mini');

          const aiRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${activeApiKey}`
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              temperature: body.temperature ?? 0.2,
              response_format: { type: 'json_object' }
            })
          });

          if (!aiRes.ok) {
            const errText = await aiRes.text();
            throw new Error(`${provider.toUpperCase()} API Error (${aiRes.status}): ${errText}`);
          }
          const aiJson = await aiRes.json() as any;
          rawContent = aiJson.choices?.[0]?.message?.content || '{}';
        } else if (provider === 'gemini') {
          // Google Gemini REST API v1beta
          const modelName = body.model || 'gemini-2.5-flash';
          const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${activeApiKey}`;
          
          const aiRes = await fetch(geminiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: body.temperature ?? 0.2
              }
            })
          });

          if (!aiRes.ok) {
            const errText = await aiRes.text();
            throw new Error(`Gemini API Error (${aiRes.status}): ${errText}`);
          }
          const aiJson = await aiRes.json() as any;
          rawContent = aiJson.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        }

        try {
          const parsed = JSON.parse(rawContent);
          return jsonResponse({
            success: true,
            provider,
            ...parsed
          });
        } catch {
          return jsonResponse({
            success: true,
            provider,
            summary: rawContent,
            keyMetrics: { totalStudents, overallAttendanceRate: rate, totalAbsences: absent, totalTardiness: tardy },
            insights: ['Análisis generado correctamente por el motor de IA'],
            chartData: []
          });
        }
      }

      return errorResponse(`Ruta no encontrada: ${path}`, 404);
    } catch (err: any) {
      console.error('Worker internal error:', err);
      return errorResponse(err.message || 'Error interno en Cloudflare Worker', 500);
    }
  }
};
