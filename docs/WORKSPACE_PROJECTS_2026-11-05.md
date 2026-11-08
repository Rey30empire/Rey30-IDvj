# REINIER TAMAYO — INFORME TÉCNICO DE CODEX

**PROYECTO:** Rey30 IDvj  
**MÓDULO:** Espacio de trabajo por carpeta · 2026-11-05  
**ESTADO:** COMPLETADO CON LIMITACIONES. La suite web y la integración en Debug 0.9.5 están aprobadas. La Release se compiló y preparó para el lanzador. La revisión manual del selector se interrumpió con Escape.

## 1. Objetivo

Abrir una carpeta desde la barra lateral en Windows y continuar su sesión de trabajo al volver. El usuario debe poder elegir una carpeta existente o crear una vacía en el selector, pedir operaciones sobre archivos y revisar lo que hizo el agente.

## 2. Trabajo realizado

La versión estable de Windows ocultaba la superficie Cowork. La implementación expone **Abrir carpeta** en la barra lateral y presenta esa superficie como **Espacio de trabajo**. Reutiliza sus sesiones, selector de modelo, planificación y registro de herramientas.

El selector nativo devuelve la carpeta al frontend. Cancelarlo deja la selección actual intacta. Una ruta aceptada abre la sesión guardada para esa carpeta o crea una nueva. El trabajo sobre archivos empieza cuando el usuario envía una tarea. La [guía de uso](REY30_USER_GUIDE.md#trabajar-con-una-carpeta) explica cómo elegir el modelo, revisar cambios y volver a la sesión.

## 3. Arquitectura

`useCoworkFolderPicker` invoca `open_dialog` para una sola carpeta y pasa el resultado a `validate_cowork_folder`. El plugin Rust resuelve la ruta y comprueba que sea un directorio accesible, separado del almacenamiento de la app y de ubicaciones protegidas. Al ejecutar herramientas vuelve a validar el alcance. La carpeta elegida es la raíz de las rutas relativas de las herramientas de archivos. La sesión mantiene su almacenamiento temporal propio.

`useCoworkSessions` guarda la carpeta, el identificador, el modelo y el historial en el almacén nativo de ajustes. Una sesión nueva toma el modelo seleccionado si está disponible y admite herramientas. Al reabrir la carpeta, recupera el modelo de la sesión. En **Planificar**, el agente puede consultar archivos y proponer trabajo. Las mutaciones están bloqueadas hasta pasar a ejecución.

En Windows, `allowProcesses` excluye `shell` y `monitor` de las herramientas que se ofrecen al modelo cuando la sesión tiene una carpeta. El despacho aplica el mismo límite y Rust rechaza `shell` y el inicio de monitores por IPC si reciben una carpeta adjunta con escritura. Las operaciones de archivo conservan su validación de ruta. Las sesiones sin carpeta siguen sujetas a las comprobaciones del aislamiento de procesos. [Despacho](../web-app/src/lib/coworkDispatch.ts) · [Comandos Rust](../src-tauri/plugins/tauri-plugin-agent-tools/src/commands.rs)

El IPC de esquemas incluye `ls`, `find` y `grep`. Cowork las anuncia cuando la terminal no forma parte del conjunto permitido. Rust también rechaza una operación de archivo si un hook configurado para ella ejecutaría un comando en una carpeta de proyecto de Windows. [Selección de herramientas](../web-app/src/lib/coworkTools.ts) · [Comandos Rust](../src-tauri/plugins/tauri-plugin-agent-tools/src/commands.rs)

## 4. Análisis profesional

Reutilizar Cowork concentra el selector, la persistencia y la ejecución en los contratos existentes. La barra lateral añade el punto de entrada que faltaba en Windows estable. Validar el directorio antes de guardarlo permite explicar un rechazo en el momento de la selección. Revalidarlo durante la ejecución cubre cambios posteriores de la ruta.

Las operaciones actúan sobre los archivos elegidos. El diff ayuda a revisar una edición y el sistema de archivos determina si se aplicó. La integración aprobada comprobó ambas evidencias.

## 5. Comprensión profunda

Seleccionar una carpeta identifica el proyecto. Elegir un modelo con `tools` permite que este proponga llamadas estructuradas. El runner y Rust deciden si cada operación se puede ejecutar. Que un modelo declare `tools` indica compatibilidad en el catálogo. Su respuesta efectiva y la calidad del trabajo dependen de cada ejecución.

Se comprobó `tools` en los metadatos del modelo local de 4B instalado, sin cargar el modelo ni ejecutar inferencia. La política existente requiere **Normal** para las herramientas del espacio. **Solo local** y **Nube con revisión** las bloquean. Elegir un modelo local en **Normal** y activar **Solo local** son acciones distintas.

## 6. Bloqueos detectados

La condición de canal dejaba el acceso fuera de la edición estable de Windows. El acceso de escritorio en Windows está incorporado en fuente. La carpeta debe superar la validación y el modelo debe estar disponible y admitir herramientas. Si la carpeta desaparece, la validación devuelve un error al elegirla o al iniciar el trabajo. Si la política de privacidad bloquea herramientas, el flujo presenta ese motivo.

AppContainer añade al directorio de trabajo una entrada de acceso heredable al ejecutar procesos. Al usar una carpeta de proyecto real como directorio de trabajo, esa ruta podía recibir permisos nuevos que persistían después del proceso. Se limitó la ejecución de terminal y monitores con carpetas reales en Windows para evitar ese cambio. Esta corrección actúa antes de iniciar el proceso. [Implementación de AppContainer](../src-tauri/plugins/tauri-plugin-agent-tools/src/tools/appcontainer.rs)

El primer E2E se detuvo con `Tool ls was not advertised`. El IPC entregaba únicamente los esquemas básicos, que omitían `ls`, `find` y `grep` porque la terminal cubría esas operaciones. Se incorporaron al IPC los esquemas de búsqueda existentes y Cowork los ofrece cuando opera sin terminal. El segundo E2E pasó con la misma exigencia de anunciar `ls`. [Recibo del primer intento](../artifacts/qa/workspace-folder-e2e/run-szpFqP/receipt.json) · [Registro preservado](../artifacts/qa/workspace-projects-20261105/before-search-schemas/e2e-workspace.log)

## 7. Pruebas y evidencias

- La suite web final pasó 4969 pruebas en 385 archivos, código 0. Las suites focales de 223 y 81 pruebas se solapan con la suite web. [Suite web](../artifacts/qa/workspace-projects-20261105/test-web.log) · [Límite de procesos](../artifacts/qa/workspace-folder-20261105/runtime-web-file-only.log) · [Esquemas de búsqueda](../artifacts/qa/workspace-folder-20261105/search-schemas-web.log)
- Rust aprobó 12 pruebas focales de carpeta de trabajo, incluidas las restricciones de procesos y hooks, y una regresión del IPC de esquemas. [Carpetas y permisos](../artifacts/qa/workspace-folder-20261105/rust-workspace-file-only-final.log) · [Esquemas IPC](../artifacts/qa/workspace-folder-20261105/rust-search-schemas.log)
- Los tipos del E2E pasaron con `corepack yarn typecheck` en `e2e`. La compilación de Debug 0.9.5 terminó en 2 min 02 s, código 0. SHA-256 del ejecutable `54dff76f80ecf923a5da1e7d167b0a6325cce5935f211c18580d50bd038a4480`. [Compilación Debug](../artifacts/qa/workspace-projects-20261105/build-e2e.log)
- El E2E en Debug pasó 1 de 1 en 7,6 s, 12 s en total. Usó un perfil temporal, una carpeta real de prueba y un proveedor simulado en loopback. Registró siete POST SSE simulados y seis llamadas de herramienta por IPC real, incluida la escritura de escape rechazada. Comprobó los esquemas sin terminal ni monitor, los bytes escritos, el diff, el modelo y la sesión recuperados al reabrir. Registró cero inferencias reales. [Registro E2E](../artifacts/qa/workspace-projects-20261105/e2e-workspace.log) · [Recibo](../artifacts/qa/workspace-folder-e2e/run-ScOB7B/receipt.json) · [Transcripción](../artifacts/qa/workspace-folder-e2e/run-ScOB7B/workspace-transcript.png) · [Sesión reabierta](../artifacts/qa/workspace-folder-e2e/run-ScOB7B/workspace-return.png)
- Release Windows 0.9.5 terminó con código 0. El ejecutable preparado coincidió con el SHA-256 `e9e7232eb0e148527c167be2b20ecbed9244c9f935895e61bb845b50894c16e6`. El lanzador resolvió el ejecutable y la aplicación abrió su ventana. [Compilación](../artifacts/qa/workspace-projects-20261105/release-build-receipt.json) · [Preparación](../artifacts/qa/workspace-projects-20261105/staging-receipt.json) · [Comprobación del lanzador](../artifacts/qa/workspace-projects-20261105/launcher-check.log)

## 8. Control de calidad

La verificación de fuente congelada encontró 2313 archivos y cero diferencias. La prueba de integración se restringió a la carpeta sintética y al proveedor local simulado. Comprobó el rechazo de escritura fuera de la carpeta en el sistema de archivos y la persistencia del identificador de sesión tras recargar. [Comprobación de fuente](../artifacts/qa/workspace-projects-20261105/production-freeze-check.json)

La respuesta simulada del selector permitió comprobar su contrato con la aplicación. Escape interrumpió la comprobación manual del diálogo del sistema operativo.

## 9. Limitaciones

Queda pendiente la aceptación manual del selector de Windows. La compatibilidad declarada del modelo local de 4B se verificó en metadatos. Quedan sin medir su capacidad para completar una tarea real con herramientas y su rendimiento. El alcance de aceptación de esta entrega es Windows. El límite de procesos es preventivo. La inspección o retirada de entradas de permisos de ejecuciones anteriores queda fuera del alcance.

## 10. Siguiente paso

Comprobar el selector de carpetas con entrada física de Windows. Registrar ese resultado por separado de la compilación Release y del E2E en Debug.

## 11. Recomendación personalizada

Para la primera comprobación, Reinier puede abrir una carpeta vacía, elegir su modelo local compatible y pedir que cree `resumen.md`. Ver el archivo y su diff confirma el recorrido de escritura con un destino de prueba fácil de identificar.
