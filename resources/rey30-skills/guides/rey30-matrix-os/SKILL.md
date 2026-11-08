---
name: rey30-matrix-os
description: Evalúa y prepara una integración de MatrixOS con un espacio de trabajo existente, distinguiendo cliente Windows y servidor Linux.
license: Apache-2.0
---

# MatrixOS — guía propia de integración

El nombre solicitado es ambiguo; la referencia revisada es [HamedMP/matrix-os](https://github.com/HamedMP/matrix-os). Esta habilidad propia no instala su servidor ni reemplaza el escritorio de Rey30 IDvj.

Identifica primero el repositorio o una instancia que la persona ya utilice. Revisa su versión, manifiestos, proveedor de modelos, límites del espacio de trabajo y autenticación. El proyecto revisado usa Node, pnpm y Bun; su despliegue de servidor incorpora servicios Linux. No presentes ese despliegue como una aplicación nativa Windows ni actives WSL o servicios del sistema para completar una revisión.

Para interoperar, identifica una interfaz documentada en esa versión: API, importación de archivos o endpoint de modelos. Usa el servidor OpenAI compatible local de Rey30 sólo si el cliente admite ese contrato. Copia la URL base y el ID real de modelo desde la configuración; `127.0.0.1` sólo es alcanzable desde el mismo host. Un contenedor o servidor remoto necesita red y autenticación explícitas.

Antes de importar datos, delimita carpetas y operaciones. Conserva archivos y credenciales existentes; no ejecutes instaladores `curl | sudo bash` durante descubrimiento. Revisa la licencia AGPL del software externo antes de distribuir una integración derivada. La guía propia no cambia esa licencia.

Valida primero descubrimiento, autenticación y un contrato de lectura autorizado. Sin una instancia disponible, entrega configuración y requisitos como preparados, no como una conexión ejecutada.
