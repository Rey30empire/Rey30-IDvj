# Lore

Todo lo que forma a Plumita vive aquí, dentro del proyecto. La app lee esta
carpeta directamente: lo que metas aquí aparece sin volver a compilar (pulsa
«Actualizar» en las opciones de voz si la app ya estaba abierta).

| Carpeta | Qué va dentro | Dónde se usa |
| --- | --- | --- |
| `biblioteca/` | Libros, textos, PDF, Word, Markdown, HTML (su dataset literario). | Pluma busca aquí con «buscar en la biblioteca». |
| `voces/<carpeta>/hablar/` | Muestras de una sola voz clara, de 5 a 30 segundos, hasta 10 MB. Cada archivo es una voz. | Opciones de voz → «Voz para hablar». |
| `voces/<carpeta>/cantar/` | Muestras de esa voz cantando. | Opciones de voz → «Voz de canto». |
| `canciones/` | Letras en `.txt`, `.md` o `.lrc` (las marcas de tiempo LRC se quitan). El nombre del archivo es el título. | Dile «canta Lluvia de abril» y la canta con su letra. |

## Carpetas de voces

Cada asistente tiene su carpeta y, además, ve la de su género. Así no se
mezclan: una voz de hombre nunca le aparece a Pluma.

| Carpeta | De quién es | Quién la ve |
| --- | --- | --- |
| `voces/Pluma/` | Voces de Pluma (Plumita). | Pluma. |
| `voces/Beto/` | Voces de Beto. | Beto. |
| `voces/mujer/` | Voces de mujer que puede usar cualquier asistente mujer. | Pluma, Nara y las asistentes mujer. |
| `voces/hombre/` | Voces de hombre que puede usar cualquier asistente hombre. | Beto y los asistentes hombre. |

Hoy solo Pluma habla con voz clonada («Gemma 4 · voz clonada»). Las carpetas
de los demás quedan listas para cuando ellos también la tengan.

Para otro asistente, crea una carpeta con su nombre (`voces/Nara/hablar`): la
app la usa sola. Los asistentes que trae la app usan su nombre de siempre
(`Beto`, aunque en la app se llame Don Chispa); los que crees tú, su primer
nombre.

Lo que grabes con «Grabar mi voz» se guarda en la carpeta del asistente que
estás configurando.

Formatos: WAV y MP3 se usan tal cual. M4A, MP4, MPEG, AAC, OGG, Opus, WebM y
FLAC (notas de voz del teléfono o de WhatsApp) se convierten a WAV al elegirlos;
el archivo de Lore no se toca.

El nombre del archivo es lo que ves en la app: `voces/Pluma/hablar/Pluma suave.wav`
aparece como «Pluma suave».

Puedes cambiar de voz durante la llamada: la usa desde su próxima frase.

Nada de lo que hay dentro de estas carpetas se sube a git (son tus textos y tu
voz): solo este README y la estructura de carpetas. Si mueves el proyecto, la
app compilada sigue buscando Lore donde estaba; la variable de entorno
`REY30_LORE_DIR` puede apuntar a otra copia.
