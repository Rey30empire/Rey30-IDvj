import { beforeEach, describe, expect, it, vi } from 'vitest'
import { answerWithGemma, plumaSongStyle, songLyrics, type GemmaMessage } from '../pluma-gemma'

const fixtures = vi.hoisted(() => ({ invoke: vi.fn(), search: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ Channel: class { onmessage: (event: unknown) => void = () => {} } }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: fixtures.invoke }) }) }))
vi.mock('@/lib/literaryLibrary', () => ({ literaryLibraryContext: fixtures.search }))

const audioWav = 'UklGRg=='
const sessionId = 'pluma-fixture'
const audioPart = { type: 'input_audio', input_audio: { data: audioWav, format: 'wav' } }
const assistant = { role: 'assistant', content: '  La lluvia marca el ritmo.  ', reasoning_content: 'Reservado' }
const toolCall = { id: 'call-library', type: 'function', function: { name: 'buscar_biblioteca', arguments: '{"consulta":"poemas de lluvia"}' } }
const songCall = { id: 'call-song', type: 'function', function: { name: 'cantar_cancion', arguments: JSON.stringify({ letra: 'Cae la lluvia,\nla noche canta.', estilo: 'bolero suave' }) } }
const defaultSongStyle = 'A cappella female voice, no instruments, Spanish folk pop melody'
const complete = (message: object) => ({ choices: [{ message }] })
const toolNames = (tools: { function: { name: string } }[]) => tools.map(tool => tool.function.name)
// A streamed completion: emits the text as one delta, then closes the channel.
const streamed = (message: { content?: string | null }) => async (_command: string, args: { events?: { onmessage: (event: unknown) => void } }) => {
  if (message.content) args.events?.onmessage({ textDelta: message.content })
  args.events?.onmessage({ done: true })
  return complete(message)
}

describe('conversación local de Gemma para Pluma', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    fixtures.invoke.mockResolvedValue(complete(assistant))
  })

  it('entrega audio al motor nativo y devuelve solo texto para la voz', async () => {
    const { text, messages } = await answerWithGemma({ audioWav, sessionId, turnId: 1 })
    expect(text).toBe('La lluvia marca el ritmo.')
    expect(messages).toEqual([
      { role: 'user', content: [expect.objectContaining({ type: 'text', text: expect.stringContaining('micrófono de la llamada') }), audioPart] },
      { role: 'assistant', content: 'La lluvia marca el ritmo.' },
    ])
    expect(fixtures.invoke).toHaveBeenCalledWith('pluma_clone_chat', expect.objectContaining({ sessionId, turnId: 1 }))
    expect(toolNames(fixtures.invoke.mock.calls[0][1].tools)).toEqual(['buscar_biblioteca', 'recordar', 'olvidar'])
    expect(fixtures.search).not.toHaveBeenCalled()
  })

  it.each([
    'No has subido ningún archivo de audio. Por favor, adjúntalo.',
    'Lo siento, no veo ningún archivo de audio adjunto al mensaje.',
    'Parece que no se adjuntó ningún audio.',
    'Para responderte, sube un archivo de audio.',
    'No tengo acceso a un archivo de audio.',
    'No te entendí bien. ¿Puedes repetirlo?',
    'Lo siento, no te he entendido bien. ¿Podrías repetirlo, por favor?',
    'No te he oído. ¿Podrías repetir lo que dijiste?',
    'No he escuchado lo que dijiste.',
    "I can't hear any audio. Please upload an audio file.",
  ])('deriva una captura de micrófono mal interpretada al dictado local (%s)', async content => {
    fixtures.invoke.mockResolvedValueOnce(complete({ role: 'assistant', content }))

    await expect(answerWithGemma({ audioWav, sessionId })).rejects.toMatchObject({ name: 'PlumaAudioNotUnderstoodError' })
    expect(fixtures.search).not.toHaveBeenCalled()
  })

  it.each([
    'No hay archivos de audio en la carpeta de tu proyecto. El código solo genera texto.',
    'No veo problema en comprimir el audio.',
  ])('conserva las respuestas legítimas sobre archivos de audio (%s)', async text => {
    fixtures.invoke.mockResolvedValueOnce(complete({ role: 'assistant', content: text }))

    await expect(answerWithGemma({ audioWav, sessionId })).resolves.toMatchObject({ text })
  })

  it('descarta la misma confusión en la respuesta a un dictado local', async () => {
    fixtures.invoke.mockResolvedValueOnce(complete({ role: 'assistant', content: 'No veo el archivo de audio.' }))

    await expect(answerWithGemma({ transcript: 'Quiero hablar sobre la poesía.', sessionId })).rejects.toMatchObject({ name: 'PlumaAudioNotUnderstoodError' })
  })

  it('devuelve la referencia local a Gemma como resultado de su llamada', async () => {
    const toolReply = { role: 'assistant', content: null, tool_calls: [toolCall], reasoning_content: 'Reservado' }
    fixtures.invoke.mockResolvedValueOnce(complete(toolReply))
    fixtures.search.mockResolvedValue('Pasaje en poemas/lluvia.md')

    const result = await answerWithGemma({ audioWav, sessionId })

    expect(fixtures.search).toHaveBeenCalledWith('poemas de lluvia', { kind: 'clone', sessionId })
    const continuation = fixtures.invoke.mock.calls[1][1].messages
    expect(continuation.slice(-2)).toEqual([
      toolReply,
      { role: 'tool', tool_call_id: 'call-library', content: 'Pasaje en poemas/lluvia.md' },
    ])
    expect(result.messages).toHaveLength(2)
    expect(JSON.stringify(result.messages)).not.toContain('Reservado')
  })

  it('envía la transcripción literal sin convertir nombres, números ni rutas', async () => {
    const transcript = 'Revisa el capítulo 07 de «Pluma R30» en novelas/Final-02.md.'
    await answerWithGemma({ transcript, sessionId })
    const messages = fixtures.invoke.mock.lastCall?.[1].messages
    expect(messages.at(-1)).toEqual({ role: 'user', content: transcript })
    expect(messages[0].content).toContain('conserva nombres, cifras, rutas y citas')
    expect(messages[0].content).toContain('el canto no está disponible')
    // Short on purpose: Gemma reads it on every turn. The learning rule added a line.
    expect(messages[0].content.length).toBeLessThan(900)
  })

  it('devuelve una acción de canto, sin simular una respuesta hablada', async () => {
    fixtures.invoke.mockResolvedValueOnce(complete({ role: 'assistant', content: 'Ya canté.', tool_calls: [songCall] }))
    const result = await answerWithGemma({ audioWav, sessionId, canSing: true, turnId: 1 })
    expect(result).toEqual({
      text: '', messages: [expect.objectContaining({ role: 'user' })],
      song: { lyrics: '[Verse]\nCae la lluvia,\nla noche canta.', style: defaultSongStyle },
    })
    expect(toolNames(fixtures.invoke.mock.lastCall?.[1].tools)).toEqual(['buscar_biblioteca', 'cantar_cancion', 'recordar', 'olvidar'])
  })

  it('resuelve la búsqueda antes de aceptar un canto que depende de la biblioteca', async () => {
    fixtures.invoke.mockResolvedValueOnce(complete({ role: 'assistant', content: null, tool_calls: [songCall, toolCall] }))
      .mockResolvedValueOnce(complete({ role: 'assistant', content: null, tool_calls: [songCall] }))
    fixtures.search.mockResolvedValue('Pasaje de lluvia')
    await expect(answerWithGemma({ audioWav, sessionId, canSing: true })).resolves.toMatchObject({ song: { style: defaultSongStyle } })
    expect(fixtures.invoke.mock.calls[1][1].messages.slice(-2)).toEqual([
      { role: 'tool', tool_call_id: 'call-song', content: expect.stringContaining('El canto no se generó') },
      { role: 'tool', tool_call_id: 'call-library', content: 'Pasaje de lluvia' },
    ])
  })

  it('solo aplica acompañamiento cuando coincide con la petición literal', async () => {
    const songWithInstrument = { ...songCall, function: { ...songCall.function, arguments: JSON.stringify({ letra: 'Cae la lluvia', acompanamiento: 'con guitarra' }) } }
    fixtures.invoke.mockResolvedValue(complete({ role: 'assistant', content: null, tool_calls: [songWithInstrument] }))
    const audio = await answerWithGemma({ audioWav, sessionId, canSing: true })
    expect(audio.song).toMatchObject({ style: defaultSongStyle, accompanimentQuote: 'con guitarra' })
    const text = await answerWithGemma({ transcript: 'Canta una canción con guitarra.', sessionId, canSing: true })
    expect(text.song?.style).toContain('Clear Spanish solo singing with this accompaniment: con guitarra')
    expect(plumaSongStyle('con guitarra', 'Canta una canción sobre la lluvia.')).toBe(defaultSongStyle)
    expect(plumaSongStyle('con guitarra', 'Canta una canción, no con guitarra.')).toBe(defaultSongStyle)
  })

  it.each([false, true])('descarta un canto inválido o deshabilitado (disponible=%s)', async canSing => {
    const invalid = { ...songCall, function: { ...songCall.function, arguments: JSON.stringify({ letra: 'a'.repeat(2401), estilo: 'bolero' }) } }
    fixtures.invoke.mockResolvedValueOnce(complete({ role: 'assistant', content: null, tool_calls: [canSing ? invalid : songCall] }))
    const result = await answerWithGemma({ audioWav, sessionId, canSing })
    expect(result.song).toBeUndefined()
    expect(fixtures.invoke.mock.calls[0][1].tools).toHaveLength(canSing ? 4 : 3)
    expect(fixtures.invoke.mock.calls[1][1].messages.at(-1).content).toContain(canSing ? 'El canto no se generó' : 'El canto no está disponible')
  })

  it('transmite solo una respuesta que puede prescindir de herramientas', async () => {
    let events: { onmessage: (event: unknown) => void } | undefined
    fixtures.invoke.mockImplementation(async (_command, args) => {
      events = args.events
      return complete({ role: 'assistant', content: 'Hola, ¿qué tal?' })
    })
    const onTextDelta = vi.fn()
    const turn = answerWithGemma({ transcript: '¡Hola, Pluma!', sessionId, turnId: 2, onTextDelta })
    expect(fixtures.invoke).toHaveBeenCalledWith('pluma_clone_chat_stream', expect.objectContaining({ sessionId, turnId: 2, tools: [] }))
    events!.onmessage({ textDelta: 'Hola, ' })
    expect(onTextDelta).toHaveBeenCalledWith('Hola, ')
    events!.onmessage({ textDelta: '¿qué tal?' })
    events!.onmessage({ done: true })
    await expect(turn).resolves.toMatchObject({ text: 'Hola, ¿qué tal?' })
    expect(fixtures.search).not.toHaveBeenCalled()
  })

  it('transmite con herramientas para referencias implícitas y audio sin transcribir', async () => {
    fixtures.invoke.mockImplementation(streamed(assistant))
    const onTextDelta = vi.fn()
    await answerWithGemma({ transcript: 'Hola, ¿cómo terminaba la otra?', sessionId, onTextDelta })
    await answerWithGemma({ audioWav, sessionId, onTextDelta })
    expect(fixtures.invoke.mock.calls).toHaveLength(2)
    for (const [command, args] of fixtures.invoke.mock.calls) {
      expect(command).toBe('pluma_clone_chat_stream')
      expect(toolNames(args.tools)).toEqual(['buscar_biblioteca', 'recordar', 'olvidar'])
    }
    expect(onTextDelta).toHaveBeenCalledTimes(2)
  })

  it('transmite la respuesta final tras dos rondas de búsqueda', async () => {
    const toolReply = { role: 'assistant', content: null, tool_calls: [toolCall] }
    fixtures.search.mockResolvedValue('Pasaje en poemas/lluvia.md')
    fixtures.invoke.mockImplementationOnce(streamed(toolReply)).mockImplementationOnce(streamed(toolReply))
      .mockImplementationOnce(streamed({ ...assistant, content: 'La lluvia marca el ritmo.' }))
    const onTextDelta = vi.fn()
    await expect(answerWithGemma({ audioWav, sessionId, onTextDelta })).resolves.toMatchObject({ text: 'La lluvia marca el ritmo.' })
    expect(fixtures.invoke.mock.calls.map(([command]) => command)).toEqual(['pluma_clone_chat_stream', 'pluma_clone_chat_stream', 'pluma_clone_chat_stream'])
    expect(fixtures.invoke.mock.calls[2][1].tools).toEqual([])
    expect(onTextDelta).toHaveBeenCalledOnce()
  })

  it('aprende un dato duradero, lo confirma a Gemma y sigue respondiendo', async () => {
    const remember = { id: 'call-memory', type: 'function', function: { name: 'recordar', arguments: '{"dato":"Se llama Reinier"}' } }
    fixtures.invoke.mockImplementationOnce(streamed({ role: 'assistant', content: null, tool_calls: [remember] }))
      .mockImplementationOnce(streamed({ role: 'assistant', content: 'Encantada, Reinier.' }))
    fixtures.invoke.mockImplementation(async command => (command === 'settings_get' ? null : undefined))
    localStorage.clear()
    const onMemory = vi.fn()
    const result = await answerWithGemma({ audioWav, sessionId, onTextDelta: vi.fn(), onMemory })
    expect(result.text).toBe('Encantada, Reinier.')
    expect(onMemory).toHaveBeenCalledWith(['Se llama Reinier'])
    const second = fixtures.invoke.mock.calls.find(([command, args]) => command === 'pluma_clone_chat_stream' && args.messages.at(-1).role === 'tool')
    expect(second?.[1].messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call-memory', content: expect.stringContaining('Guardado') })
  })

  it('lleva lo aprendido al prompt del sistema y lo deja fuera si no hay nada', async () => {
    await answerWithGemma({ transcript: 'Hola, ¿qué libro empezamos?', sessionId, memory: ['Se llama Reinier', 'Prefiere respuestas cortas'] })
    const system = fixtures.invoke.mock.lastCall?.[1].messages[0].content
    expect(system).toContain('Lo que has aprendido de la persona')
    expect(system).toContain('- Se llama Reinier\n- Prefiere respuestas cortas')
    await answerWithGemma({ transcript: 'Hola, ¿qué libro empezamos?', sessionId })
    expect(fixtures.invoke.mock.lastCall?.[1].messages[0].content).not.toContain('Lo que has aprendido')
  })

  it('usa las herramientas de acción y devuelve su resultado a Gemma', async () => {
    const create = { id: 'call-doc', type: 'function', function: { name: 'crear_documento', arguments: '{"nombre":"ideas.md","texto":"# Ideas"}' } }
    const run = vi.fn(async () => 'Creado ideas.md')
    const actions = { tools: [{ type: 'function', function: { name: 'crear_documento' } }], owns: (name: string) => name === 'crear_documento', run }
    fixtures.invoke.mockResolvedValueOnce(complete({ role: 'assistant', content: null, tool_calls: [create] }))
      .mockResolvedValueOnce(complete({ role: 'assistant', content: 'Listo, creé ideas.md.' }))
    const result = await answerWithGemma({ audioWav, sessionId, actions })
    expect(result.text).toBe('Listo, creé ideas.md.')
    expect(run).toHaveBeenCalledWith(create, undefined)
    expect(toolNames(fixtures.invoke.mock.calls[0][1].tools)).toContain('crear_documento')
    expect(fixtures.invoke.mock.calls[1][1].messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call-doc', content: 'Creado ideas.md' })
  })

  it('conserva el texto ya leído antes de una herramienta como inicio de la respuesta', async () => {
    fixtures.search.mockResolvedValue('Pasaje de lluvia')
    fixtures.invoke.mockImplementationOnce(streamed({ role: 'assistant', content: 'Déjame mirarlo. ', tool_calls: [toolCall] }))
      .mockImplementationOnce(streamed({ role: 'assistant', content: 'Está en el capítulo dos.' }))
    const result = await answerWithGemma({ audioWav, sessionId, onTextDelta: vi.fn() })
    expect(result.text).toBe('Déjame mirarlo. Está en el capítulo dos.')
  })

  it.each([{ name: 'ejecutar_comando', arguments: '{}' }, { name: 'buscar_biblioteca', arguments: '{"consulta":5}' }])('omite llamadas no autorizadas o malformadas', async func => {
    fixtures.invoke.mockResolvedValueOnce(complete({ role: 'assistant', content: null, tool_calls: [{ ...toolCall, function: func }] }))
    await answerWithGemma({ audioWav, sessionId })
    expect(fixtures.search).not.toHaveBeenCalled()
    expect(fixtures.invoke.mock.calls[1][1].messages.at(-1).content).toContain('No se hizo la búsqueda')
  })

  it('mantiene en memoria solamente los dos turnos más recientes', async () => {
    const { messages: turn1 } = await answerWithGemma({ audioWav, sessionId })
    const { messages: turn2 } = await answerWithGemma({ audioWav, sessionId, previousMessages: turn1 })
    const { messages: turn3 } = await answerWithGemma({ audioWav, sessionId, previousMessages: turn2 })
    expect(turn2).toHaveLength(4)
    expect(turn3).toHaveLength(4)
    const previousMessages: GemmaMessage[] = [...turn1, ...turn2]
    await answerWithGemma({ audioWav, sessionId, previousMessages })
    expect(fixtures.invoke.mock.lastCall?.[1].messages).toHaveLength(6)
  })

  it('ignora llamadas de herramienta llegadas tras el cierre', async () => {
    const controller = new AbortController()
    fixtures.invoke.mockImplementationOnce(async () => {
      controller.abort()
      return complete({ role: 'assistant', content: null, tool_calls: [toolCall] })
    })
    await expect(answerWithGemma({ audioWav, sessionId, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixtures.search).not.toHaveBeenCalled()
  })
})

describe('letra de canciones completas', () => {
  it('conserva estrofas y estribillo y traduce las secciones en español', () => {
    const letra = '[Estrofa 1]\nEl mar se duerme\n\n[Estribillo]\nQuédate aquí\n\n[Puente]\nY la luz\n\n[Nota del autor]\n[Coro]\nQuédate aquí'
    expect(songLyrics(letra)).toBe('[Verse]\nEl mar se duerme\n\n[Chorus]\nQuédate aquí\n\n[Bridge]\nY la luz\n\n[Chorus]\nQuédate aquí')
  })

  it('empieza con una estrofa cuando la letra no trae secciones y rechaza una letra vacía', () => {
    expect(songLyrics('Cae la lluvia\nla noche canta')).toBe('[Verse]\nCae la lluvia\nla noche canta')
    expect(songLyrics('[Verse]\n[Chorus]\n')).toBe('')
  })

  it('pide a Gemma una canción entera y no solo unos versos', async () => {
    fixtures.invoke.mockResolvedValue(complete(assistant))
    await answerWithGemma({ audioWav, sessionId, canSing: true })
    const tools = fixtures.invoke.mock.calls[0][1].tools as { function: { name: string; parameters: { properties: { letra?: { description: string } } } } }[]
    const song = tools.find(tool => tool.function.name === 'cantar_cancion')
    expect(song?.function.parameters.properties.letra?.description).toContain('[Bridge]')
    expect(fixtures.invoke.mock.calls[0][1].messages[0].content).toContain('canción completa')
  })
})
