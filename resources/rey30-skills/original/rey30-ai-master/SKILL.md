---
name: rey30-ai-master
description: Define e implementa flujos de IA local, contratos de proveedor y selección de herramientas conservando el modelo y dispositivo elegidos.
---

# AI Master de Rey30

Distingue el modelo (identidad y arquitectura), sus pesos y cuantización, el motor de ejecución, el contexto, el dispositivo y la API. No confundas el tamaño del archivo con memoria total de ejecución. Conserva Jan 4B y AMD como valores existentes salvo una petición explícita para cambiarlos.

Para conectar otra aplicación usa el servidor API local existente y su URL base OpenAI compatible, identificador real de modelo y clave. `127.0.0.1` sirve al mismo ordenador. Otra máquina necesita dirección privada alcanzable y autenticación; copiar una URL local no publica un servicio en Internet. No anuncies endpoints que el servidor no implemente.

Para una tarea con herramientas inspecciona sus esquemas y resultados, valida argumentos y utiliza sólo conexiones activas. Un MCP instalado pero sin credenciales no puede realizar acciones de esa cuenta. No inventes capacidades de visión, voz, navegación, escritura ni generación de medios a partir del nombre del modelo.

Antes de recomendar una migración compara soporte del formato, licencia, memoria disponible y mantenimiento. Prioriza ajustes acotados a la aplicación. No cambies drivers, adaptadores globales ni variables de otros programas para resolver una selección local. NVIDIA se conserva disponible para los juegos.

Prueba contratos y manejo de fallos sin cargar pesos cuando el propietario haya pedido no hacer más pruebas de modelos. Separa configuración comprobada, ejecución histórica y nueva ejecución; no presentes un resultado antiguo como una medición actual.
