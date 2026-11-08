---
name: find-skills
description: Encuentra habilidades existentes para una capacidad concreta y revisa su fuente antes de instalarlas.
license: MIT
---

# Encontrar habilidades

Adaptación al español de Find Skills. Primero consulta las habilidades instaladas; una capacidad existente puede resolver la tarea sin añadir paquetes.

Define el dominio y la operación concreta. Consulta [skills.sh](https://skills.sh/) como directorio de descubrimiento y verifica después el repositorio original. Las posiciones, descargas y estrellas no demuestran seguridad ni compatibilidad.

Si están disponibles Node.js y Skills CLI, la búsqueda admite:

```text
npx skills find <consulta concreta>
npx skills find <consulta> --owner <propietario>
```

Una búsqueda no autoriza instalar. Antes de agregar un resultado, lee su `SKILL.md`, referencias y scripts necesarios; fija propietario, ruta y commit. Revisa licencia, mantenimiento, permisos, transferencias de datos, dependencias, compatibilidad Windows y coincidencia con la necesidad. Descarta ejemplos de ataque y fixtures aunque aparezcan en resultados de un catálogo.

Para instalar una habilidad autorizada, utiliza el importador revisable de Rey30 IDvj. El comando externo `npx skills add <owner/repo@skill>` instala en los agentes que soporte ese CLI; no asumas que cambia el almacén de Rey30 IDvj. No añadas `-g`, colecciones completas ni conexiones de cuenta sin que el alcance lo requiera.

Tras instalar comprueba descubrimiento y lectura en el gestor real, y registra origen y requisitos. Una guía que mencione un CLI no instala ese programa.

Cuando no exista una fuente verificable, informa qué se buscó y crea una habilidad propia con otro identificador y propósito concreto si la persona lo autorizó. Conserva la distinción entre el proyecto original, una adaptación y una alternativa propia.
