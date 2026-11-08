Motor local de voz clonada de Pluma

Variante de llama.cpp b11960 para Windows x64. Qwen3-TTS reutiliza en memoria
la representación del hablante durante la llamada y adelanta el audio en
intervenciones breves. SOURCE.json documenta el
origen, la modificación local y el SHA-256 de los archivos preparados.

Primero prepara el runtime oficial con node scripts/prepare-pluma-runtime.mjs.
Después ejecuta scripts/prepare-pluma-tts-runtime.ps1 con -OutputDirectory
apuntando a una carpeta nueva. Copia sus archivos a este directorio de recursos.
