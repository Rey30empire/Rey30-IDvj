import { describe, expect, it } from 'vitest'
import { cleanDebate, DEFAULT_DEBATE, debateAgents, debateCommandPrefix, debateSystemFor, isDebateTurn, offersDebateCommand, parseDebate, plumaDebateSystem, withoutDebateCommand } from '../pluma-debate'

const debate = (over: Partial<typeof DEFAULT_DEBATE> = {}) => cleanDebate({ ...DEFAULT_DEBATE, ...over })

describe('debate de documentos de Pluma', () => {
  it('ofrece «/debate» mientras se escribe su comienzo, y lo marca cuando está escrito', () => {
    expect(['/', '/d', '/De', '/debat'].map(offersDebateCommand)).toEqual([true, true, true, true])
    expect(['', 'hola', '/debate', '/debate ', '/x', ' /d', '/d e'].map(offersDebateCommand)).toEqual([false, false, false, false, false, false, false])
    expect(debateCommandPrefix('/debate resume esto')).toBe('/debate')
    expect(debateCommandPrefix('/Debate')).toBe('/Debate')
    expect(debateCommandPrefix('/debates')).toBeNull()
    expect(debateCommandPrefix('hola /debate')).toBeNull()
  })

  it('sin papel descrito, cada participante recibe uno según cuántos son', () => {
    expect(debateAgents(debate({ count: 1 })).map(agent => agent.role)).toEqual(['narradora que presenta el documento, explica sus ideas principales con ejemplos y cierra con una conclusión'])
    const four = debateAgents(debate({ count: 4 }))
    expect(four.map(agent => agent.name)).toEqual(['Pluma', 'Crítico', 'Experta', 'Moderador'])
    expect(four[1].role).toMatch(/^crítico que cuestiona/)
    expect(four[3].role).toMatch(/^moderador/)
    expect(four.every(agent => agent.autoRole)).toBe(true)
  })

  it('respeta el papel y el nombre que escribes, y no repite nombres', () => {
    const agents = cleanDebate({ ...DEFAULT_DEBATE, agents: [{ name: 'Ana', role: 'abogada del diablo', tone: 'enojada', voice: { group: 'Beto', file: 'Veto 1.mpeg' } }, { name: 'ana', role: '', tone: 'normal', voice: null }] }).agents
    const resolved = debateAgents({ count: 2, agents })
    expect(resolved[0]).toMatchObject({ name: 'Ana', role: 'abogada del diablo', autoRole: false, tone: 'enojada', voice: { group: 'Beto', file: 'Veto 1.mpeg' } })
    expect(resolved[1].name).toBe('ana 2')
    expect(resolved[1].autoRole).toBe(true)
  })

  it('se activa con «/debate» o con el modo debate, y solo para Pluma', () => {
    expect(isDebateTurn('/debate resume esto', false)).toBe(true)
    expect(isDebateTurn('  /DEBATE', false)).toBe(true)
    expect(isDebateTurn('/debates', false)).toBe(false)
    expect(isDebateTurn('hola', false)).toBe(false)
    expect(isDebateTurn('hola', true)).toBe(true)
    expect(withoutDebateCommand('/debate sobre el capítulo 3')).toBe('sobre el capítulo 3')
    expect(debateSystemFor('literatura', '/debate', debate())).toMatch(/^MODO DEBATE/)
    expect(debateSystemFor('beto', '/debate', debate())).toBeUndefined()
    expect(debateSystemFor('literatura', 'hola', debate())).toBeUndefined()
    expect(debateSystemFor('literatura', 'hola', debate({ enabled: true }))).toMatch(/^MODO DEBATE/)
  })

  it('pide un guion con una línea por intervención, basado en el documento', () => {
    const system = plumaDebateSystem(debateAgents(debate({ count: 2, length: 'breve' })), 'breve')
    expect(system).toMatch(/entre 2 participantes/)
    expect(system).toMatch(/- Pluma: presentadora/)
    expect(system).toMatch(/- Crítico: crítico que cuestiona/)
    expect(system).toMatch(/«Pluma: …»/)
    expect(system).toMatch(/entre 6 y 10 intervenciones/)
    expect(system).toMatch(/sin inventar lo que no dice/)
    const solo = plumaDebateSystem(debateAgents(debate({ count: 1 })), 'normal')
    expect(solo).toMatch(/una sola voz/)
  })

  it('reconoce el guion, también con nombres en negrita y líneas que siguen', () => {
    const agents = debateAgents(debate({ count: 2 }))
    const lines = parseDebate('**Pluma:** Hoy leemos un cuento.\n\n**Crítico:** No me convence el final.\nSobre todo la última escena.\nPluma: ¿Por qué?', agents)
    expect(lines).toEqual([
      { agent: 0, name: 'Pluma', text: 'Hoy leemos un cuento.' },
      { agent: 1, name: 'Crítico', text: 'No me convence el final. Sobre todo la última escena.' },
      { agent: 0, name: 'Pluma', text: '¿Por qué?' },
    ])
    expect(parseDebate('Pluma: Hola.\nPluma: Sigo yo.', agents)).toBeNull()
    expect(parseDebate('Una respuesta normal: sin participantes.', agents)).toBeNull()
    expect(parseDebate('Pluma: Hola.\nPluma: Y sigo.', debateAgents(debate({ count: 1 })))).toHaveLength(2)
  })

  it('un ajuste guardado raro vuelve a valores seguros', () => {
    const clean = cleanDebate({ enabled: 'sí' as never, count: 9, length: 'eterno' as never, agents: [{ name: 'X'.repeat(90), role: 3 as never, tone: 'furiosa' as never, voice: { group: 1 as never, file: 'a.wav' } }] })
    expect(clean).toMatchObject({ enabled: false, count: 2, length: 'normal' })
    expect(clean.agents).toHaveLength(4)
    expect(clean.agents[0]).toEqual({ name: 'X'.repeat(40), role: '', tone: 'normal', voice: null })
  })
})
