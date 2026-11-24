import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PLUMA_EMOTIONS, type PlumaEmotion } from './pluma-voice-style'

/**
 * Pluma's document debate, in the spirit of NotebookLM's audio overviews: the
 * person shares a document and one to four participants talk it through, each
 * with a role, a tone and a voice. Pluma writes the whole script as her chat
 * answer (one line per turn, «Nombre: texto») and the chat can read it aloud.
 *
 * It starts with «/debate» in Pluma's chat, or for every message while the
 * debate mode is on.
 */
export type DebateVoice = { group: string; file: string }
export type DebateAgent = { name: string; role: string; tone: PlumaEmotion; voice: DebateVoice | null }
export type DebateLength = 'breve' | 'normal' | 'largo'
export type PlumaDebate = { enabled: boolean; count: number; length: DebateLength; agents: DebateAgent[] }
/** A participant ready to speak: its role filled in when the person left it empty. */
export type ResolvedAgent = DebateAgent & { autoRole: boolean }
export type DebateLine = { agent: number; name: string; text: string }

export const MAX_DEBATE_AGENTS = 4
const DEFAULT_NAMES = ['Pluma', 'Crítico', 'Experta', 'Moderador']

/** Roles given when the person does not describe one, by how many take part. */
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

const blankAgent = (index: number): DebateAgent => ({ name: DEFAULT_NAMES[index], role: '', tone: 'normal', voice: null })
export const DEFAULT_DEBATE: PlumaDebate = { enabled: false, count: 2, length: 'normal', agents: Array.from({ length: MAX_DEBATE_AGENTS }, (_, index) => blankAgent(index)) }

const text = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/[\p{Cc}]/gu, ' ').slice(0, limit) : ''

/** Stored settings made safe: four participants, known tones, sensible counts. */
export function cleanDebate(value: Partial<PlumaDebate> | undefined): PlumaDebate {
  const count = Math.round(Number(value?.count))
  const agents = Array.from({ length: MAX_DEBATE_AGENTS }, (_, index) => {
    const stored = value?.agents?.[index] as Partial<DebateAgent> | undefined
    const voice = stored?.voice && typeof stored.voice.file === 'string' && typeof stored.voice.group === 'string'
      ? { group: text(stored.voice.group, 60), file: text(stored.voice.file, 255) }
      : null
    return {
      name: stored?.name === undefined ? DEFAULT_NAMES[index] : text(stored.name, 40),
      role: text(stored?.role, 300),
      tone: stored?.tone && stored.tone in PLUMA_EMOTIONS ? stored.tone : 'normal',
      voice,
    }
  })
  return {
    enabled: value?.enabled === true,
    count: count >= 1 && count <= MAX_DEBATE_AGENTS ? count : 2,
    length: value?.length && value.length in LENGTHS ? value.length : 'normal',
    agents,
  }
}

type DebateState = PlumaDebate & {
  set: (next: Partial<Omit<PlumaDebate, 'agents'>>) => void
  setAgent: (index: number, next: Partial<DebateAgent>) => void
  reset: () => void
}

export const usePlumaDebate = create<DebateState>()(
  persist(
    (set) => ({
      ...DEFAULT_DEBATE,
      set: (next) => set((state) => cleanDebate({ ...state, ...next })),
      setAgent: (index, next) => set((state) => cleanDebate({ ...state, agents: state.agents.map((agent, at) => at === index ? { ...agent, ...next } : agent) })),
      reset: () => set(DEFAULT_DEBATE),
    }),
    {
      name: 'rey30-pluma-debate',
      partialize: ({ enabled, count, length, agents }) => ({ enabled, count, length, agents }),
      merge: (stored, current) => ({ ...current, ...cleanDebate(stored as Partial<PlumaDebate>) }),
    }
  )
)

/** The participants who take part, with a name and a role each (unique names). */
export function debateAgents(debate: Pick<PlumaDebate, 'count' | 'agents'>): ResolvedAgent[] {
  const count = Math.min(MAX_DEBATE_AGENTS, Math.max(1, debate.count))
  const used = new Set<string>()
  return debate.agents.slice(0, count).map((agent, index) => {
    let name = agent.name.replace(/[:*\n]/g, ' ').trim() || DEFAULT_NAMES[index]
    while (used.has(comparable(name))) name = `${name} ${index + 1}`
    used.add(comparable(name))
    const role = agent.role.trim()
    return { ...agent, name, role: role || AUTO_ROLES[count - 1][index], autoRole: !role }
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
  const cast = agents.map(agent => {
    const tone = PLUMA_EMOTIONS[agent.tone]?.label.toLowerCase()
    return `- ${agent.name}: ${agent.role}.${agent.tone !== 'normal' && tone ? ` Tono: ${tone}.` : ''}`
  }).join('\n')
  const solo = agents.length === 1
  return [
    solo
      ? 'MODO DEBATE. La persona compartió un documento o un texto (puede venir tras «/debate»). Escribe un comentario hablado en español sobre él, como un pódcast de una sola voz:'
      : `MODO DEBATE. La persona compartió un documento o un texto (puede venir tras «/debate»). Escribe un debate hablado en español sobre él entre ${agents.length} participantes, como un pódcast:`,
    cast,
    `Formato obligatorio: cada intervención en una línea propia que empieza por el nombre exacto del participante, dos puntos y lo que dice (por ejemplo «${agents[0].name}: …»). Nada de Markdown, títulos, acotaciones ni narración fuera de las intervenciones.`,
    `Escribe ${LENGTHS[length].turns} intervenciones de una a cuatro frases.${solo ? '' : ' Que se respondan entre sí, con acuerdos y desacuerdos reales.'} Basa todo en el documento: cita y comenta sus ideas concretas, sin inventar lo que no dice. Empieza presentando el documento y termina con una conclusión.`,
    'Si no hay documento ni texto, contesta en una sola línea, con el primer participante, pidiendo que adjunten uno.',
  ].join('\n')
}

/** The debate instructions for a chat turn: only Pluma (`literatura`) debates. */
export function debateSystemFor(characterId: string | undefined, userText: string, debate: PlumaDebate = usePlumaDebate.getState()): string | undefined {
  if (characterId !== 'literatura' || !isDebateTurn(userText, debate.enabled)) return undefined
  return plumaDebateSystem(debateAgents(debate), debate.length)
}

function comparable(value: string) {
  return value.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9ñ ]/g, '').trim()
}

/**
 * The turns of a debate script, or `null` when the text is not one: lines that
 * start with a participant's name and a colon (bold names too), at least two
 * of them, with two different speakers unless only one takes part. A line
 * without a name continues the previous turn.
 */
export function parseDebate(text: string, agents: ResolvedAgent[]): DebateLine[] | null {
  const names = agents.map(agent => comparable(agent.name))
  const lines: DebateLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const match = /^[*_\s-]*([^:*_]{1,40}?)[*_\s]*:[*_\s]*(.+)$/u.exec(line)
    const agent = match ? names.indexOf(comparable(match[1])) : -1
    if (match && agent >= 0) lines.push({ agent, name: agents[agent].name, text: match[2].replace(/[*_]+/g, '').trim() })
    else if (lines.length) lines[lines.length - 1].text += ` ${line.replace(/[*_]+/g, '')}`
  }
  const speakers = new Set(lines.map(line => line.agent))
  if (lines.length < 2 || (agents.length > 1 && speakers.size < 2)) return null
  return lines.filter(line => line.text.trim())
}
