# Scripts de AutoQA

Los adaptadores de descarga e instalación necesitan un instalador de Rey30 IDvj proporcionado explícitamente. No existe una URL de descarga pública propia predeterminada. Revisa ruta, versión y entorno de pruebas antes de usarlos.

Los scripts `*_cleanup.*` y `*_post_cleanup.*` rechazan la ejecución. No deben eliminar perfiles, modelos ni instalaciones de uso diario. Usa el directorio temporal creado por la ejecución de `e2e/` cuando corresponda.

`run_tests.ps1` y `run_tests.sh` invocan el arnés Python con sus opciones actuales `--rey30-app-path` y `--rey30-process-name`. La automatización remota y ReportPortal requieren configuración propia explícita. No se mantienen workflows de publicación ni envío a infraestructura heredada.
