Reconocimiento de voz con Whisper

whisper.cpp b5907 oficial para Windows x64 con OpenBLAS, sin cambios. Funciona
con el procesador, así que no quita memoria de las tarjetas a la voz de Pluma
ni a Strata. La app lo usa para escribir lo que dices (el chat de las
llamadas, el dictado) y vuelve al reconocedor pequeño (Vosk) si falta.
SOURCE.json documenta el origen y el SHA-256 de cada archivo.

Prepáralo con node scripts/prepare-pluma-whisper-runtime.mjs.

El modelo no va dentro de la app: ggml-large-v3-turbo-q5_0.bin
(ggerganov/whisper.cpp, licencia MIT) va en la carpeta de modelos, en
Pluma\Whisper-large-v3-turbo. La variable REY30_WHISPER_DIR puede apuntar a
otra.
