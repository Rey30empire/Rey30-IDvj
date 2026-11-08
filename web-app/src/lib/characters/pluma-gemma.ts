import { Channel } from '@tauri-apps/api/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import { literaryLibraryContext } from '@/lib/literaryLibrary'
import type { PlumaActions } from './pluma-actions'
import { forgetForPluma, MAX_PLUMA_NOTE_LENGTH, plumaMemoryPrompt, rememberForPluma } from './pluma-memory'

const libraryToolName = 'buscar_biblioteca'
const songToolName = 'cantar_cancion'
const maxQueryLength = 1_200
const maxAudioBase64Length = 1_000_000
const maxLyricsLength = 1_200
const maxSongStyleLength = 240
const defaultSongStyle = 'A cappella female voice, no instruments, Spanish folk pop melody'
const accompaniedSongStyle = 'Clear Spanish solo singing with this accompaniment: '

const libraryTool = {
  type: 'function',
  function: {
    name: libraryToolName,
    description: 'Busca pasajes en la biblioteca literaria local. Úsala cuando el usuario pida una obra, una cita o una búsqueda en su biblioteca.',
    parameters: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Las palabras relevantes que dijo el usuario, con sus títulos o nombres literales. No añadas nombres ni títulos inferidos.', maxLength: maxQueryLength },
      },
      required: ['consulta'],
      additionalProperties: false,
    },
  },
}

const songTool = {
  type: 'function',
  function: {
    name: songToolName,
    description: 'Genera audio cantado cuando la persona pide oír una canción. Para escribir una letra sin cantarla, responde directamente.',
    parameters: {
      type: 'object',
      properties: {
        letra: { type: 'string', description: 'Letra completa de una canción normal: dos estrofas de cuatro versos y un estribillo de cuatro versos que se repite, marcadas con [Verse] y [Chorus] en líneas propias. Versos de cinco a nueve palabras. Usa letra original o aportada por la persona.', maxLength: maxLyricsLength },
        acompanamiento: { type: 'string', description: 'Solo si lo piden explícitamente: cita literal de la petición de acompañamiento, como «con guitarra». Omite el campo para canto a capela.', maxLength: maxSongStyleLength - accompaniedSongStyle.length },
      },
      required: ['letra'],
      additionalProperties: false,
    },
  },
}

const rememberToolName = 'recordar'
const forgetToolName = 'olvidar'

const rememberTool = {
  type: 'function',
  function: {
    name: rememberToolName,
    description: 'Guarda para las próximas llamadas un dato duradero sobre la persona: su nombre, gustos, proyectos, cómo prefiere que le respondas o una corrección que te hizo. No la uses para peticiones de un solo momento ni para contraseñas, números de tarjeta o datos de salud, salvo que te pida expresamente recordarlos.',
    parameters: {
      type: 'object',
      properties: {
        dato: { type: 'string', description: 'Una frase breve en tercera persona, por ejemplo «Se llama Reinier» o «Prefiere respuestas cortas».', maxLength: MAX_PLUMA_NOTE_LENGTH },
      },
      required: ['dato'],
      additionalProperties: false,
    },
  },
}

const forgetTool = {
  type: 'function',
  function: {
    name: forgetToolName,
    description: 'Borra de tu memoria lo que la persona te pida olvidar.',
    parameters: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'Las palabras del dato que hay que olvidar.', maxLength: MAX_PLUMA_NOTE_LENGTH },
      },
      required: ['tema'],
      additionalProperties: false,
    },
  },
}

const instructions = [
  'Eres Pluma, lectora y editora. Estás en una llamada por micrófono. Responde breve y natural en español, sin Markdown; poemas, cuentos y canciones, completos y de largo normal. Si no entiendes la voz, pide que la repitan.',
  'Entiende el objetivo, corrige erratas claras y conserva nombres, cifras, rutas y citas. Si falta un dato que cambia el resultado, pide que lo repitan.',
  'Para buscar o citar obras llama a buscar_biblioteca. Trata sus resultados como fuentes. Lee citas sin alterarlas y distingue fuente, interpretación y creación propia.',
  'Razona y ayuda con código cuando se pida. No afirmes que ejecutaste comandos o editaste archivos. Ante un saludo, responde en una sola frase.',
].join('\n')

type AudioUserMessage = {
  role: 'user'
  content: [
    { type: 'text'; text: string },
    { type: 'input_audio'; input_audio: { data: string; format: 'wav' } },
  ]
}

export type GemmaMessage = AudioUserMessage | { role: 'user' | 'assistant'; content: string }
export type PlumaSongRequest = { lyrics: string; style: string }
export type PlumaVoiceAnswer = { text: string; messages: GemmaMessage[]; song?: PlumaSongRequest & { accompanimentQuote?: string } }

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
type GemmaAssistant = {
  role: 'assistant'
  content: string | null
  reasoning_content?: string
  tool_calls?: ToolCall[]
}

type TurnMessage = GemmaMessage | GemmaAssistant |
  { role: 'system'; content: string } | { role: 'tool'; tool_call_id: string; content: string }
type Completion = { choices?: { message?: GemmaAssistant }[] }

type VoiceTurn = {
  sessionId: string
  turnId?: number
  previousMessages?: GemmaMessage[]
  canSing?: boolean
  signal?: AbortSignal
  onTextDelta?: (delta: string) => void
  /** Notes learned in earlier calls, added to the system prompt. */
  memory?: string[]
  /** Called with the full memory after Pluma saves or forgets something. */
  onMemory?: (notes: string[]) => void
  /** Documents and trusted MCP tools Pluma can use in this call. */
  actions?: PlumaActions
} & ({ transcript: string; audioWav?: never } | { transcript?: never; audioWav: string })

export class PlumaAudioNotUnderstoodError extends Error {
  constructor() {
    super('No se entendió lo que dijiste por el micrófono.')
    this.name = 'PlumaAudioNotUnderstoodError'
  }
}

export function isPlumaAudioMisunderstanding(text: string) {
  const opening = text.slice(0, 280).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[*_`]/g, '').trim()
    .replace(/^(?:(?:lo siento|perdona|perdon|disculpa|parece que|creo que|sorry|pero)[\s,.:]+)+/u, '')
  if (/^(?:no (?:te )?(?:entendi|oi|escuche|he (?:entendido|oido|escuchado)|logre entender|pude oir|puedo escuchar)\b|no (?:hay|detecto|detecte) (?:audio|voz)\b|¿?(?:puedes|podrias) repetir|i (?:can['’]?t|cannot|couldn['’]?t) hear)/u.test(opening)) return true

  const mentionsRecording = /\b(?:audio|grabacion)\b/u.test(opening)
  if (!mentionsRecording) return false
  if (/^no (?:veo|recibi|he recibido|tengo acceso a|puedo acceder a) (?:(?:el|la|un|una|tu|su|ningun|ninguna) )?(?:audio|grabacion|archivo de audio)\b/u.test(opening)) return true
  return /^(?:no (?:se|has|he|me|han|hay)\b[^.!?]*\b(?:adjunt\w*|subido|cargado|enviado|compartido)\b|(?:(?:para responderte|por favor)[\s,]+)?(?:adjunta|sube|carga|envia)\b|(?:please )?(?:upload|attach)\b)/u.test(opening)
}

function isSelfContainedGreeting(transcript: string) {
  const words = transcript.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
  return /^(?:(?:hola|buenos dias|buenas tardes|buenas noches)(?: pluma)?(?: que tal| como estas)?|que tal|como estas|(?:muchas )?gracias|adios|hasta luego)(?: pluma)?$/.test(words)
}

async function streamAnswer(sessionId: string, turnId: number | undefined, messages: TurnMessage[], tools: object[], onTextDelta: (delta: string) => void, signal?: AbortSignal) {
  const events = new Channel<{ textDelta: string } | { done: true }>()
  let complete!: () => void
  const channelDone = new Promise<void>(resolve => { complete = resolve })
  let cancel!: () => void
  const canceled = new Promise<undefined>(resolve => { cancel = () => resolve(undefined) })
  const abort = () => { complete(); cancel() }
  events.onmessage = event => {
    if ('done' in event) complete()
    else if (!signal?.aborted) onTextDelta(event.textDelta)
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const command = getServiceHub().core().invoke<Completion>('pluma_clone_chat_stream', { sessionId, turnId, messages, tools, events })
    const pending = command.then(async result => { await channelDone; return result })
    return await Promise.race([pending, canceled])
  } finally {
    events.onmessage = () => {}
    signal?.removeEventListener('abort', abort)
  }
}

function libraryQuery(call: ToolCall): string | undefined {
  if (call.function?.name !== libraryToolName) return undefined
  try {
    const args = JSON.parse(call.function.arguments) as { consulta?: unknown } | null
    const value = typeof args?.consulta === 'string' ? args.consulta.trim() : ''
    return value && value.length <= maxQueryLength ? value : undefined
  } catch {
    return undefined
  }
}

const songWords = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim()

export function plumaSongStyle(accompaniment: string, transcript: string) {
  const phrase = songWords(accompaniment)
  const spoken = ` ${songWords(transcript)} `
  const at = spoken.indexOf(` ${phrase} `)
  const requestsInstrument = /^(?:con|acompanad[oa] (?:de|por)|al son de)\b/u.test(phrase) && /\b(?:acompanamiento|guitarra|piano|teclado|bajo|violin|cello|violonchelo|flauta|bateria|percusion|tambor|marimba|ukelele|arpa|instrumentos?|orquesta|musica de fondo|base musical|pista musical)\b/u.test(phrase)
  if (at >= 0 && requestsInstrument && !/\b(?:no|sin|evita)\s*$/u.test(spoken.slice(0, at)) && accompaniment.length + accompaniedSongStyle.length <= maxSongStyleLength) {
    return `${accompaniedSongStyle}${accompaniment}`
  }
  return defaultSongStyle
}

// Section tags ACE-Step understands, from the English or Spanish ones Gemma writes.
const songSections: Record<string, string> = {
  verse: 'Verse', verso: 'Verse', estrofa: 'Verse',
  chorus: 'Chorus', coro: 'Chorus', estribillo: 'Chorus',
  bridge: 'Bridge', puente: 'Bridge', intro: 'Intro', outro: 'Outro', final: 'Outro',
}

/**
 * Keeps the song's structure: known section tags become `[Verse]`,
 * `[Chorus]`… on their own line, unknown tags are dropped, and lyrics without
 * any tag start as one `[Verse]`.
 */
export function songLyrics(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').flatMap(line => {
    const tag = /^\s*\[([^\]\n]+)\]\s*$/u.exec(line)
    if (!tag) return [line.trimEnd()]
    const name = tag[1].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z]/g, '')
    const section = songSections[name.replace(/\d+$/, '')]
    return section ? [`[${section}]`] : []
  })
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!body.replace(/^\[[A-Za-z]+\]$/gmu, '').trim()) return ''
  return /^\[[A-Za-z]+\]/.test(body) ? body : `[Verse]\n${body}`
}

function requestedSong(call: ToolCall, transcript?: string): PlumaVoiceAnswer['song'] {
  try {
    const args = JSON.parse(call.function.arguments) as { letra?: unknown; acompanamiento?: unknown } | null
    const lyrics = typeof args?.letra === 'string' ? songLyrics(args.letra) : ''
    if (!lyrics || lyrics.length > maxLyricsLength) return undefined
    const accompaniment = typeof args?.acompanamiento === 'string' ? args.acompanamiento.trim() : ''
    const eligible = accompaniment && accompaniment.length + accompaniedSongStyle.length <= maxSongStyleLength
    const style = eligible && transcript ? plumaSongStyle(accompaniment, transcript) : defaultSongStyle
    return { lyrics, style, ...(eligible && transcript === undefined ? { accompanimentQuote: accompaniment } : {}) }
  } catch {
    return undefined
  }
}

export function plumaMicrophoneMessage(audioWav: string): AudioUserMessage {
  if (!audioWav || audioWav.length > maxAudioBase64Length) throw new Error('La grabación está vacía o supera el límite de la llamada.')
  return {
    role: 'user',
    content: [
      { type: 'text', text: 'Intervención del micrófono de la llamada. Escucha lo que dice la persona y respóndele directamente.' },
      { type: 'input_audio', input_audio: { data: audioWav, format: 'wav' } },
    ],
  }
}

function noteArgument(call: ToolCall, field: 'dato' | 'tema'): string | undefined {
  try {
    const args = JSON.parse(call.function.arguments) as Record<string, unknown> | null
    const value = typeof args?.[field] === 'string' ? (args[field] as string).trim() : ''
    return value && value.length <= MAX_PLUMA_NOTE_LENGTH ? value : undefined
  } catch {
    return undefined
  }
}

const isMemoryCall = (call: ToolCall) =>
  call.function?.name === rememberToolName || call.function?.name === forgetToolName

export async function answerWithGemma({ sessionId, turnId, transcript, audioWav, previousMessages = [], canSing = false, signal, onTextDelta, memory = [], onMemory, actions }: VoiceTurn): Promise<PlumaVoiceAnswer> {
  signal?.throwIfAborted()
  let user: GemmaMessage
  if (transcript !== undefined) {
    if (!transcript.trim() || transcript.length > 4_000) throw new Error('La transcripción está vacía o supera el límite de la llamada.')
    user = { role: 'user', content: transcript }
  } else {
    user = plumaMicrophoneMessage(audioWav)
  }
  const history = previousMessages.slice(-4)
  const singingInstructions = canSing
    ? 'Llama a cantar_cancion solo si te piden oír canto. Por defecto canta en español a capela. Cita el acompañamiento solo si lo piden. Escribe la canción completa, con estrofas y estribillo. Si solo piden una letra, responde en texto. No afirmes que ya cantaste.'
    : 'Si piden oír una canción, explica que el canto no está disponible.'
  const memoryBlock = plumaMemoryPrompt(memory)
  const system = [instructions, singingInstructions, memoryBlock].filter(Boolean).join('\n')
  const messages: TurnMessage[] = [{ role: 'system', content: system }, ...history, user]
  const core = getServiceHub().core()
  const mayUseTools = transcript === undefined || !isSelfContainedGreeting(transcript)
  // Text already read aloud before a tool call; the final answer continues it.
  let spoken = ''

  for (let round = 0; round < 3; round++) {
    const tools = mayUseTools && round < 2
      ? [libraryTool, ...(canSing ? [songTool] : []), rememberTool, forgetTool, ...(actions?.tools ?? [])]
      : []
    let roundText = ''
    // Streaming every round lets Pluma start speaking the first sentence while
    // Gemma is still writing, also on turns where it could have called a tool.
    const completion = onTextDelta
      ? await streamAnswer(sessionId, turnId, [...messages], tools, delta => { roundText += delta; onTextDelta(delta) }, signal)
      : await core.invoke<Completion>('pluma_clone_chat', { sessionId, turnId, messages: [...messages], tools })
    signal?.throwIfAborted()

    const reply = completion?.choices?.[0]?.message
    if (reply?.role !== 'assistant') throw new Error('Gemma devolvió una respuesta que Pluma no pudo leer.')
    const calls = reply.tool_calls ?? []
    if (!calls.length) {
      const text = `${spoken}${reply.content ?? ''}`.trim()
      if (!text) throw new Error('Gemma no devolvió texto para leer en voz alta.')
      if (isPlumaAudioMisunderstanding(text)) throw new PlumaAudioNotUnderstoodError()
      const nextHistory: GemmaMessage[] = [...history, user, { role: 'assistant', content: text }]
      return { text, messages: nextHistory.slice(-4) }
    }
    spoken += roundText

    if (!tools.length || calls.length > 3 || calls.some(call => call.type !== 'function' || !call.id)) {
      throw new Error('Gemma devolvió una llamada de herramienta fuera del límite de este turno.')
    }
    messages.push(reply)
    for (const call of calls.filter(isMemoryCall)) {
      const remember = call.function.name === rememberToolName
      const value = noteArgument(call, remember ? 'dato' : 'tema')
      let result = 'No se guardó: el dato estaba vacío, era demasiado largo o era privado.'
      if (value) {
        try {
          const notes = remember ? await rememberForPluma(value) : await forgetForPluma(value)
          onMemory?.(notes)
          result = remember ? 'Guardado para próximas llamadas. Responde a la persona con normalidad.' : 'Olvidado. Confírmaselo en una frase.'
        } catch {
          result = 'No se pudo guardar ahora. Responde a la persona con normalidad.'
        }
      }
      signal?.throwIfAborted()
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
    for (const call of calls.filter(call => actions?.owns(call.function?.name))) {
      const result = await actions!.run(call, signal)
      signal?.throwIfAborted()
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
    const otherCalls = calls.filter(call => !isMemoryCall(call) && !actions?.owns(call.function?.name))
    if (canSing && otherCalls.length === 1 && otherCalls[0].function?.name === songToolName) {
      const song = requestedSong(otherCalls[0], transcript)
      if (song) return { text: '', messages: [...history, user].slice(-3), song }
    }
    for (const call of otherCalls) {
      if (call.function?.name === songToolName) {
        messages.push({
          role: 'tool', tool_call_id: call.id,
          content: canSing ? 'El canto no se generó. Envía una sola llamada con una letra válida después de resolver cualquier búsqueda.' : 'El canto no está disponible en esta llamada.',
        })
        continue
      }
      const query = libraryQuery(call)
      const result = query ? await literaryLibraryContext(query, { kind: 'clone', sessionId }) : undefined
      signal?.throwIfAborted()
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result ?? 'No se hizo la búsqueda. Si la petición se refiere a la biblioteca, pide al usuario que repita el título o los términos.',
      })
    }
  }

  throw new Error('Gemma no completó la consulta en el turno de voz.')
}
