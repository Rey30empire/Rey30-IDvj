import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  channels: new Map<string, { onmessage: (event: unknown) => void }>(),
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class { onmessage = () => {} },
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke: mock.invoke }) }),
}))

import { startPlumaFast } from '../pluma-fast'

async function firstUtterance() {
  const fast = startPlumaFast()
  await Promise.resolve()
  const asr = mock.channels.get('pluma_first_asr_start')!
  asr.onmessage({ type: 'ready' })
  fast.append([new Float32Array(12800)], 16000, true)
  const pending = fast.finish(new AbortController().signal)
  return { asr, pending }
}

describe('Primer saludo de Pluma', () => {
  beforeEach(() => {
    mock.channels.clear()
    mock.invoke.mockReset().mockImplementation(async (command, args) => {
      if (args.events) mock.channels.set(command, args.events)
      return command
    })
  })

  it('responde al saludo completo que reconoce el motor local', async () => {
    const { asr, pending } = await firstUtterance()
    asr.onmessage({ type: 'result', text: 'hola qué tal', words: [
      { word: 'hola', start: 0.12, end: 0.42, conf: 1 },
      { word: 'qué', start: 0.42, end: 0.54, conf: 0.85 },
      { word: 'tal', start: 0.54, end: 0.84, conf: 1 },
    ] })
    await expect(pending).resolves.toBe('Bien, ¿y tú?')
    expect(mock.invoke).not.toHaveBeenCalledWith('pluma_realtime_start', expect.anything())
  })

  it.each([
    { text: 'hola cántame una canción', words: [{ word: 'hola', start: 0.09, end: 0.42, conf: 1 }] },
    { text: 'hola', words: [{ word: 'hola', start: 0.09, end: 0.36, conf: 0.95 }] },
  ])('conserva para Gemma un turno que incluye una petición o una parte sin reconocer', async (result) => {
    const { asr, pending } = await firstUtterance()
    asr.onmessage({ type: 'result', ...result })
    await expect(pending).resolves.toBeUndefined()
  })
})
