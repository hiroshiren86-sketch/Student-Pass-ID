# Módulo de Excusas Justificadas — Spec de Referencia 2026 (integradora)

> **Objetivo de este documento:** servir como **contrato común** entre (a) el módulo que ya planea el
> propietario ("Escudo de Justificación" con fechas **futuras**, tabla `student_excuses` en D1, otro
> encargado a cargo) y (b) el baseline del usuario (justificación **post-hoc** de 1 toque, firma física
> de la rectora, aprobar/rechazo en notificaciones de Rectoría, "protegido" = no cuenta falta).
> **No reemplaza el módulo del encargado: lo integra.** Todo el diseño de abajo es **aditivo** sobre
> `schema.sql` actual (migraciones `ALTER TABLE` reversibles; cero migración de datos existentes).
>
> Formato apto para anexionarse a `AGENTS.md` → sección "Fase Futura Planificada: Módulo de Excusas".

---

## 1. Decisión central: dos temporalidades, UNA entidad

La tabla `student_excuses` (que ya existe en `cloudflare-worker/schema.sql`) con su par
`start_date / end_date` es capaz de modelar **los dos flujos** con una sola entidad:

| | **Anticipada** (Escudo — diseño del encargado) | **Post-hoc** (Justificación — baseline del usuario) |
|---|---|---|
| **¿Quién radica?** | Estudiante / acudiente desde el Portal | Rectoría / coordinación desde la planilla (1 toque) |
| **Fechas** | Futuras (`start_date ≥ hoy+1`, hasta fin de término) | Pasada (el día de la ausencia): `start_date = end_date = fecha` |
| **Vínculo con registro** | Ninguno aún: el cierre de jornada **crea** el registro ya protegido | `source_attendance_id` → el registro `AUSENTE` existente |
| **Efecto** | En el auto-cierre el estudiante queda `AUSENTE + excuse_id` (nunca "injustificado") | El registro existente recibe `excuse_id` y deja de contar como falta |
| **Reversión** | Si Rectoría **rechaza** → el registro vuelve a ser `AUSENTE` puro y el % se recalcula | Ídem |

Un solo ciclo de vida, un solo buzón, un solo audit. Esto elimina el riesgo principal de tener dos
módulos paralelos: reglas de conteo divergentes entre "escudo" y "justificación".

### 1.1 Regla de oro del conteo (invariable)

```
Falta injustificada  =  status = 'AUSENTE' AND excuse_id IS NULL
Ausencia justificada =  status = 'AUSENTE' AND excuse_id IS NOT NULL
% de asistencia      =  (PUNTUAL + TARDANZA) / total_estudiantes_del_día      (sin cambios)
% de faltas injust.  =  faltas_injustificadas / total_estudiantes_del_día     (la excusa NO lo altera
                                                                   hasta que es RECHAZADA)
```

Protección **provisional**: cualquier excusa **no rechazada** (PENDIENTE o APROBADA) cubriendo la fecha
protege al estudiante en el cierre. Solo `RECHAZADA` quita la protección (y se recalcula todo).
Esto cumple el propósito del Escudo ("sin latencia burocrática") **y** el control de Rectoría (el
usuario's baseline): la protección es inmediata pero **reversible con evidencia** por la rectora.

### 1.2 Por qué el registro NO cambia a un estado nuevo `EXCUSA` (decisión de modelo)

El diseño del encargado dice "se marca `EXCUSA / JUSTIFICADO`". Recomendamos implementarlo como
**overlay** (`excuse_id` en el registro) en vez de un 4° estado, y mantener `status='AUSENTE'`:

1. **Semántica:** un estudiante con incapacidad *estuvo ausente*, pero la ausencia está justificada.
   "Excusado" es una cualidad de la ausencia, no otro estado de asistencia (evita el clásico error de
   modelar atributos como estados).
2. **Cero migración:** el historial existente (`PUNTUAL/TARDANZA/AUSENTE`) no se toca; los reportes,
   el 30% de auto-cierre, `getSummary`, la planilla y el CSV siguen funcionando; la planilla solo
   agrega la etiqueta derivada "Excusada (bajo revisión)" / "Excusada (verificada)".
3. **Reversión limpia:** rechazar = `UPDATE attendance_records SET excuse_id=NULL WHERE …`. Sin
   "des-migrar" estados, sin duplicar lógica de recálculo.
4. **Multi-día natural:** una INCAPACIDAD de 3 días = 1 excusa (rango) → N registros que la referencian.
   Con un estado nuevo habría que propagar/revertir el estado en cada registro a mano.

El frontend muestra el estado visual `EXCUSA` (badge verde) — el contrato UI del encargado se respeta —
mientras la base de datos conserva el modelo relacional limpio.

---

## 2. Modelo de datos (migración aditiva v2 — 100% compatible con lo existente)

### 2.1 Lo que YA existe (no se toca)

```sql
CREATE TABLE IF NOT EXISTS student_excuses (
  id TEXT PRIMARY KEY,
  student_code TEXT NOT NULL,
  student_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  start_date TEXT NOT NULL,   -- YYYY-MM-DD
  end_date TEXT NOT NULL,     -- YYYY-MM-DD
  reason TEXT NOT NULL,       -- CITA_MEDICA, INCAPACIDAD, CALAMIDAD, DEPORTIVA, OTRA
  notes TEXT,
  status TEXT DEFAULT 'APROBADA',       -- PENDIENTE, APROBADA, RECHAZADA
  submitted_by TEXT DEFAULT 'PORTAL_ESTUDIANTE',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (student_code) REFERENCES students(code) ON DELETE CASCADE
);
CREATE INDEX idx_excuses_student_date ON student_excuses(student_code, start_date, end_date);
CREATE INDEX idx_excuses_dates ON student_excuses(start_date, end_date);
```

También existe `attendance_records` y `audit_logs` (se reutilizan, ver §2.3).

### 2.2 Migración v2 (solo `ALTER` — ninguna tabla nueva obligatoria, cero datos que mover)

```sql
-- student_excuses: columnas aditivas
ALTER TABLE student_excuses ADD COLUMN source_attendance_id TEXT
  REFERENCES attendance_records(id) ON DELETE SET NULL;  -- post-hoc: el AUSENTE justificado (NULL si anticipada)
ALTER TABLE student_excuses ADD COLUMN attachment_path TEXT;      -- foto del soportes físico (infra existente de documentos)
ALTER TABLE student_excuses ADD COLUMN reviewed_by TEXT;          -- usuario de Rectoría que decidió
ALTER TABLE student_excuses ADD COLUMN reviewed_at TEXT;          -- timestamp de la decisión
ALTER TABLE student_excuses ADD COLUMN reject_reason TEXT;        -- obligatoria si status=RECHAZADA
ALTER TABLE student_excuses ADD COLUMN auto_approved INTEGER DEFAULT 0; -- 1 si la aprobó la ventana 72 h
ALTER TABLE student_excuses ADD COLUMN audit_hash TEXT;           -- cadena HMAC (auditoría forense, §6.2)

CREATE INDEX idx_excuses_attendance ON student_excuses(source_attendance_id);
-- 1 excusa por ausencia (evita dobles justificaciones del mismo AUSENTE)
CREATE UNIQUE INDEX uq_excuses_attendance ON student_excuses(source_attendance_id)
  WHERE source_attendance_id IS NOT NULL;

-- attendance_records: overlay de protección
ALTER TABLE attendance_records ADD COLUMN excuse_id TEXT
  REFERENCES student_excuses(id) ON DELETE SET NULL;
CREATE INDEX idx_attendance_excuse ON attendance_records(excuse_id);

-- auditoría: se REUTILIZA la tabla existente audit_logs con nuevos event_type:
--   EXCUSE_CREATED, EXCUSE_APPROVED, EXCUSE_REJECTED, EXCUSE_REMOVED, EXCUSE_AUTO_APPROVED
-- (details_json guarda {excuse_id, student_code, status_anterior, status_nuevo, motivo, auto_approved})
```

### 2.3 Decisión de default: `status` pasa de `DEFAULT 'APROBADA'` a `DEFAULT 'PENDIENTE'`

El default actual (`APROBADA`) solo tiene sentido si no hay revisión; con un buzón de Rectoría,
defaultear a aprobada haría de la revisión una formalidad (la protección ya rige desde antes de que
la rectora la vea, y "aprobar" ya no cambia nada). Con default `PENDIENTE` + **protección provisional**
(§1.1) se conserva la experiencia del Escudo (protección inmediata, sin formularios) y la decisión es
real: la rectora aprueba (verifica el soportes) o rechaza (con motivo).
**Riesgo: nulo** — la tabla está vacía (preparación preventiva); la migración solo cambia el default
de filas futuras.

### 2.4 Reglas de negocio (validadas SIEMPRE en el worker — OWASP: nunca confiar en el cliente)

| # | Regla | Detalle |
|---|---|---|
| R1 | Rango válido | `end_date ≥ start_date`; anticipada: `start_date ≥ hoy+1`; post-hoc: fecha ≤ hoy y debe existir registro `AUSENTE` de ese día (si el estudiante asistió ese día → 400 "No hay ausencia que justificar en esa fecha") |
| R2 | 1 excusa por AUSENTE | Index único `uq_excuses_attendance` (post-hoc); el error se devuelve con línea/motivo en español |
| R3 | Anti-spam | Máx. **3 excusas activas** por estudiante y máx. **10 días justificados** por término (configurables en Ajustes). `reason='OTRA'` exige `notes` (fricción ligera; las demás no) |
| R4 | Inmutable para el radicante | Una vez radicada, el estudiante **no edita ni retira** su excusa (evita juego: radicar/retraer para manipular el %). Solo Rectoría puede borrar (con motivo → `EXCUSE_REMOVED` en audit) |
| R5 | Solamente Rectoría decide | Transiciones de estado solo por el rol Rectoría (verificado en servidor: session + rol). El API de aprobación rechaza cualquier otro rol con 403 |
| R6 | Rechazo exige motivo | `reject_reason` no vacío; se notifica al estudiante/acudiente con el motivo |
| R7 | Overlap | Ranges que se superponen están permitidos (p. ej. cita médica + calamidad en el mismo día); el registro enlaza a la excusa **más antigua** (created_at) que cubra la fecha |
| R8 | Ventana de revisión | **72 h** (configurable por colegio): `PENDIENTE` vencida → `APROBADA` + `auto_approved=1` + event `EXCUSE_AUTO_APPROVED` (o permaneciendo PENDIENTE si el colegio desactiva el auto-aprobo; la protección provisional rige en ambos casos) |
| R9 | Solo ausencias | Una excusa justifica ausencias, no tardanzas (`TARDANZA` nunca recibe `excuse_id`) |
| R10 | Fin de vigencia | `end_date` no puede exceder el fin del término escolar (fecha configurable en Ajustes) |

---

## 3. Máquina de estados

```
                 ┌──────────────┐  aprobar (rectoría, con verificación del soportes)
   radicar ───▶  │   PENDIENTE  │ ────────────────────────────────────────────┐
   (portal o     │  (protege:   │                                             ▼
    1 toque)     │  provisional)│  ┌────────────────────────────────┐   ┌──────────┐
                 │              │  │ ventana 72 h vence (config)    │──▶│ APROBADA │──▶ registro
                 └─────────────┘  │ auto_approved=1 (audit)        │   │ (definitiva)│   queda "Excusada
                        │ rechazar │                                │   └──────────┘     (verificada)"
                        ▼          └────────────────────────────────┘
                 ┌────────────┐   el registro pierde excuse_id, % recalculado,
                 │ RECHAZADA  │   notificación al estudiante con el motivo
                 │(exige motivo)│
                 └────────────┘
```

- Transiciones legales: `PENDIENTE → APROBADA`, `PENDIENTE → RECHAZADA` (manuales, solo Rectoría);
  `PENDIENTE → APROBADA` (automática por R8, con flag de audit).
- **Ninguna** transición en reversa (APROBADA→PENDIENTE, etc.). Corregir un error = borrar por
  Rectoría (R4) + re-radicar: el audit queda completo.
- Efectos sobre `attendance_records` (siempre en la misma transacción en D1):
  - `APROBADA`: los registros del rango conservan `excuse_id`; etiqueta "Excusada (verificada)".
  - `RECHAZADA`: `UPDATE attendance_records SET excuse_id = NULL WHERE student_code=… AND date BETWEEN start AND end` → etiqueta vuelve a "Ausente"; recalcular resúmenes del rango; notificar.

---

## 4. Motor de protección (donde se integran con el código existente)

1. **Auto-cierre de jornada** (el algoritmo actual, con la regla 30% ya implementada): antes de
   marcar `AUSENTE` a cada estudiante sin escaneo, consultar
   `SELECT id FROM student_excuses WHERE student_code=? AND status != 'RECHAZADA' AND ? BETWEEN start_date AND end_date`.
   - Con excusa → registro `status='AUSENTE', method='AUTO_CIERRE', excuse_id=…` (**protegido**).
   - Sin excusa → `AUSENTE` puro (comportamiento actual, sin cambios).
   - El diálogo "Solo se registró el X% — ¿forzar cierre?" sigue contando **solo faltas injustificadas**:
     las ausencias cubiertas por excusa no entran al "X%" ni al "Se marcaron N inasistencias".
2. **Planilla (rectoría y docente):** columna Estado muestra `Excusada (bajo revisión)` /
   `Excusada (verificada)` sobre el `AUSENTE` enlazado. **Nunca** se muestra el `reason` ni la foto
   en la planilla (minimización, §5) — solo el estado.
3. **Resúmenes y reportes:** `getSummary` agrega un 4° número: `justificados` (sin tocar
   `presentes/ausentes`); el CSV de exportación agrega la columna
   `Justificación` = `Bajo revisión | Verificada | (vacío)` — misma línea que la columna
   "Contexto de Vinculación" de Ronda 19.
4. **Rechazo tardío:** si una excusa APROBADA se borra/rechaza semanas después (Rectoría), el recálculo
   es retroactivo sobre el rango y los resúmenes diarios del período se regeneran (idempotente).

---

## 5. Protección de datos (OBLIGATORIO — la razón médica es DATO ESPECIAL)

- **Ley 1581/2012 art. 3(o) y Título III:** los datos relativos a **salud** son *categorías especiales*
  de datos con tratamiento restringido. La excusa médica toca exactamente esa categoría.
- **Ley 1581/2012 art. 7 + Ley 1346/2009:** los titulares son **menores** → el tratamiento requiere
  autorización del **representante legal** (consentimiento informado) e interés superior del menor.

Diseño resultante (minimización por diseño):

| Dato | Tratamiento |
|---|---|
| `reason` (catálogo: CITA_MEDICA, INCAPACIDAD, CALAMIDAD, DEPORTIVA, OTRA) | Categoría, no dato clínico. Visible en el buzón de Rectoría y en el portal del propio estudiante |
| `notes` | **Opcional** en todas las razones excepto `OTRA` (R3). Visible solo en el buzón de Rectoría y portal propio |
| `attachment_path` (foto de la nota/incapacidad) | **Cifrado en reposo**: sube a CF (R2/Storage) con AES-GCM en cliente, clave derivada del `qrSecret` institucional (mismo patrón Web Crypto del QR de Clase). Solo roles: Rectoría y el propio estudiante/acudiente. La planilla y los docentes **nunca** ven la foto ni el motivo |
| Consentimiento | El flujo de registro de estudiantes (que ya pide datos del representante) debe incluir el **cláusula específica** de datos de salud para justificaciones (checkbox explícito, no embebido en términos generales) — art. 7 y art. 9 (consentimiento previo, expreso e informado) |
| Conservación | Foto y `notes`: **fin del término + 1 año** y se purgan (job programable en el worker); el rastro de auditoría (estado, fechas, quién decidió) se conserva como dato operativo |
| Registro de auditoría | Cada transición → fila en `audit_logs` existente (`EXCUSE_*`), con `performed_by` y `details_json` |

Fuente: [Ley 1581 de 2012](https://www.suin-juriscol.gov.co/viewDocument.asp?ruta=Leyes/1684507);
protección especial de niños, niñas y adolescentes (SIC, guía de tratamiento de datos de menores).

---

## 6. El salto "vanguardia 2026"

### 6.1 Equivalencia funcional: la firma de la rectora deja de ser binaria (física o nada)

Hoy el baseline del usuario es: **la rectora firma un documento físico** (papel) y la app registra.
En 2026, con validez legal, eso se vuelve **física O electrónica, a elección de la institución**:

- **Colombia — Ley 527 de 1999** (docs. electrónicos, mensajes de datos y firmas digitales):
  [texto oficial](https://www.suin-juriscol.gov.co/viewDocument.asp?ruta=Leyes/1662013). Arts. 21–22:
  la firma digital es **única, verificable, bajo control exclusivo del firmante, ligada a la información
  (cualquier cambio la invalida)** y conforme a reglamentación. El principio de **equivalencia
  funcional** (art. 2): el mensaje de datos satisface los requisitos jurídicos del documento.
- **Referencia europea — eIDAS (Reg. UE 910/2014), art. 25**: una firma electrónica cualificada
  produce los mismos efectos legales que una firma manuscrita.
- **Implementación en INAS (sin infraestructura nueva):** la aprobación en el buzón de Rectoría ya
  requiere sesión autenticada del rol rectora (R5). Registrar `reviewed_by + reviewed_at + audit_hash`
  (= HMAC-SHA256 sobre `prev_hash + id + estado + revisor + timestamp`) cubre los 4 requisitos de una
  firma digital "segura" de la Ley 527: única (session), verificable (HMAC recomputable), bajo control
  exclusivo (credencial de la rectora) y **ligada a la información (si se altera la fila, la cadena
  HMAC se rompe → evidencia forense del tampering)**.
- **Resultado:** el expediente digital de la excusa tiene fuerza de soporte equivalente. La firma
  física **sigue siendo válida y opcional** (baseline del usuario intacto): si la rectora firma el
  papel, marca "soportes físico verificado" (checkbox en el modal de aprobación); si no, su
  aprobación electrónica con la cadena de auditoría basta. **Puntos a ganar:** la rectora puede
  resolver desde su celular (la app es responsive) sin archivar papel; el colegio queda con un
  expediente verificable en segundos (endpoint `GET /api/excuses/verify-chain`).

### 6.2 Cadena de auditoría "blockchain-lite" (tamper-evidente, costo cero)

Misma primitiva que ya rige el QR de Clase (HMAC-SHA256 con `qrSecret`, Web Crypto):
`audit_hash(n) = HMAC(secret, audit_hash(n-1) || id || status || reviewed_by || ts)`.
Cualquier modificación posterior a una excusa o a su decisión rompe la cadena a partir de ese eslabón.
Cero infraestructura: una columna + un endpoint de verificación. (Mismo principio que los
registros append-only forenses recomendados por [OWASP Secure Coding Practices](https://www.appsecmaster.net/blog/owasp-secure-coding-practices/): integridad verificable del historial.)

### 6.3 Accesibilidad WCAG 2.2 (W3C Recommendation, oct 2023)

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): **4.1.2** nombre/rol/valor en los chips de razón y los
  botones Aprobar/Rechazar (los modales de Ronda 19 ya cumplen; mantener); **2.4.11 Focus Not
  Obscured (NUEVO en 2.2)**: el modal de radicación no debe tapar el botón "Justificar" de origen;
  **3.3.7 Redundant Input**: la foto es opcional (nunca requerir lo que ya se da: la razón + fecha
  bastan); **2.4.3 Orden de foco**: razón → fechas → foto → radicar.
- Estados anunciados con `aria-live="polite"` al cambiar PENDIENTE→APROBADA/RECHAZADA.
- Heredado de Ronda 19: validación nativa en español (listener `invalid` + `setCustomValidity` en
  `main.tsx`) — los errores de las nuevas entradas deben usar los mismos mensajes (no introducir
  validaciones en inglés).

### 6.4 Notificaciones y PWA

- Notificación **in-app** (sistema existente de notificaciones de Rectoría/estudiante) + **badge**
  de pendientes en el panel de Rectoría (contador en la sección "Justificaciones").
- Evolución (roadmap PWA #14 ya existe): **Web Push** al estudiante/acudiente cuando su excusa cambia
  de estado — es el estándar 2026 para apps educativas móviles sin app nativa.

### 6.5 Reuso de infraestructura existente (cero duplicación)

| Necesidad | Reusa |
|---|---|
| Foto del soporte | `DocumentUploadModal` (upload JPEG/PNG, compresión, preview) — mismo pipeline |
| Cifrado / firma | Web Crypto + `qrSecret` (patrón del QR de Clase `CLASE:v1`) |
| Auditoría | `audit_logs` (D1) existente |
| Buzón de revisión | Panel de notificaciones de Rectoría existente (sección nueva "Justificaciones") |
| Validación ES | Listener global de Ronda 19 |

---

## 7. Flujos por rol (pantallas)

### 7.1 Estudiante / acudiente — Portal (radicación anticipada, diseño del encargado)

1. Sección **"Mis justificaciones"**: lista (fecha(s), razón, badge de estado) + mini-calendario del
   término con **ícono de escudo** en las fechas protegidas.
2. **"Nueva justificación"** (sin formulario: 3 pasos de un toque):
   - **Paso 1** — chip de razón: `Cita médica · Incapacidad · Calamidad · Evento deportivo · Otra`
     (elegir `Otra` despliega un campo de nota corto, obligatorio — R3).
   - **Paso 2** — fechas rápidas: "Un solo día" (picker, solo futuro) **o** "Rango" (p. ej.
     incapacidad de varios días); validación R1/R10 con mensajes en español.
   - **Paso 3** — foto **opcional** del soportes (reuso del modal de documentos) → **Radicar**.
3. Resultado: badge "Bajo revisión" + aviso: "Rectoría revisará en un máximo de 72 h. Tu registro queda
   protegido mientras no se rechace." (verdad por diseño: protección provisional §1.1).
4. Estado final: "Verificada" / "Rechazada (motivo)" — notificación in-app (+ PWA push en fase P4).
5. **No puede editar ni retirar** (R4): el único camino es pedirle a Rectoría la revisión.

### 7.2 Rectoría / Coordinación — Planilla (post-hoc, baseline del usuario)

- En cada fila `AUSENTE` **sin** excusa (vista rectoría): botón de **1 toque** "Justificar"
  (`aria-label="Justificar ausencia de {nombre} el {fecha}"`).
- Modal de 1 toque: chip de razón + checkbox **"El soportes físico firmado está en el expediente"**
  (opcional) + foto **opcional** + nota opcional → **Radicar** → `status=PENDIENTE`,
  `submitted_by=RECTORIA`, `source_attendance_id=registro`.
- La rectora sigue firmando el **documento físico** si su institución lo exige (el papel es la
  autoridad); el checkbox certifica que ya lo tiene. Si prefiere el 100% digital, su aprobación
  electrónica con cadena HMAC (§6.1) equivale.
- Una fila ya justificada muestra el badge y el botón desaparece (R2 impide la segunda excusa).

### 7.3 Rectoría — Buzón "Justificaciones" (unificado, ambos orígenes)

- Sección nueva en el **panel de notificaciones de Rectoría** (donde ya viven las alertas de
  inasistencias) con **badge de pendientes**.
- Tarjeta por excusa: estudiante, curso, fecha(s), razón, origen (Portal/Planilla), foto si la hay
  (clic → viewer cifrado), estado. Acciones: **[Aprobar]** 1 toque · **[Rechazar]** → pide motivo
  (obligatorio, campo con validación ES).
- Filtros: Pendientes / Aprobadas / Rechazadas / del día / por curso. Historial con `reviewed_by +
  reviewed_at` visible (audit).
- Bulk (opción P3): "aprobar todas las citas médicas de hoy" — 1 toque por lote (con confirmación).

### 7.4 Estudiante — "Mi asistencia"

- En su vista de asistencia, las ausencias justificadas aparecen como **"Excusada (bajo revisión)"** /
  **"Excusada (verificada)"** y **no** entran al % de faltas; las tardanzas y puntualidades sin cambio.

---

## 8. API (worker Cloudflare — mismos patrones que los endpoints actuales)

```
POST   /api/excuses
  body: { student_code, start_date, end_date, reason, notes?, attachment_path?,
         source_attendance_id?, submitted_by }
  → 201 { excuse }  | 400 {errors:[{line?, rule, message_es}]}  | 403 (rol)
  valida: R1, R2, R3, R10 (siempre en servidor)

PATCH  /api/excuses/:id
  body: { status: 'APROBADA' | 'RECHAZADA', reject_reason?, physical_document_verified? }
  → 200 { excuse, records_affected }  | 403 (no Rectoría)  | 409 (ya decidida — R5)
  transacción D1: estado + audit_logs + (si RECHAZADA) desvincular registros + recalculo

GET    /api/excuses?student_code=&status=&from=&to=&grade=
  portal: solo la propia (forzado por session) | rectoría: todo (forzado por rol)

GET    /api/excuses/:id/attachment   → foto cifrada (Rectoría o el propio estudiante; 403 otros)
GET    /api/excuses/verify-chain     → verifica la cadena HMAC desde el origen; 200 {intact:true} | 500 {intact:false, first_broken}
```

- Autenticación: misma sesión/rol del resto de endpoints; **R5 se enforcea en servidor**
  ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html): nunca
  confiar en el cliente; la regla de oro del informe de testing #6 sigue aplicando: cuando se active
  `AUTH_TOKEN`, estos endpoints entran al scope de verificación HMAC server-side).
- Respuestas de error **en español**, consistentes con la validación nativa de Ronda 19.

---

## 9. Comparación con el enfoque anterior (spec v1) — ventajas, desventajas y puntos a ganar

**Anterior** (`spec-excusa-justificada.md`, v1): solo post-hoc; nuevo estado `EXCUSADO` en el registro;
botón de 1 toque sobre `AUSENTE`; foto opcional; ventana 72 h; solo Rectoría crea/revoca.

| Dimensión | v1 | **2026 (esta spec)** | Notas |
|---|---|---|---|
| Temporalidades | Solo post-hoc | **Anticipada + post-hoc** en una entidad | Unifica el Escudo del encargado (fechas futuras) con el baseline del usuario |
| Modelo del registro | Estado nuevo `EXCUSADO` (migrar historia, tocar todo el conteo) | **Overlay `excuse_id`** (cero migración, reversión = NULL) | Menos superficie de regressión |
| Integración con el repo | Módulo paralelo | **ALTER aditivo sobre `student_excuses` existente** | El encargado no rehace su trabajo: su tabla, su Escudo y su buzón se conservan |
| Base legal | Documento físico + foto | **+ Equivalencia funcional (Ley 527/1999, eIDAS art. 25)** | Aprobación electrónica con fuerza de firma; el físico sigue siendo opción |
| Auditoría | Log simple | **Cadena HMAC tamper-evidente** reutilizando `qrSecret` | Evidencia forense de integridad con costo cero |
| Protección de datos | Mención general a Ley 1581 | **Salud = dato especial (art. 3(o))**: foto cifrada AES-GCM, minimización (la planilla nunca ve el motivo), retención término+1 año, consentimiento específico del representante legal (art. 7, menores) | Cumplimiento explícito, no aspiracional |
| Anti-abuso | "Solo Rectoría revoca" | + estudiante no puede editar/retirar (R4), límites de volumen (R3), `OTRA` exige nota, rechazo con motivo notificado (R6) | El % deja de ser manipulable desde el portal |
| Latencia | Protección solo tras aprobación | **Protección provisional inmediata** + decisión real (o auto-aprobo 72 h auditable) | El Escudo protege sin latencia burocrática; Rectoría conserva el control real |

**Puntos a ganar (resumen):**
1. El encargado **no rehace nada**: su tabla, su concepto de Escudo y su buzón sobreviven intactos;
   la spec solo añade 7 columnas y 2 índices.
2. El baseline del usuario se respeta **al 100%**: 1 toque sin formulario, firma física de la rectora
   (ahora opcional-equivalente), aprobar/rechazo en notificaciones de Rectoría, protegido = no cuenta
   falta.
3. Expediente verificable en segundos (cadena HMAC) con primitiva ya probada en producción (QR de Clase).
4. Cumplimiento Ley 1581 para dato de salud y menores **por diseño** (no como parche posterior).
5. Un solo contrato de conteo para los dos equipos → imposible que "escudo" y "justificación" diverjan
   en el %.

**Desventajas honestas (y mitigaciones):**
- **Más piezas móviles** (2 puntos de entrada + auto-aprobo): mitigado por reuso de infra (modal,
  buzón, HMAC) y por ser todo aditivo; fases P0–P4 (§11) permiten entregable incremental.
- **Default `APROBADA`→`PENDIENTE`** cambia la semántica del diseño del encargado: mitigado porque la
  tabla está vacía (cero riesgo) y la protección provisional deja la experiencia idéntica para el
  estudiante.
- **Almacenamiento de fotos cifradas** (CF R2/Storage): costo marginal (pocos MB por término); se
  mitiga con compresión (infra existente) y purga a término+1 año.
- **Dependencia de la latencia de Rectoría** para la decisión "definitiva": mitigada por la ventana
  72 h con auto-aprobo auditable (configurable por colegio).

---

## 10. Casos de prueba de aceptación (para el encargado y para la regresión)

1. **Anticipada → cierre:** radicar cita médica para mañana → al cierre, registro `AUSENTE` con
   `excuse_id`, planilla "Excusada (bajo revisión)", % de faltas no la cuenta.
2. **Aprobación:** Rectoría aprueba → "Excusada (verificada)" + notificación al estudiante +
   `reviewed_by/at` + fila en `audit_logs`.
3. **Rechazo:** Rectoría rechaza con motivo → registro vuelve a `AUSENTE` puro, % recalculado,
   notificación con el motivo; `verify-chain` íntegro.
4. **Post-hoc 1 toque:** sobre `AUSENTE` de ayer → excusa con `source_attendance_id` → protegido.
5. **Incapacidad multi-día:** rango de 3 días → 1 excusa, 3 registros protegidos.
6. **Doble justificación:** 2° intento sobre el mismo AUSENTE → 400 + mensaje ES (index único).
7. **Inmutabilidad:** estudiante intenta editar/retirar → sin UI + 403 en API.
8. **Minimización:** planilla y vista docente: NUNCA ven `reason` ni foto; solo el estado.
9. **Ventana 72 h:** excusa sin revisar → auto-`APROBADA` con `auto_approved=1` + event de audit
   (o pendiente si el colegio desactivó el auto-aprobo).
10. **Tampering:** alterar una fila de `student_excuses` en D1 → `verify-chain` reporta
    `intact:false` con el primer eslabón roto.
11. **WCAG 2.2:** modales navegables por teclado, foco no oscurecido (2.4.11), `aria-live` anuncia el
    cambio de estado, validación en español.
12. **Bordes:** fecha > fin del término → 400 (R10); estudiante sin matrícula → 404; `OTRA` sin nota
    → 400 (R3); justificar un día donde el estudiante asistió → 400 (R1).

---

## 11. Fases de implementación sugeridas (para el encargado — no cambia su prioridad)

- **P0 — Contrato:** migración §2.2 + reglas R1–R10 en el worker + API §8 + `audit_logs` (eventos `EXCUSE_*`).
- **P1 — Motor de protección:** auto-cierre con consulta de excusas (§4.1) + columna derivada en
  planilla + 4° número en resúmenes + columna `Justificación` en el CSV.
- **P2 — UI core:** portal "Mis justificaciones" (7.1) + botón 1 toque en planilla (7.2) + buzón
  "Justificaciones" (7.3) + notificaciones in-app.
- **P3 — Evidencia:** fotos cifradas (reuso del modal de documentos) + `verify-chain` + bulk approval.
- **P4 — Vanguardia:** Web Push (PWA #14) + cláusula de consentimiento art. 7 en registro de
  estudiantes + job de purga término+1 año + auditoría WCAG 2.2 completa.

**Criterio de "listo para producción" (gate):** los 12 casos de §10 en verde + `tsc --noEmit` +
`vite build` + 111+ tests de `verify_ronda19.ts` sin regresión + verificación HMAC server-side del
nuevo scope (pendiente del informe de testing #6, misma ventana de despliegue que `AUTH_TOKEN`).

---

## 12. Fuentes oficiales

1. **Ley 1581 de 2012** (protección de datos personales) — art. 3(o) categorías especiales de datos
   (salud), art. 7 (menores → representante legal), art. 9 (consentimiento previo, expreso e
   informado): [texto oficial (Suin-Juriscol)](https://www.suin-juriscol.gov.co/viewDocument.asp?ruta=Leyes/1684507).
2. **Ley 527 de 1999** (documentos electrónicos, mensajes de datos y firmas digitales) — arts. 21–22
   (requisitos de la firma digital "segura": única, verificable, control exclusivo, ligada a la
   información) y equivalencia funcional: [texto oficial (Suin-Juriscol)](https://www.suin-juriscol.gov.co/viewDocument.asp?ruta=Leyes/1662013).
3. **SIC** — Guía de protección especial de datos de niños, niñas y adolescentes (tratamiento de
   datos de menores y datos sensibles).
4. **eIDAS — Reglamento (UE) 910/2014**, art. 25 (efectos legales de la firma electrónica cualificada
   = firma manuscrita): [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014R0910).
5. **WCAG 2.2** (W3C Recommendation, 5 oct 2023): [w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/)
   — 4.1.2 Name/Role/Value, 2.4.11 Focus Not Obscured, 3.3.7 Redundant Input.
6. **OWASP** — [HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)
   (localStorage/secrets; validar siempre en servidor) y [Secure Coding Practices
   2026](https://www.appsecmaster.net/blog/owasp-secure-coding-practices/) (nunca confiar en el
   cliente; integridad del historial).
7. **Repo (estado actual):** `cloudflare-worker/schema.sql` (`student_excuses`, `attendance_records`,
   `audit_logs`), `AGENTS.md` §"Fase Futura Planificada: Módulo de Excusas Médicas / Permisos
   Anticipados y Buzón Escolar", Ronda 19 (QR de Clase `CLASE:v1` HMAC-SHA256, validación nativa ES,
   buzón de notificaciones de Rectoría).
