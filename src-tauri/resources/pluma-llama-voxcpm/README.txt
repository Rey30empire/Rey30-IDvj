Motor de la voz expresiva de Pluma

llama.cpp b12648 oficial para Windows x64 con Vulkan, sin cambios: su ruta /tts
ejecuta VoxCPM2, que clona la voz de la muestra y acepta una descripción del
estilo al principio del texto (emociones, y algo de acento). SOURCE.json
documenta el origen y el SHA-256 de cada archivo.

Prepáralo con node scripts/prepare-pluma-voxcpm-runtime.mjs.

El modelo no va dentro de la app: VoxCPM2-Q8_0.gguf y mmproj-VoxCPM2-BF16.gguf
(ggml-org/VoxCPM2-GGUF, licencia Apache 2.0) van en la carpeta de modelos, en
Pluma\VoxCPM2-GGUF. La variable REY30_PLUMA_VOXCPM_DIR puede apuntar a otra.
