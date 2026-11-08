---
name: rey30-openbot
description: Revisa una instalación OpenBot y delimita importación de capacidades y acceso a archivos o navegador antes de conectarla con el editor.
license: Apache-2.0
---

# OpenBot — guía propia de integración

El nombre no identifica un proyecto único. La referencia revisada es [nightly-labs/openbot](https://github.com/nightly-labs/openbot), cuya licencia PolyForm Noncommercial no permite asumir uso comercial. Esta habilidad propia no incorpora su código ni instala la aplicación.

Identifica el repositorio o instalación concreta. Inspecciona capacidades declaradas, formatos de skills/agentes, conectores y almacenamiento de credenciales. No conectes sesiones del navegador, cuentas de mensajería ni carpetas amplias para demostrar descubrimiento.

Si el propósito es reutilizar una habilidad, importa únicamente su procedimiento revisado con el importador de Rey30 IDvj, conservando licencia, procedencia y requisitos. No copies ejecutables, permisos o hooks de otro agente como si fuesen compatibles con este editor.

Si se necesita interoperar con una instancia, usa sólo su API o MCP documentado para esa versión, con alcance y autenticación delimitados. Prueba una operación de lectura autorizada antes de afirmar conexión. Separa licencia de la guía propia y licencia del programa externo. Si no hay instancia o la identidad sigue ambigua, deja explícito el requisito pendiente.
