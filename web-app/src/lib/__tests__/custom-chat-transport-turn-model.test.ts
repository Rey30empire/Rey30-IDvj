import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import type * as ProviderCaps from '@/lib/providerCaps'

// #9311: a tool-using turn keeps running when the user opens another thread,
// and opening it moves the global model selection to that thread's model. The
// turn's automatic follow-up must still go to the model and provider the turn
// started on, never to the open thread's (possibly remote) one.

const h = vi.hoisted(() => ({
  serviceHub: null as unknown,
  selection: {
    selectedProvider: 'llamacpp',
    selectedModel: { id: 'local-model', capabilities: [] as string[] },
  },
  createModelMock: vi.fn(async (modelId: string) => ({ modelId })),
  libraryContext: vi.fn(async (_query: string) => 'PASO_LITERARIO_DE_PRUEBA'),
  protectLiteraryThread: vi.fn(async (_threadId: string) => {}),
  sent: [] as Array<Record<string, unknown>>,
  threads: {} as Record<
    string,
    { assistants?: { id: string }[]; metadata?: { project?: { id: string }; literaryLibrary?: boolean } }
  >,
  currentAssistant: null as { id: string } | null,
}))

h.serviceHub = {
  mcp: () => ({ getTools: vi.fn(async () => []) }),
  rag: () => ({ getTools: async () => [] }),
}

const providers: Record<
  string,
  { provider: string; models: unknown[]; active: boolean }
> = {
  llamacpp: { provider: 'llamacpp', models: [], active: true },
  openai: { provider: 'openai', models: [], active: true },
}

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: { getState: () => ({ serviceHub: h.serviceHub }) },
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: {
    getState: () => ({
      getDisabledTools: () => [],
      getDefaultDisabledTools: () => [],
    }),
  },
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      ...h.selection,
      providers: Object.values(providers),
      getProviderByName: (name: string) => providers[name],
    }),
  },
}))
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: { getState: () => ({ currentAssistant: h.currentAssistant }) },
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: { getState: () => ({ threads: h.threads, protectLiteraryThread: h.protectLiteraryThread }) },
}))
vi.mock('@/lib/literaryLibrary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/literaryLibrary')>()),
  literaryLibraryContext: h.libraryContext,
}))
vi.mock('@/stores/useCharacterStore', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/stores/useCharacterStore')>()
  return {
    ...actual,
    useCharacterStore: actual.createCharacterStore({
      read: async () => null,
      write: async () => {},
    }),
  }
})
vi.mock('@/lib/masterOrchestrator', () => ({
  prepareMasterContext: async () => undefined,
}))
vi.mock('@/lib/agentTools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agentTools')>()),
  memoryDigestNow: () => '',
  refreshMemoryDigest: async () => '',
}))
vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: { getState: () => ({ enabled: false }) },
}))
vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: { getState: () => ({ settings: {} }) },
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () => new Proxy({}, { get: () => () => undefined }),
  },
}))
vi.mock('@rey30-idvj/tauri-plugin-llamacpp-api', () => ({
  getLoadedModels: vi.fn(async () => ['local-model']),
  unloadLlamaModel: vi.fn(),
}))
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => null }) },
}))
vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: vi.fn() },
}))
vi.mock('@/lib/mcp-router-model-filter', () => ({
  isRouterModelSelectable: () => false,
}))
vi.mock('@/lib/reasoningProviderOptions', () => ({
  buildReasoningProviderOptions: () => undefined,
}))
vi.mock('@/lib/providerCaps', async (importOriginal) => ({
  ...(await importOriginal<typeof ProviderCaps>()),
  isPredefinedRemoteProvider: () => false,
  getProviderApiType: () => 'openai',
}))
vi.mock('../model-factory', () => ({
  ModelFactory: { createModel: h.createModelMock },
}))
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    streamText: (options: Record<string, unknown>) => {
      h.sent.push(options)
      return {
        toUIMessageStream: () =>
          new ReadableStream({ start: (c) => c.close() }),
      }
    },
  }
})

import { CustomChatTransport } from '../custom-chat-transport'
import { CoworkChatTransport } from '../coworkTransport'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'
import { createDefaultCharacterData } from '@/lib/characters/profiles'

const user = (id: string, text: string): UIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage

// The assistant turn whose tool call has its result: what the SDK resubmits
// automatically as the turn's follow-up.
const toolTurn = (id: string): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      {
        type: 'tool-fetch',
        toolCallId: `${id}-call`,
        state: 'output-available',
        input: {},
        output: 'result',
      },
    ],
  }) as UIMessage

const send = (
  transport: CustomChatTransport,
  messages: UIMessage[],
  trigger: 'submit-message' | 'regenerate-message' = 'submit-message'
) =>
  transport.sendMessages({
    chatId: 'thread-a',
    messages,
    abortSignal: undefined,
    trigger,
    messageId: undefined,
  })

const openOtherThreadOnRemoteModel = () => {
  h.selection = {
    selectedProvider: 'openai',
    selectedModel: { id: 'remote-model', capabilities: [] },
  }
}

function submitVoiceMessage(characterId: string, threadId: string, messageId: string) {
  const state = useAvatarVoiceSession.getState()
  state.openFor(characterId, threadId)
  state.start()
  const { generation, claim, markSubmitted } = useAvatarVoiceSession.getState()
  expect(claim(generation, 'ready', 'listening')).toBe(true)
  expect(claim(generation, 'listening', 'waiting')).toBe(true)
  expect(markSubmitted(generation, threadId, messageId)).toBe(true)
}

describe('CustomChatTransport: turn model and character context', () => {
  beforeEach(() => {
    useAvatarVoiceSession.getState().close()
    h.createModelMock.mockClear()
    h.libraryContext.mockClear()
    h.protectLiteraryThread.mockClear()
    h.selection = {
      selectedProvider: 'llamacpp',
      selectedModel: { id: 'local-model', capabilities: [] },
    }
    h.sent.length = 0
    h.threads = {}
    h.currentAssistant = null
    providers.llamacpp.models = [{ id: 'local-model', capabilities: [] }]
    providers.openai.models = []
    const characters = createDefaultCharacterData()
    characters.profiles = characters.profiles.map((profile) => ({
      ...profile,
      modelBinding: { providerId: 'llamacpp', modelId: 'local-model' },
    }))
    useCharacterStore.setState({
      ...characters,
      loaded: true,
      saving: false,
      error: null,
    })
  })

  it.each([false, true])('consults the library through the same local route in chat and voice (%s)', async (voice) => {
    h.threads = { 'thread-a': { assistants: [{ id: 'character:literatura' }] } }
    if (voice) {
      const profile = useCharacterStore.getState().profiles.find((item) => item.id === 'literatura')!
      await useCharacterStore.getState().updateProfile({ ...profile, voice: { ...profile.voice, enabled: true } })
      submitVoiceMessage('literatura', 'thread-a', 'reading')
    }
    openOtherThreadOnRemoteModel()
    await send(new CustomChatTransport(undefined, 'thread-a'), [user('reading', 'Analiza una carta de amor')])
    expect(h.protectLiteraryThread).toHaveBeenCalledWith('thread-a')
    expect(h.libraryContext).toHaveBeenCalledWith('Analiza una carta de amor', { kind: 'chat', threadId: 'thread-a' })
    expect(h.createModelMock).toHaveBeenCalledExactlyOnceWith('local-model', providers.llamacpp, expect.anything(), true)
    expect(h.sent[0].system).toContain('PASO_LITERARIO_DE_PRUEBA')
    expect(h.sent[0].tools).toBeUndefined()
  })

  it.each([false, true])('blocks another assistant from an existing library conversation even with a local model (%s)', async remote => {
    h.threads = { 'thread-a': { assistants: [{ id: 'character:otra' }], metadata: { literaryLibrary: true } } }
    if (remote) openOtherThreadOnRemoteModel()
    await expect(send(new CustomChatTransport(undefined, 'thread-a'), [user('reading', 'Recuerda la carta')])).rejects.toThrow('reservada a Pluma')
    expect(h.createModelMock).not.toHaveBeenCalled()
    expect(h.libraryContext).not.toHaveBeenCalled()
    expect(h.sent).toHaveLength(0)
  })

  it('sends the follow-up to the model the turn started on', async () => {
    const transport = new CustomChatTransport(undefined, 'thread-a')
    await send(transport, [user('u1', 'look it up')])

    openOtherThreadOnRemoteModel()
    await send(transport, [user('u1', 'look it up'), toolTurn('a1')])

    expect(h.createModelMock).toHaveBeenLastCalledWith(
      'local-model',
      providers.llamacpp,
      expect.anything()
    )
    expect(transport.getTurnModelSelection()).toMatchObject({
      selectedProvider: 'llamacpp',
      selectedModel: { id: 'local-model' },
    })
  })

  it('starts a new turn on the current selection', async () => {
    const transport = new CustomChatTransport(undefined, 'thread-a')
    await send(transport, [user('u1', 'look it up')])

    openOtherThreadOnRemoteModel()
    await send(transport, [
      user('u1', 'look it up'),
      toolTurn('a1'),
      user('u2', 'next'),
    ])

    expect(h.createModelMock).toHaveBeenLastCalledWith(
      'remote-model',
      providers.openai,
      expect.anything()
    )
  })

  // Regenerating the reply that followed a tool step sends the same history as
  // the automatic follow-up did, but the user asked for a new reply: it runs on
  // the model selected now.
  it('regenerates a follow-up reply on the current selection', async () => {
    const transport = new CustomChatTransport(undefined, 'thread-a')
    await send(transport, [user('u1', 'look it up')])

    openOtherThreadOnRemoteModel()
    await send(
      transport,
      [user('u1', 'look it up'), toolTurn('a1')],
      'regenerate-message'
    )

    expect(h.createModelMock).toHaveBeenLastCalledWith(
      'remote-model',
      providers.openai,
      expect.anything()
    )
  })

  // Nothing to continue: a transport that never ran a turn has no model to keep.
  it('uses the current selection when no turn has run yet', async () => {
    const transport = new CustomChatTransport(undefined, 'thread-a')
    openOtherThreadOnRemoteModel()
    await send(transport, [user('u1', 'look it up'), toolTurn('a1')])

    expect(h.createModelMock).toHaveBeenLastCalledWith(
      'remote-model',
      providers.openai,
      expect.anything()
    )
  })

  it.each(['kairo', 'beto', 'tino', 'milo', 'roco', 'nara'])(
    'resolves the assigned %s profile from its thread and excludes a stale assistant system snapshot',
    async (id) => {
      h.threads = { 'thread-a': { assistants: [{ id: `character:${id}` }] } }
      const profile = useCharacterStore
        .getState()
        .profiles.find((item) => item.id === id)!
      const transport = new CustomChatTransport(
        'BASE_SYSTEM_OWNED_QA',
        'thread-a'
      )
      await send(transport, [
        user(
          'character-turn',
          'Explica un paso verificable. USER_QA_UNCHANGED'
        ),
      ])
      const sent = h.sent.at(-1)!
      expect(sent.system).not.toContain('BASE_SYSTEM_OWNED_QA')
      expect(sent.system).toContain(`Tu nombre en esta conversación es ${JSON.stringify(profile.name)}.`)
      expect(sent.system).toContain('CHAT ESCRITO')
      expect(sent.system).toContain(
        'No concede acceso a herramientas, archivos, red ni credenciales'
      )
      for (const other of useCharacterStore
        .getState()
        .profiles.filter((item) => item.id !== id)) {
        expect(sent.system).not.toContain(`Tu nombre en esta conversación es ${JSON.stringify(other.name)}.`)
      }
      expect(JSON.stringify(sent.messages)).toContain('USER_QA_UNCHANGED')
      expect(h.createModelMock).toHaveBeenLastCalledWith(
        'local-model',
        providers.llamacpp,
        expect.anything()
      )
    }
  )

  it('uses an explicit character model binding instead of the globally selected model', async () => {
    h.threads = { 'thread-a': { assistants: [{ id: 'character:tino' }] } }
    await useCharacterStore.getState().selectCharacter('tino')
    const profile = structuredClone(
      useCharacterStore.getState().profiles.find((item) => item.id === 'tino')!
    )
    profile.modelBinding = {
      providerId: 'openai',
      modelId: 'owned-bound-model',
    }
    await useCharacterStore.getState().updateProfile(profile)
    providers.openai.models = [{ id: 'owned-bound-model', capabilities: [] }]
    await send(new CustomChatTransport('BOUND_SYSTEM_QA', 'thread-a'), [
      user('bound-turn', 'Revisa el plan.'),
    ])
    expect(h.createModelMock).toHaveBeenLastCalledWith(
      'owned-bound-model',
      providers.openai,
      expect.anything()
    )
    expect(h.sent.at(-1)?.model).toEqual({ modelId: 'owned-bound-model' })
    expect(h.sent.at(-1)?.system).toContain(`Tu nombre en esta conversación es ${JSON.stringify(profile.name)}.`)
    expect(h.selection.selectedModel.id).toBe('local-model')
  })

  it.each([true, false])('resolves an automatic profile binding on an existing thread only when a suitable local model is available (%s)', async (hasLocalModel) => {
    h.threads = { 'thread-a': { assistants: [{ id: 'character:nara' }] } }
    const store = useCharacterStore.getState()
    const profile = store.profiles.find((item) => item.id === 'nara')!
    await store.updateProfile({ ...profile, modelBinding: null })
    openOtherThreadOnRemoteModel()
    providers.openai.models = [h.selection.selectedModel]
    providers.llamacpp.models = hasLocalModel
      ? [{ id: 'Qwen3.5-9B-Q4_K_M', capabilities: ['tools'] }]
      : [{ id: 'Jan-v3.5-4B-Q4_K_XL', capabilities: [] }]

    const request = send(new CustomChatTransport(undefined, 'thread-a'), [
      user('automatic-character-turn', 'Revisa el plan.'),
    ])

    if (hasLocalModel) {
      await request
      expect(h.createModelMock).toHaveBeenCalledExactlyOnceWith(
        'Qwen3.5-9B-Q4_K_M',
        providers.llamacpp,
        expect.anything()
      )
      expect(h.sent.at(-1)?.system).toContain('CHAT ESCRITO')
    } else {
      await expect(request).rejects.toThrow('El personaje no tiene un modelo asignado')
      expect(h.createModelMock).not.toHaveBeenCalled()
      expect(h.sent).toHaveLength(0)
    }
  })

  it('sends a user-created assistant through the Rey30 local model instead of a restored Jan model', async () => {
    h.threads = { 'thread-a': { assistants: [{ id: 'owned-assistant' }] } }
    const jan = { id: 'Jan-v3.5-4B-Q4_K_XL', capabilities: [] }
    const qwen = { id: 'Qwen3.5-9B-Q4_K_M', capabilities: ['tools'] }
    providers.llamacpp.models = [jan, qwen]
    h.selection.selectedModel = jan
    await send(new CustomChatTransport(undefined, 'thread-a'), [user('owned-turn', 'Revisa este código.')])
    expect(h.createModelMock).toHaveBeenCalledExactlyOnceWith(qwen.id, providers.llamacpp, expect.anything())
  })

  it('fails visibly before sending when a bound character model is no longer available', async () => {
    h.threads = { 'thread-a': { assistants: [{ id: 'character:tino' }] } }
    await useCharacterStore.getState().selectCharacter('tino')
    const profile = structuredClone(
      useCharacterStore.getState().profiles.find((item) => item.id === 'tino')!
    )
    profile.modelBinding = {
      providerId: 'missing-owned-provider',
      modelId: 'missing-owned-model',
    }
    await useCharacterStore.getState().updateProfile(profile)
    await expect(
      send(new CustomChatTransport(undefined, 'thread-a'), [
        user('missing-bound-turn', 'Hola'),
      ])
    ).rejects.toThrow('El modelo asignado al personaje ya no está disponible')
    expect(h.createModelMock).not.toHaveBeenCalled()
    expect(h.sent).toHaveLength(0)
  })

  it('sends serious-mode settings and only authorized memory for this character and project', async () => {
    await useCharacterStore.getState().selectCharacter('nara')
    const profile = structuredClone(
      useCharacterStore.getState().profiles.find((item) => item.id === 'nara')!
    )
    profile.settings = {
      ...profile.settings,
      mode: 'charla',
      humor: 3,
      flirtation: 3,
      profanity: 3,
    }
    profile.voice.enabled = true
    await useCharacterStore.getState().updateProfile(profile)
    await useCharacterStore.getState().setIndividualMemory('nara', {
      enabled: true,
      notes: 'INDIVIDUAL_NARA_OWNED_QA',
    })
    await useCharacterStore.getState().setIndividualMemory('kairo', {
      enabled: true,
      notes: 'OTHER_CHARACTER_OWNED_QA',
    })
    await useCharacterStore.getState().setSharedMemory('project-a', {
      enabled: true,
      notes: 'PROJECT_A_OWNED_QA',
    })
    await useCharacterStore.getState().setSharedMemory('project-b', {
      enabled: true,
      notes: 'PROJECT_B_OWNED_QA',
    })
    h.threads = {
      'thread-a': {
        assistants: [{ id: 'character:nara' }],
        metadata: { project: { id: 'project-a' } },
      },
    }
    const transport = new CustomChatTransport('MEMORY_SYSTEM_QA', 'thread-a')
    submitVoiceMessage('nara', 'thread-a', 'serious-turn')
    await send(transport, [
      user('serious-turn', 'Háblame en serio. Revisa mi plan.'),
    ])
    const first = h.sent.at(-1)?.system
    expect(first).toContain('Modo efectivo: serio. Intensidad de humor: 0/3')
    expect(first).toContain('Regla de lenguaje (0/3)')
    expect(first).toContain('Regla de coqueteo (0/3)')
    expect(first).toContain('INDIVIDUAL_NARA_OWNED_QA')
    expect(first).toContain('PROJECT_A_OWNED_QA')
    expect(first).not.toContain('PROJECT_B_OWNED_QA')
    expect(first).not.toContain('OTHER_CHARACTER_OWNED_QA')

    h.threads = {
      'thread-a': {
        assistants: [{ id: 'character:nara' }],
        metadata: { project: { id: 'project-b' } },
      },
    }
    await send(transport, [user('project-b-turn', 'Siguiente paso.')])
    expect(h.sent.at(-1)?.system).toContain('PROJECT_B_OWNED_QA')
    expect(h.sent.at(-1)?.system).not.toContain('PROJECT_A_OWNED_QA')
    await useCharacterStore.getState().setIndividualMemory('nara', {
      enabled: false,
      notes: 'INDIVIDUAL_NARA_OWNED_QA',
    })
    h.threads = { 'thread-a': { assistants: [{ id: 'character:nara' }] } }
    await send(transport, [user('no-project-turn', 'Continúa.')])
    expect(h.sent.at(-1)?.system).not.toMatch(
      /INDIVIDUAL_NARA_OWNED_QA|PROJECT_A_OWNED_QA|PROJECT_B_OWNED_QA|OTHER_CHARACTER_OWNED_QA/
    )
  })

  it.each(['nara', 'verso'])(
    'isolates the spoken style of %s to its own active voice turn and follow-ups',
    async (id) => {
      const store = useCharacterStore.getState()
      const profile = store.profiles.find((item) => item.id === id)!
      await store.updateProfile({ ...profile, voice: { ...profile.voice, enabled: true } })
      h.threads = { 'thread-a': { assistants: [{ id: `character:${id}` }] } }
      const transport = new CustomChatTransport(undefined, 'thread-a')
      const spoken = user('spoken-id', 'Revisa mis ideas.')
      await send(transport, [spoken])
      expect(h.sent.at(-1)?.system).toContain('CHAT ESCRITO')
      expect(h.sent.at(-1)?.system).not.toContain(profile.instructions)

      submitVoiceMessage(id, 'thread-b', spoken.id)
      await send(transport, [spoken])
      expect(h.sent.at(-1)?.system).toContain('CHAT ESCRITO')

      submitVoiceMessage(id, 'thread-a', spoken.id)
      await send(transport, [spoken, user('typed-id', 'Modo charla. Continúa.')])
      expect(h.sent.at(-1)?.system).toContain('CHAT ESCRITO')
      expect(h.sent.at(-1)?.system).not.toContain(profile.instructions)
      expect(useCharacterStore.getState().profiles.find((item) => item.id === id)?.settings.mode).toBe(profile.settings.mode)

      for (const messages of [[spoken], [spoken, toolTurn('tool-reply')]]) {
        await send(transport, messages)
        expect(h.sent.at(-1)?.system).toContain('CONVERSACIÓN POR VOZ')
        expect(h.sent.at(-1)?.system).toContain(profile.instructions)
      }

      const priorVoiceReply = { id: 'voice-reply', role: 'assistant', parts: [{ type: 'text', text: '¡Un giro inesperado y unas rimas!' }] } as UIMessage
      await send(transport, [spoken, priorVoiceReply, user('later-typed-id', 'Ahora por escrito.')])
      expect(h.sent.at(-1)?.system).toContain('Mantén un registro profesional, incluso al continuar conversaciones anteriores')
      expect(h.sent.at(-1)?.system).not.toContain(profile.instructions)

      useAvatarVoiceSession.getState().pause()
      await send(transport, [spoken], 'regenerate-message')
      expect(h.sent.at(-1)?.system).toContain('CHAT ESCRITO')
      expect(h.sent.at(-1)?.system).not.toContain(profile.instructions)
    }
  )

  it('keeps the actual Cowork transport free of chat character context, memory, mode changes and model bindings', async () => {
    h.currentAssistant = { id: 'character:nara' }
    await useCharacterStore.getState().selectCharacter('nara')
    const profile = structuredClone(
      useCharacterStore.getState().profiles.find((item) => item.id === 'nara')!
    )
    profile.settings.mode = 'charla'
    profile.modelBinding = {
      providerId: 'openai',
      modelId: 'owned-character-model',
    }
    await useCharacterStore.getState().updateProfile(profile)
    await useCharacterStore.getState().setIndividualMemory('nara', {
      enabled: true,
      notes: 'NO_COWORK_MEMORY_OWNED_QA',
    })
    providers.llamacpp.models = [{ id: 'local-model', capabilities: [] }]
    const transport = new CoworkChatTransport('owned-cowork-session', {
      model: { provider: 'llamacpp', id: 'local-model' },
      workspacePath: null,
      readOnlyFolder: null,
      planMode: false,
      webSearch: false,
      allowSubagents: false,
      subagentNames: [],
    })
    // This case isolates the context boundary; native tool assembly is outside its scope.
    vi.spyOn(transport, 'refreshTools').mockResolvedValue(undefined)
    await send(transport, [
      user('cowork-turn', 'Háblame en serio. Revisa el plan.'),
    ])
    expect(h.sent.at(-1)?.system).not.toContain(
      'PERSONA CONVERSACIONAL ORIGINAL'
    )
    expect(h.sent.at(-1)?.system).not.toContain('NO_COWORK_MEMORY_OWNED_QA')
    expect(h.createModelMock).toHaveBeenLastCalledWith(
      'local-model',
      providers.llamacpp,
      expect.anything()
    )
    expect(
      useCharacterStore.getState().profiles.find((item) => item.id === 'nara')
        ?.settings.mode
    ).toBe('charla')
  })

  it.each(['jan', 'model-only', undefined])(
    'never adds a global character to a thread assigned %s',
    async (id) => {
      h.currentAssistant = { id: 'character:nara' }
      await useCharacterStore.getState().selectCharacter('nara')
      h.threads = { 'thread-a': { assistants: id ? [{ id }] : [] } }
      await send(new CustomChatTransport('ORDINARY_SYSTEM_QA', 'thread-a'), [
        user('ordinary-turn', 'Háblame en serio.'),
      ])
      expect(h.sent.at(-1)?.system).toContain('ORDINARY_SYSTEM_QA')
      expect(h.sent.at(-1)?.system).not.toContain(
        'PERSONA CONVERSACIONAL ORIGINAL'
      )
      expect(
        useCharacterStore
          .getState()
          .profiles.find((profile) => profile.id === 'nara')?.settings.mode
      ).not.toBe('serio')
    }
  )

  it('does not inherit the global character while a known thread has not loaded', async () => {
    h.currentAssistant = { id: 'character:nara' }
    await send(
      new CustomChatTransport('PENDING_THREAD_SYSTEM_QA', 'thread-a'),
      [user('pending-thread', 'Hola')]
    )
    expect(h.sent.at(-1)?.system).not.toContain(
      'PERSONA CONVERSACIONAL ORIGINAL'
    )
  })
})
