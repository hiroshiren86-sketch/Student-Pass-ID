# tests/ — Verificación de Student Pass ID

Estructura creada en la **Ronda 69** para separar tres niveles de verificación que
antes convivían en `scripts/` y en carpetas de evidencia sueltas (`qa_r57_evidence/`,
`qa_r58_evidence/`, …). Las suites históricas siguen en `scripts/` y en esas carpetas
(sin tocar: son la evidencia acumulada de las rondas 40-68).

```
tests/
├── harness/                 # utilidades compartidas (jsdom, fixtures, montaje de React)
│   ├── domEnv.ts            # DOM real (jsdom) + WebCrypto + localStorage para pruebas
│   ├── fixtures.ts          # catálogo real de producción (80 estudiantes, 20 docentes)
│   └── mountApp.ts          # monta <App/> dentro de ThemeProvider y cierra modales
├── unit/                    # suites locales deterministas (sin red)
│   ├── r69_grade_catalog.ts        # RC-7a/7b: canonicalizador y catálogo de cursos
│   ├── r69_filtro_grado_dom.ts     # la regresión reportada, en DOM real
│   ├── r69_escudito_dinamico.ts    # RC-8: Escudito 100% dinámico desde el catálogo
│   └── r69_mini_colegio_local.ts   # ensayo local de los Pasos A→B→C con los CSV reales
├── fixtures/                # datos de la simulación (CSV versionados)
│   ├── matricula_mini_colegio_15_grupos.csv   # 150 estudiantes (15 cursos × 10)
│   └── horarios_mini_colegio_15_grupos.csv    # 60 cátedras (Dirección + 3 materias × 15)
├── scripts/
│   └── gen_fixtures_mini_colegio.mjs          # generador determinista + auto-auditoría
├── e2e/simulation/          # guiones Playwright contra la app real (entorno con red)
│   ├── .env.example         # variables necesarias (nunca commitee el .env real)
│   ├── lib/{env,report,app}.mjs
│   ├── 01_regresion_filtro_y_escudito.mjs
│   ├── 02_paso_a_carga_csv_y_claves.mjs
│   ├── 03_paso_b_subroles_rep.mjs
│   ├── 04_paso_c_horarios_clase_qr.mjs
│   ├── 05_paso_c_excusas.mjs
│   ├── 06_sync_cross_device.mjs
│   └── run_all.sh
└── evidence/                # evidencia versionada (pre-fix, reportes E2E)
```

## 1. Suites locales (sin red, deterministas)

```bash
bun tests/unit/r69_grade_catalog.ts
bun tests/unit/r69_filtro_grado_dom.ts
bun tests/unit/r69_escudito_dinamico.ts
TZ=America/Bogota bun tests/unit/r69_mini_colegio_local.ts
```

Requieren `jsdom` instalado (`npm i --no-save jsdom`; el sandbox de CI lo instala).
Corren también en CI (ver `.github/workflows/ci.yml`).

Estado en R69 (sandbox, sin red): **66 + 32 + 31 + 49 = 178 checks en verde**, más las
suites históricas (`scripts/verify_ronda*.ts`, `scripts/qa-r*.ts`) sin regresiones.

## 2. Fixtures de la simulación "Mini Colegio"

Los CSV son **datos de prueba versionados** (no código de la app): la app nunca los
incluye ni los inyecta. Se generan de forma determinista:

```bash
node tests/scripts/gen_fixtures_mini_colegio.mjs
```

El generador se auto-audita y falla si: hay documentos duplicados, algún curso queda
con <10 estudiantes, dos cátedras del mismo docente chocan en el mismo (día, bloque)
o dos materias del mismo curso caen en la misma celda del horario.

| Archivo | Contenido |
|---|---|
| `matricula_mini_colegio_15_grupos.csv` | 150 estudiantes: 6°1-6°3, 7°1-7°3, 8°1-8°3, 9°1-9°2, 10°1-10°2, 11°1-11°2 (10 c/u). Formato SIMAT: `TIPO_DOC,DOCUMENTO,APELLIDOS,NOMBRES,CURSO`. Documentos en el rango 1.090.000.000+ para no chocar con la matrícula real. |
| `horarios_mini_colegio_15_grupos.csv` | 60 cátedras: Dirección de Grupo + Matemáticas + Lengua Castellana + Inglés por curso, con los 20 docentes reales (nombres exactos para que el importador resuelva `teacherId`). |

**Alcance ADITIVO**: los cursos existentes (6°4, 7°4, 8°4 con 14; 9°3, 10°3 con 13;
11°3 con 12) no se modifican. Tras importar: 21 cursos y 230 estudiantes, todos los
cursos de 6°1 a 11°3 con ≥10.

## 3. E2E contra la app real (requiere red + credenciales)

```bash
npm i -D playwright && npx playwright install chromium   # una sola vez
npm i -D jsqr pngjs                                      # opcional: decodificar el PNG del QR
cp tests/e2e/simulation/.env.example tests/e2e/simulation/.env   # y complete los valores
bash tests/e2e/simulation/run_all.sh
```

| Guión | Qué prueba |
|---|---|
| `01_regresion_filtro_y_escudito` | La regresión reportada: cada curso del selector devuelve sus filas, búsqueda sin tildes, cursos fantasma ausentes, Escudito dinámico (conteos, filtro, búsqueda, refresco en vivo) y vista previa de perfil sin perder la sesión de Rectoría. |
| `02_paso_a_carga_csv_y_claves` | Paso A: carga masiva del CSV por la UI, 15 cursos nuevos con ≥10, cursos existentes intactos, Push, verificación **en la nube** con el API del Worker, restablecimiento masivo de claves (000000) y comprobación desde un segundo navegador limpio. |
| `03_paso_b_subroles_rep` | Paso B: botón "Hacer Rep" por curso, persistencia del sub-rol, Push, verificación en la nube y portal del Representante en otro dispositivo. |
| `04_paso_c_horarios_clase_qr` | Paso C: importación del horario por CSV, tarjeta de clase v2 (y QR v1 por curso/día), desbloqueo de la hora, escaneo de los 10 estudiantes del grupo y lectura en la planilla de Rectoría. |
| `05_paso_c_excusas` | Paso C: ausencia real, excusa anticipada y post-hoc desde el portal, aprobación en el Buzón y verificación del verificador en la nube. |
| `06_sync_cross_device` | Tres navegadores limpios reciben el mismo catálogo, latencia de propagación Docente→Rectoría, higiene de identidad (cero sesiones anónimas) y token de dispositivo en Ajustes. |

Cada guión escribe su evidencia en `tests/evidence/e2e_<guion>_<timestamp>/`
(`.json`, `.txt` y capturas PNG) y sale con código ≠ 0 si algo falla.

### Estado de ejecución en R69

**Estos guiones NO se ejecutaron en el sandbox de la Ronda 69**: ese entorno no tiene
egreso de red hacia `*.workers.dev` / `*.github.io` / `*.googleapis.com` ni navegadores
instalados (`playwright install` bloqueado). Se entregan versionados, verificados
sintácticamente (`node --check`) y con su cadena operativa ensayada localmente contra
el código real en `tests/unit/r69_mini_colegio_local.ts` (49 checks: importación CSV,
sub-roles, horarios, activación de clase v1/v2, escaneo y planilla). La ejecución en
producción queda pendiente en el entorno del propietario/QA.
