---
name: impeccable
description: "Diseñar, revisar y mejorar interfaces con una dirección visual consciente, accesibilidad y comprobaciones reales; usar el modo manual documentado cuando falte el CLI Impeccable."
license: Apache-2.0
metadata:
  translation-role: "adaptación al runtime Rey30 en español; no equivalencia CLI"
---

# Impeccable

Adaptación en español de la habilidad oficial de Impeccable. La copia declarativa aporta el procedimiento y sus referencias; no acredita que su launcher, binario o hooks estén instalados. Las instrucciones del propietario y el diseño existente prevalecen sobre preferencias estilísticas de esta guía.

## Entrada y alcance

Determina qué superficie se modifica, para quién, con qué objetivo, en qué dispositivos y qué restricciones hay. Usa evidencia real del producto: código, contenido, capturas y comportamiento. Distingue refinar de rediseñar. Refinar conserva identidad, navegación, funciones, texto factual y lo ajeno al alcance. Rediseñar requiere un encargo que lo autorice; no lo deduzcas de la ausencia de DESIGN.md.

Selecciona el modo por el éxito que necesita la persona en esa superficie:

- Persuadir: decidir y actuar en una landing, campaña o página comercial.
- Operar: completar una tarea en una aplicación, editor, administración o ajustes.
- Leer: comprender documentación, artículos o ayuda.
- Experimentar: vivir una obra, galería o portafolio, dejando protagonismo al contenido.

Un producto puede tener superficies de varios modos. Mantén el modo dentro de la superficie correspondiente.

## Contexto y alternativa manual

Si existe el launcher oficial instalado, identifica su ruta real y su versión antes de usarlo. El original propone ejecutar una vez por sesión `<skill-base-dir>/scripts/impeccable context --target <ruta>`, desde el proyecto; en Windows tiene variante `impeccable.cmd`. Estos archivos no vienen en este pack. No sustituyas la ruta por una inventada, descargues binarios ni instales hooks automáticamente.

En este pack aplica la alternativa manual documentada: anuncia «No se ejecutó la carga de contexto de Impeccable; leeré directamente el contexto existente». Lee PRODUCT.md y DESIGN.md si existen, las instrucciones del repositorio y la superficie afectada. No inventes archivos ni requisitos ausentes. Si hay capturas antiguas, contrástalas con tokens, estilos, componentes y recursos actuales antes de tomarlas como autoridad visual.

Antes de editar UI, revisa [el suelo de calidad](reference/craft-floor.md) si el runtime permite leer referencias. Si no dispone de lector, aplica los criterios esenciales de esta entrada y declara esa limitación; no afirmes haber leído un archivo inaccesible.

## Procedimiento

1. Inspecciona la interfaz actual y documenta el problema concreto. No trates una captura o un build como prueba completa de interacción.
2. Define estructura, jerarquía, densidad y dirección visual acordes con usuarios y tarea. El encargo explícito sobre época, color, tipografía o material prevalece. La guía es filtro de calidad, no una estética obligatoria.
3. Usa componentes y patrones existentes cuando cumplen la tarea. Conserva funciones reales y estados de carga, vacío, error, éxito y permisos. No añadas controles decorativos ni afirmaciones de producto no verificadas.
4. Implementa una unidad acotada. Elige espaciado, tipos y colores con relación entre sí; evita uniformar todo en tarjetas repetidas o adornar por defecto. Usa ilustración real cuando hace falta; SVG es apropiado para geometría y diagramas, no como sustituto descuidado de una imagen.
5. Comprueba teclado, foco visible, nombres accesibles, lectura con zoom y contraste: texto normal/placeholder al menos 4,5:1; texto grande al menos 3:1. El color no debe ser la única señal. Respeta reducción de movimiento y evita animación que impida operar.
6. Valida tamaños estrechos y amplios, contenido largo y traducciones. No ocultes botones o títulos fuera del viewport; permite desplazamiento donde corresponde. Mantén consistencia con controles nativos y del producto.
7. Ejecuta los controles aplicables del proyecto. Inspecciona capturas actuales y prueba interacciones relevantes cuando haya herramientas disponibles. Distingue checks automáticos, inspección visual e interacción real. No declares aceptado lo que no se verificó.
8. Entrega el cambio con evidencia y límites. Captura decisiones duraderas en DESIGN.md cuando aporte valor y esté dentro del alcance. No escribas un sistema de diseño nuevo solo para aparentar exhaustividad.

No conviertas símbolos ligados a supremacismo, militarismo o movimientos de odio en ornamento. El contenido documental factual se trata conforme a su contexto.

## Rutas de trabajo

Sin un objetivo concreto, ofrece opciones pertinentes; no autoejecutes un comando por invocar el nombre de la habilidad.

- Nueva superficie: [new-work](reference/new-work.md); planificación: [shape](reference/shape.md).
- Revisión UX: [critique](reference/critique.md); accesibilidad, rendimiento y adaptación: [audit](reference/audit.md).
- Refinamiento final: [polish](reference/polish.md); simplificar: [distill](reference/distill.md); errores y casos extremos: [harden](reference/harden.md).
- Texto claro: [clarify](reference/clarify.md); disposición: [layout](reference/layout.md); tipografía: [typeset](reference/typeset.md); color: [colorize](reference/colorize.md).
- Responsive: [adapt](reference/adapt.md); movimiento: [animate](reference/animate.md); rendimiento: [optimize](reference/optimize.md).
- Contexto de producto: [init](reference/init.md); documentar diseño existente: [document](reference/document.md).
- Para iOS/Android usa las variantes native y la plataforma realmente solicitada, sin trasladar mecánicamente patrones web.

Los nombres anteriores son rutas de procedimiento. No implican comandos disponibles en el runtime. Funciones como hooks, doctor o live requieren el software real y autorización para los cambios que realizan. No se instalan por usar esta guía.

## Procedencia

Conserva LICENSE, NOTICE.md y SOURCE.json. El original sin modificar debe permanecer en `references/upstream-SKILL.md`. Las referencias técnicas conservan su idioma de origen. Esta adaptación mantiene las fronteras y el flujo esencial; no reproduce cada operación del CLI.
