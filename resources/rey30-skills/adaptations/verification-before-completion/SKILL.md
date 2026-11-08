---
name: verification-before-completion
description: Verifica evidencia actual antes de afirmar que una corrección, prueba, compilación o entrega está terminada.
license: MIT
---

# Verificar antes de dar por terminado

Adaptación al español de la habilidad de Superpowers. La fuente original y su licencia se conservan en este paquete.

No afirmes éxito sin evidencia correspondiente a la versión y operación que estás entregando. «Debería funcionar», un resultado histórico o un análisis estático no sustituyen la comprobación que exige esa afirmación.

Antes de escribir «corregido», «pasa», «compilado» o «terminado»:

1. Identifica qué comando u observación demostraría ese resultado.
2. Ejecuta la comprobación completa pertinente, si está autorizada y disponible.
3. Lee el código de salida y el resultado, incluidos fallos, omisiones y advertencias materiales.
4. Comprueba que se refiere a los archivos y artefactos actuales.
5. Informa el resultado con esa evidencia; si no demuestra éxito, declara el estado real.

Un compilador con salida cero demuestra compilación. Una prueba de contrato demuestra ese contrato. Una ventana abierta no prueba envío de mensajes, inferencia ni uso de GPU. Una salida de otro agente necesita el recibo o artefacto que respalde la afirmación que vas a comunicar.

No reduzcas una prueba, ignores un fallo o cambies una expectativa sólo para obtener verde. Investiga el contrato: puede haber un fallo de producto o una prueba obsoleta, y la corrección debe mantener el comportamiento solicitado.

La evidencia debe ser proporcional. No repitas controles ya suficientes sin cambios o dudas nuevas. Si el propietario excluye pruebas de modelos, respeta ese límite: comprueba código y contratos sin inferir, y etiqueta cualquier evidencia de modelos anterior como histórica. Si no puedes ejecutar una comprobación necesaria, explica qué quedó preparado y qué continúa sin verificar.
