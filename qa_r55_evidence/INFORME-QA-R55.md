# INFORME QA — RONDA 55
## Gestión Docente moderna: asignaturas en tarjetas + Dirección de Grupo automática + fin del acceso duplicado a Plantillas
**Fecha:** jueves 10/09/2026 · **Ambientes:** pre-vuelo local (dist R55 vía `vite preview`) + producción `https://student-pass-id.pages.dev` (bundle `index-Beu6xU0_.js` verificado por marcadores) · **Commit:** `80565e0`

---

## 0. Filtros previos (antes de tocar producción)

| Filtro | Resultado |
|---|---|
| Auditoría de consumidores de `teacher.subjects` / `directorGrade` | ✅ 34 referencias mapeadas (QR CLASE:v2, validación C.2/D2, `getGroupDirectorForGrade`, sesiones docente, nube) |
| Estado REAL de la nube antes de la migración implícita | ✅ 16 materias únicas en los 20 docentes — **todas dentro de la lista institucional** (cero pérdida posible); 2 "directores fantasma" detectados (grado sin materia DG) |
| `tsc --noEmit` | ✅ **0 errores** |
| `vite build` | ✅ limpio (2,604 kB / gzip 760 kB) |
| Worker | ✅ SIN cambios (`git diff cloudflare-worker/` vacío — no hubo despliegue de Worker) |
| Root `package-lock.json` / `backups/` | ✅ NO commiteados |
| Marcadores del bundle en producción | ✅ nuevos presentes ("Otra asignatura…", nota Horarios→Plantillas); viejos ausentes ("Separadas por coma", "Plantilla de Jornada Activa", `inas-subjects-datalist`) |

## 1. Pre-vuelo LOCAL con Chromium (dist R55, sin riesgo) — **20/20 PASS**

login → Pull 80/20 → chips render → **sincronización viva ⭐** (ON al elegir curso / OFF en N/A) → toggle Religión → custom add/remove → Ajustes **sin selector de Plantillas** (3 selects, ninguno de plantillas) → nota orientadora → inicio/fin de jornada intactos (2 `input[type=time]`) → **0 errores JS de página**.

## 2. QA E2E en PRODUCCIÓN (navegador real, usuario real Rectoría/docente)

### Batería principal (`qa_r55_production.mjs`) — estado final de la nube PERFECTO

| # | Prueba | Veredicto |
|---|---|---|
| T0 | Login Rectoría + Pull producción (`80 estudiantes / 20 docentes`) | ✅ PASS |
| T1 | Ficha fantasma (María Camila 6°4): chip ⭐ **derivado** activo al abrir; OFF en N/A; ON al volver a 6°4; guardado sin error | ✅ PASS (ver T6) |
| T2 | Alta de docente con chips ("QA Ronda 55 Eliminar", Física retirada por toggle, Matemáticas ✓) → **cuenta Firebase real creada por la UI** → push 21 docentes | ✅ PASS |
| T2c | Borrado del docente QA → 20 locales + **tombstone teacher** → push | ✅ PASS |
| T3 | Ajustes: **0 selectores de Plantillas** (3 selects, ninguno), nota presente, inicio/fin/tolerancia intactos | ✅ PASS |
| T4 | Horarios → Plantillas intacto (Plantilla A + «Aplicar hoy») | ✅ PASS |
| T5 | Escaneo 16:31 con Plantilla A → **RECHAZADO** ("No hay clase en curso (16:31:35)… No se registra asistencia por escáner"), **0 registros nuevos** (2→2) | ✅ PASS |
| T6 | Nube final: **80/20/180/2 + Plantilla A activa**; **María Camila REPARADA por el invariante** (`directorGrade:6°4`, `isGroupDirector:true`, `subjects:["Lengua Castellana","Dirección de Grupo"]`); docente QA ausente; **tombstone teacher propagado** | ✅ PASS ×7 |

### Seguimiento quirúrgico (`qa_r55_followup.mjs` + `qa_r55_badge_check.mjs`)

| Prueba | Veredicto |
|---|---|
| Badge ⭐ tarjeta María Camila = `⭐ Director de Grupo:6°4` (producción) | ✅ PASS |
| Chips de su tarjeta: `Lengua Castellana` presente, **«Dirección de Grupo» NO duplicada** (la representa el badge ⭐) | ✅ PASS |
| **Login docente REAL** (Andrés Felipe Giraldo, clave temporal de su ficha, contexto limpio) | ✅ PASS |
| Aula docente: Asignatura es `<select>`, opciones = **su ficha** (Inglés), valor inicial correcto, **cero texto libre** | ✅ PASS |
| Mis Cátedras: `<select>` de materia con opciones desde su ficha | ✅ PASS |
| Mis Tarjetas QR: **1 tarjeta por asignatura de la ficha** (1/1) | ✅ PASS |
| Guarda de jornada: rechazo correcto + cero registros nuevos | ✅ PASS |

**Nota de honestidad:** la batería principal reportó 4 "FAIL" que fueron **falsos negativos del SCRIPT, no del producto**, cada uno repro-bado y corregido: (1)(2) lecturas del badge sin `.first()` (strict-mode de Playwright) — la captura `r55_T1_guardada.png` y la verificación puntual lo confirman en verde; (3) login del docente QA de prueba: la clave temporal se leyó vacía del formulario (index incorrecto del input) — se re-testeó el MISMO flujo con una ficha real y su clave persistida: PASS completo; (4) regex del rechazo buscaba "Jornada Cerrada" pero el mensaje correcto del bloque vencido es "No hay clase en curso… no se registra asistencia" — captura `r55_T5_jornada_cerrada.png` lo evidencia. **Cero cambios de código para "hacer pasar" pruebas (Regla #8).**

## 3. Artefactos dejados en producción (permitidos por el propietario)

- Tombstone de docente QA `prof-1789075784647` (alta + borrado verificados; matrícula docente restaurada a 20). Su cuenta Firebase `qa.r55.eliminar@inas.edu.co` permanece viva — **la eliminación en cascada de cuentas NO está implementada** (spec futura `docs/ESPECIFICACION_ELIMINAR_ESTUDIANTE_CASCADA.md`); borrar por consola si se desea.
- Tombstone de estudiante `999999999` (de R54, intacto).
- **1 reparación de dato REAL**: María Camila Restrepo Henao obtuvo la materia «Dirección de Grupo» en `subjects` por el invariante nuevo (era "directora fantasma"). Nube consistente 80/20/180/2.
- **NO se aplicó Plantilla T** (no fue necesaria: la prueba de escaneo del día fue de guarda NEGATIVA con reloj real). **Plantilla A activa al cierre** (verificada por API T6).

## 4. Seguridad

- Cero errores JS de página en todas las sesiones (Rectoría y docente).
- Ninguna credencial embebida en scripts de QA (se leen de `.env`); capturas revisadas antes de publicar (sin claves en texto plano).
- Remote de git restaurado a URL limpia tras cada push; `.git/config` sin PAT.
- La clave temporal del docente QA vivió solo en la BD/fichas y su ficha ya fue eliminada (la cuenta Firebase de esa prueba queda como único residuo, declarado arriba).

## 5. Cobertura de la petición del propietario

| Petición | Estado |
|---|---|
| Elegir curso ⭐ → tarjeta «Dirección de Grupo» automática (sin escribirla) | ✅ Implementado y verificado en producción (sincronización viva ON/OFF + reparación de fantasmas al guardar) |
| Materias estilo tarjetas (fin del texto por comas) en la ficha del docente | ✅ Implementado (17 institucionales + custom púrpura removible) |
| Localizar y modernizar otros formularios antiguos sin huérfanos | ✅ Aula docente y Mis Cátedras ahora `<select>` ligado a la ficha; datalist retirado sin dejar referencias muertas |
| Retirar de Configuración el acceso duplicado a Plantillas (dejar solo jornada) | ✅ Implementado con nota orientadora; Horarios → Plantillas intacto; inicio/fin/tolerancia intactos |
| No romper / no dejar huérfano / precisión sobre velocidad | ✅ Auditoría previa + invariante en 3 puntos + tsc 0 + build limpio + Worker intacto + 2 baterías E2E + estado de nube verificado |
