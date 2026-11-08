# Validación y distribución de Rey30 IDvj

Los workflows activos comprueban Rust, TypeScript, documentación, aislamiento e2e y compilación del motor. La matriz de motor conserva CUDA, Vulkan, ROCm y Metal; no comparte cachés ni credenciales con infraestructura de otros mantenedores.

`rey30-idvj-offline-dependencies.yml` prepara dependencias vendorizadas como artifacts del workflow para construir sin red. No publica releases. `rey30-idvj-docs.yml` exporta documentación como artifact y no la despliega.

Se retiraron los flujos heredados de publicación a npm, tiendas, S3 y Cloudflare, firma/canales de actualización, notificaciones y automatización de issues. También se retiró la orquestación AutoQA que usaba instalaciones de uso diario y subía registros a un servidor externo. El historial Git conserva las versiones anteriores para revisión.

Los scripts de limpieza global de AutoQA rechazan la ejecución. Usa los perfiles temporales y comprobaciones de ruta de `e2e/` antes de limpiar datos. Los adaptadores antiguos de empaquetado Electron están retirados; la configuración actual es Tauri.

Para activar una distribución pública hacen falta destinos, certificados y claves propios, revisión de los artefactos y aprobación de publicación. Ningún workflow de este checkout activa esos canales por defecto.
