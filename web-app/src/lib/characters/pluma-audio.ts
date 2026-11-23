// Two capture frames of voice: enough to tell a word from a click, short enough for a bare «sí».
const minVoiceMs = 85
// Long enough for most commas, short enough that the reply starts right away.
const endSilenceMs = 450
// Once a phrase runs past a second, a pause to think is longer than a comma.
const longTurnMs = 1000
const longTurnSilenceMs = 750
// The audio before the voice was recognized: the soft start of «hola» or the
// «s» of «sí» comes before the first periodic frame.
const preRollMs = 400
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
      // One frame without voice (an «l», a soft consonant) only half undoes the
      // voice heard so far, so it does not throw away the start of the word.
      voiceMs = voiced ? voiceMs + ms : started ? voiceMs : Math.max(0, voiceMs - ms / 2)
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
      const silenceNeeded = turnMs - silenceMs > longTurnMs ? longTurnSilenceMs : endSilenceMs
      return {
        chunks,
        ended: started && (silenceMs >= silenceNeeded || turnMs >= maxTurnMs),
        level: Math.min(1, rms * 8),
        voiced,
      }
    },
  }
}

const lowPassLength = 31

/**
 * A windowed-sinc low-pass at 90 % of the target's Nyquist frequency (7.2 kHz
 * for 16 kHz), unity gain. Without it, going from 48 kHz to 16 kHz keeps every
 * third sample and the hiss of «s», «z» and «ch» folds back into the voice.
 */
export function plumaLowPass(fromRate: number, toRate: number) {
  if (fromRate <= toRate) return Float32Array.of(1)
  const cutoff = 0.45 * toRate / fromRate
  const middle = (lowPassLength - 1) / 2
  const taps = Float32Array.from({ length: lowPassLength }, (_, index) => {
    const x = index - middle
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)
    return sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * index / (lowPassLength - 1)))
  })
  const sum = taps.reduce((total, tap) => total + tap, 0)
  return taps.map(tap => tap / sum)
}

export function createPlumaPcmEncoder(fromRate: number, toRate: number) {
  const ratio = fromRate / toRate
  const taps = plumaLowPass(fromRate, toRate)
  // The last input samples, so the filter runs across packet boundaries.
  let history = new Float32Array(taps.length - 1)
  let next = 0
  let previous = 0

  return (input: Float32Array): string => {
    const joined = new Float32Array(history.length + input.length)
    joined.set(history)
    joined.set(input, history.length)
    const filtered = new Float32Array(input.length)
    for (let index = 0; index < input.length; index++) {
      let sum = 0
      for (let tap = 0; tap < taps.length; tap++) sum += taps[tap] * joined[index + taps.length - 1 - tap]
      filtered[index] = sum
    }
    history = joined.slice(joined.length - history.length)
    const pcm = new Uint8Array((Math.ceil(input.length / ratio) + 1) * 2)
    const view = new DataView(pcm.buffer)
    let size = 0
    for (; next <= filtered.length - 1; next += ratio) {
      const left = Math.floor(next)
      const fraction = next - left
      const a = left < 0 ? previous : filtered[left]
      const b = filtered[left + 1] ?? a
      const value = Math.max(-1, Math.min(1, a + fraction * (b - a)))
      view.setInt16(size, Math.round(value * (value < 0 ? 32768 : 32767)), true)
      size += 2
    }
    next -= filtered.length
    previous = filtered[filtered.length - 1]
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

function writeWavHeader(bytes: Uint8Array, dataLength: number, sampleRate: number) {
  const view = new DataView(bytes.buffer)
  bytes.set([82, 73, 70, 70], 0)
  view.setUint32(4, 36 + dataLength, true)
  bytes.set([87, 65, 86, 69, 102, 109, 116, 32], 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  bytes.set([100, 97, 116, 97], 36)
  view.setUint32(40, dataLength, true)
}

export function plumaDictationWav(pcmBase64: string) {
  const pcm = atob(pcmBase64)
  const header = new Uint8Array(44)
  writeWavHeader(header, pcm.length, 16000)
  return btoa(String.fromCharCode(...header) + pcm)
}

/** A whole song is megabytes: converted in slices, since one spread would overflow the call stack. */
export function encodePlumaWav(clips: Float32Array[], sampleRate: number) {
  const dataLength = clips.reduce((sum, clip) => sum + clip.length * 2, 0)
  const bytes = new Uint8Array(44 + dataLength)
  writeWavHeader(bytes, dataLength, sampleRate)
  const view = new DataView(bytes.buffer)
  let offset = 44
  for (const clip of clips) {
    for (const sample of clip) {
      view.setInt16(offset, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true)
      offset += 2
    }
  }
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}
