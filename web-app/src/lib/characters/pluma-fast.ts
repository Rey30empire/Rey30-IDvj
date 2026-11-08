import { Channel } from '@tauri-apps/api/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import { createPlumaPcmEncoder } from './pluma-audio'

const maxResponseWaitMs = 160
const maxGreetingMs = 3200

type FirstAsrEvent = {
  type: 'ready' | 'result' | 'error'
  text?: string
  words?: { word: string; start: number; end: number; conf: number }[]
}

const greetingPattern = /^(?:(?:hola|buenos dias|buenas tardes|buenas noches)(?: pluma)?(?: que tal| como estas)?|que tal|como estas|(?:muchas )?gracias|adios|hasta luego)(?: pluma)?$/u

function greetingReply(event: FirstAsrEvent, lastVoicedMs: number) {
  const heard = event.text?.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ')
  const words = event.words
  if (!heard || !greetingPattern.test(heard) || !words?.length || words.length !== heard.split(' ').length) return
  const last = words[words.length - 1]
  if (!words.every(word => Number.isFinite(word.conf) && word.conf >= 0.45)
    || !Number.isFinite(words[0].start) || words[0].start > 0.26
    || !Number.isFinite(last.end) || last.end * 1000 + 160 < lastVoicedMs) return

  if (/gracias/u.test(heard)) return 'De nada.'
  if (/^(adios|hasta luego)/u.test(heard)) return 'Hasta luego.'
  if (/(que tal|como estas)/u.test(heard)) return 'Bien, ¿y tú?'
  return 'Hola, ¿qué tal?'
}

export function startPlumaFast() {
  const core = getServiceHub().core()
  const events = new Channel<FirstAsrEvent>()
  let id: string | undefined
  let ready = false
  let closed = false
  let audioMs = 0
  let lastVoicedMs = 0
  let encode: ReturnType<typeof createPlumaPcmEncoder> | undefined
  let pendingMessages = 0
  let queue = Promise.resolve()
  let settle: ((reply?: string) => void) | undefined

  function stop() {
    if (closed) return
    closed = true
    events.onmessage = () => {}
    settle?.()
    if (id) void core.invoke('pluma_first_asr_stop', { sessionId: id }).catch(() => {})
  }

  function send(command: string, args: Record<string, unknown> = {}) {
    if (closed) return
    if (++pendingMessages > 24) { stop(); return }
    queue = queue.then(async () => {
      if (!closed) await core.invoke(command, { sessionId: id, ...args })
    }).catch(stop).finally(() => { pendingMessages-- })
  }

  events.onmessage = event => {
    if (closed) return
    if (event.type === 'ready') { ready = true; return }
    if (event.type === 'result') settle?.(greetingReply(event, lastVoicedMs))
    stop()
  }
  void core.invoke<string>('pluma_first_asr_start', { events }).then(sessionId => {
    if (closed) void core.invoke('pluma_first_asr_stop', { sessionId }).catch(() => {})
    else id = sessionId
  }).catch(stop)

  return {
    append(chunks: Float32Array[], sourceRate: number, voiced: boolean) {
      if (closed || !chunks.length) return
      if (!ready || !id) { stop(); return }
      encode ??= createPlumaPcmEncoder(sourceRate, 16000)
      for (const chunk of chunks) {
        audioMs += chunk.length * 1000 / sourceRate
        if (audioMs > maxGreetingMs) { stop(); return }
        const pcmBase64 = encode(chunk)
        if (pcmBase64) send('pluma_first_asr_send', { pcmBase64 })
      }
      if (voiced) lastVoicedMs = audioMs
    },
    finish(signal: AbortSignal): Promise<string | undefined> {
      if (closed || !ready || !audioMs || signal.aborted || settle) {
        stop()
        return Promise.resolve(undefined)
      }
      return new Promise(resolve => {
        const timer = setTimeout(stop, maxResponseWaitMs)
        settle = text => {
          settle = undefined
          clearTimeout(timer)
          signal.removeEventListener('abort', stop)
          resolve(text)
        }
        signal.addEventListener('abort', stop, { once: true })
        send('pluma_first_asr_finish')
      })
    },
    stop,
  }
}
