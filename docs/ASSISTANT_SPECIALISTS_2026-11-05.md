# REINIER TAMAYO — INFORME TÉCNICO DE CODEX

**Proyecto** Rey30 IDvj  
**Módulo** Asistentes de chat y voz y puente OpenClaw  
**Estado** COMPLETADO CON LIMITACIONES. Release 0.9.6 preparada para Windows x64. La conexión en vivo a OpenClaw está pendiente de una CLI oficial disponible y un Gateway configurado.

## 1. Objetivo

Dar a los asistentes acceso directo y continuidad desde la barra lateral, siguiendo el recorrido de Kimi Claw mostrado en las capturas. Separar la especialidad de chat de la personalidad hablada, añadir un poeta para voz y preparar el puente oficial de OpenClaw.

## 2. Trabajo realizado

El grupo plegable **Asistentes** muestra el nombre y la especialidad. Un clic abre el último chat independiente de ese perfil. Si todavía no tiene uno, deja preparado el chat nuevo con el asistente seleccionado. El engranaje abre la administración. El selector superior muestra el modelo efectivo del perfil y su proveedor, incluso si el chat guardó una asignación anterior. [Barra lateral](../web-app/src/components/left-sidebar/NavAssistants.tsx) · [Selector](../web-app/src/containers/DropdownModelProvider.tsx)

Atlas se dedica a arquitectura, Forja a backend, Lince a depuración, Senda a interfaces, Vértice a infraestructura, Nova a calidad y Centinela a seguridad. Verso compone y recita poemas originales durante la conversación hablada. Nova conserva su carácter travieso en voz y usa su especialidad de calidad por escrito. [Catálogo](../web-app/src/lib/characters/profiles.ts) · [Guía de uso](REY30_USER_GUIDE.md#asistentes-de-chat-y-voz)

## 3. Arquitectura

Los perfiles integrados usan IDs estables y se proyectan al selector de asistentes existente. La migración reconoce el catálogo anterior, respeta nombres personalizados y añade los dos perfiles nuevos. El modelo se resuelve desde la asignación efectiva. Con asignación automática se usa un candidato local elegible y se prioriza Jan 4B. Los roles técnicos se componen en `buildCharacterContext`. [Perfiles y migración](../web-app/src/lib/characters/profiles.ts) · [Transporte](../web-app/src/lib/custom-chat-transport.ts)

El adaptador MCP prepara un proceso stdio `openclaw mcp serve --claude-channel-mode off`. El catálogo ofrece revisar y guardar la receta inactiva, con una ruta absoluta opcional para la CLI. La conexión usa el flujo existente de Servidores MCP. [Receta nativa](../src-tauri/src/core/integrations/catalog.rs) · [Guía de OpenClaw](src/pages/docs/desktop/integrations/openclaw.mdx) · [Servidor oficial](https://docs.openclaw.ai/cli/mcp/serve)

La CLI de Rey30 añadió **OpenClaw** en estado inactivo a la configuración habitual. La lectura posterior comprobó la conservación de las seis entradas anteriores y de los demás ajustes MCP. [Registro de configuración habitual](../artifacts/qa/assistants-specialists-20261105/openclaw-habitual-save.json)

## 4. Análisis profesional

El perfil, el modelo y la conversación son entidades distintas. Reutilizar el historial existente permite volver al contexto de trabajo sin duplicar hilos. Resolver en la cabecera y en el transporte el mismo modelo evita que un chat antiguo muestre una asignación distinta de la que se usará para enviar.

Kimi configura su propia instancia, modelo y suscripción. El puente oficial ofrece acceso a conversaciones que un Gateway puede enrutar. La comprobación de un Gateway operativo y su autenticación pertenece a la conexión real. [Despliegue de Kimi Claw](https://www.kimi.com/en/help/kimi-claw/desktop-deployment-guide) · [Alcance del puente](https://docs.openclaw.ai/cli/mcp/serve)

## 5. Comprensión profunda

El orbe abre la sesión de voz bajo una acción explícita. El envío dictado marca su mensaje dentro de esa sesión en memoria. Para aplicar la personalidad hablada, el transporte comprueba mensaje, conversación y asistente. Un envío escrito pausa la voz activa y usa el perfil técnico. En chat escrito, Verso usa un registro neutro e indica cómo activar la recitación. [Sesión de voz](../web-app/src/stores/useAvatarVoiceSession.ts) · [Contexto](../web-app/src/lib/characters/personality.ts)

## 6. Bloqueos detectados

Al reabrir un hilo, la cabecera podía priorizar la asignación histórica y el transporte usar la actual. Se corrigieron la visualización y la resolución cuando la asignación del perfil está en automático. La CLI oficial de OpenClaw no estaba disponible en el PATH comprobado. La documentación de Kimi describe su propio despliegue y no proporciona un procedimiento de autenticación del puente con la sesión de escritorio de Kimi.

El ejecutable de pruebas Rust sin manifiesto falló en el cargador de Windows con `0xc0000139`. El análisis identificó `TaskDialogIndirect` de Common Controls. La copia de prueba con el manifiesto de Common Controls v6 de la aplicación ejecutó el código compilado. [Evidencia del cargador y prueba](../artifacts/qa/openclaw-20261105/native-openclaw-test-receipt.json)

En la primera prueba de escritorio, el arranque aislado solicitó el modelo auxiliar `sentence-transformer-mini`. La comprobación de archivos detectó la descarga de 45.949.216 bytes y dejó la prueba incompleta. Se retiró el archivo de ese perfil temporal y se repitió la prueba con un proxy local sin escucha para impedir las descargas HTTP externas, conservando el acceso al proveedor de metadatos en loopback. [Primer intento](../artifacts/qa/assistants-specialists-20261105/e2e-initial.log) · [Registro de la descarga aislada](../artifacts/qa/assistants-specialists-20261105/e2e-initial-embedder-receipt.json)

## 7. Pruebas y evidencias

- `corepack yarn test:web --maxWorkers=8 --minWorkers=1` pasó 4.984 pruebas en 386 archivos. La suite cubre migración, selección, perfiles por canal y envío dictado. [Suite web](../artifacts/qa/assistants-specialists-20261105/test-web.log)
- La compilación web de Windows con `IS_TAURI=true` y `TAURI_ENV_PLATFORM=windows` terminó con código 0. ESLint focal registró cero errores. [Construcción](../artifacts/qa/assistants-specialists-20261105/build-web.log) · [ESLint](../artifacts/qa/assistants-specialists-20261105/lint.log)
- Seis pruebas de catálogo Rust pasaron. La prueba existente de registro externo se omitió. La CLI de Rey30 guardó la configuración inactiva sobre una copia aislada y se compararon las demás entradas. [Rust](../artifacts/qa/openclaw-20261105/native-catalog-tests.log) · [Guardado aislado](../artifacts/qa/assistants-specialists-20261105/openclaw-isolated-save.json)
- La aplicación nativa Debug pasó los cinco casos de `characters-preferences.e2e.ts`. Verificó la selección de Verso desde la barra lateral con el orbe inactivo, el regreso al hilo de Atlas, la persistencia de perfiles y modelos, la recuperación de preferencias y el guardado real del puente OpenClaw inactivo. Las solicitudes de catálogo se simularon en el límite IPC y el proveedor local sirvió únicamente metadatos. [Registro](../artifacts/qa/assistants-specialists-20261105/e2e.log) · [Recibo](../artifacts/qa/assistants-specialists-20261105/native-e2e-receipt.json) · [Captura de la barra lateral](../artifacts/qa/characters-preferences-e2e/run-zvMeqD/sidebar-specialists-1200.png)
- `cargo build --locked --offline --release --manifest-path src-tauri/Cargo.toml --bin Rey30-IDvj` terminó en 7 min 45 s con código 0. El ejecutable Windows x64 preparado mide 61.645.824 bytes y su SHA-256 es `1d3d8f127ee6dfa8768e39b37af90b2497061b1ebc40c72e1ea344b4cca53d03`. `Iniciar-Rey30-IDvj.bat -Check` resolvió el ejecutable preparado. [Compilación](../artifacts/qa/assistants-specialists-20261105/release-build-receipt.json) · [Preparación](../artifacts/qa/assistants-specialists-20261105/staging-receipt.json) · [Lanzador](../artifacts/qa/assistants-specialists-20261105/launcher-check.log)

## 8. Control de calidad

La barra lateral conserva los destinos de chat, proyectos, Hub y espacio de trabajo. Los controles son operables con teclado y muestran su estado de selección mediante texto y atributos accesibles. Las pruebas verifican que un chat temporal o de proyecto queda fuera del acceso independiente. Los tests de transporte simulan al proveedor y prueban el caso de voz anterior seguida por texto. [Navegación](../web-app/src/components/left-sidebar/__tests__/NavAssistants.test.tsx) · [Transporte](../artifacts/qa/assistant-voice-channel-tests.log)

Se cotejaron 2.314 archivos de fuente antes de preparar Release. Se verificaron los otros 459 archivos de runtime, el tamaño y fecha de los pesos de Jan 4B y el hash de los ajustes del motor. La copia privada de asistentes anterior a 0.9.6 quedó bajo `%APPDATA%\Rey30-IDvj\backup`. [Control de fuente](../artifacts/qa/assistants-specialists-20261105/production-freeze-check.json) · [Preparación](../artifacts/qa/assistants-specialists-20261105/staging-receipt.json)

## 9. Limitaciones

La calidad de respuesta de los modelos y el audio físico quedan sin medir. El puente MCP requiere una CLI oficial disponible y un Gateway configurado con canales. La capacidad de consultar o enviar por un canal depende de la cuenta y los permisos del Gateway. Al guardar los dos nuevos perfiles, una vuelta a la versión 0.9.5 requiere recuperar la configuración anterior desde la copia privada de asistentes.

## 10. Siguiente paso

Verificar la conexión del puente con el Gateway elegido y consultar la lista de herramientas anunciadas. La autenticación y el acceso a canales dependen de esa instancia.

## 11. Recomendación personalizada

Reinier Tamayo puede abrir a Nova desde la barra lateral para trabajar en pruebas por escrito. Para usar su estilo conversacional o recitar con Verso, la acción que cambia de canal es **Iniciar voz**. La misma navegación conserva la conversación cuando vuelve al chat.
