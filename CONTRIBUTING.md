# Contribuir a Rey30 IDvj

La distribución la mantiene Reinier Tamayo. Conserva la licencia y los avisos de los componentes heredados; identifica tus modificaciones en el historial.

## Arquitectura

La interfaz de `web-app/` importa los contratos de `core/` y las extensiones de `extensions/`. Estas capas llaman a los comandos Rust de `src-tauri/` mediante Tauri IPC. Los plugins nativos se encargan del hardware, la inferencia y las herramientas. La estructura de navegación se conserva durante la migración de marca.

## Preparación y cambios

Sigue los requisitos y comandos del [README](README.md). Usa cambios pequeños y revisables. Conserva configuraciones, conversaciones, credenciales y modelos existentes. No sustituyas identificadores de modelos ni URLs de dependencias por nombres de marca: forman parte de contratos externos reales.

Los paquetes locales usan el scope `@rey30-idvj`. Algunas dependencias publicadas conservan su nombre original porque no existe un paquete equivalente de esta distribución.

## Validación

Ejecuta los controles adecuados al cambio: `corepack yarn lint`, `corepack yarn test`, `corepack yarn build:web` y los tests Rust afectados. Las pruebas de [e2e](e2e/README.md) requieren una aplicación compilada y perfiles temporales. Nunca ejecutes una limpieza automática contra el perfil de uso diario.

Una prueba con mocks comprueba su contrato; una compilación comprueba el código compilado. La descarga de un modelo y una conversación real deben comprobarse por separado antes de declarar la integración lista.

## Distribución

Los flujos de publicación, firma, tiendas, telemetría del sitio y despliegue heredados quedan sin activar hasta disponer de infraestructura propia revisada. No publiques en scopes ni dominios de otros mantenedores. Para problemas de seguridad sigue [SECURITY.md](SECURITY.md).
