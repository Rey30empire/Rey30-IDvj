---
name: rey30-sprite-gen
description: Prepara y valida sprites o hojas de animación con dimensiones, transparencia y fotogramas coherentes, mediante SpriteGen o herramientas disponibles.
license: Apache-2.0
---

# SpriteGen — guía propia de producción

Fuente: [aldegad/sprite-gen](https://github.com/aldegad/sprite-gen). El CLI Python, FFmpeg, herramientas de vídeo y proveedores de imagen son dependencias externas; esta habilidad no los instala, autentica ni descarga RIFE o modelos.

Define tamaño de cada celda, filas/columnas, direcciones, estados, duración, pivote y formato de transparencia. Decide si hace falta generar imágenes o basta organizar recursos existentes. Mantén los originales y crea una salida identificable.

Comprueba versión y ayuda del programa disponible antes de construir comandos. Usa SpriteGen sólo si su entorno existe y el flujo solicitado está soportado. Si requiere una API, verifica proveedor, permiso y coste antes de generar. No elijas cuentas, claves ni un paquete de aceleración por tu cuenta.

Para una hoja existente comprueba dimensiones divisibles por la retícula, número y orden de fotogramas, márgenes, alfa, coherencia de escala e identidad, y ausencia de cortes o solapamientos. Una vista de la hoja y una reproducción animada permiten detectar fallos distintos; revisa ambas cuando haya herramientas.

Exporta imagen y metadatos que el motor real admita, e informa tamaño y secuencia comprobados. No afirmes animación fluida ni importación correcta sólo porque el PNG sea válido. Si falta generación o visualización, declara el estado preparado y entrega las comprobaciones que sí se pudieron ejecutar.
