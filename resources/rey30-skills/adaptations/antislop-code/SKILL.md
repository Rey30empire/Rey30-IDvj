---
name: antislop-code
description: Limpia comentarios genéricos del código conservando razones, contratos, licencias y restricciones importantes, sin cambiar comportamiento.
license: MIT
---

# AntiSlop — comentarios de código

Adaptación al español del procedimiento de higiene de comentarios. Úsalo para revisar comentarios o cuando una edición autorizada los necesite; no conviertas una limpieza de comentarios en una refactorización de código.

Un comentario aporta información que el código no muestra: razón de negocio, contrato, límite de plataforma, seguridad, concurrencia, rendimiento, protocolo, caso límite o motivo de una excepción. Conserva esa información y todos los avisos de licencia.

Retira o acorta comentarios que narren la declaración siguiente, anuncien una sección obvia, repitan el nombre de una función o expliquen historia que no cambie una decisión actual. Evita separadores decorativos, cajas, títulos en mayúsculas, emojis y frases formales innecesarias. Un comentario por cada línea tapa la lógica que pretende explicar.

Prefiere una frase natural sobre la restricción; usa una segunda sólo si añade otro hecho necesario. No conviertas una razón valiosa en un párrafo de justificaciones. No borres una explicación necesaria sólo para reducir el número de líneas.

Al terminar revisa el diff: en una tarea exclusivamente de comentarios no debe cambiar código ejecutable, literales de producto ni comportamiento. Si descubres un defecto funcional, infórmalo o corrígelo únicamente dentro del alcance autorizado y compruébalo por separado.
