# Guion de presentación — Sistema de Control de Asistencia con Carné Digital (INAS)

**Versión que se muestra:** prototipo final (Ronda 69). Todo lo que dice este guion existe hoy, tal cual, en la aplicación.
**Público:** amplio — estudiantes, familias, docentes, directivos y evaluadores. Sin tecnicismos.
**Duración:** 12 a 15 minutos de demostración + 3 de preguntas.
**Idea de fondo:** el sistema reemplaza el llamado a lista en papel y el carné de cartón por un **carné digital firmado** y un **escáner** que registra la asistencia por bloque de clase, funciona **sin internet** y luego sincroniza con la nube.

---

## 1. Antes de empezar (2 minutos de preparación)

- **Abra la aplicación** en el navegador: `https://hiroshiren86-sketch.github.io/Student-Pass-ID/`
- **Tenga a mano** las credenciales del paquete de entrega: la cuenta de **Rectoría**, la de un **docente** y el **código + clave** de un estudiante (van impresos en el reverso de su carné).
- **Mire la hora.** La jornada del colegio va de 6:30 a.m. a 12:30 p.m. Si la demostración es fuera de ese horario, la aplicación mostrará **"Jornada cerrada (06:30 – 12:30)"** y no permitirá escanear. **Eso no es un error: es una guarda del sistema** (no deja marcar asistencia en jornada cerrada). Dígalo con naturalidad y siga el recorrido; si puede hacer la demo en horario lectivo, mucho mejor.
- **Prepare el equipo:** pantalla completa, zoom al 100 %, y el **lector de códigos USB** conectado si va a escanear un carné de verdad (también funciona con la cámara del portátil o del celular).
- **Reparta los papeles:** una persona narra y otra da clic, o la misma persona hace las dos cosas. Las líneas marcadas con **Decir:** son para leerlas o parafrasearlas.
- **Si va a hacer Push desde un equipo recién instalado:** pegue primero el **"Token de Acceso del Worker"** en **Ajustes » Sync y Seguridad** (doble llave: sesión de Rectoría + token del terminal). Sin él, el push sube solo los hechos de asistencia y no el catálogo — es seguridad por diseño, no un fallo.

> Regla de oro para el presentador: si algo no sale como dice el guion, **no improvise una explicación técnica**. Diga "lo repito una vez más" y continúe; al final, el anexo 6 dice qué está probado y qué no.

---

## 2. El recorrido, escena por escena

### Escena 0 — La entrada: tres puertas, un mismo sistema (1 min)

**En pantalla:** la pantalla de acceso muestra tres tarjetas de perfil y, al pie, "Acceso verificado con Firebase Auth".

**Haga:** pulse la tarjeta **"Rectoría / Admin — Gestión académica y configuración"**, escriba el correo y la contraseña, y entre con **"Ingresar (Rectoría / Admin)"**.

**Decir:** *"No son tres aplicaciones distintas: es una sola que se abre de forma distinta según quién entra. Rectoría entra con su correo institucional; el docente, con el suyo; y el estudiante, con el código y la clave que van impresos en el reverso de su carné. Nadie ve más de lo que le corresponde."*

**Si desea mostrarlo:** cierre la sesión y enseñe la tarjeta **"Estudiante / Representante — Carné digital y asistencia"**: allí los campos cambian a **"Código de Estudiante o Tarjeta de Identidad"** y **"Código de Acceso Seguro (Reverso Carné)"**.

### Escena 1 — El directorio: la matrícula y los representantes (1,5 min)

**En pantalla:** al entrar, lo primero es el **"Directorio Escolar — Registro y Gestión de Estudiantes"**.

**Muestre, en este orden:**

1. Los botones de trabajo: **"Cargar Archivo(s)"** (fichas PDF, fotos de carné, CSV o SIMAT), **"Restablecer claves (todos)"** y **"+ Nuevo Estudiante"** (ficha individual, con clave y cuenta opcionales).
2. El **selector de cursos**: **"Todos los Cursos (80)"**, con la matrícula real del colegio: Grado 6°4 · 14 estudiantes, 7°4 · 14, 8°4 · 14, 9°3 · 13, 10°3 · 13 y 11°3 · 12.
3. La tabla: nombre del estudiante, **Grado / Curso**, **Tipo / Documento** (por ejemplo "TI 1700000137"), el **Código QR / Barras** y la columna **"Rol en Aula"**.

**Haga:** en la columna "Rol en Aula", pulse **"Hacer Rep"** en un estudiante del curso que va a usar (por ejemplo, uno de 6°4). El botón cambia a **"Representante"** con una corona: ese estudiante queda nombrado representante de su salón. (Si se equivoca, ese mismo botón lo quita.)

**Decir:** *"Aquí vive la información del colegio: quién es cada estudiante y quién lo representa. Un representante de salón se nombra con un clic, y eso es lo que después le habilita su propio escáner."*

### Escena 2 — Los carnés: identidad física y digital (1 min)

**Vaya a:** menú **"Módulos"** » **"Generador de Carnés PDF"**.

**Muestre:** el recorrido impreso en pantalla —**"1 Registro Manual"**, **"2 Generar & Imprimir (PDF)"**, **"3 Escaneo de Asistencia"**—, el rótulo **"Módulo de Emisión Criptográfica • CR80 (85.6 x 53.98 mm)"** y el botón **"Descargar Todos (80 Carnés PDF)"**.

**Haga:** pulse **"Previsualizar"** en un estudiante y abra su carné. Señale el anverso (institución, foto, nombre, grado y sección, y la palabra **"HMAC"**) y el reverso (**"Credenciales de Consulta"** con **CÓDIGO**, **PIN PORTAL**, el aviso de vigencia y el código de barras).

**Decir:** *"El carné se imprime en tamaño tarjeta, para plastificar o para impresora de carnés. Y no es un adorno: el código va firmado con criptografía, así que un carné copiado o alterado no sirve para registrar asistencia."*

### Escena 3 — El horario: la columna vertebral del día (1,5 min)

**Vaya a:** **"Módulos"** » **"Horarios Escolares"**.

**Muestre:** el título **"Constructor de Horarios & Bloques Pedagógicos"**, las vistas (**"Por Día"**, **"Semana Completa"**, **"Estructura de Horas"**, **"Plantillas"** y **"QR de Clase"**), el botón **"Importar CSV"** y los seis bloques de 55 minutos: del bloque **"1ª"**, con la franja **"06:30 - 07:25 (55 min)"**, al bloque **"6ª"**, **"11:35 - 12:30 (55 min)"**, con el **"Recreo / Descanso Principal 09:15 - 09:45 (30 min)"** entre el tercero y el cuarto.

**Haga:** abra la vista **"QR de Clase"** y muestre **"Tarjetas QR de Docentes — la tarjeta es la identidad del docente, no el aula"** y el botón **"Imprimir todas las tarjetas QR de docentes"**.

**Decir:** *"El horario es el reloj del sistema: cada bloque de 55 minutos sabe quién debería estar en clase. Y cada docente tiene su tarjeta QR: la lleva en el bolsillo, la escanea al entrar al salón y con eso activa su asignatura en el equipo del aula. Un solo papel sirve todo el año."*

### Escena 4 — Los docentes: credenciales y cátedras (1 min)

**Vaya a:** **"Módulos"** » **"Gestión Docentes"**.

**Muestre:** el encabezado **"Administración • Gestión de Personal"**, el título **"Panel de Control de Docentes & Credenciales"**, el contador **"20 docentes registrados"**, el botón **"Registrar Nuevo Docente"**, **"Restablecer claves (todos)"** y el buscador (**"Buscar docente por nombre, cédula, materia o usuario..."**). En una ficha, señale sus asignaturas (por ejemplo "Matemáticas", "Geometría"), el distintivo de **Director de Grupo** ("Director de Grupo:6°4") cuando lo tiene, su usuario, su clave temporal y el botón **"Crear Cuenta"** para quien aún no tiene acceso (**"Sin cuenta de acceso aún — use \"Crear Cuenta\""**).

**Decir:** *"Rectoría crea la cuenta del docente y le asigna sus materias. La clave temporal sirve para el primer ingreso y después se cambia; el sistema no vuelve a mostrar la clave personal de nadie."*

### Escena 5 — Escanear: la asistencia en un segundo (1,5 min)

**Vaya a:** pestaña **"Escanear"** del menú superior.

**Muestre:** el rótulo **"CAPTURA EN VIVO • CR80"** con la etiqueta **"Offline-Ready"**, el reloj corriendo, **"Sonido ON"**, y las dos formas de lectura: **"Lector USB / OTG"** y **"Cámara Móvil / QR"** (con la nota **"Lectura Óptica Instantánea (<0.5s)"** y la instrucción **"Pase el carné por el escáner"**). Abajo está **"Últimos Registros del Día"**.

**Haga:** pase un carné por el lector, o escríbalo en el campo **"Esperando lectura de carné..."** y pulse Enter. El estudiante aparece al instante en "Últimos Registros del Día" con su hora.

**Decir:** *"Escáner profesional de carné o simplemente la cámara del celular: los dos caminos guardan el mismo registro. Y funciona sin internet: si se cae la red, el sistema sigue escaneando y luego sube todo solo."*

### Escena 6 — El aula del docente: la cascada de escaneo (2 min)

**Vaya a:** el botón de perfil de la esquina superior derecha (**"Rectoría / Admin"**) » **"Cambio Rápido de Perfil de Acceso"** » **"Docente (Aula y Horarios)"** » **"Elegir Docente"** » seleccione uno » entre a **"Aula de Clase & Control de Asistencia"**.

**Muestre, en este orden:**

1. **"Curso / Grado"** y **"Bloque de Horario"**: el docente elige su grupo y su bloque.
2. **"Jerarquía de Escaneo en Aula (Cascada de 3 Niveles): Nivel 1: Representante Titular • Nivel 1.B: Suplente • Nivel 2: Delegado Efímero • Nivel 3: Docente"**, con la tarjeta del **Titular** (el representante nombrado), el **Suplente**, el **"Delegado Efímero"** y el botón **"+ Delegar a Estudiante de Fila"**.
3. El aviso **"Ventana de Auto-Cierre Proporcional"** (el bloque se cierra solo **T-11 minutos** antes de su fin) y la frase **"Regla de Oro: Si hay 0 escaneos = 0 ausencias"**.
4. Los botones del aula: **"Activar en este dispositivo"** (la tarjeta del docente), **"Mis Cátedras"**, **"Mis Tarjetas QR"**, **"Escanear con Cámara"**, **"Cerrar Bloque (T-11)"** y **"Registrar"**.

**Decir:** *"Si el docente está explicando y no puede pasar lista, el sistema tiene una jerarquía clara: primero el representante titular del salón, luego su suplente, y solo por excepción un delegado momentáneo. Y hay dos protecciones: el bloque se cierra solo once minutos antes de terminar, y si no hubo ni un escaneo el sistema entiende que no hubo clase y no marca ausencias."*

### Escena 7 — El representante de salón (1,5 min)

**Vaya a:** el botón de perfil » **"Cambio Rápido de Perfil de Acceso"** » **"Estudiante / Acudiente"** » **"Elegir Estudiante / Acudiente"** » busque al estudiante que nombró representante en la escena 1 (puede filtrar por curso). Fíjese en la etiqueta que acompaña al buscador: **"80 estudiantes · catálogo en la nube"**.

**Muestre:** en su portal aparece **"Modo Representante de Salón (6°4)"** con la explicación *"Tienes permiso para escanear carnés de tus compañeros de salón y apoyar al docente en el llamado a lista"*.

**Haga (dos partes):**

1. **Primero la tarjeta de clase.** Con la pantalla del docente (Escena 6) abra **"Mis Tarjetas QR"** y muestre la tarjeta con QR; luego, en el portal del representante, escanee esa tarjeta. Aparecerá el mensaje **"Clase activa…"** con la asignatura y el bloque del reloj, y **"· Firma verificada por la nube del colegio"**. El propio representante queda auto-registrado (por ejemplo, *"Además quedaste registrado (TARDANZA)"*).
2. **Después un compañero.** En **"Escanear carné de compañero"** pase el carné de un compañero (o escriba su código) y pulse **"Registrar"**.

**Decir (esta es la parte que conviene decir con exactitud):** *"El representante no es un administrador: él aporta **hechos** de asistencia, nunca toca la lista oficial de estudiantes, los horarios ni las credenciales — la autoridad sobre el catálogo la tiene solo Rectoría. Y hay un detalle fino: su celular no guarda la llave con la que se firman los carnés, por eso la tarjeta de clase se valida contra la nube del colegio en el momento; así, aunque un teléfono se pierda, con él no se pueden fabricar carnés."*

**Aclaración técnica honesta (para la ronda de preguntas, no para narrar):** el escaneo del representante **se guarda al instante** en su dispositivo y **entra a una cola de envío**; esa cola reenvía los hechos al servidor por la ruta de asistencia (idempotente, un hecho por escaneo, nunca el catálogo). En la prueba en producción del 15/09/2026 (informe R70) este era **el único punto parcial de 30 comprobaciones**: el auto-registro quedó bien guardado en el teléfono, pero su publicación automática desde el portal del estudiante aún no tenía disparador propio (el reenvío vivía en el Escáner de Rectoría/Docente). Es decir: **el dato no se pierde —se publica cuando ese u otro terminal del colegio sincroniza—, pero hoy no sale solo desde el portal.** Si preguntan "¿ya está arreglado?": responda *"está diagnosticado y con la corrección propuesta y verificable"*, y no prometa el ciclo automático de 5 minutos para el portal.

### Escena 8 — La planilla y el buzón: la mañana, resuelta (2 min)

**Vaya a:** el botón de perfil » volver a **"Rectoría / Admin"** (ese mismo panel ofrece **"Volver a Rectoría / Admin"**) » pestaña **"Planilla"**.

**Muestre:** **"Consolidado Diario & Analítica"**, los totales (**"Matrícula Activa 80"**, **"Presentes (hoy)"**, **"Puntuales"**, **"Tardanzas"**, **"Justificadas"**), el botón **"Descargar Planilla (Excel / CSV)"**, el filtro de curso (**"Todos los Cursos"**, **"Curso 6°4 · 0 reg. · 14 matric."**) y el filtro de estados (**"Todos los Estados"**, **"Puntuales"**, **"Tardanzas"**, **"Ausentes (Inasistencias)"**).

**Haga:** si hay un ausente, pulse su botón **"Justificar"** y muestre el formulario: las razones en un toque (**"Cita médica"**, **"Incapacidad"**, **"Calamidad doméstica"**, **"Evento deportivo"**, **"Otra"**), la casilla del soporte físico y el botón **"Radicar"**.

**Luego vaya a:** pestaña **"Buzón"**. Muestre **"Buzón unificado (Portal + Planilla)"**, su campanita, los filtros **"Bajo revisión"**, **"Verificada"**, **"Rechazada"**, **"Todas"**, y la explicación al pie: *"Las radicaciones del Portal (anticipadas) y de la Planilla (1 toque) aparecen aquí."* Si hay pendientes, muestre **"Aprobar pendientes"** y el **"Verificar expediente"** (que abre la cadena de auditoría).

**Decir:** *"Aquí se ve el ahorro de tiempo: la excusa entra por dos caminos, desde el portal del estudiante antes de faltar o desde la planilla con un toque; Rectoría decide en la misma pantalla, y todo queda con auditoría: quién aprobó, cuándo y con qué soporte."*

### Escena 9 — El portal del estudiante: su carné en el celular (1,5 min)

**Vaya a:** perfil » **"Estudiante / Acudiente"** » elija un estudiante cualquiera (no el representante, para variar) » **"Portal Estudiante / Acudiente"**.

**Muestre:** los indicadores de asistencia (**"Total Clases"**, **"Puntuales"**, **"Tardanzas"**, **"Inasistencias"**, **"% Asistencia Global"**), el **"Carné Estudiantil Digital CR80 Oficial • 2026"** con sus botones **"Visualizar Carné"**, **"Personalizar Foto"** y **"Descargar PDF"**, la sección **"Mi horario (opcional)"** con **"Cargar mi horario (CSV)"**, **"Mis Justificaciones"** con **"Nueva justificación"** y el **"Historial de Clases Registradas"**.

**Decir:** *"El estudiante lleva su carné en el bolsillo, lo muestra desde el celular si lo necesita, revisa cómo va su asistencia y radica una excusa antes de faltar para que su registro quede protegido. La familia ve lo mismo que ve el colegio."*

### Escena 10 — Analítica e IA: leer los datos (1 min)

**Vaya a:** **"Módulos"** » **"Analítica e IA por Grado"**.

**Muestre:** el rótulo **"IA Escolar • Motor Local Heurístico ($0)"**, el selector de curso, los botones de consulta rápida (por ejemplo **"Dame un resumen conciso de 6°4"** y **"Recomendaciones para coordinación académica"**) y el aviso de honestidad **"Análisis generado por el Motor Local (sin IA real)"**.

**Decir:** *"El sistema puede sacar conclusiones sin internet y sin pagar nada, con su motor local. Si el colegio quiere usar un modelo de lenguaje potente, en Ajustes se conecta la clave del proveedor: es 'traiga su propia llave', el sistema no cobra ni revende inteligencia artificial."*

### Escena 11 — Ajustes: la nube, la seguridad y los respaldos (1,5 min)

**Vaya a:** menú del usuario (arriba a la derecha) » **"Cloudflare D1 & Sync"** (o **"Configuración & Motores IA"**).

**Muestre:** las pestañas **"Institución y Jornada"**, **"Inteligencia Artificial"** y **"Sync y Seguridad"**; los campos de jornada (**"Hora de Inicio de Jornada"**, **"Tolerancia Tardanza"**, **"Fin de Jornada"**); la **"Cloudflare Worker URL / D1 Endpoint"** con su **"Probar Conexión"**, **"Descargar (Pull)"** y **"Sincronizar (Push)"**; el bloque **"Respaldo Local (Exportar / Importar)"**; la **"Purga de la Nube (D1 + KV)"**; la **"Clave Secreta HMAC-SHA256 (QR_SECRET)"** y la casilla **"Exigir carné firmado (verificación HMAC en el escaneo)"**.

**Decir:** *"Aquí están las decisiones delicadas. La nube guarda una copia para que varios dispositivos vean lo mismo; el respaldo local permite llevarse todo en un archivo; y la purga borra la nube, pero exige token, copia previa y escribir una confirmación. Los secretos, como la llave que firma los carnés, nunca viajan a la nube: se quedan en los equipos del colegio."*

### Escena 12 — Cierre: el sistema completo en una pantalla (1 min)

**Haga:** pulse el botón del rol (arriba a la derecha) para mostrar el **"Cambio Rápido de Perfil de Acceso"**: Rectoría, Docente y Estudiante, con la etiqueta **"catálogo en la nube"** y el buscador de personas (**"Elegir Docente"** / **"Elegir Estudiante / Acudiente"**). Muestre también **"Guía rápida"** en el menú del usuario: la guía de primer ingreso que explica a cada perfil qué puede hacer, con accesos directos como **"Abrir Planilla"**, **"Abrir Buzón"**, **"Probar Escáner"** o **"Generar Carnés"**.

**Decir, para cerrar:** *"Un solo sistema, con tres puertas: Rectoría organiza, el docente registra su clase y el estudiante lleva su carné. Funciona sin internet, verifica que los carnés sean legítimos y mantiene la nube al día sin que nadie tenga que copiar nada a mano."*

---

## 3. Cómo se hizo (y qué es el VibeCoding) — 2 min

Esta es la parte "de cocina", para las preguntas del jurado o del profesor.

**El método.** El sistema se construyó por **rondas**: cada ronda es un objetivo concreto (una función nueva, un error que apareció, una auditoría) que termina con una **verificación**. Al día de hoy el proyecto va por la **Ronda 69**, y todas las decisiones quedaron escritas en un manual técnico del propio proyecto, con el **por qué** de cada una.

**El VibeCoding.** No se escribió el código a mano línea por línea. Se trabajó "conversando" con un agente de inteligencia artificial: el responsable del proyecto **describe en lenguaje natural qué quiere y qué está prohibido**, el agente escribe el código y ejecuta las pruebas, y el responsable **revisa el resultado en la aplicación real** y decide. De ahí salen dos reglas que explican la calidad del prototipo: **(1) cero regresiones** — antes de agregar algo nuevo, todo lo anterior debe seguir funcionando; y **(2) cero suposiciones** — nada se da por bueno sin comprobarlo.

**La disciplina de pruebas.** El proyecto trae su propio laboratorio: al cierre de la Ronda 69 había **611 comprobaciones automáticas en verde** (catálogos, filtros, el cambio de perfil con el catálogo real, la simulación de un "mini colegio" de punta a punta, políticas de seguridad) más la compilación limpia del proyecto. Cada corrección importante deja una prueba que la demuestra: por ejemplo, el flujo del representante de salón tiene su propia batería de comprobaciones, y lo mismo la verificación de carnés firmados.

**Ejemplo honesto.** Cuando el propietario preguntó si el **representante de salón** "mandaba directo a la nube", la respuesta no fue un "sí, claro": se revisó el código y el servidor, y quedó documentado que el representante envía **hechos de asistencia** por la cola de su propio dispositivo, mientras que el **catálogo** (estudiantes, docentes, horarios) solo lo escribe Rectoría. Así funciona el VibeCoding bien hecho: la IA acelera la escritura, pero **las decisiones y la verdad se verifican**.

---

## 4. Preguntas frecuentes del público (respuestas listas)

- **¿Funciona sin internet?** Sí. El escaneo, el carné digital y la planilla se guardan en el dispositivo; cuando vuelve la conexión, el sistema sube todo. Internet solo es imprescindible para entrar como Rectoría o docente y para sincronizar.
- **¿Qué pasa si se equivocan al escanear?** Cada bloque y cada curso se pueden revisar y corregir desde la planilla, y todo cambio queda auditado con usuario y fecha.
- **¿Un carné falso sirve?** No. Los carnés llevan firma criptográfica; si el carné no está firmado o está vencido, el escáner lo rechaza. Hay una casilla en Ajustes que permite operar con lectores antiguos de código de barras, pero entonces el registro queda marcado como *sin verificación criptográfica*, nunca como verificado.
- **¿Se puede justificar una falta con anticipación?** Sí, desde el portal del estudiante; y Rectoría también puede hacerlo con un toque desde la planilla.
- **Si el representante escanea desde su propio celular, ¿el registro llega a la nube?** Sí, y llega como **hecho de asistencia** (nunca como catálogo). Detalle honesto probado en producción el 15/09/2026: el registro se guarda al instante en el teléfono y entra a la cola de envío; en esa jornada su **publicación automática desde el portal** quedó pendiente del próximo ciclo de sincronización del colegio (fue el único punto parcial de 30). La corrección está diagnosticada y propuesta, con verificación, en `ANALISIS_R70_OUTBOX_REPRESENTANTE.md`.
- **¿Cuánto cuesta?** El sistema corre con servicios que tienen plan gratuito (Firebase para las cuentas, Cloudflare para la nube) y su propia IA local. Si el colegio quiere un modelo de lenguaje externo, cada usuario pone su clave: no hay costo obligatorio ni licencias por estudiante.

---

## 5. Chuleta del presentador (una página)

- **Entrar como Rectoría:** tarjeta **"Rectoría / Admin"** » correo y contraseña.
- **Matrícula y representantes:** menú superior **"Directorio"** » columna **"Rol en Aula"** » **"Hacer Rep"**.
- **Carnés:** **Módulos** » **"Generador de Carnés PDF"** » **"Previsualizar"** o **"Descargar Todos (80 Carnés PDF)"**.
- **Horario y tarjetas QR de docentes:** **Módulos** » **"Horarios Escolares"** » vista **"QR de Clase"**.
- **Docentes:** **Módulos** » **"Gestión Docentes"** » **"Crear Cuenta"**.
- **Escanear:** pestaña **"Escanear"** » **"Lector USB / OTG"** o **"Cámara Móvil / QR"**.
- **Aula del docente:** botón del rol » **"Docente (Aula y Horarios)"** » **"Elegir Docente"**.
- **Representante de salón:** botón del rol » **"Estudiante / Acudiente"** » **"Modo Representante de Salón"** » **"Abrir Escáner de Aula"**.
- **Planilla y excusas:** pestaña **"Planilla"** (botón **"Justificar"**) y pestaña **"Buzón"**.
- **Portal del estudiante:** botón del rol » estudiante » **"Visualizar Carné"**, **"Nueva justificación"**.
- **Analítica con IA:** **Módulos** » **"Analítica e IA por Grado"**.
- **Nube y seguridad:** menú de usuario » **"Cloudflare D1 & Sync"**.
- **Cambiar de perfil:** botón del rol, arriba a la derecha (**"Cambio Rápido de Perfil de Acceso"**).
- **Guía de primer ingreso:** menú de usuario » **"Guía rápida"**.

---

## 6. Honestidad y evidencia (para el cierre)

- **Lo que está probado en este guion:** cada texto entre comillas existe hoy en la aplicación final. Las pantallas se recorrieron y verificaron con un inventario automático de la interfaz real (`tests/evidence/r70_inventario_ui_guion.txt`), y el flujo del representante de salón hacia la nube tiene una batería propia de 15 comprobaciones (`tests/evidence/r70_representante_nube.txt`).
- **Prueba en producción del 15/09/2026 (informe R70, "Pruebita del Representante"):** **29 de 30 comprobaciones en verde** — login real de Rectoría en dispositivo limpio, **"Hacer Rep"** con insignia en la fila, push verificado por API, tarjeta `CLASE:v2` firmada por producción y decodificada del PNG, login del estudiante tras borrado total del navegador, **"Modo Representante de Salón (7°4)"** llegado por la nube, firma validada por el servidor, hora de clase sin bloquearse, auto-registro con materia/docente/bloque y **cero errores de JavaScript**.
- **El único punto parcial (fila 11 del informe):** el auto-registro quedó guardado en el teléfono, pero **su publicación automática desde el portal del estudiante no tenía disparador** (el reenvío por cola está cableado en el Escáner de Rectoría/Docente). No es pérdida de datos: los hechos viajan cuando ese dispositivo u otro terminal sincroniza. El análisis con líneas de código y la corrección propuesta (3 cambios aditivos, sin abrir permisos nuevos) están en `ANALISIS_R70_OUTBOX_REPRESENTANTE.md`.
- **Nota 1 del mismo informe (configuración, no fallo):** en un dispositivo **recién instalado**, un Push de Rectoría exige la **doble llave** (sesión de Rectoría **y** el *Token de Acceso del Worker* pegado en **Ajustes » Sync y Seguridad**). Sin ese token el push queda como *solo-hechos*. Para la demo: pegue el token antes de presentar (o haga el Push desde el equipo que ya lo tiene).
- **Lo que no se pudo probar desde el entorno de desarrollo:** la ejecución completa en producción y los seis guiones de simulación "mini colegio" (el entorno de desarrollo no tiene salida a internet). Están escritos y listos para ejecutarlos desde el colegio.
- **Lo que se dice con precisión:** el representante de salón **no** escribe directamente el catálogo de la nube; envía **hechos de asistencia** desde la cola del dispositivo, y el servidor solo acepta cambios de catálogo de Rectoría. Es una decisión de seguridad, no una limitación.
- **Estado de verificación local:** 611 comprobaciones automáticas en verde al cierre de la Ronda 69, más las 9 de este inventario de interfaz y las 15 del flujo del representante.

---

*Guion preparado para la presentación del prototipo final. Si necesita una versión de 5 minutos: escenas 0, 2, 5, 6, 8 y 12.*
