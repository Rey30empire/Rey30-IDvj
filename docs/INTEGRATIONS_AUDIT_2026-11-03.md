# REINIER TAMAYO — INFORME TÉCNICO DE CODEX

Proyecto: Rey30 IDvj.

Módulo: auditoría transversal de identidad e integraciones; importación de componentes y GitHub opcional.

Fecha: 2026-11-03, America/Chicago.

Estado: COMPLETADO CON LIMITACIONES para esta auditoría y las integraciones nativas comprobadas. Auditoría, correcciones focalizadas y tres pruebas nativas sobre Debug con el renderer definitivo aprobadas. La Release 0.8.9 está compilada y preparada; el BAT apunta a ella. No se declara ejecutada: después de las pruebas, Computer Use notificó una parada del escritorio con Escape y no se abrió otra UI. El cierre general está en `PROJECT_STATUS.md`. Este informe no certifica una auditoría exhaustiva de cada línea ni compatibilidad universal con editores o componentes externos.

## 1. Objetivo

Identificar cómo importar skills, agentes, herramientas y declaraciones MCP desde otros editores o repositorios, sin ejecutar sus instrucciones durante la inspección. Preparar un acceso GitHub opcional para consultar repositorios. Revisar referencias de identidad migrables y conservar la navegación, el aspecto y los colores actuales.

## 2. Trabajo realizado

Se revisaron puntos de entrada y contratos de UI, backend, CLI, SDK JavaScript/Python, documentación, configuración raíz y dependencias declaradas. La cobertura fue estática y por subsistemas: rutas, llamadas IPC, formatos, permisos, nombres públicos, manifiestos y fixtures. No se leyó íntegramente cada archivo ni se reprodujeron todas las integraciones externas.

Se corrigieron dos límites de seguridad:

- Los agentes compatibles con Claude distinguen una restricción ausente de una lista explícita vacía o sin herramientas traducibles. Una definición explícita vacía queda sin herramientas; no hereda las del padre. `Glob` se traduce a `find` y `Grep` a `grep`, equivalentes nativos de búsqueda sin shell. Se aceptan listas YAML y nombres separados por comas. Políticas de permisos, sandbox, aprobación, aislamiento o herramientas prohibidas que no se traducen producen también una definición sin herramientas para revisión manual.
- Los procesos MCP stdio de escritorio eliminan credenciales heredadas detectables por nombre antes de aplicar el `env` asignado explícitamente a ese servidor. No se alteran sus cabeceras HTTP explícitas. Variables operativas como PATH, directorios de runtime y locale se conservan.

Se ajustaron ejemplos de rutas `~/.rey30-idvj`, ramas `rey30-idvj/agent/`, prefijos de correlación y mensajes del servidor a la implementación actual. La guía de protocolo remite a los esquemas y ejemplos del checkout correspondiente, sin presentar el protocolo upstream como el de esta distribución. Se retiraron el diagnóstico Electron con `chown`, la promesa de retención de logs durante 24 horas y las instrucciones de borrar perfiles/modelos para reparar una compilación.

La revisión paralela de UI identificó que el editor JSON de MCP aceptaba `null` y arrays, que podían interpretarse como un mapa vacío al guardar. Se implementaron validación compartida y persistencia antes de actualizar el estado. El nuevo diálogo de importación usa las entradas existentes del Hub y Ajustes MCP, selección inicialmente vacía, vista previa de texto y confirmación de lo seleccionado. MCP se guarda inactivo por defecto; conectar y comprobar es una opción separada desmarcada inicialmente. La integración nativa se comprobó sobre Debug con el renderer definitivo; la compilación y el arranque de la Release de entrega quedan a cargo del cierre general del proyecto.

## 3. Arquitectura

El repositorio ya dispone de skills `SKILL.md` y Markdown plano, ámbitos proyecto/usuario/plugin, invocación explícita y catálogo para el modelo. El destino canónico de las skills importadas por el módulo nuevo es `<data>/agent-workspace/skills/<nombre>/SKILL.md`: utiliza el almacén permanente compartido con el consumidor de skills de escritorio. La prueba de importación actual comprueba también que la skill resultante puede invocarse mediante ese consumidor. El CLI conserva sus ámbitos propios; copiar una skill al almacén de escritorio no garantiza que aparezca en todos los ámbitos del CLI.

Los plugins pueden declarar `skills/`, `commands/`, `agents/`, `plugin.toml`, `.claude-plugin/plugin.json`, `.mcp.json`, herramientas y hooks. Instalar archivos no inicia inmediatamente un servidor MCP, pero los hooks y herramientas de plugins están habilitados por defecto para las sesiones que los cargan. Por ello, inspeccionar debe usar un área separada del almacén activo y la activación debe ser una acción diferenciada.

El backend MCP usa `mcp_config.json` con un mapa `mcpServers`. Sus transportes internos son stdio, `http` y `sse`. Un `server.json` del registro MCP describe paquetes y conexiones remotas: necesita adaptación y selección de receta; no es un comando ni un mapa interno listo para ejecutar. Véase la [especificación oficial](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md).

El módulo nuevo está en `src-tauri/src/core/integrations/`, con detección/importación, acceso GitHub y recetas separados. El frontend usa `ImportResourcesDialog` y un cliente IPC tipado. Que un agente quede preparado en el almacén no significa que esté disponible en el chat clásico: sus runtimes y superficies deben indicarse expresamente. No se habilitó Cowork como parte de esta interfaz.

## 4. Análisis profesional

Conviene reutilizar los parsers y servicios existentes en lugar de construir otro cargador paralelo. La detección debe producir un inventario revisable: formato, origen, archivos asociados, restricciones traducibles, dependencias, colisiones y motivo de incompatibilidad.

La importación debe conservar la fuente y el contenido original, impedir rutas fuera del destino y tratar una restricción desconocida como una limitación, sin convertirla en permisos completos. Copiar un hook no equivale a aprobar su ejecución. Detectar `package.json` o `pyproject.toml` tampoco demuestra que exista una receta MCP instalable ni autoriza sus scripts de instalación.

## 5. Comprensión profunda

Una skill es un procedimiento; un agente es una definición de comportamiento con límites de herramientas; una herramienta local puede ejecutar código; MCP es un protocolo para exponer capacidades. Un plugin puede agrupar varios de estos elementos. Importarlos exige preservar estas diferencias.

GitHub CLI ofrece autenticación en navegador y almacenamiento de credenciales del sistema, con posible fallback a texto plano. La aplicación no debe prometer un almacén seguro garantizado ni mostrar tokens. Además, `gh auth status --json` puede devolver código cero aunque existan problemas de autenticación: debe comprobarse el estado contenido en la respuesta. Fuentes: [login](https://cli.github.com/manual/gh_auth_login) y [estado](https://cli.github.com/manual/gh_auth_status).

`gh repo list` enumera repositorios del propietario indicado y tiene un límite predeterminado de 30. Para incluir repositorios accesibles por colaboración y organización, la API documenta `GET /user/repos`, con paginación y permisos de lectura apropiados. Fuentes: [repo list](https://cli.github.com/manual/gh_repo_list) y [repositorios del usuario autenticado](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user).

## 6. Bloqueos detectados

Corregido en código: el adaptador de agentes descartaba herramientas desconocidas y, si no quedaba ninguna, heredaba las del padre. También normalizaba una definición vacía durante el despacho. Ambas capas conservan ahora la restricción explícita.

Corregido en código: el arranque stdio MCP de escritorio heredaba credenciales del proceso sin aplicar el filtrado previo disponible en el flujo CLI. El filtrado nuevo actúa por nombres y permite al usuario asignar después las credenciales específicas del MCP.

La prueba nativa comprobó importación local, conexión explícita de un MCP propio, disponibilidad de la skill en el chat clásico y listado de repositorios mediante una sesión GitHub CLI existente y autorizada. Siguen pendientes la cobertura de cada editor, importación de repositorios autenticados y recetas de terceros. Los proveedores OAuth pueden exigir aprobación o registro de cliente; instalar un plugin no elimina esa dependencia. No se inició un login nuevo ni se ejecutó una instalación externa durante esta auditoría.

## 7. Pruebas y evidencias

Los resultados de esta fase se guardan en `artifacts/qa/integrations-docs/`. Los recibos de la migración del 1 de noviembre son evidencia histórica y no prueban los cambios de esta fase.

Pruebas focalizadas:

- Escritorio MCP: `cargo test --locked --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target --no-default-features --features test-tauri --lib core::mcp::helpers::stdio_environment_tests:: -- --test-threads=1`: **3 aprobadas, 0 fallos**, 0,04 s de ejecución. Incluye un proceso hijo real con entorno aislado y credenciales ficticias. Log: `artifacts/qa/integrations-docs/desktop-mcp-env-tests.log`.
- CLI/subagentes: **144 aprobadas, 0 fallos**, 4,08 s de ejecución sobre la fuente actual, incluido `tools: null`. Cubren parser, políticas no traducidas, restricciones hasta el despacho y su serialización y techo del padre. Log: `artifacts/qa/integrations-docs/subagent-tests-current.log`.
- Backend de integraciones actual: **28 aprobadas, 0 fallos y 1 ignorada**, 2,98 s. Incluye destino canónico de skills, invocación mediante el consumidor real y build de un fixture Bun privado sin dependencias de red. Log: `artifacts/qa/integrations-20261103/test-integrations-final.log`.
- Archivo GitHub local explícito: **1 aprobada**, ejecutada aparte con su entrada autorizada; corresponde al caso ignorado por defecto en el filtro anterior. No ejecuta código del repositorio inspeccionado. Log: `artifacts/qa/integrations-docs/runtime-final-08be36ad50d44a918148c3005b8eca3f/github-real-archive.log`.
- Persistencia MCP: **2 aprobadas, 0 fallos**. Log: `artifacts/qa/integrations-docs/stored-config-tests-current.log`. El subtotal Rust de los filtros y el caso explícito es **178 pruebas aprobadas**: `28 + 1 + 144 + 2 + 3`. No representa toda la suite Rust del repositorio. La omisión del caso de archivo en el filtro ordinario queda documentada y su ejecución separada no se cuenta dos veces.
- Documentación: `corepack yarn --cwd docs build` y `corepack yarn --cwd docs postbuild`, código de salida 0. Auditoría del HTML generado: **82 páginas, 4968 enlaces internos comprobados, 0 rotos y 0 rutas retiradas restantes**. El checker resuelve rutas absolutas y relativas, fragmentos y archivos locales; excluye URLs externas. Logs, checker y JSON: `docs-build-final.log`, `docs-postbuild-final.log`, `audit-doc-links.py` y `docs-link-audit.json` bajo `artifacts/qa/integrations-docs/`. Persisten advertencias de deprecación Sass, sin error de construcción.

Los perfiles Rust de prueba usan `REY30_CONFIG_HOME`, `REY30_DATA_ROOT` y `REY30_DATA_FOLDER` temporales. Hubo intentos de compilación intermedios con `E0583` por `recipes.rs` todavía no creado y `E0505` en la integración concurrente; no fueron fallos de pruebas ejecutadas. Una suite intermedia de integraciones detectó tres fallos de fixtures/rutas Windows; el responsable corrigió esos casos y repitió el filtro completo. Las ejecuciones anteriores de 23 y 27 casos de integraciones son históricas; el filtro actual es el de 28 aprobadas indicado arriba. El recibo `scope-final.receipt.json` conserva la fase anterior de 172 pruebas y no se reescribe como si fuera la entrega actual. El resumen vigente se guarda en `artifacts/qa/integrations-docs/scope-delivery.receipt.json`.

Fixtures y contratos inspeccionados: `src-tauri/tests/fixtures/upgrade/0.8.3/mcp_config.json`, pruebas de plugins/skills/subagentes en Rust y `web-app/src/lib/__tests__/skillStore.test.ts`. Su presencia no se cuenta como una ejecución aprobada. La aceptación completa de UI, importación y GitHub corresponde a la validación final del módulo.

La auditoría NPM ejecutada por el agente principal produjo 18 entradas: 16 moderadas, 2 altas y ninguna crítica. Son entradas de advisories, no 18 paquetes únicos. Evidencia: `artifacts/qa/integrations-20261103/npm-audit.jsonl`. No se reprodujeron exploits. Las dos altas corresponden a cadenas antiguas de tooling: `braces` 1.8.5/2.3.2 mediante micromatch 2/3 y `decode-uri-component` 0.2.2 mediante source-map-resolve 0.5.3. Fuentes contrastadas: [GHSA-grv7-fg5c-xmjg](https://github.com/advisories/GHSA-grv7-fg5c-xmjg) y [GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f).

Frontend: la ejecución web definitiva aprobó **4568 pruebas en 342 archivos**, 0 fallos, en 128,70 s. Log actual: `artifacts/qa/integrations-20261103/test-web-accepted.log`. Las ejecuciones de entrega anteriores y los resultados focalizados de 59 casos, tipos y lint se conservan como históricos; estos últimos están en `artifacts/qa/typecheck-integrations-frontend.log`, `lint-integrations-frontend.log` y `test-integrations-frontend.log`.

La ejecución nativa definitiva aprobó **3 pruebas**, 0 fallos, con salida 0, en 13,7 s de casos y 17 s de ejecución de la especificación. Comprobó revisión e importación con un MCP local propio y conexión explícita, listado y expansión de la skill en el chat clásico sin enviar mensaje, y listado de repositorios mediante la sesión GitHub CLI existente y autorizada. Log: `artifacts/qa/integrations-20261103/test-native-wdio-accepted.log`. Los artefactos están en `artifacts/qa/resource-imports-e2e/run-BF4x3v/`; su recibo registra título, cierre y pie dentro del viewport de 1200 × 800. El agente principal inspeccionó la captura. `artifacts/qa/integrations-20261103/wdio-accepted-result.json` registra los hashes de Debug y del renderer definitivo, salida 0 y hash de ajustes originales idéntico antes y después. La cohorte anterior de 19,7 s queda como histórica. La Release posterior compiló con salida 0 y quedó preparada; estas pruebas no acreditan su arranque, un OAuth nuevo ni instalación de MCP de terceros. Véase release-staging.json y la parada de escritorio registrada en ui-control-stopped.json.

## 8. Control de calidad

- Funcionalidad: se conservan formatos existentes, ámbitos y navegación. Una lista de herramientas desconocida ya no aumenta acceso.
- Seguridad: el código de terceros se inspecciona como datos; las pruebas de entorno utilizan credenciales ficticias y no modifican secretos del usuario. La configuración explícita del MCP mantiene prioridad sobre el filtrado heredado.
- Rendimiento: el filtrado de entorno recorre sus nombres una vez por arranque stdio. Los tiempos registrados de pruebas y carga corresponden a esos escenarios; no constituyen benchmarks ni una medición comparable de memoria o rendimiento global de la aplicación.
- Mantenibilidad: se reutiliza el adaptador de agentes y se cubre la diferencia entre ausencia y restricción vacía. El filtro de escritorio es conservador y distinto del filtro estrecho del CLI; esta diferencia debe mantenerse documentada.
- Integración: las pruebas focalizadas no sustituyen el build y la ejecución final de la aplicación. No se cambió el diseño visual.

## 9. Limitaciones

El filtrado detecta credenciales por el nombre de variable; no descubre secretos ocultos bajo nombres arbitrarios. Variables necesarias para un MCP que coincidan con esos patrones deben asignarse explícitamente a ese servidor. No se acreditó compatibilidad universal con plugins ni con todos los editores.

La auditoría NPM corresponde al grafo consultado por el comando registrado; no acredita ausencia de vulnerabilidades en otros locks independientes, Rust, binarios empaquetados ni servicios externos. Las dos entradas altas indicadas siguen pendientes: forzar `braces` 3 o `decode-uri-component` 0.5.1 sin migrar sus consumidores puede romper contratos de API o de módulos. La propuesta es retirar o migrar el tooling antiguo que introduce esas cadenas, incluido cpx, y repetir la auditoría. No se ejecutaron pruebas en todos los sistemas operativos, mediciones de rendimiento, un login nuevo ni instalación de MCP externos. Las credenciales, permisos y binarios requeridos por terceros siguen siendo dependencias de cada integración.

Las referencias al proyecto base tienen categorías distintas:

- **Compatibilidad:** IDs persistidos, nombres de archivo de instrucciones heredados, aliases de variables, valores serializados y fixtures de migración se conservan cuando el código los necesita.
- **Procedencia legal y externa:** LICENSE/NOTICE, autores originales, paquetes, modelos de terceros y sus fuentes reales no se reatribuyen.
- **Identidad migrable:** nombres visibles propios, comandos actuales, rutas nuevas, etiquetas y ejemplos deben usar Rey30 IDvj. Se corrigieron las discrepancias verificadas; el informe no afirma que no quede ninguna cadena antigua en todo el árbol.

## 10. Siguiente paso

La Release y el chequeo no interactivo del BAT están registrados en el cierre general; su arranque final quedó sin ejecutar tras la parada con Escape. Como ampliaciones posteriores, extender la cobertura integrada de editores y recetas de terceros, y comprobar por separado un login nuevo cuando se autorice. Los casos nativos aprobados no sustituyen esas comprobaciones ni autorizan activar automáticamente el contenido encontrado. Cada importación debe informar qué quedó preparado y qué tiene dependencias pendientes.

Propuestas de nombres, sin aplicarlas: **Importar componentes** para la acción y **Origen**/**Destino** para la revisión. Mantener los colores actuales y expresar estados mediante texto como **Preparado**, **Incompatible** o **Requiere configuración**; cualquier cambio de color requiere revisar contraste y coherencia con el diseño existente. No se propone modificar navegación ni reemplazar la paleta.

Política actual declarada por el usuario: **AMD Radeon AI PRO R9700 para toda la IA de este proyecto; NVIDIA funcional reservada para juegos y deshabilitada para IA por elección del usuario**. Esto describe su disposición, no una comprobación del estado del adaptador en Windows. No se recomienda cambiar la IA a NVIDIA. El harness QA exigió `Vulkan1 = AMD Radeon AI PRO R9700` antes de cargar, usó contexto 4096 y `fit = off`, y excluyó CUDA únicamente en el entorno de su hijo. Carga, listado y una inferencia real `9 + 6 → 15` devolvieron HTTP 200. Se cerró después mediante su `stop.flag`: worker 42316 y harness 39780 salieron con código 0 y se comprobó que ambos PIDs estaban ausentes. Evidencia en la carpeta del worker real bajo `artifacts/qa/integrations-20261103/`: `receipt-amd-ready.json`, `receipt.json` y `receipt-amd-shutdown.json`. No se cambiaron perfiles, drivers ni la configuración global, ni se copiaron o enlazaron pesos; los metadatos de tamaño y modificación del GGUF permanecieron iguales.

La fase NVIDIA anterior quedó cerrada de forma ordenada, con worker y harness en código de salida 0, y archivada en la subcarpeta `phase-nvidia-prior/` de esa misma evidencia. El intento inicial que exigía `Vulkan1 = NVIDIA` se detuvo antes de cargar y conserva `receipt-device-mismatch.json`. La correspondencia actual observada es `Vulkan0 = NVIDIA` y `Vulkan1 = AMD`; no se atribuye la diferencia histórica a una causa no comprobada. Como mejora propuesta, sin aplicar un arreglo global, persistir y comprobar una identidad física estable (UUID o identificadores PCI cuando el backend los exponga) además del índice. Esta QA no acredita por sí sola qué GPU usa el dispositivo predeterminado de la aplicación.

## 11. Recomendación personalizada

Reinier Tamayo, mantendría la interfaz actual y la importación revisable implementada sobre los contratos existentes. Priorizaría permisos que no aumenten al convertir formatos, conservación de datos y una separación visible entre inspeccionar, preparar y ejecutar. Evitaría prometer instalación automática para un repositorio que solo contiene código o instrucciones sin una receta verificable.
