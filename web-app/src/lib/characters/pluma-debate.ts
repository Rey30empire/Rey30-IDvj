import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PLUMA_EMOTIONS, type PlumaEmotion } from './pluma-voice-style'

/**
 * Pluma's document debate, in the spirit of NotebookLM's audio overviews: the
 * person shares a document and one to four agents talk it through, each with
 * a role, a personality, a tone and a voice of their gender. Pluma writes the
 * whole script as her chat answer (one line per turn, «Nombre: texto») and the
 * chat reads it aloud, records it and saves it.
 *
 * The agents are a list the person edits (fourteen to start with: Pluma, four
 * debate roles and the personalities of the assistants the app used to have);
 * up to four take part at once. With none chosen, Pluma debates with the
 * first man of the list.
 *
 * It starts with «/debate» in Pluma's chat, or for every message while the
 * debate mode is on.
 */
export type DebateGender = 'mujer' | 'hombre'
export type DebateVoice = { group: string; file: string }
/** `auto`: a free voice of the agent's gender; `pluma`: Pluma's own voice. */
export type DebateVoiceChoice = 'auto' | 'pluma' | DebateVoice
/** The face its hologram shows: Pluma's, Blaster's, Coder's, or a plain cloud. */
export type DebatePortrait = 'pluma' | 'blaster' | 'coder' | 'ninguna'
export type DebateAgent = {
  id: string
  name: string
  gender: DebateGender
  /** What the agent does in the debate. Empty: one is given by its place. */
  role: string
  /** How the agent talks. */
  personality: string
  tone: PlumaEmotion
  voice: DebateVoiceChoice
  portrait: DebatePortrait
  active: boolean
}
export type DebateLength = 'breve' | 'normal' | 'largo'
export type PlumaDebate = { enabled: boolean; length: DebateLength; agents: DebateAgent[] }
/** An agent ready to speak: unique name, and its role filled in when the person left it empty. */
export type ResolvedAgent = DebateAgent & { autoRole: boolean }
export type DebateLine = { agent: number; name: string; text: string }

export const MAX_DEBATE_AGENTS = 4
export const MAX_AGENT_LIST = 20

const agent = (id: string, name: string, gender: DebateGender, role: string, personality: string, extra: Partial<DebateAgent> = {}): DebateAgent =>
  ({ id, name, gender, role, personality, tone: 'normal', voice: 'auto', portrait: gender === 'hombre' ? 'blaster' : 'ninguna', active: false, ...extra })

/** The agents the app starts with. Pluma and the critic debate until the person picks others. */
export const DEFAULT_AGENTS: readonly DebateAgent[] = [
  agent('pluma', 'Pluma', 'mujer', 'presentadora que explica el documento con entusiasmo, ejemplos claros y citas concretas', 'lectora y editora literaria, cálida y precisa, que cuida los matices de la voz del autor', { voice: 'pluma', portrait: 'pluma', active: true }),
  agent('critico', 'Crítico', 'hombre', 'crítico que cuestiona los argumentos, señala puntos débiles y pide pruebas', 'exigente pero justo; va al grano y reconoce lo que está bien hecho', { active: true }),
  agent('analista', 'Analista', 'mujer', 'analista que desmonta la estructura del texto: ideas principales, datos, causas y consecuencias', 'metódica y clara; ordena las ideas y las resume en pocas palabras'),
  agent('abogado', 'Abogado del diablo', 'hombre', 'defiende la postura contraria a la del texto para poner a prueba sus ideas', 'provocador, ingenioso y tenaz, nunca grosero'),
  agent('moderadora', 'Moderadora', 'mujer', 'ordena la conversación, hace preguntas a los demás y resume las conclusiones', 'serena y cordial; da la palabra y evita que nadie se vaya del tema'),
  // The personalities of the assistants the app had besides Pluma and Coder.
  agent('blaster', 'Blaster', 'hombre', 'entusiasta que defiende las ideas más audaces del documento como si fueran hazañas', 'presumido, competitivo y leal; convierte cada reto en una hazaña y su ego es un recurso cómico'),
  agent('don-chispa', 'Don Chispa', 'hombre', 'el simpático: aligera el debate con humor y ejemplos de la vida diaria sin perder el hilo', 'bromista cálido, optimista y observador; su humor nace de comparaciones cotidianas'),
  agent('tremendo', 'Tremendo', 'hombre', 'replica rápido, juega con las palabras del texto y detecta los dobles sentidos', 'astuto y conversador; le encantan los juegos de palabras y los malentendidos breves que acaban en ayuda'),
  agent('brujula', 'Brújula', 'hombre', 'filósofo que pregunta por el sentido profundo del texto y lo relaciona con la vida', 'humilde, curioso y algo filosófico; da rodeos cómicos que terminan en claridad'),
  agent('coyote', 'Coyote', 'hombre', 'lector de la calle que dice sin rodeos qué se entiende, qué sobra y qué falta', 'compa urbano mexicano, irreverente, directo y resolutivo; habla claro pero sin insultar'),
  agent('luna', 'Luna', 'mujer', 'lectora ingeniosa que encuentra lo emocionante y lo provocador del texto', 'inteligente, segura y traviesa; responde con ingenio y picardía'),
  agent('escudo', 'Escudo', 'hombre', 'prudente que señala los riesgos, las consecuencias y lo que podría salir mal', 'habla con calma y criterio; explica qué podría ocurrir antes de opinar'),
  agent('lirico', 'Lírico', 'hombre', 'poeta que comenta el estilo, las imágenes y el ritmo del texto, y a veces responde con un verso propio', 'sensible y musical; cuida cada palabra y disfruta recitando'),
  agent('nexo', 'Nexo', 'hombre', 'práctico que traduce las ideas del texto a ejemplos concretos y aplicables', 'ingeniero práctico y ordenado; explica las decisiones paso a paso'),
]

/** Roles given when the person empties an agent's role, by its place among those taking part. */
export const AUTO_ROLES: readonly (readonly string[])[] = [
  ['narradora que presenta el documento, explica sus ideas principales con ejemplos y cierra con una conclusión'],
  ['presentadora que explica el documento con entusiasmo y ejemplos claros', 'crítico que cuestiona los argumentos, señala puntos débiles y pide pruebas'],
  ['presentadora que explica el documento con entusiasmo y ejemplos claros', 'crítico que cuestiona los argumentos, señala puntos débiles y pide pruebas', 'experta que aporta contexto, datos y relaciones con otras obras o ideas'],
  ['presentadora que explica el documento con entusiasmo y ejemplos claros', 'crítico que cuestiona los argumentos, señala puntos débiles y pide pruebas', 'experta que aporta contexto, datos y relaciones con otras obras o ideas', 'moderador que ordena la conversación, hace preguntas y resume las conclusiones'],
]

const LENGTHS: Record<DebateLength, { label: string; turns: string }> = {
  breve: { label: 'Breve', turns: 'entre 6 y 10' },
  normal: { label: 'Normal', turns: 'entre 12 y 18' },
  largo: { label: 'Largo', turns: 'entre 20 y 30' },
}
export const DEBATE_LENGTH_LABELS = Object.fromEntries(Object.entries(LENGTHS).map(([id, value]) => [id, value.label])) as Record<DebateLength, string>
export const DEBATE_PORTRAIT_LABELS: Record<DebatePortrait, string> = { pluma: 'Pluma', blaster: 'Blaster', coder: 'Coder', ninguna: 'Sin cara' }

export const DEFAULT_DEBATE: PlumaDebate = { enabled: false, length: 'normal', agents: DEFAULT_AGENTS.map(item => ({ ...item })) }

const text = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/[\p{Cc}]/gu, ' ').slice(0, limit) : ''
const isVoice = (value: unknown): value is DebateVoice =>
  !!value && typeof value === 'object' && typeof (value as DebateVoice).file === 'string' && typeof (value as DebateVoice).group === 'string'

function cleanVoice(value: unknown): DebateVoiceChoice {
  if (value === 'pluma' || value === 'auto') return value
  return isVoice(value) ? { group: text(value.group, 60), file: text(value.file, 255) } : 'auto'
}

function cleanAgent(stored: Partial<DebateAgent>, fallback: DebateAgent): DebateAgent {
  return {
    id: text(stored.id, 60) || fallback.id,
    name: stored.name === undefined ? fallback.name : text(stored.name, 40),
    gender: stored.gender === 'hombre' || stored.gender === 'mujer' ? stored.gender : fallback.gender,
    role: stored.role === undefined ? fallback.role : text(stored.role, 300),
    personality: stored.personality === undefined ? fallback.personality : text(stored.personality, 300),
    tone: stored.tone && stored.tone in PLUMA_EMOTIONS ? stored.tone : fallback.tone,
    voice: stored.voice === undefined ? fallback.voice : cleanVoice(stored.voice),
    portrait: stored.portrait && stored.portrait in DEBATE_PORTRAIT_LABELS ? stored.portrait : fallback.portrait,
    active: typeof stored.active === 'boolean' ? stored.active : fallback.active,
  }
}

export const newAgentId = () => `agente-${Math.random().toString(36).slice(2, 10)}`

/** Stored settings made safe: known tones and voices, unique ids, at most four taking part. */
export function cleanDebate(value: Partial<PlumaDebate> | undefined): PlumaDebate {
  const stored = Array.isArray(value?.agents) ? value.agents.slice(0, MAX_AGENT_LIST) : undefined
  const ids = new Set<string>()
  let active = 0
  const agents = (stored ?? DEFAULT_DEBATE.agents).map((item) => {
    const known = DEFAULT_AGENTS.find(base => base.id === (item as Partial<DebateAgent>)?.id)
    const clean = cleanAgent((item ?? {}) as Partial<DebateAgent>, known ?? agent(newAgentId(), 'Agente', 'mujer', '', ''))
    if (ids.has(clean.id)) clean.id = newAgentId()
    ids.add(clean.id)
    if (clean.active && ++active > MAX_DEBATE_AGENTS) clean.active = false
    return clean
  })
  return {
    enabled: value?.enabled === true,
    length: value?.length && value.length in LENGTHS ? value.length : 'normal',
    agents: agents.length ? agents : DEFAULT_DEBATE.agents.map(item => ({ ...item })),
  }
}

/** The first settings (four fixed participants, `count` of them taking part) as the agent list. */
type FirstDebate = { enabled?: boolean; count?: number; length?: DebateLength; agents?: { name?: string; role?: string; tone?: PlumaEmotion; voice?: DebateVoice | null }[] }
export function fromFirstDebate(first: FirstDebate): PlumaDebate {
  const agents = DEFAULT_AGENTS.map(item => ({ ...item, active: false }))
  const count = Math.min(MAX_DEBATE_AGENTS, Math.max(1, Math.round(Number(first.count)) || 2))
  for (const [index, old] of (first.agents ?? []).slice(0, count).entries()) {
    const name = text(old?.name, 40).trim()
    const voice: DebateVoiceChoice = isVoice(old?.voice) ? cleanVoice(old.voice) : index === 0 ? 'pluma' : 'auto'
    const match = agents.find(item => comparable(item.name) === comparable(name))
    // The old «Experta» and «Moderador» become the analyst and the moderator.
    const same = match ?? agents.find(item => (name === 'Experta' && item.id === 'analista') || (name === 'Moderador' && item.id === 'moderadora'))
    const changes = { active: true, tone: old?.tone && old.tone in PLUMA_EMOTIONS ? old.tone : 'normal' as PlumaEmotion, ...(old?.role?.trim() ? { role: text(old.role, 300) } : {}) }
    if (same) Object.assign(same, changes, isVoice(old?.voice) || index === 0 ? { voice } : {})
    else if (name) agents.push({ ...agent(newAgentId(), name, voice === 'pluma' ? 'mujer' : 'hombre', '', ''), ...changes, voice })
  }
  return cleanDebate({ enabled: first.enabled === true, length: first.length, agents })
}

/** Stored settings of an older version as today's; a save without a version is from the first settings too. */
export const migrateDebate = (stored: unknown, version: number | undefined): PlumaDebate =>
  !(Number(version) >= 1) ? fromFirstDebate((stored ?? {}) as FirstDebate) : cleanDebate(stored as Partial<PlumaDebate>)

type DebateState = PlumaDebate & {
  set: (next: Partial<Omit<PlumaDebate, 'agents'>>) => void
  setAgent: (id: string, next: Partial<DebateAgent>) => void
  /** Takes an agent in or out of the debate; false when four already take part. */
  toggleAgent: (id: string, active: boolean) => boolean
  addAgent: () => string | undefined
  removeAgent: (id: string) => void
  reset: () => void
}

export const usePlumaDebate = create<DebateState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_DEBATE,
      set: (next) => set((state) => cleanDebate({ ...state, ...next })),
      setAgent: (id, next) => set((state) => cleanDebate({ ...state, agents: state.agents.map((item) => item.id === id ? { ...item, ...next, id } : item) })),
      toggleAgent: (id, active) => {
        if (active && get().agents.filter(item => item.active && item.id !== id).length >= MAX_DEBATE_AGENTS) return false
        set((state) => cleanDebate({ ...state, agents: state.agents.map((item) => item.id === id ? { ...item, active } : item) }))
        return true
      },
      addAgent: () => {
        if (get().agents.length >= MAX_AGENT_LIST) return undefined
        const id = newAgentId()
        set((state) => cleanDebate({ ...state, agents: [...state.agents, agent(id, `Agente ${state.agents.length + 1}`, 'mujer', '', '')] }))
        return id
      },
      removeAgent: (id) => set((state) => cleanDebate({ ...state, agents: state.agents.filter((item) => item.id !== id) })),
      reset: () => set({ ...DEFAULT_DEBATE, agents: DEFAULT_DEBATE.agents.map(item => ({ ...item })) }),
    }),
    {
      name: 'rey30-pluma-debate',
      version: 1,
      partialize: ({ enabled, length, agents }) => ({ enabled, length, agents }),
      migrate: migrateDebate,
      merge: (stored, current) => ({ ...current, ...cleanDebate(stored as Partial<PlumaDebate>) }),
    }
  )
)

function comparable(value: string) {
  return value.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9ñ ]/g, '').trim()
}

/** Every agent of the list with a usable, unique name, in order. */
export function namedAgents(agents: readonly DebateAgent[]): DebateAgent[] {
  const used = new Set<string>()
  return agents.map((item, index) => {
    let name = item.name.replace(/[:*\n]/g, ' ').trim() || `Agente ${index + 1}`
    while (used.has(comparable(name))) name = `${name} ${index + 1}`
    used.add(comparable(name))
    return { ...item, name }
  })
}

/**
 * Who takes part: the agents switched on (at most four, in list order). With
 * none, Pluma (or the first woman) debates with the first man.
 */
export function debateAgents(debate: Pick<PlumaDebate, 'agents'>): ResolvedAgent[] {
  const named = namedAgents(debate.agents)
  let cast = named.filter(item => item.active).slice(0, MAX_DEBATE_AGENTS)
  if (!cast.length) {
    const woman = named.find(item => item.id === 'pluma') ?? named.find(item => item.gender === 'mujer')
    const man = named.find(item => item.gender === 'hombre' && item !== woman)
    cast = [woman, man].filter((item): item is DebateAgent => !!item)
    if (!cast.length) cast = named.slice(0, 2)
    if (!cast.length) cast = [{ ...DEFAULT_AGENTS[0] }, { ...DEFAULT_AGENTS[1] }]
  }
  return cast.map((item, index) => {
    const role = item.role.trim()
    return { ...item, role: role || AUTO_ROLES[cast.length - 1][index], autoRole: !role }
  })
}

const DEBATE_COMMAND = /^\s*\/debate(?=\s|$)/i

/** Whether this message to Pluma asks for a debate: «/debate…», or any message while the mode is on. */
export const isDebateTurn = (userText: string, enabled: boolean) => enabled || DEBATE_COMMAND.test(userText)

/** The message without its «/debate» command, for showing what was asked. */
export const withoutDebateCommand = (userText: string) => userText.replace(DEBATE_COMMAND, '').trim()

/** What choosing the command leaves in the box, ready for the text or the question. */
export const DEBATE_COMMAND_TEXT = '/debate '

/** Whether the box holds the start of «/debate» («/», «/de»…), so the command can be offered. */
export const offersDebateCommand = (prompt: string) =>
  prompt.startsWith('/') && prompt.length < '/debate'.length && '/debate'.startsWith(prompt.toLowerCase())

/** The «/debate» at the start of the box, to mark it as a command, or `null`. */
export const debateCommandPrefix = (prompt: string) => prompt.match(DEBATE_COMMAND)?.[0] ?? null

/** The instructions that turn Pluma's answer into the debate script. */
export function plumaDebateSystem(agents: ResolvedAgent[], length: DebateLength): string {
  const cast = agents.map(item => {
    const tone = PLUMA_EMOTIONS[item.tone]?.label.toLowerCase()
    const personality = item.personality.trim()
    return `- ${item.name} (${item.gender}): ${item.role}.${personality ? ` Personalidad: ${personality}.` : ''}${item.tone !== 'normal' && tone ? ` Tono: ${tone}.` : ''}`
  }).join('\n')
  const solo = agents.length === 1
  return [
    solo
      ? 'MODO DEBATE. La persona compartió un documento o un texto (puede venir adjunto o tras «/debate»). Escribe un comentario hablado en español sobre él, como un pódcast de una sola voz:'
      : `MODO DEBATE. La persona compartió un documento o un texto (puede venir adjunto o tras «/debate»). Escribe un debate hablado en español sobre él entre ${agents.length} participantes, como un pódcast:`,
    cast,
    `Formato obligatorio: cada intervención en una línea propia que empieza por el nombre exacto del participante, dos puntos y lo que dice (por ejemplo «${agents[0].name}: …»). Nada de Markdown, títulos, acotaciones ni narración fuera de las intervenciones.`,
    `Escribe ${LENGTHS[length].turns} intervenciones de una a cuatro frases.${solo ? '' : ' Que se respondan entre sí, con acuerdos y desacuerdos reales, y que cada uno hable con su personalidad y concuerde con su género.'} Basa todo en el documento: cita y comenta sus ideas concretas, sin inventar lo que no dice. Empieza presentando el documento y termina con una conclusión.`,
    'Si no hay documento ni texto, contesta en una sola línea, con el primer participante, pidiendo que adjunten uno con el botón «+».',
  ].join('\n')
}

/** The debate instructions for a chat turn: only Pluma (`literatura`) debates. */
export function debateSystemFor(characterId: string | undefined, userText: string, debate: PlumaDebate = usePlumaDebate.getState()): string | undefined {
  if (characterId !== 'literatura' || !isDebateTurn(userText, debate.enabled)) return undefined
  return plumaDebateSystem(debateAgents(debate), debate.length)
}

/**
 * The turns of a debate script, or `null` when the text is not one: lines that
 * start with an agent's name and a colon (bold names too), at least two of
 * them, with two different speakers unless only one takes part. A line
 * without a name continues the previous turn. `agent` indexes `agents`.
 */
export function parseDebate(text: string, agents: readonly Pick<DebateAgent, 'name'>[]): DebateLine[] | null {
  const names = agents.map(item => comparable(item.name))
  const lines: DebateLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const match = /^[*_\s-]*([^:*_]{1,40}?)[*_\s]*:[*_\s]*(.+)$/u.exec(line)
    const found = match ? names.indexOf(comparable(match[1])) : -1
    if (match && found >= 0) lines.push({ agent: found, name: agents[found].name, text: match[2].replace(/[*_]+/g, '').trim() })
    else if (lines.length) lines[lines.length - 1].text += ` ${line.replace(/[*_]+/g, '')}`
  }
  const speakers = new Set(lines.map(line => line.agent))
  if (lines.length < 2 || (agents.length > 1 && speakers.size < 2)) return null
  return lines.filter(line => line.text.trim())
}

/**
 * A finished script with its speakers: read against the agents taking part
 * now, and failing that against the whole list (the person may have changed
 * who takes part since). `cast` holds only those who speak, in order of first
 * turn, and each line's `agent` indexes it.
 */
export function debateScript(text: string, debate: Pick<PlumaDebate, 'agents'>): { cast: ResolvedAgent[]; lines: DebateLine[] } | null {
  const current = debateAgents(debate)
  const everyone = namedAgents(debate.agents).map(item => current.find(member => member.id === item.id) ?? { ...item, autoRole: false })
  for (const agents of [current, everyone]) {
    const lines = parseDebate(text, agents)
    if (!lines) continue
    const order = [...new Set(lines.map(line => line.agent))]
    const cast = order.map(index => agents[index])
    return { cast, lines: lines.map(line => ({ ...line, agent: order.indexOf(line.agent) })) }
  }
  return null
}

/** A voice an agent speaks with: Pluma's own sample, or a Lore file. */
export type AssignedVoice = 'pluma' | DebateVoice
/** A Lore voice to choose from: `group` is its folder (`mujer`, `hombre`, `Pluma`, `Beto`…). */
export type DebateLoreVoice = { group?: string; file: string }

/** Folders whose voices are of a known gender. An assistant's folder is one person; `mujer` and `hombre` hold many. */
const GROUP_GENDER: Record<string, DebateGender> = { mujer: 'mujer', hombre: 'hombre', pluma: 'mujer', beto: 'hombre' }
const isGenderFolder = (group: string) => group === 'mujer' || group === 'hombre'
const voiceKey = (voice: AssignedVoice) => voice === 'pluma' ? 'pluma' : `${voice.group}/${voice.file}`
/** Who speaks with a voice: Pluma's folder is Pluma, and each assistant's folder is one person. */
const personOf = (voice: AssignedVoice) => {
  if (voice === 'pluma') return 'pluma'
  const group = voice.group.toLowerCase()
  return isGenderFolder(group) || !group ? voiceKey(voice) : group
}

/**
 * The voice of each agent taking part. A chosen voice is kept; an automatic
 * one is a free voice of the agent's gender — Pluma's own first for a woman,
 * then the `mujer` or `hombre` folder, then an assistant's folder (Beto's for
 * a man) — never one already speaking while another is left. `shared` names
 * the agents left to share a voice because Lore has too few of their gender.
 */
export function assignDebateVoices(agents: readonly Pick<DebateAgent, 'name' | 'gender' | 'voice'>[], lore: readonly DebateLoreVoice[]): { voices: AssignedVoice[]; shared: string[] } {
  const taken = new Set<string>()
  const voices: (AssignedVoice | undefined)[] = agents.map(item => {
    if (item.voice === 'auto') return undefined
    const voice: AssignedVoice = item.voice
    taken.add(personOf(voice))
    return voice
  })
  const pool = (gender: DebateGender): AssignedVoice[] => {
    const files = lore.filter(voice => GROUP_GENDER[(voice.group ?? '').toLowerCase()] === gender)
    const folder = files.filter(voice => isGenderFolder((voice.group ?? '').toLowerCase())).map(voice => ({ group: voice.group ?? '', file: voice.file }))
    // One file per assistant folder: it is one person whatever the recording.
    const people = new Map<string, AssignedVoice>()
    for (const voice of files) {
      const group = (voice.group ?? '').toLowerCase()
      if (!isGenderFolder(group) && group !== 'pluma' && !people.has(group)) people.set(group, { group: voice.group ?? '', file: voice.file })
    }
    return gender === 'mujer' ? ['pluma', ...folder, ...people.values()] : [...folder, ...people.values()]
  }
  const shared: string[] = []
  const uses = new Map<string, number>()
  const use = (voice: AssignedVoice) => uses.set(personOf(voice), (uses.get(personOf(voice)) ?? 0) + 1)
  voices.forEach(voice => { if (voice) use(voice) })
  agents.forEach((item, index) => {
    if (voices[index]) return
    const options = pool(item.gender)
    const free = options.find(voice => !taken.has(personOf(voice)))
    // Too few voices of this gender: the least used one is shared.
    const voice = free ?? ([...options].sort((a, b) => (uses.get(personOf(a)) ?? 0) - (uses.get(personOf(b)) ?? 0))[0] ?? 'pluma')
    if (!free) shared.push(item.name)
    taken.add(personOf(voice))
    voices[index] = voice
    use(voice)
  })
  return { voices: voices as AssignedVoice[], shared }
}
