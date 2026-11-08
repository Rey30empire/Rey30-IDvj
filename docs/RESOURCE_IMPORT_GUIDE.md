# Importar recursos en Rey30 IDvj

Abre **Importar recursos** desde el Hub o desde la configuración de MCP. La aplicación funciona sin iniciar sesión en GitHub.

Puedes revisar una colección de skills, agentes, reglas o servidores MCP, incluidos repositorios que mezclen varios tipos. La aplicación prepara los elementos compatibles que selecciones. Un repositorio necesita archivos reconocibles y, para preparar un MCP ejecutable, una configuración o receta compatible con sus requisitos resueltos.

## Recursos locales

**Detectar editores** busca ubicaciones conocidas de Codex, skills compartidas, Cursor, Claude Code, Windsurf, Gemini CLI, Continue y configuraciones MCP de VS Code, Claude Desktop, Cline y Roo Code. También puedes elegir una carpeta, cargar un archivo o pegar una ruta absoluta.

Revisa el origen, el tipo, las instrucciones y las advertencias de cada recurso; marca únicamente los que quieras preparar. La vista previa no ejecuta scripts ni conecta servidores. Un nombre ocupado recibe un nombre nuevo: no se reemplaza el recurso existente.

- **Skills:** se copia `SKILL.md` junto con los archivos auxiliares. En el chat normal, el menú **Skills** inserta `/skill:nombre`; al enviar, se incorporan sus instrucciones. Los scripts adjuntos no se ejecutan por la importación ni por esta expansión.
- **Reglas y comandos Markdown:** se convierten en skills de uso explícito. Las condiciones automáticas propias de otro editor no se activan.
- **Agentes:** se convierten a definiciones del runtime de agentes. Las restricciones no traducibles se conservan como una definición sin herramientas. Cowork continúa oculto en la versión estable; importar agentes no habilita ese entorno ni los convierte en subagentes del chat clásico.
- **MCP:** se admite configuración JSON compatible, `mcpServers`, `servers` de VS Code y `mcp_servers` de Codex TOML. Los valores de conexión se conservan localmente y se ocultan en la vista previa. Las rutas y variables exclusivas de otro editor pueden necesitar adaptación.

Las instrucciones de Copilot en `.github/copilot-instructions.md` y `.github/instructions/**/*.instructions.md` también se preparan como skills explícitas; `applyTo` no se activa automáticamente. Los agentes Copilot `.agent.md` pueden tomar el nombre del archivo si lo omiten. Esa adaptación no elimina los campos obligatorios de otros formatos ni amplía sus permisos.

## Repositorios de GitHub

Selecciona **GitHub**. Si existe una sesión de GitHub CLI, se utiliza esa cuenta; si no, **Conectar con GitHub** inicia su autorización por navegador. GitHub CLI es una dependencia de esta conexión, no un requisito para utilizar el asistente local. El almacenamiento de sus credenciales depende de la configuración de GitHub CLI.

La lista incluye repositorios accesibles por propiedad, colaboración u organización, con paginación. El filtro se aplica a la página cargada. **Revisar** descarga una instantánea del commit seleccionado e inspecciona sus recursos sin ejecutar el repositorio.

El mismo flujo sirve para repositorios de skills, agentes, reglas, MCP o colecciones mixtas. También puedes analizar un clon local desde **Recursos locales**. Revisa cada elemento detectado, su destino y sus advertencias antes de seleccionarlo; no necesitas importar toda la colección.

Para MCP, la detección busca configuraciones explícitas admitidas y metadatos compatibles. Un `server.json` puede declarar una conexión HTTP/SSE o un paquete publicado npm/PyPI con versión exacta. En proyectos Node o Python, `package.json` o `pyproject.toml` pueden aportar una receta cuando contienen los datos necesarios. Un nombre de paquete o un README no bastan para demostrar que el programa implementa MCP. Si falta una receta verificable, el servidor requiere preparación manual.

La revisión muestra el paquete, la versión y los comandos que se prepararán. Si un manifiesto apunta a una publicación npm/PyPI, se instala esa versión publicada; los cambios locales de un fork no se incluyen automáticamente. Para preparar el código del repositorio se necesita una receta local compatible y revisar su comando de construcción.

La preparación de paquetes puede ejecutar código de instalación o compilación después de confirmar. Los servidores Node necesitan Node.js compatible; Bun se utiliza para preparar dependencias y compilaciones declaradas. Los intérpretes Python, credenciales, dependencias nativas o servicios externos que falten se notifican como errores o requisitos manuales. Otros registros y formatos no compatibles no se convierten en comandos inventados.

Revisa el origen antes de confirmar: los comandos de construcción y el servidor se ejecutan con los permisos de tu usuario. Una carpeta de preparación privada separa los archivos, pero no aísla ese código del sistema.

## Colecciones mixtas

Esta estructura ilustra una colección con recursos de varios tipos; no exige un manifiesto propio de Rey30 IDvj:

```text
coleccion/
  skills/
    resumir/
      SKILL.md
      references/
  agents/
    revisor.md
  rules/
    estilo.mdc
  .mcp.json
```

`SKILL.md` identifica una skill y sus archivos auxiliares. Los agentes deben usar un formato compatible y declarar los campos que requiera su parser. Las reglas y comandos reconocidos se preparan como skills explícitas; las condiciones automáticas del editor original no se activan. La configuración MCP se revisa por separado aunque comparta repositorio con esos recursos.

La exploración tiene límites de profundidad, cantidad y tamaño, y omite enlaces y carpetas de dependencias o artefactos. Si una colección es grande o un recurso no aparece, revisa las advertencias y analiza una subcarpeta o archivo concreto. Hooks, extensiones de un IDE y otros formatos requieren una revisión aparte; la importación no convierte cualquier repositorio en una integración ejecutable.

## Preparar y conectar

Los MCP se añaden **desactivados**. Si marcas **Conectar y comprobar MCP al terminar**, la aplicación inicia el servidor, comprueba la conexión y consulta sus herramientas antes de guardar su activación. Si falla, muestra el motivo y trata de detener lo iniciado; la copia del recurso no se presenta como una conexión verificada.

La configuración MCP previa se combina de forma aditiva. Se conservan los campos existentes y se completan valores predeterminados que falten. Antes de escribir se guarda una copia local `mcp_config.before-import-<id>.json`. Estas copias contienen la configuración anterior, incluidos los valores de conexión que tuviera.

Si el JSON existente está corrupto o cambia durante la preparación, la operación devuelve un error para que se revise; no lo sustituye silenciosamente por un mapa vacío. Las vistas previas caducan y no pueden reutilizarse después de confirmar.

## GPU y datos existentes

La preferencia de este proyecto es **AMD para IA y NVIDIA para juegos**. La configuración actual conserva `Vulkan1`, comprobado como AMD Radeon AI PRO R9700 durante esta entrega. Los índices pueden cambiar al enumerar dispositivos; deben contrastarse con el nombre físico.

El modelo local predeterminado y los chats existentes se conservan. La prueba aislada de inferencia utiliza el GGUF original por referencia, sin copiarlo ni crear enlaces y sin cambiar los ajustes del perfil.
