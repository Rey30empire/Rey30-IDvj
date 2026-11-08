const minVoiceMs = 120
const endSilenceMs = 260
const preRollMs = 140
const maxTurnMs = 20000

const pitchRate = 8000
const minPitchLag = Math.floor(pitchRate / 500)
const maxPitchLag = Math.ceil(pitchRate / 70)
/** Periodicity a frame needs to count as a voice rather than breath or noise. */
export const plumaVoicePeriodicity = 0.5

/**
 * How periodic a frame is, from 0 to 1: the strongest normalized
 * autocorrelation at a pitch between 70 and 500 Hz. Voiced speech repeats at
 * its pitch and scores high; breath, rustle and fan noise are aperiodic and
 * score low even when they are loud.
 */
export function voicePeriodicity(samples: Float32Array, rate: number): number {
  const ratio = rate / pitchRate
  const length = Math.floor(samples.length / ratio)
  if (ratio < 1 || length < maxPitchLag * 2) return 0
  const reduced = new Float32Array(length)
  let mean = 0
  for (let index = 0; index < length; index++) {
    const from = Math.floor(index * ratio)
    const to = Math.max(from + 1, Math.floor((index + 1) * ratio))
    let sum = 0
    for (let offset = from; offset < to; offset++) sum += samples[offset]
    reduced[index] = sum / (to - from)
    mean += reduced[index]
  }
  mean /= length
  for (let index = 0; index < length; index++) reduced[index] -= mean
  let best = 0
  for (let lag = minPitchLag; lag <= maxPitchLag; lag++) {
    let dot = 0
    let head = 0
    let tail = 0
    for (let index = 0; index + lag < length; index++) {
      const a = reduced[index]
      const b = reduced[index + lag]
      dot += a * b
      head += a * a
      tail += b * b
    }
    if (head > 1e-9 && tail > 1e-9) best = Math.max(best, dot / Math.sqrt(head * tail))
  }
  return best
}

export const isVoiceLike = (samples: Float32Array, rate: number) =>
  voicePeriodicity(samples, rate) >= plumaVoicePeriodicity

export function createPlumaTurnDetector(rate: number) {
  let preRoll: Float32Array[] = []
  let bufferedMs = 0
  let voiceMs = 0
  let silenceMs = 0
  let turnMs = 0
  let started = false
  let noise = 0.003

  const reset = () => {
    preRoll = []
    bufferedMs = voiceMs = silenceMs = turnMs = 0
    started = false
  }

  return {
    reset,
    get started() { return started },
    push(samples: Float32Array) {
      const ms = samples.length * 1000 / rate
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
      const loud = rms > Math.max(0.009, noise * 3)
      // A turn only opens on a real voice; once open, any sound (consonants,
      // a breath between phrases) keeps it going until the silence.
      const voiced = loud && (started || isVoiceLike(samples, rate))
      if (!started && !loud && voiceMs === 0) noise = Math.min(0.012, noise * 0.9 + rms * 0.1)
      voiceMs = voiced ? voiceMs + ms : started ? voiceMs : Math.max(0, voiceMs - ms)
      silenceMs = voiced ? 0 : silenceMs + ms
      let chunks: Float32Array[] = []
      if (started) {
        turnMs += ms
        chunks = [samples]
      } else {
        preRoll.push(samples)
        bufferedMs += ms
        while (preRoll.length > 1 && bufferedMs - preRoll[0].length * 1000 / rate >= preRollMs) {
          bufferedMs -= preRoll.shift()!.length * 1000 / rate
        }
        if (voiceMs >= minVoiceMs) {
          started = true
          turnMs = bufferedMs
          chunks = preRoll
          preRoll = []
        }
      }
      return {
        chunks,
        ended: started && (silenceMs >= endSilenceMs || turnMs >= maxTurnMs),
        level: Math.min(1, rms * 8),
        voiced,
      }
    },
  }
}

export function createPlumaPcmEncoder(fromRate: number, toRate: number) {
  const ratio = fromRate / toRate
  let next = 0
  let previous = 0

  return (input: Float32Array): string => {
    const pcm = new Uint8Array((Math.ceil(input.length / ratio) + 1) * 2)
    const view = new DataView(pcm.buffer)
    let size = 0
    for (; next <= input.length - 1; next += ratio) {
      const left = Math.floor(next)
      const fraction = next - left
      const a = left < 0 ? previous : input[left]
      const b = input[left + 1] ?? a
      const value = Math.max(-1, Math.min(1, a + fraction * (b - a)))
      view.setInt16(size, Math.round(value * (value < 0 ? 32768 : 32767)), true)
      size += 2
    }
    next -= input.length
    previous = input[input.length - 1]
    return btoa(String.fromCharCode(...pcm.subarray(0, size)))
  }
}

export function decodePlumaPcm(audio: string) {
  const bytes = atob(audio)
  if (bytes.length % 2 !== 0) throw new Error('Pluma recibió un fragmento de audio incompleto.')
  const samples = new Float32Array(bytes.length / 2)
  for (let index = 0; index < samples.length; index++) {
    const value = bytes.charCodeAt(index * 2) | (bytes.charCodeAt(index * 2 + 1) << 8)
    samples[index] = (value >= 0x8000 ? value - 0x10000 : value) / 32768
  }
  return samples
}

export function encodePlumaDictation(chunks: Float32Array[], sourceRate: number) {
  const encode = createPlumaPcmEncoder(sourceRate, 16000)
  return btoa(chunks.map(chunk => atob(encode(chunk))).join('').slice(0, 640000))
}

export function plumaDictationWav(pcmBase64: string) {
  const pcm = atob(pcmBase64)
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  header.set([82, 73, 70, 70], 0)
  view.setUint32(4, 36 + pcm.length, true)
  header.set([87, 65, 86, 69, 102, 109, 116, 32], 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true)
  view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  header.set([100, 97, 116, 97], 36)
  view.setUint32(40, pcm.length, true)
  return btoa(String.fromCharCode(...header) + pcm)
}
