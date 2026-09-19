# INSTRUCCIÓN — Guión de presentación del proyecto INAS (versión con 3 presentadores)

> **Cómo usar este documento.** Es un paquete autocontenido para entregárselo a otro agente y pedirle
> el **guión de presentación**. Copie desde "INICIO DEL ENCARGO" hasta "FIN DEL ENCARGO" y adjunte
> (o dé acceso a) el repositorio indicado en §2.

--- INICIO DEL ENCARGO ---

# ENCARGO: escribir el guión de presentación del proyecto INAS

## 0. Su rol

Usted es **guionista técnico** de una presentación oral. Escriba el guión completo (palabra por palabra
lo que dicen las personas), con reparto entre **tres presentadores**, listo para ensayar. No modifique
código de producto, no haga commits, no invente datos: su insumo es el repositorio y los documentos de
evidencia que se listan abajo.

Estilo pedido por el dueño del proyecto, textual: **"dirigido a un público amplio; enfocado en mostrar el
funcionamiento del sistema; lenguaje natural; extensión media, ni muy largo pero tampoco demasiado
superficial; y con una pequeña explicación de cómo se hizo el sistema y el uso del VibeCoding que lo hizo
posible"**.

## 1. El objetivo de la presentación (y el único mensaje que debe quedar)

El público debe salir sabiendo **qué hace el sistema, cómo se ve funcionando y por qué es confiable**.
El mensaje de fondo es: *"es un sistema que ya funciona en producción, que mide lo que hace, que dice la
verdad sobre sus límites y que dejó el camino preparado para crecer sin abrir puertas de seguridad."*

Duración objetivo: **15 a 18 minutos** (más 5 de preguntas). Reparto equilibrado: **cada presentador
habla entre %28 y %38 del tiempo**. Ninguna intervención continua debe pasar de **2 minutos** sin que
otra persona tome la palabra.

## 2. Insumos obligatorios (léalos antes de escribir)

Repositorio: `github.com/hiroshiren86-sketch/Student-Pass-ID`, rama `arena/01a0b6eb-student-pass-id`
(PR #2). Commit base de `main`: `f1bdbd2`.

| Documento | Para qué sirve |
|---|---|
| `GUION_PRESENTACION_INAS.md` | **Guión v1 ya validado** (13 escenas). Es la BASE: mantenga su estructura y su tono; esta versión agrega el encuadre del representante y el reparto entre 3 voces |
| `tests/evidence/r70_inventario_ui_guion.txt` (+ `.json`) | **Fuente única de citas de la interfaz**: cada texto entre comillas del guión debe existir ahí (se generó recorriendo la app real) |
| `ANALISIS_R70_OUTBOX_REPRESENTANTE.md` | Diagnóstico verificado del caso del representante + propuesta de 3 cambios aditivos |
| `ANALISIS_RIESGOS_AUTOSYNC_REPRESENTANTE.md` | Análisis de riesgos con `archivo:línea` (de aquí sale el argumento de seguridad) |
| `INSTRUCCION_AUDITORIA_AUTOSYNC.md` | Términos exactos de autorización, snapshot, credenciales (glosario) |
| `AGENTS.md` | Bitácora de rondas (úsela para la parte de cómo se hizo: VibeCoding, rondas, auditorías) |
| `INFORME_R69.md` / `INFORME_R68.md` | Métricas de ingeniería y alcance funcional |

**Comandos de verificación** (sin red, Node 20+):
```bash
npm i --no-save jsdom tsx pdfmake pdfjs-dist jose
TZ=America/Bogota npx tsx tests/unit/r70_guion_inventario_ui.ts   # 9 checks (citas de la UI)
TZ=America/Bogota npx tsx tests/unit/r70_flujo_docente_estudiante.ts # 15 checks (2 dispositivos)
TZ=America/Bogota npx tsx tests/unit/r70_representante_nube.ts    # 15 checks (endpoints reales)
TZ=America/Bogota npx tsx tests/unit/r70_alcance_autosync.ts     # 12 checks (alcance del autosync)
node scripts/gen_guion_pdf.mjs <archivo.md> <archivo.pdf>      # Markdown -> PDF
```
Cualquier afirmación técnica del guión debe poder rastrearse a estos documentos. **Si un dato no está
verificado, no se dice** (o se dice "no lo medimos").

## 3. LO MÁS IMPORTANTE DE ESTE ENCARGO: cómo se explica el caso del representante

El público (directivos, docentes, acudientes, evaluadores) debe entender el estado real **sin** percibir
una falla y **sin** que se le oculte nada. El dueño del proyecto lo resumió así: *"tampoco se le dio mucha
prioridad, también por la seguridad; dejó la puerta libre y todo implementado para que, si se lían
representantes, puedan hacerlo"*.

### 3.1 Los hechos que se dicen (verificados, no negociables)

1. El representante es una **alternativa** para cuando el profesor no quiere o no puede pasar lista:
  el salón se apoya en su representante. **No reemplaza al docente.**
2. Aporta **hechos** de asistencia; **nunca** toca la lista oficial, los horarios ni las credenciales.
  La autoridad sobre el catálogo es de Rectoría. *(Regla del Worker: `catalogWritten: isAdmin`.)*
3. Su celular **no guarda la llave de firma** de los carnés: la tarjeta de clase se valida contra la nube
  del colegio en el momento. Con un teléfono perdido no se pueden fabricar carnés.
4. Su escaneo **se guarda al instante** y entra a una **cola de envío** (la cola es durable: no se pierde
  si se cierra la app o se va la señal).
5. **La sincronización automática de sus escaneos no está implementada todavía.** Fue una **decisión**:
  (a) mantener la compatibilidad de lo que hoy sí funciona (no romper la sincronización de Docencia y
  Rectoría), y (b) **no multiplicar los dispositivos con capacidad de escritura** mientras no exista un
  caso de uso formal de representantes.
6. Hoy los portales **autorizados para el autosincronizado** son **Docente** y **Rectoría**.
7. **Nada quedó a medias en el diseño**: el camino ya está construido y probado (rol de operador por
  identidad, endpoint de hechos idempotente con `opId`, cola durable con tope de 2000 operaciones,
  deduplicación en la nube con ventana de 24 horas, guardas de servidor). Activarlo para el
  representante es una **decisión de producto (~3 cambios aditivos, unas 25 líneas)**, no un proyecto
  desde cero.
8. **Se midió en producción**: 29 de 30 comprobaciones en verde (15/09/2026) y el punto que quedó
  fuera fue exactamente este. Encuadre: *"sabemos dónde está el límite porque lo medimos; no lo
  escondemos y sabemos cómo cerrarlo"*.
9. Precaución honesta para la demo: el escaneo llega a la base de datos oficial (D1: exportaciones,
  métricas) por el canal de hechos; para que **otro teléfono** lo vea en su pantalla hace falta que
  algún dispositivo publique el paquete de sincronización (lo hacen Docencia/Rectoría al sincronizar).
  Diga "se publica en la próxima sincronización del colegio", **nunca** "aparece al instante".
10. **No prometa el "ciclo de 5 minutos"** para el portal del estudiante: verificado que ese ciclo, sin
  ediciones pendientes, **solo descarga** (no sube). Y **no** diga que cambiar la foto de perfil o
  cargar el horario en CSV fuerza la subida: la Ronda 64 lo bloqueó a propósito.

### 3.2 La estrategia persuasiva: **"decisión, no deuda"** (4 movimientos)

Escríbala en el guión en este orden, con estas ideas y sin pedir disculpas:

1. **Reencuadre del propósito** (antes de mencionar cualquier límite): *el representante es el plan B del
  profesor*: existe para que el salón tenga respaldo cuando el docente no quiera o no pueda pasar lista.
2. **Autoridad y límites duros** (una frase, sin tecnicismos): *"aporta hechos, no toca el catálogo"*, y su
  teléfono no tiene llaves de firma: la tarjeta se valida en la nube del colegio.
3. **El porqué de la decisión** (seguridad + compatibilidad, en ese orden): *preferimos no multiplicar los
  teléfonos con permiso de escritura hasta que el colegio lo pida formalmente; y no tocamos lo que ya
  sincroniza bien en Docencia y Rectoría*.
4. **La puerta abierta, con evidencia**: todo lo necesario ya existe y está probado (enumerar los 4
  mecanismos del punto 7) + *"activarlo es una decisión, no un desarrollo"* + la medida de producción
  (29/30) como prueba de rigor.

**Analogía recomendada (elija UNA y úsela una sola vez):**
- *"Es como el cuaderno de anotaciones del salón: el representante anota al instante, y la transcripción
 al libro oficial la hace quien tiene la llave."*
- *"Funciona como una consignación: la caja recibe el paquete siempre; sale en la ruta cuando pasa el
 camión."*

**Regla de las tres frases** (máximo para cerrar el tema, memorizable): *"El representante sirve, y sirve
seguro. Su trabajo se guarda siempre y hoy se publica cuando el colegio sincroniza. Encender su envío
automático es una decisión que ya dejamos lista."*

### 3.3 Banco de frases aprobadas (úsense tal cual o muy cerca)

- "El representante es una alternativa para cuando el profesor no quiere o no puede pasar lista."
- "Aporta hechos de asistencia, nunca toca la lista oficial ni las credenciales: eso es de Rectoría."
- "Su celular no guarda la llave con la que se firman los carnés: la tarjeta se valida contra la nube del colegio."
- "El escaneo queda guardado al instante y en cola: aunque se cierre la aplicación o se vaya la señal, no se pierde."
- "La sincronización automática de sus escaneos todavía no está encendida; lo decidimos así por seguridad y para no romper lo que ya funciona."
- "Hoy los portales autorizados para el autosincronizado son el de Docente y el de Rectoría."
- "La puerta quedó abierta: el camino ya está construido y probado. Encenderlo es una decisión, no un desarrollo."
- "En la prueba en producción pasamos 29 de 30 y el único punto que quedó fuera fue justamente este: sabemos dónde está el límite porque lo medimos."

### 3.4 Frases PROHIBIDAS (si aparecen, el guión se devuelve)

- "El ciclo de 5 minutos subirá los registros" o cualquier promesa de envío automático desde el portal del estudiante.
- "Cambiar la foto de perfil o cargar el horario fuerza la sincronización" (falso: verificado).
- "El representante reemplaza al docente" / "el registro del representante es la lista oficial".
- "El autosincronizado del representante falla / está roto / quedó pendiente sin solución" (es una decisión consciente).
- "El estudiante verá la marca al instante en su perfil".
- Cualquier dato de seguridad operativo sensible: tokens, URLs de administración con parámetros, claves, correos reales, datos de menores. Para la demo, use un curso de ejemplo o difumine.
- Cifras no verificadas en el repositorio (líneas de código, número de rondas, número de comprobaciones): si se usan, deben salir de `AGENTS.md` / informes, y el guión debe decir de dónde.

## 4. Qué debe mostrar el guión (recorrido y escenas)

Mantenga el recorrido del guión v1 y **etiquete cada escena con el presentador** que la dice. Mapa
sugerido (ajústelo si mejora el ritmo, pero respete el orden lógico):

| # | Escena | Quién | Qué se muestra / dice | Min. |
|---|---|---|---|---|
| 1 | Apertura y promesa | P1 | Qué van a ver, en una frase; quiénes son los tres | 1 |
| 2 | El problema del colegio | P1 | Pasar lista a mano, papeles, planillas, tiempo perdido | 1.5 |
| 3 | El sistema en una imagen | P2 | Los tres portales y qué resuelve cada uno | 1.5 |
| 4 | Rectoría en vivo | P2 | Matrícula, planilla del día, horarios, tarjetas QR, exportación | 2.5 |
| 5 | Docencia en vivo | P3 | Llamado de lista por bloques, escáner, tarjeta de clase | 2 |
| 6 | Carné digital del estudiante | P3 | Carné CR80, historial, justificaciones | 1.5 |
| 7 | **El representante** | P1 | Escanear la tarjeta de clase → clase activa + auto-registro; escanear a un compañero; **aquí va la estrategia de §3** | 3 |
| 8 | Por qué es confiable | P2 | Firma HMAC, verificación en la nube, roles, datos guardados aunque se caiga la señal, 29/30 en producción | 2 |
| 9 | **Cómo se hizo (VibeCoding)** | P3 | Rondas de trabajo con agente, auditorías que encontraron y corrigieron bugs, pruebas automatizadas, bitácora `AGENTS.md` | 2 |
| 10 | Lo que sigue | P1 | Cerrar la Nota 2 (encender el autosync del representante), representantes con caso de uso formal, más cursos | 1 |
| 11 | Cierre y preguntas | P2 | La frase de cierre + traspaso al bloque de preguntas | 1 |

**Reglas de escritura del guión:**
- Formato por escena: `### Escena N — Título (Presentador X, ~N min)` + `**En pantalla:**` + `**Decir:**` (texto literal entre comillas) + `**Muestre:**` (acciones de la demo) + `**Si algo falla:**` (plan B de esa escena).
- Las intervenciones se escriben **en lenguaje hablado**, frases cortas, sin tecnicismos sin traducir. Si un término técnico es imprescindible (por ejemplo "cola de envío"), se explica en la misma frase con una comparación cotidiana.
- **Público amplio:** nada de siglas sin explicar (D1, KV, HMAC, snapshot). Si se menciona la nube, se dice "la nube del colegio".
- **Fidelidad 100 % a la app:** cada botón, pestaña y texto entre comillas debe existir tal cual (fuente: `tests/evidence/r70_inventario_ui_guion.txt`).
- **Números**: solo los verificados. Está permitido decir "80 estudiantes y 20 docentes" si el guión v1 ya lo validó, y "29 de 30 comprobaciones en la prueba en producción del 15/09/2026".

## 5. Los tres presentadores (reparto y ensayo)

- Nómbrelos **Presentador 1, 2 y 3** en el guión (los nombres reales se ponen al final, a mano).
- Cada uno debe tener: (a) una escena "de lucimiento" (demo o idea fuerte), (b) al menos un traspaso explícito (*"…y para mostrar cómo se ve esto, le paso a ___"*), y (c) la misma cantidad aproximada de texto.
- Sugerencia de perfiles (el dueño puede reasignar): **P1** = narrativa y representante (apertura y encuadre); **P2** = producto y confiabilidad (Rectoría y seguridad); **P3** = aula y método (Docencia, estudiante y VibeCoding).
- Incluya al final una **tabla de reparto de tiempos** (minutos y porcentaje por presentador) y una **chuleta de una página por presentador** (solo sus frases clave, lo que muestra y su plan B).

## 6. La demo en vivo (incluir en el guión)

- **Orden de la demo** (con quién maneja el mouse y quién narra): Rectoría → Docencia → Estudiante/Representante.
- **Checklist previo** (10-15 minutos antes): sesión iniciada en el rol correcto, un curso de ejemplo cargado, la tarjeta de clase del docente lista, un carné de ejemplo a mano, la pantalla con zoom suficiente, notificaciones silenciadas.
- **Plan B si falla internet**: el guión debe indicar qué escena se salta, qué se muestra en su lugar (capturas preparadas) y la frase de transición para no perder el hilo (*"mientras vuelve la conexión, les muestro el mismo flujo en capturas"*). Recuerde: el sistema **captura sin internet** (la cola guarda), ese es un argumento, no una excusa.
- **Pantalla limpia**: no mostrar tokens, claves, ni datos identificables de menores.

## 7. Entregables (exactos)

1. `GUION_PRESENTACION_INAS_v2.md` — guión completo con las 11 escenas (o las que resulten), etiquetado por presentador, con "En pantalla / Decir / Muestre / Si algo falla".
2. `GUION_PRESENTACION_INAS_v2.pdf` — generado con `node scripts/gen_guion_pdf.mjs GUION_PRESENTACION_INAS_v2.md GUION_PRESENTACION_INAS_v2.pdf`.
3. Al final del propio Markdown: **anexo A** (tabla de reparto de tiempos), **anexo B** (chuletas por presentador), **anexo C** (preguntas difíciles y respuestas aprobadas, mínimo 8, incluyendo las de §3), **anexo D** (checklist de la demo).
4. Un **informe de una página** en el chat: qué cambió frente al guión v1, qué citas de la interfaz se verificaron y con qué comando, y qué no se pudo verificar.

**Restricciones técnicas del PDF:** el generador usa una fuente con repertorio Latin-1: **no use emojis ni flechas** (`→`, ``, etc.): escriba "»" o "hacia". Después de generar, verifique el PDF con extracción de texto (pdfjs-dist) que no haya caracteres raros y que las frases clave estén presentes.

## 8. Lista de verificación antes de entregar

1. ¿Cada texto entre comillas existe en la app? (comando de §2, 9 checks).
2. ¿Se respetan las frases prohibidas de §3.4? (busque en el Markdown las palabras "5 minutos", "instantáneo", "al instante", "falla", "roto").
3. ¿La explicación del representante sigue los 4 movimientos de §3.2 y usa la analogía una sola vez?
4. ¿Están los tres presentadores con reparto equilibrado y traspasos explícitos?
5. ¿Hay escena de VibeCoding con un ejemplo concreto de cómo se trabajó (rondas + auditorías + pruebas)?
6. ¿El guión dice que el sistema **captura sin internet** y que **la publicación la hace el colegio al sincronizar**?
7. ¿La duración total está entre 15 y 18 minutos y el reparto entre %28 y %38 por presentador?
8. ¿Sin emojis/flechas y con el PDF verificado?

## 9. Rúbrica con la que se evaluará su guión (para el usuario)

1 punto cada una (máximo 8): (1) fidelidad 100 % a la UI; (2) el caso del representante se entiende como **decisión**, no como falla; (3) quedan claros los tres límites (hechos sí / catálogo no / sin llaves de firma); (4) la puerta abierta se justifica con los mecanismos ya construidos y probados; (5) el reparto entre tres presentadores es claro, equilibrado y con traspasos; (6) la parte de VibeCoding es concreta y honesta (rondas, auditorías, pruebas) y no un eslogan; (7) lenguaje natural y apto para público amplio (sin siglas sin explicar); (8) extensión media cumplida (15-18 min) con plan B para la demo.

Señal de alarma: si el guión dice "no se ha implementado" sin explicar **por qué** y **qué quedó listo**, o si promete sincronización automática en el portal del estudiante, está incumpliendo este encargo.

--- FIN DEL ENCARGO ---

## Anexo para el usuario (no para el agente): por qué esta instrucción funciona

- **El encuadre "decisión, no deuda"** convierte el punto débil en un argumento de madurez: seguridad primero, compatibilidad primero, y una ruta de activación que ya está construida. Los cuatro movimientos evitan el orden que suele arruinar estas explicaciones (empezar por el límite y terminar pidiendo perdón).
- **Las frases aprobadas y las prohibidas** son la parte más importante: garantizan que los tres presentadores digan **lo mismo** y que ninguno improvise una promesa que la app no cumple (los tres puntos falsos detectados en esta ronda: "ciclo de 5 minutos", "foto/horario fuerza la subida" y "aparece al instante en el perfil").
- **La evidencia citada** (9 + 15 + 15 + 12 comprobaciones locales y 29/30 en producción) le da al guión respaldo verificable: si alguien del público pregunta "¿cómo saben eso?", hay una prueba que lo demuestra.
- **El reparto en tres voces** con traspasos y chuletas reduce el riesgo de que la presentación se vuelva un monólogo y reparte la carga de ensayo.
