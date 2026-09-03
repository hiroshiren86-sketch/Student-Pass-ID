# 🏗️ Arquitectura de Almacenamiento y Sincronización — INAS 2026 (Ronda 23)

**Objetivo:** responder con evidencia a la pregunta del propietario — *¿cuál es la mejor arquitectura de almacenamiento en el Worker (KV + D1) para una lógica de sincronización de vanguardia, preparada para uso real?* — y dejar la recomendación lista para implementarse por fases.

---

## 1. Estado actual (verificado en producción)

| Capa | Tecnología | Rol actual | Salud |
|---|---|---|---|
| Cliente | localStorage (`inas_*`) + servicio local-first | La app funciona 100% offline; el navegador es la fuente operativa del día a día | ✅ |
| Cache | **KV** (`ATTENDANCE_KV`) | `latest_snapshot_{schoolCode}` — snapshot completo para pull ultrarrápido | ✅ |
| Verdad relacional | **D1** (`inas_attendance_db`, 9 tablas) | estudiantes, asistencias (overlay de excusas), excusas, audit_logs, snapshots, push_subscriptions | ✅ |
| Canal | HTTP request/response | push/pull por intervalo (default 5 min) + API de excusas en tiempo real | ⚠️ sin tiempo real |

**Cadena de despliegue:** Pages (frontend) auto-despliega con cada push a `main`; el Worker se despliega con `wrangler deploy` (Ronda 23 documentó por qué el vínculo automático del panel no estaba construyendo).

---

## 2. El mito del "60 segundos" — lo que dice la documentación oficial

Lo que el propietario escuchó sobre "60 segundos" es real y tiene nombre: **KV es eventualmente consistente**. La documentación oficial de Cloudflare (KV → *How the cache works*) establece:

- Una escritura a KV se propaga a la ubicación (edge) donde se hizo **inmediatamente**, pero las demás ubicaciones del mundo pueden tardar **hasta 60 segundos** en verla.
- KV **no es una base de datos**: es un almacén clave-valor optimizado para lectura frecuente y escritura rara. Garantías de consistencia: *eventual, con ventana ≤ 60 s*.

**Consecuencia de diseño (ya aplicada):** KV solo guarda el *snapshot de conveniencia* para acelerar el pull. **La verdad está en D1** (consistencia fuerte, transaccional, con `batch()` atómico). Las excusas jamás se leen desde KV — siempre de D1 vía `/api/excuses`. Así la ventana de 60 s es irrelevante para la integridad de datos.

---

## 3. Opciones evaluadas (con costos del plan gratuito / $5 USD Workers Paid)

### Opción A — "Pulido del modelo actual" (snapshot + polling) — *YA IMPLEMENTADA EN Ronda 23*
- El cliente manda su copia (`push`), D1 la consolida con upserts que **no destruyen** datos (Ronda 23 eliminó la cascada de excusas), y el `pull` devuelve la verdad.
- Refresco automático del buzón cada 30 s + al volver a primer plano (`visibilitychange`).
- ✅ Cero costo nuevo, cero complejidad operativa. ⚠️ Latencia real de datos: segundos–minutos (depende del intervalo); el dispositivo solo sabe del cambio si pregunta.

### Opción B — Durable Objects + WebSocket (Hibernation API) — *LA DE VANGUARDIA, recomendada para la Fase 2*
El propietario intuyó bien: los **Durable Objects (DO)** mantienen una unidad de estado+consistencia única en el mundo y soportan **WebSockets**. El miedo al costo ("no sería tan rentable mantener la conexión") se resuelve con la **Hibernation API**:

- El WebSocket **no cuesta nada mientras está inactivo**: el DO se *hiberna* (cero billing de duración) y **despierta automáticamente** al llegar un mensaje. La conexión TCP/WS queda sostenida por el runtime, no por facturación.
- Con un solo colegio basta **UN DO por `schoolCode`** (clave `idFromName(schoolCode)`) — la escala es trivial: decenas de dispositivos, no miles.
- Los DO con almacenamiento SQLite están disponibles **también en el plan gratuito** (desde 2025); en Workers Paid el costo de este uso sería centavos.

**Patrón recomendado ("bus de eventos, no dueño de la verdad"):**
```
Teléfono A (portal) ──WS──┐
Teléfono B (rectoría) ─WS─┤──▶ DO "SchoolHub" (schoolCode) ──▶ fan-out a los WS suscritos
PC Rectoría ──────────WS──┘            │
                                       └── persiste en D1 (la verdad relacional sigue allí)
```
- El DO **no** reemplaza a D1: es el *salón de clase* donde todos escuchan. D1 sigue siendo la única fuente de verdad y el audit log inmutable.
- Eventos a difundir: `EXCUSE_CREATED` (→ rectoría), `EXCUSE_DECIDED` (→ portal), `ATTENDANCE_CLOSED` (→ docentes), `TEMPLATE_SYNCED`.
- Fallback obligatorio: si el WS no conecta (proxy corporativo, red escolar restrictiva), el cliente cae al polling de la Opción A. La app **nunca** queda dependiente de una sola vía.

### Opción C — D1 Read Replication / Sessions API
Réplica de lectura multirregión de D1 (beta). Para un colegio con usuarios en una sola región (Colombia) es **sobre-ingeniería**: la latencia ya es baja. Descartada.

### Opción D — Cron Triggers para los barridos (complemento, Fase 3)
Hoy el auto-aprobo 72 h (R8) y la purga de retención (P4) son *lazy sweeps* — se ejecutan cuando alguien abre el buzón. Un **Cron Trigger** (gratis, `wrangler.toml [triggers] crons`) los ejecutaría cada hora de madrugada: más auditable, no depende de que alguien entre a mirar. **Recomendado** para la Fase 3.

---

## 4. Recomendación final por fases

| Fase | Qué | Estado |
|---|---|---|
| **1 — Corrección de verdad** | D1 como única verdad; upserts sin `INSERT OR REPLACE` en tablas con CASCADE; excusas siempre de D1; buzón con auto-refresh; Web Push (VAPID) para eventos de excusas | ✅ **HECHO (Ronda 23)** |
| **2 — Tiempo real** | DO `SchoolHub` por schoolCode con WebSocket Hibernation como *bus de eventos*; D1 sigue siendo la verdad; fallback a polling | 📋 Diseñado (este doc) |
| **3 — Operación nocturna** | Cron Triggers para R8 (auto-aprobo 72 h) y purga de retención; auditoría de sweeps en `audit_logs` | 📋 Diseñado |

**Regla de oro que ya rige y debe seguir rigiendo:** el navegador es cómodo, **el Worker es la autoridad**, y **D1 es la verdad**. KV es solo asiento de caché; los DO serán solo el altavoz. Ninguna capa nueva puede volverse fuente de verdad ni guardar secretos.

## 5. Riesgos y notas de la Fase 2 (para el prototipo → uso real)
- **iOS:** el Web Push (Fase 1) requiere la app *instalada como PWA* ("Añadir a inicio") en iOS ≥ 16.4 — documentarlo en la guía del propietario.
- **Proxies escolares:** algunos bloquean WS — el fallback de polling hace que la degradación sea invisible.
- **Consistencia:** el DO difunde eventos *después* de que D1 confirma la escritura (post-commit), así nunca se anuncia un dato que luego no existe.
- **Seguridad:** el endpoint WS del DO debe reutilizar el mismo gate `AUTH_TOKEN` que el resto de rutas cuando el propietario lo active.
