---
name: rey30-skill-hub
description: Localiza e importa una habilidad o agente específico desde archivos locales o repositorios GitHub revisados en Rey30 IDvj.
---

# Skill Hub de Rey30

Consulta primero las habilidades instaladas y el importador de recursos de la aplicación. Busca por capacidad concreta y compara el resultado con la tarea. El número de descargas no demuestra seguridad ni compatibilidad.

Para un repositorio, verifica propietario, commit, licencia y ubicación exacta de `SKILL.md` o definición de agente. Revisa el texto completo y los recursos que se van a copiar. No instales fixtures de pruebas, ejemplos de ataque ni una colección entera por una sola habilidad. La revisión de un catálogo no concede permisos al contenido que enumera.

Importa mediante el flujo de revisión de recursos existente: muestra candidatos, advertencias y colisiones, selecciona sólo los solicitados y conserva el recibo. Una habilidad con nombre ya utilizado debe conservar la versión local hasta decidir una actualización explícita. No ejecutes scripts durante el descubrimiento.

Tras importar comprueba que el nombre aparezca en el gestor y que sus instrucciones puedan leerse o invocarse. Si necesita un programa, API, clave o servidor, indícalo como requisito separado. Instalar un procedimiento no instala automáticamente su herramienta externa.
