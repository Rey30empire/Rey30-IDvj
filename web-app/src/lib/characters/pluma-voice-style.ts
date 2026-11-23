import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * How Pluma speaks: a mood and a regional Spanish she writes in, plus the
 * speed and pitch her cloned voice is played at.
 *
 * Qwen3-TTS clones the timbre of the sample but takes no style or accent
 * instruction, so the mood and the accent go into what she says (wording,
 * rhythm, exclamations, regional vocabulary) and speed and pitch are applied
 * to the audio here. The voice itself stays the chosen sample.
 */
export const PLUMA_EMOTIONS = {
  normal: { label: 'Normal', prompt: '' },
  suave: { label: 'Suave y tranquila', prompt: 'Habla con dulzura y calma: frases suaves, pausadas y cálidas.' },
  susurro: { label: 'Susurrando, escondida', prompt: 'Habla en susurros, como escondida para que nadie te oiga: frases muy cortas, pausas con puntos suspensivos y algún «shh».' },
  alegre: { label: 'Alegre', prompt: 'Estás muy contenta: frases vivas, con entusiasmo y alguna exclamación.' },
  triste: { label: 'Triste', prompt: 'Estás triste y apagada: frases cortas, lentas, con pausas y suspiros.' },
  enojada: { label: 'Enojada', prompt: 'Estás enfadada: frases cortas y tajantes, con exclamaciones. Nunca insultes a la persona.' },
  gritona: { label: 'Gritona', prompt: 'Hablas a gritos y con mucha energía: exclamaciones (¡…!) y palabras enfáticas.' },
} as const

export const PLUMA_ACCENTS = {
  neutro: { label: 'Español neutro', place: '' },
  cuba: { label: 'Cuba', place: 'Cuba' },
  espana: { label: 'España', place: 'España' },
  mexico: { label: 'México', place: 'México' },
  'republica-dominicana': { label: 'República Dominicana', place: 'República Dominicana' },
  'puerto-rico': { label: 'Puerto Rico', place: 'Puerto Rico' },
  venezuela: { label: 'Venezuela', place: 'Venezuela' },
  colombia: { label: 'Colombia', place: 'Colombia' },
  argentina: { label: 'Argentina', place: 'Argentina' },
  chile: { label: 'Chile', place: 'Chile' },
  peru: { label: 'Perú', place: 'Perú' },
  'guinea-ecuatorial': { label: 'Guinea Ecuatorial (África)', place: 'Guinea Ecuatorial' },
} as const

export type PlumaEmotion = keyof typeof PLUMA_EMOTIONS
export type PlumaAccent = keyof typeof PLUMA_ACCENTS
/** `speed`: 0.7 to 1.4 times. `pitch`: semitones, -4 to +4. */
export type PlumaVoiceStyle = { emotion: PlumaEmotion; accent: PlumaAccent; speed: number; pitch: number }

export const DEFAULT_PLUMA_STYLE: PlumaVoiceStyle = { emotion: 'normal', accent: 'neutro', speed: 1, pitch: 0 }
const clamp = (value: number, low: number, high: number, fallback: number) => Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback

/** A stored style made safe: unknown moods or accents and out-of-range numbers fall back. */
export function cleanPlumaStyle(value: Partial<PlumaVoiceStyle> | undefined): PlumaVoiceStyle {
  return {
    emotion: value?.emotion && value.emotion in PLUMA_EMOTIONS ? value.emotion : 'normal',
    accent: value?.accent && value.accent in PLUMA_ACCENTS ? value.accent : 'neutro',
    speed: clamp(Number(value?.speed), 0.7, 1.4, 1),
    pitch: clamp(Number(value?.pitch), -4, 4, 0),
  }
}

type StyleState = PlumaVoiceStyle & { set: (next: Partial<PlumaVoiceStyle>) => void; reset: () => void }

export const usePlumaVoiceStyle = create<StyleState>()(
  persist(
    (set) => ({
      ...DEFAULT_PLUMA_STYLE,
      set: (next) => set((state) => cleanPlumaStyle({ ...state, ...next })),
      reset: () => set(DEFAULT_PLUMA_STYLE),
    }),
    {
      name: 'rey30-pluma-voice-style',
      partialize: ({ emotion, accent, speed, pitch }) => ({ emotion, accent, speed, pitch }),
      merge: (stored, current) => ({ ...current, ...cleanPlumaStyle(stored as Partial<PlumaVoiceStyle>) }),
    }
  )
)

/** The lines her instructions get for the chosen mood and accent; empty when both are the default. */
export function plumaStyleInstructions(style: Pick<PlumaVoiceStyle, 'emotion' | 'accent'>): string {
  const lines: string[] = []
  const emotion = PLUMA_EMOTIONS[style.emotion]?.prompt
  if (emotion) lines.push(`Tono de voz elegido: ${emotion}`)
  const place = PLUMA_ACCENTS[style.accent]?.place
  if (place) lines.push(`Habla como una persona de ${place}: su vocabulario, sus expresiones, su trato (tú, usted o vos) y su ritmo. Que se note, sin caricaturizar.`)
  return lines.join('\n')
}

/** Whether the audio needs processing: speed or pitch away from normal. */
export const styleChangesAudio = (style: Pick<PlumaVoiceStyle, 'speed' | 'pitch'>) =>
  Math.abs(style.speed - 1) >= 0.01 || Math.abs(style.pitch) >= 0.05

function hann(length: number) {
  return Float32Array.from({ length }, (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / length))
}

/** Plays `input` back `step` times faster by reading it in steps: shorter and higher by that factor. */
function resample(input: Float32Array, step: number) {
  const length = Math.max(1, Math.floor(input.length / step))
  return Float32Array.from({ length }, (_, index) => {
    const position = index * step
    const left = Math.floor(position)
    const fraction = position - left
    const a = input[left] ?? 0
    return a + fraction * ((input[left + 1] ?? a) - a)
  })
}

/**
 * Changes the length of speech by `1 / tempo` without changing its pitch
 * (WSOLA): 30 ms windows are laid at a fixed hop and each is taken where it
 * best continues the previous one, so the voice keeps its periods.
 */
export function stretchVoice(input: Float32Array, rate: number, tempo: number): Float32Array {
  if (!(tempo > 0) || Math.abs(tempo - 1) < 0.005) return input
  const size = Math.max(64, 2 * Math.round(rate * 0.015))
  if (input.length < size * 2) return input
  const hop = size / 2
  const search = Math.round(rate * 0.01)
  const window = hann(size)
  const frames = Math.max(1, Math.floor((input.length / tempo - size) / hop) + 1)
  const output = new Float32Array((frames - 1) * hop + size)
  let previous = 0
  for (let frame = 0; frame < frames; frame++) {
    let start = Math.min(Math.round(frame * hop * tempo), input.length - size)
    const natural = previous + hop
    if (frame > 0 && natural + hop <= input.length) {
      let best = -Infinity
      const from = Math.max(0, start - search)
      const to = Math.min(input.length - size, start + search)
      for (let candidate = from; candidate <= to; candidate++) {
        let dot = 0
        for (let index = 0; index < hop; index += 2) dot += input[candidate + index] * input[natural + index]
        if (dot > best) { best = dot; start = candidate }
      }
    }
    // The halves no other window overlaps (the very start and end) keep full level.
    for (let index = 0; index < size; index++) {
      const edge = (frame === 0 && index < hop) || (frame === frames - 1 && index >= hop)
      output[frame * hop + index] += input[start + index] * (edge ? 1 : window[index])
    }
    previous = start
  }
  return output
}

/** Applies speed and pitch to a spoken sentence; the voice's own sound is kept. */
export function applyVoiceStyle(samples: Float32Array, rate: number, style: Pick<PlumaVoiceStyle, 'speed' | 'pitch'>): Float32Array {
  if (!styleChangesAudio(style)) return samples
  const factor = 2 ** (style.pitch / 12)
  const shifted = Math.abs(factor - 1) < 0.003 ? samples : resample(samples, factor)
  return stretchVoice(shifted, rate, style.speed / factor)
}
