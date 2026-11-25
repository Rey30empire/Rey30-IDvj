import { beforeEach, describe, expect, it } from 'vitest'
import {
  assignDebateVoices, cleanDebate, DEFAULT_AGENTS, DEFAULT_DEBATE, debateAgents, debateCommandPrefix, debateScript, debateSystemFor, fromFirstDebate,
  isDebateTurn, MAX_DEBATE_AGENTS, migrateDebate, offersDebateCommand, parseDebate, plumaDebateSystem, usePlumaDebate, withoutDebateCommand, type DebateAgent,
} from '../pluma-debate'

const debate = (over: Partial<typeof DEFAULT_DEBATE> = {}) => cleanDebate({ ...DEFAULT_DEBATE, ...over })
const only = (...ids: string[]) => DEFAULT_AGENTS.map(agent => ({ ...agent, active: ids.includes(agent.id) }))

const lore = [
  { group: 'Pluma', file: 'Pluma v1.wav' },
  { group: 'Pluma', file: 'Pluma v4.mpeg' },
  { group: 'Beto', file: 'Veto 1.mpeg' },
  { group: 'Beto', file: 'Veto R1.ogg' },
]

describe('debate de documentos de Pluma', () => {
  beforeEach(() => usePlumaDebate.getState().reset())

  it('empieza con catorce agentes: Pluma, cuatro papeles de debate y las personalidades de los antiguos asistentes', () => {
    expect(DEFAULT_AGENTS.map(agent => agent.name)).toEqual(['Pluma', 'Crítico', 'Analista', 'Abogado del diablo', 'Moderadora', 'Blaster', 'Don Chispa', 'Tremendo', 'Brújula', 'Coyote', 'Luna', 'Escudo', 'Lírico', 'Nexo'])
    expect(DEFAULT_AGENTS.every(agent => agent.role && agent.personality)).toBe(true)
    // By default a woman (Pluma, with her own voice) and a man debate.
    expect(debateAgents(debate()).map(agent => [agent.name, agent.gender, agent.voice])).toEqual([['Pluma', 'mujer', 'pluma'], ['Crítico', 'hombre', 'auto']])
  })

  it('sin ninguno activo debaten Pluma y el primer hombre; nunca más de cuatro', () => {
    expect(debateAgents({ agents: only() }).map(agent => agent.name)).toEqual(['Pluma', 'Crítico'])
    expect(debateAgents({ agents: only('luna', 'coyote', 'lirico') }).map(agent => agent.name)).toEqual(['Coyote', 'Luna', 'Lírico'])
    const store = usePlumaDebate.getState()
    expect(store.toggleAgent('analista', true)).toBe(true)
    expect(store.toggleAgent('moderadora', true)).toBe(true)
    expect(usePlumaDebate.getState().toggleAgent('luna', true)).toBe(false)
    expect(usePlumaDebate.getState().agents.filter(agent => agent.active)).toHaveLength(MAX_DEBATE_AGENTS)
  })

  it('respeta lo que escribes, completa el papel vacío y no repite nombres', () => {
    const agents = only('pluma', 'critico')
    agents[1] = { ...agents[1], name: 'pluma', role: '' }
    const cast = debateAgents({ agents })
    expect(cast[1]).toMatchObject({ name: 'pluma 2', autoRole: true })
    expect(cast[1].role).toMatch(/^crítico que cuestiona/)
  })

  it('se añaden, editan y quitan agentes, y todo vuelve a lo predeterminado', () => {
    const id = usePlumaDebate.getState().addAgent()!
    usePlumaDebate.getState().setAgent(id, { name: 'Abuela', gender: 'mujer', role: 'cuenta cómo lo vivió', tone: 'suave' })
    expect(usePlumaDebate.getState().agents.at(-1)).toMatchObject({ id, name: 'Abuela', gender: 'mujer', role: 'cuenta cómo lo vivió', tone: 'suave', voice: 'auto', active: false })
    usePlumaDebate.getState().removeAgent(id)
    expect(usePlumaDebate.getState().agents).toHaveLength(DEFAULT_AGENTS.length)
    usePlumaDebate.getState().set({ enabled: true, length: 'largo' })
    usePlumaDebate.getState().reset()
    expect(usePlumaDebate.getState()).toMatchObject({ enabled: false, length: 'normal' })
  })

  it('cada agente recibe una voz de su género sin repetir mientras queden', () => {
    const cast = debateAgents({ agents: only('pluma', 'critico') })
    expect(assignDebateVoices(cast, lore)).toEqual({ voices: ['pluma', { group: 'Beto', file: 'Veto 1.mpeg' }], shared: [] })
    // A voice in the «hombre» folder comes before an assistant's own.
    expect(assignDebateVoices(cast, [...lore, { group: 'hombre', file: 'Locutor.wav' }]).voices[1]).toEqual({ group: 'hombre', file: 'Locutor.wav' })
    // Beto's two recordings are one man: a second man has no voice of his own left.
    const men = debateAgents({ agents: only('critico', 'blaster') })
    expect(assignDebateVoices(men, lore)).toEqual({ voices: [{ group: 'Beto', file: 'Veto 1.mpeg' }, { group: 'Beto', file: 'Veto 1.mpeg' }], shared: ['Blaster'] })
    // Two women: Pluma's voice, then one from the «mujer» folder.
    const women = debateAgents({ agents: only('pluma', 'luna') })
    expect(assignDebateVoices(women, [...lore, { group: 'mujer', file: 'Ana.wav' }]).voices).toEqual(['pluma', { group: 'mujer', file: 'Ana.wav' }])
    // A chosen voice is kept, and an automatic one avoids it.
    const chosen = debateAgents({ agents: only('pluma', 'critico').map(agent => agent.id === 'pluma' ? { ...agent, voice: { group: 'Beto', file: 'Veto R1.ogg' } } : agent) })
    expect(assignDebateVoices(chosen, [...lore, { group: 'hombre', file: 'Locutor.wav' }]).voices).toEqual([{ group: 'Beto', file: 'Veto R1.ogg' }, { group: 'hombre', file: 'Locutor.wav' }])
  })

  it('se activa con «/debate» o con el modo debate, y solo para Pluma', () => {
    expect(isDebateTurn('/debate resume esto', false)).toBe(true)
    expect(isDebateTurn('  /DEBATE', false)).toBe(true)
    expect(isDebateTurn('/debates', false)).toBe(false)
    expect(isDebateTurn('hola', true)).toBe(true)
    expect(withoutDebateCommand('/debate sobre el capítulo 3')).toBe('sobre el capítulo 3')
    expect(debateSystemFor('literatura', '/debate', debate())).toMatch(/^MODO DEBATE/)
    expect(debateSystemFor('coder', '/debate', debate())).toBeUndefined()
    expect(debateSystemFor('literatura', 'hola', debate())).toBeUndefined()
    expect(debateSystemFor('literatura', 'hola', debate({ enabled: true }))).toMatch(/^MODO DEBATE/)
  })

  it('ofrece «/debate» mientras se escribe su comienzo, y lo marca cuando está escrito', () => {
    expect(['/', '/d', '/De', '/debat'].map(offersDebateCommand)).toEqual([true, true, true, true])
    expect(['', 'hola', '/debate', '/debate ', '/x', ' /d', '/d e'].map(offersDebateCommand)).toEqual([false, false, false, false, false, false, false])
    expect(debateCommandPrefix('/debate resume esto')).toBe('/debate')
    expect(debateCommandPrefix('/debates')).toBeNull()
  })

  it('pide un guion con una línea por intervención, con el género y la personalidad de cada uno', () => {
    const system = plumaDebateSystem(debateAgents(debate()), 'breve')
    expect(system).toMatch(/entre 2 participantes/)
    expect(system).toMatch(/- Pluma \(mujer\): presentadora .*Personalidad: lectora y editora literaria/)
    expect(system).toMatch(/- Crítico \(hombre\): crítico que cuestiona/)
    expect(system).toMatch(/«Pluma: …»/)
    expect(system).toMatch(/entre 6 y 10 intervenciones/)
    expect(system).toMatch(/sin inventar lo que no dice/)
    expect(system).toMatch(/botón «\+»/)
    const solo = plumaDebateSystem(debateAgents({ agents: only('luna') }), 'normal')
    expect(solo).toMatch(/una sola voz/)
  })

  it('reconoce el guion, también con nombres en negrita y líneas que siguen', () => {
    const agents = debateAgents(debate())
    const lines = parseDebate('**Pluma:** Hoy leemos un cuento.\n\n**Crítico:** No me convence el final.\nSobre todo la última escena.\nPluma: ¿Por qué?', agents)
    expect(lines).toEqual([
      { agent: 0, name: 'Pluma', text: 'Hoy leemos un cuento.' },
      { agent: 1, name: 'Crítico', text: 'No me convence el final. Sobre todo la última escena.' },
      { agent: 0, name: 'Pluma', text: '¿Por qué?' },
    ])
    expect(parseDebate('Pluma: Hola.\nPluma: Sigo yo.', agents)).toBeNull()
    expect(parseDebate('Una respuesta normal: sin participantes.', agents)).toBeNull()
  })

  it('un guion de antes se reconoce aunque hoy debatan otros', () => {
    const now = { agents: only('analista', 'coyote') }
    const script = debateScript('Luna: Me encantó.\nBlaster: ¡Una hazaña!\nLuna: Exacto.', now)
    expect(script?.cast.map(agent => agent.name)).toEqual(['Luna', 'Blaster'])
    expect(script?.lines.map(line => line.agent)).toEqual([0, 1, 0])
    expect(debateScript('Analista: Tres ideas.\nCoyote: Sobra la mitad.', now)?.cast.map(agent => agent.gender)).toEqual(['mujer', 'hombre'])
  })

  it('los ajustes de la primera versión pasan a la lista de agentes', () => {
    const migrated = fromFirstDebate({ enabled: true, count: 3, length: 'breve', agents: [
      { name: 'Pluma', role: '', tone: 'alegre', voice: null },
      { name: 'Crítico', role: '', tone: 'enojada', voice: { group: 'Beto', file: 'Veto 1.mpeg' } },
      { name: 'Darío', role: 'abogado', tone: 'normal', voice: null },
      { name: 'Moderador', role: '', tone: 'normal', voice: null },
    ] })
    expect(migrated).toMatchObject({ enabled: true, length: 'breve' })
    const active = migrated.agents.filter(agent => agent.active)
    expect(active.map(agent => [agent.name, agent.tone, agent.voice])).toEqual([
      ['Pluma', 'alegre', 'pluma'],
      ['Crítico', 'enojada', { group: 'Beto', file: 'Veto 1.mpeg' }],
      ['Darío', 'normal', 'auto'],
    ])
    expect(active[2]).toMatchObject({ role: 'abogado', gender: 'hombre' })
    // Saved before versions (none) or as version 0, the first settings are moved; version 1 is only cleaned.
    const first = { count: 2, agents: [{ name: 'Pluma', role: '', tone: 'normal', voice: null }, { name: 'Moderador', role: '', tone: 'normal', voice: null }] }
    for (const version of [undefined, 0]) expect(migrateDebate(first, version).agents.filter(agent => agent.active).map(agent => agent.name)).toEqual(['Pluma', 'Moderadora'])
    expect(migrateDebate({ agents: only('luna') }, 1).agents.filter(agent => agent.active).map(agent => agent.name)).toEqual(['Luna'])
  })

  it('un ajuste guardado raro vuelve a valores seguros', () => {
    const odd = { id: 'pluma', name: 'X'.repeat(90), gender: 'otro', role: 3, tone: 'furiosa', voice: { group: 1, file: 'a.wav' }, portrait: 'gato', active: 'sí' } as unknown as DebateAgent
    const clean = cleanDebate({ enabled: 'sí' as never, length: 'eterno' as never, agents: [odd, { ...odd }, ...DEFAULT_AGENTS.map(agent => ({ ...agent, active: true }))] })
    expect(clean).toMatchObject({ enabled: false, length: 'normal' })
    expect(clean.agents[0]).toMatchObject({ id: 'pluma', name: 'X'.repeat(40), gender: 'mujer', role: '', tone: 'normal', voice: 'auto', portrait: 'pluma', active: true })
    // The repeated id gets a new one.
    expect(clean.agents[1].id).not.toBe('pluma')
    expect(clean.agents.filter(agent => agent.active)).toHaveLength(MAX_DEBATE_AGENTS)
    expect(cleanDebate({ agents: [] }).agents).toHaveLength(DEFAULT_AGENTS.length)
  })
})
