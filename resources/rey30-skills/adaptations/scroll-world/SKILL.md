---
name: scroll-world
description: "Planificar un mundo visual cuyo vídeo avanza con el scroll, conservando continuidad de fotogramas, control de costes y accesibilidad; ejecutar generación solo con herramientas y permisos reales."
license: MIT
metadata:
  translation-role: "adaptación al runtime Rey30 en español; no equivalencia CLI"
---

# Scroll World

Guía en español para una página que recorre escenas mediante vídeo prerenderizado ligado al scroll. Se basa en el flujo oficial ScrollWorld: imágenes coherentes, trayectos de cámara y conexiones entre escenas, codificación adecuada y validación de uniones.

Este pack contiene Markdown; excluye scrub-engine.js, index-template.html y knockout.py. No instala Monid, Higgsfield, FFmpeg ni generadores de imagen. Sin esos componentes puede producirse un brief/guion y plan de implementación; no se debe declarar creada la página, el motor, la cadena de vídeo ni una integración externa.

## Límites antes de empezar

El usuario elige tema, estilo, proveedor y presupuesto. El original fija proveedores y cifras de su fecha de publicación; esta adaptación no los toma como precios vigentes ni cambia automáticamente de facturador. Consulta capacidad y coste actuales antes de gastar. No conectes cuentas, copies cookies o uses contraseñas del usuario. La autorización OAuth la realiza la persona en el navegador.

No instales ni descargues modelos/GPU/runtimes para satisfacer la guía. Comprueba las herramientas existentes y las autorizaciones reales. Conserva AMD/backend elegidos. Si faltan CLI, motor o servicios, informa de cada dependencia y ofrece planificación sin gasto. No sustituyas una herramienta inexistente por una respuesta simulada.

## 1. Brief y consentimiento

Reúne tema, audiencia, secciones, contenido factual, estilo, referencias, colores y activos de marca. No asumas sector, framework ni que «mundo 3D» exige geometría editable: este flujo genera vídeo y una ilusión de recorrido. Usa activos propios/autorizados y aclara que el resultado visual puede ser generado.

Acordad la arquitectura de cámara:

- Recorrido continuo hacia delante para interiores, lugares y paseos realistas: cada tramo avanza al siguiente sin retirarse artificialmente.
- Inmersión y conector aéreo para dioramas/miniaturas: alterna entradas con conectores que justifican cambiar de escena.
- Otros movimientos deben corresponder al concepto, manteniendo un trayecto legible y continuidad.

Pregunta si se necesita versión móvil. No generes escritorio y móvil automáticamente. Una cadena vertical 9:16 es trabajo adicional con más generaciones/créditos; presupuestarlo antes. Un recorte del vídeo horizontal no equivale a composición móvil nativa; solo sirve como alternativa temporal explícitamente aceptada.

Con N escenas, la arquitectura de inmersiones/conectores puede necesitar N clips de escena y N−1 conectores, además de imágenes y reintentos. Usa esta estructura para el presupuesto, no precios inventados. Fija un límite y una política de parada/revisión ante fallos antes de enviar trabajos.

## 2. Comprobar servicios y esquemas

Verifica ejecutables y versiones con herramientas del anfitrión. En el flujo original aparecen `monid --version`, `monid balance`, `higgsfield workspace list`, `ffmpeg` y `ffprobe`: son ejemplos válidos solo si esos programas existen. No vuelques claves ni sus listados al chat. Si falla autenticación, comunica la necesidad de login manual; no intentes iniciar sesión por la persona.

Antes de un lote consulta el esquema del modelo en el servicio real; el original documenta `higgsfield model get <job_type>` y `monid inspect`. Elige UN modelo compatible para toda la cadena. Los conectores necesitan condicionamiento por imagen inicial y final; una referencia genérica o solo imagen inicial no garantiza continuidad. No cambies modelo para ahorrar créditos a mitad de cadena.

Resolución, proporción, duración y parámetros admitidos varían por endpoint. Usa el esquema verificado, nunca copies flags incompatibles. Pasa proporción explícita por clip y comprueba la facturación real del resultado. No afirmes que una subida o variante es gratuita sin verificarlo.

## 3. Imágenes coherentes

Define un preámbulo visual compartido y el contenido de cada escena: sujeto, escala, perspectiva, materiales, iluminación, color y posición de cámara. Genera solo tras autorización y revisa las imágenes antes de continuar. Corrige incoherencias en esta fase; no pagues una cadena con bases incompatibles.

Si se quieren escenas flotantes, la eliminación de fondo es una operación opcional y requiere herramientas reales. knockout.py no está incluido: no lo invoques como disponible. Conserva originales y transparencia cuando corresponda.

## 4. Tramos y conexiones

Genera los tramos con prompts de cámara acordes al brief, sin cortes inesperados. Mantén el mismo modelo/estilo/parámetros compatibles en toda la cadena. Revisa cada clip y extrae sus fotogramas de frontera con FFmpeg real.

La regla central es continuidad por fotogramas: los conectores deben partir del ÚLTIMO fotograma del vídeo anterior y terminar en el PRIMERO del siguiente, extraídos de los vídeos renderizados; no de las imágenes fijas originales. En recorrido continuo reutiliza la frontera real como inicio del tramo siguiente. Valida que el modelo respete ambas condiciones.

No construyas un conector hasta disponer de las fronteras correctas. Identifica escena/clip/fotograma con rutas inequívocas para no cruzar índices. Un error de contenido o un corte requiere revisión; no lo tapes con un crossfade y lo declares idéntico.

Trabajos remotos largos requieren IDs de operación y seguimiento; evita lanzar reintentos duplicados porque venció una espera local. Un timeout de polling puede dejar el trabajo facturando en servidor. Consulta estado antes de reenviar y conserva coste/ID sin secretos. Descarga resultados autorizados antes de que caduquen sus URLs.

## 5. Codificación y página

Con FFmpeg/ffprobe disponibles mide primero resolución, duración y fps reales; no amplíes resolución artificialmente ni supongas que el proveedor entregó lo pedido. Codifica para búsqueda de fotogramas con intervalos de keyframes cortos y faststart; el valor exacto debe adaptarse al vídeo/dispositivo medido. Evita audio no solicitado. Conserva una copia maestra.

Implementa el motor solo si sus fuentes revisadas están presentes o existe una implementación propia identificada. La guía no obliga a framework: puede integrarse en HTML o una app existente. No sustituyas navegación/estilo ajenos. Asegura carga diferida, búsqueda agrupada, póster inicial, errores de vídeo, resize sin saltos, safe areas y funcionamiento móvil. El estado visual debe corresponder al progreso de scroll sin acumular llamadas seek inútiles.

Respeta prefers-reduced-motion: ofrece una presentación estática/alternativa navegable con contenido equivalente. Mantén texto legible, foco, enlaces y acceso a secciones sin depender exclusivamente de un vídeo animado.

## 6. QA y entrega

- Inspecciona pares de fotogramas y cada unión a velocidad normal y al mover el scroll hacia ambos sentidos. Distingue identidad de frontera de mera similitud visual.
- Reproduce los archivos finales y verifica contenido, relación de aspecto, recorte, duración, huecos negros, seek y carga lenta.
- Prueba escritorio/móvil, reducción de movimiento y cambios de tamaño. Una captura estática no valida fluidez ni toda la cadena.
- Si se aprobó móvil nativo, genera y verifica SU cadena vertical completa con SUS fronteras; no reutilices las fronteras horizontales.
- Comprueba el gasto real frente al límite. Informa fallos, clips pendientes y reintentos; no ocultes costes o una cadena incompleta.
- Entrega solo archivos existentes y separa preparado, generado, integrado, probado y aceptado por la persona.

## Fuentes

[Prompts](references/prompts.md) contiene el cuestionario y plantillas; [pipeline](references/pipeline.md) tiene scripts Bash orientados al entorno de su autor. Son fuentes de consulta, no scripts instalados ni portables automáticamente a PowerShell. Revisa rutas, quoting, versiones, stdin de procesos y consentimiento de cada llamada antes de adaptarlos.

Conserva LICENSE/SOURCE.json y `references/upstream-SKILL.md`. Esta entrada autocontenida mantiene el flujo esencial y las guardas; no instala un servicio ni garantiza precio, modelo o capacidad futura.
