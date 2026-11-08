---
name: nvidia-skill-finder
description: Busca habilidades oficiales de NVIDIA para productos o flujos NVIDIA específicos; no se aplica a tareas genéricas de IA o software.
license: CC-BY-4.0 AND Apache-2.0
metadata:
  author: NVIDIA
  adaptation: Español y contexto de Rey30 IDvj, Reinier Tamayo, 2026-11-04
---

# Buscador de habilidades NVIDIA

Adaptación en español del buscador de NVIDIA. Usa el catálogo actual de [NVIDIA/skills](https://github.com/NVIDIA/skills) como fuente de nombres y disponibilidad. Esta habilidad descubre procedimientos; no instala SDK, controladores ni un motor de IA.

Actívala para una tarea relacionada con un producto NVIDIA: CUDA, NIM, NeMo, Omniverse/OpenUSD, Isaac, RAPIDS/cuDF, cuPyNumeric, cuOpt, Dynamo, Holoscan, TensorRT, DeepStream/VSS, TAO, Jetson/JetPack, NGC/NVCF, DOCA o BlueField. Una mención genérica a «IA», «vídeo», «rutas», «optimizar» o «infraestructura» no basta.

Relaciona el producto y la operación: desarrollo y perfilado CUDA; inferencia o entrenamiento; simulación y robótica; visión o voz; datos; optimización matemática; redes y aceleradores. Para Jetson distingue host, dispositivo, versión de JetPack y operación de flasheo. Para un SDK identifica primero su versión y plataforma. La referencia taxonómica original está en `references/taxonomy-routing.md`.

Busca una habilidad específica en la fuente oficial; lee su descripción y requisitos actuales antes de nombrarla como solución. Informa fuente, capacidad, compatibilidad y permisos. Si no hay una coincidencia clara, resuelve la pregunta con las herramientas disponibles sin instalar un conjunto entero.

Instalar o modificar capacidades necesita estar dentro del encargo vigente. Revisa procedencia, licencia y contenido y usa el importador de recursos de Rey30 IDvj. Un resultado de búsqueda no autoriza cambios de sistema ni una conexión de cuenta.

El propietario utiliza AMD para la IA y NVIDIA para juegos. Mantén esa elección. No sustituyas AMD por CUDA, no cambies drivers y no afirmes ejecución NVIDIA o AMD a partir de documentación del catálogo. Si una tarea necesita explícitamente NVIDIA, comprueba sus requisitos y explica el límite del procedimiento instalado.
