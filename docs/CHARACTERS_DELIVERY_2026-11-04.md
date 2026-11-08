# REINIER TAMAYO — INFORME TÉCNICO DE CODEX

Proyecto: Rey30 IDvj. Módulo: seis personajes, audio local, recuperación de preferencias y catálogo MCP. Versión Windows x64: 0.9.2. Fecha: 2026-11-04, America/Chicago.

Estado: COMPLETADO CON LIMITACIONES EXPLÍCITAS. Release 0.9.2 preparada, seis personajes persistidos y UI habitual abierta e inspeccionada. La voz sintética y el dictado se comprobaron técnicamente; no se activó el micrófono físico ni se repitieron inferencias de Jan.

## 1. Objetivo

Implementar los seis asistentes del documento del propietario: Kairo Voltán, Beto Carambola, Tino Contrapié, Milo Palabrava, Roco Callejón y Nara Violeta. Mantener el chat con voz, avatar y animación activables por separado. Corregir el restablecimiento y presentar MCP con búsqueda, categorías y tarjetas como la referencia de Runable, conservando la navegación y el tema de Rey30.

## 2. Trabajo realizado

Los seis perfiles incluyen biografía, motivaciones, instrucciones, ejemplos, ritmo, gestos, ajustes y referencias de modelo independientes. Hay modos Charla, Trabajo y Serio; comandos naturales explícitos cambian el modo. Humor, energía, groserías y coqueteo usan niveles 0–3. El modelo y las herramientas existentes conservan sus permisos.

El selector ofrece edición, duplicación, importación y exportación validadas. Cada personaje tiene un retrato SVG original y partes animables. La voz empieza desactivada. Los controles de voz, visibilidad y movimiento del avatar no desactivan la personalidad ni la entrada de texto. La memoria individual y la de proyecto requieren notas y habilitación explícitas; permiten editar, borrar y exportar.

La voz local utiliza seis variantes españolas de eSpeak NG; Windows también aporta su catálogo instalado. El dictado español usa Vosk. La transcripción se coloca en el editor para revisarla antes de enviar. Se puede detener síntesis, reproducción, grabación y transcripción pendientes; no se abre el micrófono automáticamente.

Restablecer configuración está junto al idioma: recupera el punto guardado o valores seguros en español si no hay punto, y guarda el estado anterior para deshacer. Conserva modelos, chats, personajes, habilidades, integraciones, GPU, credenciales y código. El catálogo MCP aparece como vista principal con tarjetas, búsqueda, categorías orientativas y conexiones con estado real.

## 3. Arquitectura

- `web-app/src/lib/characters/`: perfiles, validación, personalidad, persistencia y audio.
- `web-app/src/stores/useCharacterStore.ts`: mutaciones serializadas y persistencia confirmada bajo una clave nueva.
- `web-app/src/containers/characters/`: selector, editor y avatar. Los SVG están separados en `web-app/src/assets/characters/`.
- `custom-chat-transport.ts`: captura la personalidad por petición, añade solo las memorias autorizadas y resuelve la asignación de modelo. El contexto vuelve a incluirse después de herramientas o compactación; Cowork conserva su sistema propio.
- `src-tauri/src/core/system/character_audio.rs` y `.ps1`: IPC validado, proceso local oculto, JSON por stdin, límites de entrada/salida, cancelación por identificador y descarte de resultados tardíos. La boca utiliza la amplitud del audio que reproduce Web Audio.
- `src-tauri/resources/character-audio/`: runtime, datos españoles, licencias, fuentes, receta y manifiesto SHA-256. No utiliza los pesos de Jan.

## 4. Análisis profesional

La identidad se separa del modelo para reutilizar perfiles sin cargar seis modelos. Los recursos de dictado solo se usan al transcribir; no se añade un servidor ni otro puerto. Las variantes sintéticas permiten funcionamiento local sin cuentas; no equivalen a interpretación profesional, clonación ni seis actores de voz.

La interfaz de MCP clasifica metadatos cargados; el registro no proporciona una taxonomía oficial en el contrato utilizado. Las tarjetas guardadas y las conexiones activas se distinguen mediante configuración y estado real, sin deducir una conexión por el nombre o el logotipo.

## 5. Comprensión profunda

Desactivar voz o avatar no cambia el personaje ni su capacidad de conversar. Una personalidad contiene instrucciones, no permisos adicionales. La memoria autorizada entra en la petición del modelo elegido: si se utiliza nube, ese proveedor recibe el contenido permitido por el modo de privacidad.

El movimiento de la boca refleja volumen/amplitud; no identifica fonemas exactos. Movimiento reducido y animación desactivada detienen los gestos y la boca. El dictado es una propuesta editable, no una orden ejecutada automáticamente.

## 6. Bloqueos y correcciones

El restablecimiento anterior exigía un punto previo, rechazaba el color válido `blue`, creaba un namespace con versión incorrecta y no actualizaba explícitamente i18n. Se reprodujeron y corrigieron esos casos. El reinicio destructivo continúa deshabilitado.

La revisión de personajes detectó lectura de una respuesta anterior después de cambiar identidad durante la generación, conflicto entre autoplay y dictado, y pérdida del borrador al borrar memoria. Se corrigieron sus transiciones y se añadieron regresiones. Los fixtures antiguos de ChatInput y cancelación se actualizaron al contrato real; no se eliminaron aserciones ni se aumentaron sus tiempos de espera.

Se compiló eSpeak NG 1.52.0 desde las fuentes oficiales para conservar correspondencia verificable entre binario, datos y fuentes. El runtime final no depende del proyecto LexiMind ni utiliza Piper. El paquete conserva las fuentes de Sonic y del adaptador, licencias y hashes de todos sus archivos.

La prueba nativa encontró un fallo que la ejecución del helper por separado no mostraba: las rutas Windows con prefijo `\\?\` entregadas por Tauri eran rechazadas por `Join-Path` en PowerShell 5.1. Se normalizó el prefijo antes de resolver recursos, se recompilaron los binarios y se repitió la síntesis a través del IPC real. Los intentos fallidos permanecen registrados.

## 7. Pruebas y evidencias

Las evidencias de esta fase están en `artifacts/qa/characters-20261104/`. Las de interfaz y restauración también referencian `artifacts/qa/product-20261104/{characters,settings-reset,mcp-browser}/`.

- Personajes, persistencia, avatar, controles y cancelación de audio: 55 pruebas focales aprobadas.
- Transporte real con proveedores simulados: 14 pruebas aprobadas, incluidas seis identidades, asignación de modelo, memoria de proyecto, modo serio y exclusión de Cowork.
- Restauración: 66 pruebas focales aprobadas. Catálogo MCP: 31 aprobadas.
- Audio local ejecutado: seis WAV distintos y reconocimiento de una frase sintética en español. La transcripción observada contiene omisiones y se conserva literalmente en el recibo; no se presenta como reconocimiento perfecto.
- Compilación propia de eSpeak: CMake y Visual Studio 2022, salida 0. Integridad del paquete completo comprobada con SHA-256.
- Cuatro auditorías JavaScript con salida 0, sin hallazgos altos/críticos. Su alcance no incluye Rust ni los runtimes nativos. Permanecen avisos de menor severidad y compatibilidad entre pares.
- Suite global aceptada: web 4 851 pruebas en 373 archivos; núcleo 174 en 35; extensiones 412 en 15. Total: 5 437 pruebas JavaScript. Las focales anteriores están incluidas y no se vuelven a sumar.
- Rust: 28 pruebas aprobadas sobre el código final, incluidos límites de audio, persistencia, paquete, reinicio anterior e aislamiento del keyring.
- Interfaz nativa: tres casos aprobados con perfil temporal nuevo, ventanas de 1200×800 y 900×650 y capturas reales. Comprueban las seis selecciones, controles independientes, recuperación sin/con punto, deshacer y conservación de personajes/proveedores/MCP. El catálogo de este spec usa metadatos declarados de fixture.
- Audio por IPC nativo: un caso aprobado, seis variantes españolas disponibles, WAV PCM mono de 16 bits con amplitud no nula y rechazo de parámetros inválidos. No reprodujo sonido ni abrió el micrófono.
- Tipos integrados, tipos E2E, lint de producción y de pruebas modificadas e instalación inmutable aprobados. Release final y destino CLI separado con su característica `cli`: salida 0.
- Perfil habitual observado: versión 0.9.2 en General, Restablecer configuración junto al idioma, 50 tarjetas del registro MCP real y seis perfiles en el selector. Kairo quedó activo en Trabajo con voz desactivada y avatar visible. Jan-v3.5-4B continúa seleccionado con indicador verde; eso no se presenta como una inferencia.

Recibos finales: `artifacts/qa/characters-20261104/{acceptance-final,ui-open-release-092,staging-receipt}.json`, `artifacts/qa/characters-preferences-e2e/run-qec6wN/receipt.json` y `artifacts/qa/character-audio-e2e/run-wtDbcw/receipt.json`. Se conservaron las ejecuciones iniciales fallidas y se documentaron los límites del driver para la selección de opciones y la intercepción de IPC.

## 8. Control de calidad

La persistencia no sobreescribe otros namespaces y confirma escritura a disco antes de dar éxito. La importación conserva originales, desactiva audio importado y limita formatos, campos, tamaños y rutas. Los perfiles no admiten recursos SVG arbitrarios ni campos de credenciales.

El proceso de audio recibe datos como JSON, con código estático; no concatena texto del usuario en comandos. La salida y los errores tienen límites de lectura. El catálogo no cancela una síntesis activa. Las cancelaciones identifican también la generación para evitar que un trabajo anterior cierre el posterior.

Las fuentes de producción y el paquete se congelan para comparar su cohorte con la compilación. Las comprobaciones nativas utilizan datos temporales y guardas contra carga de modelos o envío de chat.

Se comprobaron 2 306 archivos de producción sin diferencias respecto a la cohorte final. La distribución conserva 24 componentes anteriores y añade 435 archivos de audio, con manifiesto y fuentes. Los ajustes habituales del motor y de MCP, y el tamaño/fecha de Jan, permanecieron iguales después de inspeccionar la UI. La clave nueva de personajes quedó persistida con los seis perfiles.

## 9. Limitaciones

Esta entrega de audio nativo se dirige a Windows x64. Las voces son sintéticas. El micrófono físico, el dispositivo de salida y la aceptación auditiva humana quedan pendientes de uso por el propietario; no se activó el micrófono durante la auditoría. La prueba de dictado utilizó una frase sintética y muestra reconocimiento parcial.

La persistencia se verificó mediante guardado y lectura del perfil habitual, pruebas de carga y almacenamiento nativo. No se forzó un reinicio de la sesión habitual al detectarse actividad del propietario en el editor de personajes.

Por instrucción del propietario no se repitieron inferencias de Jan ni la comparación conversacional de seis respuestas generadas. Los ejemplos son textos originales incluidos en los perfiles, no respuestas observadas del modelo. Las pruebas controladas comprueban construcción y envío del contexto; no certifican que cualquier modelo mantenga siempre el estilo.

MCP mantiene requisitos propios de cada servidor. El proveedor completa OAuth mediante su navegador y consentimiento. Las categorías son orientativas. La protección de nube conserva los límites descritos en la guía; no promete anonimato ni convierte el procesamiento remoto en local.

Los controles y perfiles nuevos están en español. Los nombres y descripciones publicados por terceros en el registro conservan su idioma original; no se presentan traducciones automáticas como información oficial.

## 10. Entrega y continuidad

La entrega está en `artifacts/desktop/Rey30-IDvj.exe` y se inicia con `Iniciar-Rey30-IDvj.bat`. La comprobación del BAT seleccionó ese ejecutable con salida 0; la apertura observada se hizo mediante Sky sobre la ruta exacta. El binario tiene versión 0.9.2, editor Reinier Tamayo y subsistema GUI. SHA-256: `124399c61b379ad986bf7ab32d3e85c6f1953281e731b8241e107d992a2c1d5c`.

`artifacts/desktop/BUILD.json` identifica recursos, hashes, cohorte y comprobaciones. La versión 0.9.1 y su manifiesto se conservaron en `artifacts/qa/characters-20261104/baseline-0.9.1/`. Se comprobó Inicio con Kairo y sin audio; la aplicación permanece abierta en el editor que abrió el propietario, sin interrumpirlo. No se publicó ni envió código a un repositorio remoto.

## 11. Recomendación personalizada

Reinier Tamayo: elige el personaje por su estilo y utiliza Serio cuando necesites precisión directa. Mantén la voz y el avatar según la tarea; activar uno no exige activar los demás. Revisa el dictado antes de enviarlo y guarda en memoria solo notas que quieras incorporar al modelo. La [guía de uso](REY30_USER_GUIDE.md) detalla los controles y sus límites.

Fuentes de los componentes: [eSpeak NG 1.52.0](https://github.com/espeak-ng/espeak-ng/releases/tag/1.52.0), [modelos y licencias de Vosk](https://alphacephei.com/vosk/models), [catálogo de voces de Windows](https://learn.microsoft.com/es-es/dotnet/api/system.speech.synthesis.speechsynthesizer).
