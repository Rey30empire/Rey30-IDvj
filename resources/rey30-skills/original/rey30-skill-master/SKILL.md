---
name: rey30-skill-master
description: Crea, revisa y mantiene habilidades SKILL.md y definiciones de agente con entradas precisas y comprobación de comportamiento.
---

# Skill Master

Identifica primero una petición concreta que deba activar la habilidad y otra parecida que deba resolverse sin ella. Reutiliza una habilidad instalada si ya cubre ese procedimiento; evita duplicar catálogos o instalar una colección completa por una sola función.

Una habilidad nueva contiene `SKILL.md` con `name` en minúsculas y guiones y una `description` que explique capacidad y ocasión de uso. Incluye restricciones que cambien decisiones reales, entradas, resultado observable y manejo de errores. Elimina consejos generales que el modelo ya conoce. Añade scripts sólo para operaciones repetidas que puedas ejecutar y comprobar en el entorno disponible.

Un agente reutilizable necesita nombre, descripción y un `system_prompt` especializado. En Rey30 IDvj el formato de la definición es TOML; `model = "inherit"` conserva el modelo de la sesión. No amplíes su lista de herramientas sobre las que ya tenga el agente principal. No prometas paralelismo si la superficie actual sólo ofrece un perfil de instrucciones.

Al importar desde GitHub, fija un commit y examina el contenido completo que vas a instalar, sus referencias y su licencia. Busca envío de datos, lectura de credenciales, comandos de instalación, servidores remotos, escrituras fuera del proyecto y reglas que intenten cambiar permisos. Ejemplos de ataque y fixtures de escáneres no son habilidades para activar. Conserva copyright y atribución exigidos.

Prueba el enrutamiento con las dos peticiones iniciales y un error realista: falta de herramienta, archivo inválido o permiso denegado. Comprueba descubrimiento, lectura y límites; un validador de YAML no demuestra que la habilidad tome buenas decisiones. Registra fuente y versión, y conserva las modificaciones locales al actualizar.
