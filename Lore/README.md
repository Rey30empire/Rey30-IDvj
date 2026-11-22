# Lore

Todo lo que forma a Plumita vive aquí, dentro del proyecto. La app lee esta
carpeta directamente: lo que metas aquí aparece sin volver a compilar (pulsa
«Actualizar» en las opciones de voz si la app ya estaba abierta).

| Carpeta | Qué va dentro | Dónde se usa |
| --- | --- | --- |
| `biblioteca/` | Libros, textos, PDF, Word, Markdown, HTML (su dataset literario). | Pluma busca aquí con «buscar en la biblioteca». |
| `voces/hablar/` | Muestras WAV o MP3 de una sola voz clara, de 5 a 30 segundos, hasta 10 MB. Cada archivo es una voz. | Opciones de voz de Pluma → «Voz para hablar». |
| `voces/cantar/` | Muestras WAV o MP3 de esa voz cantando. | Opciones de voz de Pluma → «Voz de canto». |
| `canciones/` | Letras en `.txt`, `.md` o `.lrc` (las marcas de tiempo LRC se quitan). El nombre del archivo es el título. | Dile «canta Lluvia de abril» y la canta con su letra. |

El nombre del archivo es lo que ves en la app: `voces/hablar/Pluma suave.wav`
aparece como «Pluma suave».

Para cambiar de voz, pausa la llamada, elige la voz en el selector y vuelve a
empezar.

Nada de lo que hay dentro de estas carpetas se sube a git (son tus textos y tu
voz): solo este README y la estructura de carpetas. Si mueves el proyecto, la
app compilada sigue buscando Lore donde estaba; la variable de entorno
`REY30_LORE_DIR` puede apuntar a otra copia.
