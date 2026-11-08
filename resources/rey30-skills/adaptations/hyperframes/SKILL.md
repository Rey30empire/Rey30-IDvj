---
name: hyperframes
description: "Planificar y editar vídeo HTML siguiendo el contrato HyperFrames, con renderizado determinista, recursos editables y validación real solo cuando estén disponibles su CLI y dependencias."
license: Apache-2.0
metadata:
  translation-role: "adaptación al runtime Rey30 en español; no equivalencia CLI"
---

# HyperFrames

Guía en español del flujo HTML a vídeo de HyperFrames. La copia de Markdown no instala CLI, navegador/renderizador, FFmpeg ni la aplicación de escritorio. No ha generado vídeos, consumido créditos ni validado GPU. Conserva la AMD seleccionada por la persona.

## Antes de crear o ejecutar

Determina si la persona pide propuesta, modificación, exportación o una pregunta. Una idea o petición en espera recibe una propuesta; no dispara generación. Confirma fuentes, derechos de uso, formato, duración, destino y necesidad de voz, música o subtítulos. No añadas voz, subtítulos, cambio de proporción o servicio de pago no solicitados. Conserva el formato de un proyecto existente; los nuevos pueden partir de 1920×1080 a 30 fps cuando no hay otra indicación.

Comprueba una instalación local autorizada de HyperFrames, Node y FFmpeg. La fuente documenta `npx hyperframes <comando>`, pero npx puede descargar/ejecutar paquetes: úsalo solo cuando se verificó que resuelve el paquete local instalado, o con autorización expresa para una instalación revisada. Sin runtime, entrega guion, SPEC y diseño de composición con estado «Renderizado pendiente»; no simules comandos ni declares vídeo listo.

Si existen cuentas, la persona autoriza en el navegador. No leas tokens ni automatices logins. Consulta uso real mediante el CLI disponible antes de una operación facturable; si no se conoce el saldo, dilo. La guía original refiere habilidades hermanas media-use, hyperframes-cli e hyperframes-registry: no se incluyen en este núcleo. Si una operación las requiere, verifica que existan o explica la limitación; sus nombres no conceden herramientas.

## Estructura editable

`index.html` es la composición raíz: declara variables y monta escenas de `compositions/`. Recursos y fuentes van en `assets/`. Una escena por subcomposición, IDs cortos/estables y elementos temporizados escritos en HTML, no generados dinámicamente por script.

Texto, colores de marca y recursos intercambiables deben usar las variables del formato, como data-var-text, data-var-src y var(--id). Usa un tipo por pista: data-track-kind="graphics" en escenas/overlays; captions en el host que reúne subtítulos. Conserva contenido dentro del 90% action-safe y texto clave dentro del 80% title-safe; no dibujes esas guías dentro del vídeo.

No alteres el trabajo reciente del usuario: con runtime real consulta timeline y history antes de modificar. La aplicación de escritorio HyperFrames es una opción de edición posterior, no requisito inventado ni software ya instalado por esta guía.

## Contrato de renderizado

HyperFrames avanza una línea de tiempo pausada para renderizar fotogramas. La imagen debe ser una función del tiempo, con estas reglas:

1. Cada elemento temporal usa class="clip", data-start y data-duration en segundos; aparece en [inicio,inicio+duración). Sitúa el estado final antes de su fin. data-track-index organiza pistas; el orden visual lo determina z-index.
2. data-duration de la raíz determina longitud: un exceso se corta y un final temprano mantiene el último fotograma.
3. Cada composición crea una única timeline pausada y, después de sus tweens, la registra en window.__timelines con la clave data-composition-id.
4. No uses Date.now(), aleatoriedad sin semilla, fetch de red, timers ni repeat:-1. Descarga recursos autorizados antes de renderizar.
5. No animes display, visibility o autoAlpha de un clip; anima un hijo.
6. Evita CSS transform en el mismo elemento que GSAP transforma. Anima transforms, no left/top/width/height.
7. No llames play(), pause() ni seek en medios. Un vídeo conserva sonido con data-has-audio="true"; de lo contrario va muted. Música/voz/sustitución de sonido y cortes J/L son audio separado.
8. Cada audio necesita id para entrar en la mezcla. No uses crossorigin en medios. Temporiza el vídeo o su wrapper, no ambos.
9. Solo las fuentes incluidas se resuelven por nombre; otras requieren archivo local autorizado y @font-face en assets/fonts/.
10. Las rutas de recursos son assets/... sin barra inicial, también en subcomposiciones.
11. Grades, grano, blur y viñetas del metraje usan la operación media-treatment de la versión disponible; no sustituyas el contrato con filtros CSS.
12. Una escena pone estilos, markup y scripts dentro de template y estiliza #root. Solapamientos/desbordes intencionales se declaran con data-layout-allow-overlap y data-layout-allow-overflow.

## Flujo de trabajo

1. Para un proyecto existente verifica composición, cambios recientes y recursos actuales. Para uno nuevo el original documenta `npx hyperframes init <directorio> --skip-skills`, únicamente bajo las condiciones de instalación anteriores y en una carpeta propia.
2. Prepara historia/guion antes de gastar. Para una película narrativa de más de unos 15 s, desarrolla alternativas distintas en palabras si hace falta y acuerda la dirección. Si el usuario ya pidió ejecución directa con contenido concreto, no inventes una cadena de confirmaciones rutinarias.
3. Escribe SPEC.md: planos por fotograma, duración, dimensiones, contenido, estilos y límites medibles. No sustituyas decisiones por adjetivos vagos.
4. Usa imágenes del producto, marca o lugar real cuando sean el tema, con derechos adecuados. No dibujes versiones ficticias de pantallas/logos existentes. Antes de inventar efectos, busca el registro si esa capacidad está disponible.
5. Crea composición editable y recursos locales. El sonido acompaña el relato cuando se solicitó; respeta silencio explícito y requisitos de accesibilidad.
6. Con runtime verificado ejecuta `npx hyperframes check --json`; corrige errores y evalúa warnings. No declares correcto un proceso no ejecutado o con salida no cero.
7. Para película usa `npx hyperframes snapshot --review` y revisión de los planos; para un cambio pequeño captura los intervalos afectados. Inspecciona imágenes reales y audio antes de afirmar calidad. Guarda REVIEW.md con problemas y decisiones.
8. Exporta solo después de las comprobaciones pertinentes. Comprueba existencia, duración, dimensiones, legibilidad, sincronía, clipping y reproducción del resultado. Diferencia lint, capturas, vídeo reproducido y aceptación de la persona.

## Referencias y límites

Según el contenido consulta [film](references/film.md), [story](references/story.md), [spec](references/spec.md), [review](references/review.md), [format](references/format.md), [runtimes](references/runtimes.md), [motion](references/motion.md) y [sound](references/sound.md). Hay tipos específicos en references/types/ y guías de [captions](references/captions.md) y [overlays](references/overlays.md).

Si no hay lector de referencias, usa el contrato esencial anterior y no ejecutes operaciones de formato no verificadas. Servicios HeyGen u otros pueden implicar cuentas, transferencia de medios y pago: informa antes, no elijas proveedor ni presupuesto por defecto.

Conserva LICENSE y SOURCE.json; el original intacto permanece en `references/upstream-SKILL.md`. Esta adaptación no asegura compatibilidad de todos los comandos de una versión futura.
