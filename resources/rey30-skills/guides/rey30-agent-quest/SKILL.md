---
name: rey30-agent-quest
description: Examina registros de ejecución y prepara una visualización Agent Quest sin convertir un visor de sesiones en un orquestador.
license: Apache-2.0
---

# Agent Quest — guía propia de seguimiento

El nombre solicitado es ambiguo; la referencia revisada es [FulAppiOS/Agent-Quest](https://github.com/FulAppiOS/Agent-Quest). Es un visualizador de sesiones externo, no el motor de ejecución de los agentes de Rey30 IDvj. La fuente recomienda WSL para Windows y requiere su entorno Bun; esa aplicación no se instala al agregar este procedimiento.

Define qué se necesita observar: tareas, duración, llamadas de herramientas, errores o consumo registrado. Localiza únicamente los recibos o sesiones autorizados; no recorras todos los historiales personales para una demostración.

Revisa el formato y contenido antes de importar. Los logs pueden contener prompts, rutas, claves y datos privados: elimina o sustituye secretos en una copia de trabajo, conservando el original. Un alias de agente en un registro no prueba que exista un proceso activo.

Si hay una instancia compatible, prepara su fuente de datos según la documentación de esa versión y prueba lectura sin modificar sesiones originales. Si no hay visor instalado, analiza los recibos disponibles y entrega un informe factual con intervalos y estados comprobados. No inventes métricas ausentes ni identifiques progreso a partir de animaciones.
