# Usar Rey30 IDvj

Abre `Iniciar-Rey30-IDvj.bat` desde la carpeta del proyecto. El lanzador utiliza la versión de escritorio preparada. Los modelos y conversaciones permanecen en su carpeta de datos; no se copian junto al ejecutable.

## Chat y perfil

El cuadro para escribir está al pie del chat. En la parte inferior de la barra lateral, el avatar abre Perfil, Configuración, GitHub y las opciones de recursos. El nombre y las iniciales se guardan localmente. GitHub es una conexión opcional y no es necesario para conversar.

## Asistentes de chat y voz

En **Asistentes**, en la barra lateral, elige a Atlas para arquitectura, Forja para backend, Lince para depuración, Senda para interfaces, Vértice para infraestructura, Nova para pruebas o Centinela para seguridad. El acceso abre el último chat independiente del asistente o prepara uno nuevo. El selector superior también permite cambiar de asistente dentro de la conversación abierta. El engranaje de la sección abre la administración de perfiles.

La personalidad hablada se aplica a las intervenciones que dictas en una sesión de voz. Por escrito, Nova trabaja como ingeniera de pruebas. En voz puede usar su estilo travieso según tus ajustes. **Verso** compone y recita poesía al activar la voz. Su respuesta por escrito usa un registro neutro. Puedes seguir usando Rey30 IDvj como asistente general o elegir **Solo modelo**.

**Trama** es el perfil full-stack para interfaces, backend, bases de datos, depuración, pruebas, arquitectura y despliegues. Sus operaciones dependen del modelo, las herramientas y los permisos de la sesión.

**Pluma** consulta `D:\Libreria General` en chat y voz. Busca pasajes de novelas, cartas, poemas y otros textos, y usa sus rutas para citar fuentes. Selecciona un modelo local de Rey30 y abre un chat guardado. El índice se prepara al consultar la biblioteca por primera vez. Para releer la carpeta, abre **Configuración → Asistentes → Editar Pluma → Actualizar índice**. La protección local del historial se conserva al cambiar de asistente dentro de ese chat.

1. Elige un personaje con un modelo disponible asignado. El selector muestra su nombre y modelo; al volver a un hilo se recupera la selección de ese hilo.
2. Abre **Opciones del asistente** para configurar voz, visibilidad y animación. Funcionan por separado: puedes escribir con la voz apagada y mantener el indicador inmóvil si lo prefieres.
3. El orbe de voz es una esfera con aro de colores en la esquina del chat. Su control **Iniciar voz** solicita el micrófono explícitamente; seleccionar un personaje o abrir sus opciones no lo activa. La conversación escrita permanece disponible.
4. **Pausar voz** detiene la conversación de voz. **Solo chat** detiene el micrófono y el audio y desactiva la voz automática del personaje; conserva el personaje elegido y la conversación. Para conversar sin sus instrucciones, elige el asistente Rey30 IDvj o **Solo modelo** en el selector superior.

En Configuración → Asistentes, pulsa **Editar** en la fila del perfil. También puedes abrir **Configurar personaje** desde sus opciones en el chat. El editor muestra la función de chat y permite cambiar nombre, descripción, personalidad de voz, humor, energía, longitud de respuesta, apodo y colores. En voz, elige **Charla**, **Serio** o **Trabajo**, o di «háblame en serio» o «vamos a trabajar». Pulsa **Guardar cambios** y **Cerrar editor** para volver.

**Modelo del personaje** vincula un proveedor y modelo que ya estén disponibles. **Asignar automáticamente un modelo local pequeño** intenta completar la asignación desde los modelos locales compatibles; si no hay ninguno, debes elegir o instalar uno antes de utilizar el personaje. Cambiar esta referencia no descarga ni carga pesos. **Duplicar** crea otro perfil editable; **Restaurar este perfil** recupera su perfil original sin borrar conversaciones ni las notas de memoria.

**Exportar perfil guardado** descarga el perfil persistido en JSON. **Importar perfil** admite ese formato, lo valida y crea una identidad nueva, conservando los perfiles existentes y dejando la voz desactivada. Guarda los cambios antes de exportar: el archivo no incluye ediciones pendientes ni la memoria, que tiene su propia exportación.

### Memoria voluntaria

En **Memoria**, escribe notas y activa **Usar memoria individual** si quieres incluirlas en las peticiones de ese personaje. Dentro de un chat de proyecto también puedes habilitar notas compartidas entre sus personajes; no se comparten con otros proyectos. Pulsa **Guardar cambios**. No se generan recuerdos automáticamente.

Puedes borrar solo la memoria individual o la del proyecto, o usar **Exportar memoria guardada** para descargar las notas persistidas. Si eliges un proveedor remoto, recibirá las notas habilitadas que formen parte de la petición; los controles de privacidad del chat se aplican a ese envío.

### Audio español local

La distribución Windows x64 incluye **eSpeak NG 1.52.0**, compilado para Rey30 desde sus fuentes oficiales, y seis variantes sintéticas de español latino. Sus timbres son sintéticos; no son voces clonadas ni imitaciones de actores. En **Voz** puedes seleccionar una voz instalada, ajustar velocidad, tono y volumen, y pulsar **Escuchar muestra**. El tono independiente está disponible con eSpeak NG. El catálogo también muestra las voces instaladas que Windows expone; su disponibilidad depende del equipo. Consulta las fuentes oficiales de [eSpeak NG 1.52](https://github.com/espeak-ng/espeak-ng/releases/tag/1.52.0) y de las [voces instaladas de Windows](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.getinstalledvoices?view=netframework-4.8.1).

El orbe presenta el estado y la actividad de voz mediante su aro de colores. El botón de tres puntos, **Opciones de voz**, muestra el estado textual y los controles de reproducción y **Solo chat**. El control de animación y la preferencia del sistema para reducir movimiento permiten limitar los efectos del aro sin silenciar la voz.

El dictado español usa **Vosk 0.3.45** y `vosk-model-small-es-0.42`. El ZIP original del modelo ocupa aproximadamente **39,8 MB**. Los originales y sus SHA-256 se registran en [SOURCE.json](../src-tauri/resources/character-audio/SOURCE.json); [MANIFEST.json](../src-tauri/resources/character-audio/MANIFEST.json) registra los archivos del paquete. Versiones y modelo proceden de las fuentes oficiales de [Vosk 0.3.45](https://github.com/alphacep/vosk-api/releases/tag/v0.3.45) y del [catálogo de modelos Vosk](https://alphacephei.com/vosk/models).

En el modo de conversación del orbe, **Iniciar voz** solicita el micrófono para esa sesión. Al terminar una frase y guardar silencio, la transcripción se envía al chat actual sin escribir; cada toma está limitada a 30 segundos. Después de la respuesta hablada, la sesión vuelve a escuchar mientras siga activa. **Pausar voz** detiene la escucha y el audio; **Solo chat** vuelve a la conversación por texto. Silenciar la reproducción no detiene por sí solo los envíos: para parar la conversación usa pausar o Solo chat. Si quieres revisar el texto antes de enviarlo, mantén la voz pausada y utiliza el cuadro del chat.

El reconocimiento y la síntesis de voz son locales. El texto reconocido y las notas habilitadas se procesan con el modelo elegido. Si este es remoto, el envío sigue las reglas del modo de privacidad del chat, incluida **Nube con revisión**. Si faltan voces o dictado, puedes usar el chat por texto y consultar de nuevo el catálogo desde **Volver a consultar voces**.

## Habilidades y agentes

El botón **Habilidades** permite invocar una habilidad concreta, gestionar sus archivos y consultar el paquete de Rey30. La selección automática busca coincidencias con tu petición y carga hasta dos habilidades y un perfil de agente. Puedes desactivarla o usar `/skill:nombre instrucciones` para elegir explícitamente.

El paquete contiene 28 habilidades en español y 10 perfiles de agente. Incluye adaptaciones de fuentes revisadas, procedimientos propios y guías de integración. Cada ficha muestra fuente, licencia, requisitos y estado. Los documentos originales y avisos legales se conservan.

Una habilidad aporta instrucciones. Un perfil orienta al modelo actual; en el chat normal no inicia agentes paralelos. Las superficies que ya ofrecen delegación utilizan su registro de agentes y sus permisos existentes. Instalar una guía de OpenClaw, MatrixOS, FreeLLMAPI u otro programa no instala ese programa, inicia un servidor ni conecta una cuenta. Los requisitos se indican por separado.

El instalador del paquete conserva archivos existentes y ediciones locales. Si eliminas una habilidad, el reinicio no vuelve a crearla automáticamente. Los conflictos se muestran para que puedas resolverlos desde el gestor, conservando el recurso anterior.

## Trabajar con una carpeta

1. En la barra lateral de la aplicación de escritorio para Windows, pulsa **Abrir carpeta**. Elige una carpeta existente o crea una vacía en el selector. Rey30 IDvj comprueba la ruta y abre su sesión en **Espacio de trabajo**.
2. Selecciona un modelo compatible con llamadas a herramientas. Escribe una tarea concreta y envíala. Por ejemplo, pide que enumere los archivos y cree `resumen.md` con los nombres y su función.
3. Revisa las herramientas y los cambios en la sesión. Las creaciones y ediciones se aplican en la carpeta elegida. Si quieres revisar una propuesta antes de autorizar cambios, activa **Planificar**.
4. Para continuar otro día, vuelve a elegir la misma carpeta o abre su sesión desde la barra lateral de **Espacio de trabajo**. La carpeta y el historial de la sesión se guardan con la configuración de la app.

Las herramientas del espacio de trabajo requieren el modo de privacidad **Normal**. **Solo local** y **Nube con revisión** las bloquean. En modo **Normal** puedes elegir un modelo local compatible. Si eliges uno remoto, el texto de los archivos que el agente lea puede formar parte de la petición al proveedor.

En Windows, las sesiones con una carpeta de proyecto usan herramientas de archivo para listar, leer, crear y editar. La terminal y los monitores de comandos en segundo plano están desactivados en esas sesiones para evitar cambios en los permisos de la carpeta. En una sesión sin carpeta, la ejecución de comandos depende del entorno aislado de la aplicación.

## Servidores MCP

En Configuración → Servidores MCP, el catálogo aparece en la propia página. **Descubrir** permite buscar publicaciones del registro oficial, filtrar los resultados cargados, revisar una configuración e instalar una receta compatible. Las categorías —espacios de trabajo, redes sociales, comercio y pagos, desarrollo, datos y búsqueda, multimedia y diseño, y otras herramientas— son orientativas: se sugieren desde nombres y descripciones, no son clasificaciones oficiales ni una certificación del servidor.

**Conectados** muestra tanto conexiones operativas como **Guardados sin conectar**. Una configuración guardada o marcada para activarse no demuestra que su servidor esté conectado. El estado se consulta al servicio MCP; puede indicar **Conectado**, **Sin conexión** o **Estado de conexión no disponible**. Usa **Configurar**, **Conectar**, **Desconectar** y **Actualizar estado** según corresponda. Una publicación en Descubrir tampoco implica que la tengas instalada o conectada.

**Añadir personalizado** conserva el alta manual, y los ajustes anteriores están en **Ajustes y configuraciones MCP avanzados**. El importador de recursos también acepta repositorios o archivos locales con formatos admitidos.

**Configurar OpenClaw** revisa el puente oficial y permite guardarlo inactivo. Cuando la CLI oficial y tu Gateway estén listos, abre **Conectados** y pulsa **Conectar** en OpenClaw. El puente da acceso a conversaciones de los canales que ya configuraste en ese Gateway. [Configuración de OpenClaw](src/pages/docs/desktop/integrations/openclaw.mdx)

Las credenciales nuevas del catálogo se almacenan mediante el almacén nativo y referencias opacas en la configuración. Para un servicio con OAuth, usa **Iniciar sesión** y completa el consentimiento en el navegador del proveedor. Google o contraseña sólo están disponibles si ese proveedor los admite. Otros servidores requieren su token, variables, programa o configuración manual. No todos los repositorios ofrecen una receta instalable automáticamente.

## API para otra aplicación

En Configuración → Servidor API local, elige el modelo y configura la autenticación necesaria antes de iniciar. La tarjeta de conexión permite copiar la URL base, el identificador del modelo y una configuración de cliente. La clave se muestra oculta y se copia mediante una acción explícita.

La URL `127.0.0.1` conecta aplicaciones del mismo ordenador. Para otra máquina necesitas una dirección privada alcanzable y autenticación. Copiar esta URL no publica un servicio en Internet ni crea un túnel.

## Asistentes y modelos locales

En Agregar asistente, **Cargar desde archivo** permite revisar un archivo JSON, YAML o Markdown compatible antes de guardar. Importar instrucciones no concede permisos adicionales ni ejecuta código del archivo.

El Hub ofrece **Descargar e instalar** y la importación de modelos locales admitidos. Un modelo aparece listo cuando el motor lo ha registrado, no sólo cuando la descarga alcanza el 100 %. Importar un GGUF local mantiene una referencia al archivo. El modelo local predeterminado y su instalación se conservan.

## Restablecer configuración y guardar un punto

En Configuración → General, junto al selector de idioma, pulsa **Restablecer configuración**. Puedes usarlo aunque nunca hayas guardado un punto:

- Si existe un punto guardado, recupera las preferencias de ese punto.
- Si no existe, aplica los valores predeterminados de esas preferencias, con **español** como idioma.
- Antes de restablecer, guarda la configuración actual para que puedas pulsar **Deshacer último restablecimiento**.

**Guardar punto de configuración** guarda explícitamente tu idioma, apariencia, tema y preferencias generales actuales. Por ejemplo, puedes guardarlo en español, cambiar de idioma y recuperarlo después. Guardar otro punto sustituye el anterior. Si ya tienes un punto pero prefieres los valores iniciales, usa **Usar valores predeterminados (español)**. Si aparece un error de lectura o guardado, resuélvelo antes de dar la operación por completada.

La recuperación conserva modelos, chats, asistentes, personajes, skills, plugins, MCP, credenciales, configuración de GPU y código del programa. Solo modifica las preferencias admitidas de idioma, interfaz y tema; no elimina recursos ni revierte mejoras del programa. El antiguo reinicio destructivo está deshabilitado.

## Privacidad del chat

El control de privacidad ofrece tres estados:

- **Normal:** conserva el funcionamiento habitual y las herramientas habilitadas.
- **Solo local:** admite únicamente motores locales gestionados por la aplicación, con conexión loopback verificada. Bloquea proveedores remotos, proxies personalizados y herramientas del chat. Desactiva la telemetría.
- **Nube con revisión:** antes de cada petición remota puedes revisar el contenido, ocultar texto adicional o cancelar. Se sustituyen patrones comunes de datos sensibles. Los archivos opacos y las opciones que no puedan revisarse se rechazan, y las herramientas del chat permanecen bloqueadas.

La detección automática puede omitir datos sensibles. Revisa el contenido completo antes de aprobarlo. El proveedor recibe el texto aprobado y las credenciales necesarias para autenticar la conexión: este modo no garantiza anonimato, confidencialidad dentro del proveedor ni eliminación posterior de sus registros.

La revisión presenta el contenido de la petición del modelo; no es una captura exacta de todos los bytes de la conexión. No muestra ni oculta las cabeceras personalizadas del proveedor. Evita introducir información privada en esas cabeceras.

La protección se aplica a peticiones del modelo y herramientas del chat. No es un modo global sin Internet: catálogos, descargas, autenticaciones y otros clientes de la API tienen sus propios flujos. Cambiar de modo intenta cancelar peticiones y revisiones pendientes; no puede retirar datos que ya se hayan enviado ni deshacer una acción ya ejecutada.

## Identidad visual

El monograma R30 es vectorial y el fondo de bienvenida es un asset generado para esta distribución. El prompt y su procedencia están registrados en `artifacts/qa/product-20261104/background-generation.json`. Las capturas de aceptación se obtienen de la aplicación real y se guardan por separado.
