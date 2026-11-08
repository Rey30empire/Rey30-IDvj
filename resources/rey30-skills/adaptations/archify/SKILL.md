---
name: archify
description: "Preparar diagramas y explicaciones visuales con evidencia, usar Archify cuando su CLI y recursos estén presentes y declarar las limitaciones cuando solo está disponible la guía."
license: Apache-2.0
metadata:
  translation-role: "adaptación al runtime Rey30 en español; no equivalencia CLI"
---

# Archify

Adaptación de la habilidad oficial para diagramas y páginas explicativas. Archify produce HTML mediante su CLI, esquemas y renderizadores. Este pack conserva Markdown y avisos legales; no incluye esos ejecutables, esquemas, plantillas, marcas o fuentes. Una especificación escrita no equivale a un HTML generado ni validado.

## Elegir el resultado

Aclara la pregunta y el lector. Selecciona una representación que ayude a responder:

- architecture: componentes, responsabilidades y fronteras.
- workflow: pasos, decisiones, retornos y excepciones.
- sequence: participantes, mensajes, orden y condiciones.
- dataflow: orígenes, transformaciones, datos y destinos.
- lifecycle: estados y transiciones.
- erd: tablas, campos, claves y relaciones.
- class: clases y asociaciones.
- tree: jerarquía.
- timeline o waterfall: hechos, fases o tiempos sustentados.

Una explicación comparativa puede necesitar una página explainer, pero no la generes automáticamente si la persona solo pidió una respuesta. No conviertas esta guía en una obligación de crear páginas para cada mensaje. Respeta el formato y alcance del usuario.

En un proyecto real sigue el flujo solicitado en las fuentes; no copies hechos de ejemplos ni inventes APIs, tiempos, cantidades o fechas. Distingue hechos, inferencias y pendientes. Identifica condiciones que cambian el comportamiento y conserva relaciones necesarias, sin fijar un número artificial de nodos.

## Comprobar capacidad real

1. Comprueba si hay una instalación Archify autorizada. Resuelve el archivo real `bin/archify.mjs` y sus recursos; no uses una ruta de ejemplo como si existiera.
2. Si están presentes, verifica Node compatible y la ayuda/versiones. Todos los comandos deben apuntar a la ruta real del paquete y ejecutarse desde el directorio de trabajo elegido.
3. Si falta el CLI o sus recursos, declara «Guía Archify disponible; generación y validación Archify no disponibles». Puedes entregar una especificación, una explicación o Mermaid textual identificado como tal. No afirmes que ha pasado los gates Archify ni que es HTML suyo.
4. El original admite SVG colocado a mano en `assets/template.html` para diagramas nativos sin shell; esa plantilla tampoco está en este pack. Úsala solo si existe una copia autorizada real. Los explainers requieren su renderizador y gates; no finjas una alternativa equivalente.

No descargues/actualices el paquete ni ejecutes npx automáticamente. La guía no instala un runtime.

## Autoría con instalación disponible

1. Crea una carpeta propia para cada entrega, por ejemplo `.archify/<tipo>-<slug>-<fecha-hora>/`, sin sobrescribir otra petición. Conserva candidato y salida juntos; reutiliza esa carpeta para reparaciones de la misma entrega.
2. Consulta [authoring-defaults](references/authoring-defaults.md), la referencia del tipo y los esquemas reales de la versión instalada antes de introducir campos/enums. Para un repositorio consulta [repository-authoring](references/repository-authoring.md). Si no puedes leer esas fuentes, detén la generación dependiente del esquema y entrega el análisis esencial con limitación.
3. Escribe el candidato completo con IDs frescos, semántica clara y evidencia. Para arquitectura usa abstracción coherente, recorrido principal y ramas necesarias; deja espacio para etiquetas reales. Prioriza rutas automáticas antes de rutas manuales.
4. Mermaid es entrada de topología/significado: adapta el contenido al esquema Archify; no traslades mecánicamente su estilo.
5. En ERD conserva cada columna física, tipo SQL, comentario y rol de clave. Una columna puede ser PK y FK; conserva ambas y la referencia exacta. Agrupa por dominio en bloques rectangulares con row/col coherentes. No escondas campos en tarjetas para evitar densidad. Una primera versión densa puede requerir calidad standard en lugar de showcase.
6. Escribe el candidato antes de ejecutar finalize; mantén sus bytes estables mientras corre. El original documenta, con el `bin/archify.mjs` real:

```text
node bin/archify.mjs finalize <tipo> <candidate.json> <output.html> --quality showcase --json
```

Para candidatos de repositorio agrega `--repo-root <repo-root>` y fuentes desde la primera ejecución. `--quality` debe coincidir con meta.quality_profile; los placeholders son valores que hay que resolver, no comandos listos para pegar.

## Validación y reparación

Un resultado no cero nunca es éxito. Un receipt passing de finalize acredita los gates incluidos validate, deliver, strict check y browser-check; no acredita por sí solo inspección perceptiva humana. Lee stdout o evidence.summaryReceipt y corrige el gate concreto con [delivery-contract](references/delivery-contract.md).

Preserva significado y fuentes al reparar. Si una ronda ya produjo browser-check, usa otro `--out-dir` para evidencia nueva; no atribuyas capturas antiguas a bytes nuevos. Cuando la recomendación de arquitectura sugiera arreglar cruces, conserva candidato anterior, limita el cambio a posiciones/tamaños, prueba una ronda completa y restaura si empeora. No encadenes retoques ilimitados sin evidencia. Para desbordamiento workflow o ancho sequence usa el contrato específico.

Las actualizaciones notificadas por receipt se comunican sin instalarlas automáticamente. No omitas un aviso requerido ni prometas haber actualizado el programa.

## Evidencia visual y entrega

Inspecciona capturas reales si la persona pidió revisión visual o si existe una duda concreta de navegador/geometría. Sin captura inspeccionada, escribe «Comprobaciones automáticas; revisión visual pendiente». No confundas artifact checks, browser-check, capturas y aceptación perceptiva.

Verifica que cada salida existe, corresponde al candidato actual y abre con los recursos necesarios. No abras navegador ni publiques/subas contenido por defecto: atiende al encargo. Los detalles de comandos/hashes viven en receipts; la respuesta puede centrarse en el resultado y límites sin ocultar fallos.

Para explainers consulta [explainer-authoring](references/explainer-authoring.md): redacta conclusión, razones, alcance y estructura; su entrega exige validación real del renderizador. No presentes texto como página exportada.

## Restricciones y procedencia

No añadas logotipos ni fuentes sin necesidad y licencia revisada. Este pack excluye los recursos de marca opcionales; algunos, como ciertas ilustraciones Vue, tienen CC-BY-NC-SA4 y no se deben tratar como activos comerciales libres. Conserva LICENSE, LICENSE-MIT, NOTICE y THIRD_PARTY_NOTICES.md.

SOURCE.json identifica el commit y las exclusiones. El original completo permanece en `references/upstream-SKILL.md`; las referencias técnicas no implican que sus programas estén instalados.
