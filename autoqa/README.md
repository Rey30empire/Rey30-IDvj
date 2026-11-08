# AutoQA de Rey30 IDvj

Este arnés heredado puede iniciar la aplicación, controlar una sesión de ordenador y guardar grabaciones. Requiere las dependencias de `requirements.txt`, un proveedor de automatización configurado y un entorno de pruebas dedicado. La migración de nombres no demuestra que se haya ejecutado una prueba real de interfaz.

Desde `autoqa/`, usa `python main.py --help`. La aplicación se elige con `--rey30-app-path` o `REY30_APP_PATH`, y el proceso con `--rey30-process-name` o `REY30_PROCESS_NAME`. El binario de escritorio se llama `Rey30-IDvj`; el bundle macOS se llama `Rey30 IDvj.app`.

ReportPortal está desactivado por defecto. Para habilitarlo hacen falta endpoint, proyecto y token propios, proporcionados explícitamente. No hay un servidor externo predeterminado. Las grabaciones y registros pertenecen a la ejecución local hasta que se configure ese envío.

Los scripts de limpieza global rechazan la ejecución para proteger instalaciones y datos existentes. Los workflows que instalaban, borraban y reportaban contra infraestructura heredada se retiraron. Para comprobaciones reproducibles del escritorio se recomienda el arnés de [e2e](../e2e/README.md), que crea perfiles temporales y valida sus rutas.
