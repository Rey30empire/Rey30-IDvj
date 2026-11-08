# Rey30 IDvj

Distribución de escritorio mantenida por **Reinier Tamayo** para conversar con modelos locales, administrar asistentes, trabajar con herramientas y conectar proveedores externos. Conserva la estructura y la navegación del proyecto base.

El código deriva de Jan y se distribuye bajo Apache 2.0. Los avisos originales se conservan en [LICENSE](LICENSE) y [NOTICE](NOTICE); las modificaciones de esta distribución se identifican en el historial y en la documentación de migración. La identidad Rey30 IDvj no cambia la autoría de los componentes heredados ni de los modelos.

## Inicio en Windows

En este checkout, abre [Iniciar-Rey30-IDvj.bat](Iniciar-Rey30-IDvj.bat). El lanzador usa la aplicación compilada disponible; si falta, prepara el modo de desarrollo con las dependencias y herramientas necesarias. Para elegir ese modo explícitamente:

```powershell
.\Iniciar-Rey30-IDvj.bat -Dev
```

## Ejecutar desde el código

Requisitos: Node.js compatible con `^20.19.0 || >=22.12.0`, Corepack con Yarn 4.5.3, Rust según [rust-toolchain.toml](rust-toolchain.toml), herramientas nativas de Tauri y la cadena de compilación del motor seleccionado. En Windows se requieren las herramientas de compilación de Visual Studio y WebView2. Para compilar llama.cpp también se necesitan Git Bash, Make, CMake, Ninja y LLVM; CUDA o ROCm dependen del backend elegido.

Desde esta carpeta:

```powershell
corepack yarn install
corepack yarn build:tauri:plugin:api
corepack yarn build:core
corepack yarn build:extensions
corepack yarn dev
```

`corepack yarn build` construye la aplicación. El ejecutable de escritorio se llama **Rey30-IDvj**. Los binarios necesarios y la compilación del motor pueden requerir descargas y herramientas adicionales; revisar el resultado de cada paso antes de distribuirlo.

## Modelo y asistente predeterminados

La instalación y selección del modelo Jan de 4B se conservan. Sus identificadores, nombres de archivo y fuentes Hugging Face mantienen el nombre real del modelo, para que su descarga funcione y su procedencia siga siendo clara. La interfaz y el asistente de la distribución se presentan como Rey30 IDvj.

Los modelos descargados no forman parte del código fuente. Descargar un modelo, disponer de su archivo y completar una respuesta real son verificaciones diferentes. La compatibilidad, memoria necesaria y velocidad dependen del modelo, su cuantización y el equipo.

## Importar recursos y conectar GitHub

Desde **Importar recursos**, en el Hub o en ajustes de MCP, puedes detectar editores, elegir archivos o carpetas y revisar skills, agentes, reglas y servidores MCP antes de prepararlos. La conexión opcional con GitHub permite consultar repositorios de tu cuenta e inspeccionar sus recursos. La aplicación local funciona sin ese inicio de sesión.

La [guía de importación](docs/RESOURCE_IMPORT_GUIDE.md) explica los formatos, el uso de skills en el chat, la comprobación de MCP y las dependencias que pueden necesitar configuración manual. La [auditoría de integraciones](docs/INTEGRATIONS_AUDIT_2026-11-03.md) registra las pruebas y limitaciones de esta entrega.

## Componentes

La [guía de uso de Rey30 IDvj](docs/REY30_USER_GUIDE.md) describe el perfil, las habilidades y el orquestador, el catálogo MCP, la conexión API, la recuperación de preferencias y los modos de privacidad. Los controles e instrucciones instaladas se presentan en español; nombres de modelos, identificadores técnicos, contenido externo y avisos legales conservan su identidad.

- [web-app](web-app): interfaz React, navegación y ajustes.
- [core](core): contratos TypeScript y sistema de extensiones.
- [extensions](extensions): asistentes, conversaciones, descarga e inferencia.
- [src-tauri](src-tauri): aplicación nativa Rust y plugins.
- [docs](docs): guías funcionales de esta distribución.
- [e2e](e2e): pruebas de escritorio con perfiles temporales.
- [adk/python](adk/python): cliente Python del runtime de agentes.

## Datos y actualizaciones

Los perfiles nuevos usan Rey30-IDvj. La migración conserva acceso a configuraciones y modelos de perfiles anteriores mediante compatibilidad explícita; no hace falta duplicar pesos. No borres el perfil anterior hasta comprobar tus conversaciones y modelos.

El canal de actualización del proyecto base está desactivado. Esta distribución necesita sus propios artefactos y firma antes de habilitar actualizaciones. No hay un sitio, tienda ni canal de soporte público de Rey30 IDvj configurado en este repositorio.

## Comprobaciones

```powershell
corepack yarn lint
corepack yarn test
corepack yarn build:web
cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features
```

Las pruebas de escritorio requieren compilar la aplicación y usar un perfil aislado. [CONTRIBUTING.md](CONTRIBUTING.md) explica el flujo de trabajo; [SECURITY.md](SECURITY.md) describe el tratamiento de vulnerabilidades.
