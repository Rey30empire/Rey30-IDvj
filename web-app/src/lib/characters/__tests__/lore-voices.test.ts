import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke }) }) }))

const { applyLoreVoice } = await import('../lore')

describe('voces de Lore en cualquier formato', () => {
  beforeEach(() => { invoke.mockReset() })

  it('usa un WAV o un MP3 tal cual', async () => {
    invoke.mockResolvedValue({ ready: true, name: 'Pluma' })
    const convert = vi.fn()
    await applyLoreVoice('Pluma.wav', false, convert)
    await applyLoreVoice('Canto.MP3', true, convert)
    expect(invoke.mock.calls).toEqual([
      ['lore_voice_use', { singing: false, file: 'Pluma.wav' }],
      ['lore_voice_use', { singing: true, file: 'Canto.MP3' }],
    ])
    expect(convert).not.toHaveBeenCalled()
  })

  it('convierte una nota de voz M4A o MP4 a WAV sin tocar el archivo de Lore', async () => {
    invoke.mockImplementation(async (command: string) => command === 'lore_voice_read' ? btoa('audio original') : { ready: true, name: 'WhatsApp Audio' })
    const convert = vi.fn(async (audio: ArrayBuffer) => `WAV de ${new TextDecoder().decode(audio)}`)
    const status = await applyLoreVoice('WhatsApp Audio.mp4', true, convert)
    expect(invoke).toHaveBeenNthCalledWith(1, 'lore_voice_read', { singing: true, file: 'WhatsApp Audio.mp4' })
    expect(convert).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.stringContaining('WhatsApp Audio.mp4'))
    expect(invoke).toHaveBeenNthCalledWith(2, 'lore_voice_use', { singing: true, file: 'WhatsApp Audio.mp4', audio: 'WAV de audio original' })
    expect(status).toEqual({ ready: true, name: 'WhatsApp Audio' })
  })

  it('si no se puede leer, no cambia la muestra', async () => {
    invoke.mockResolvedValueOnce(btoa('roto'))
    await expect(applyLoreVoice('nota.ogg', false, async () => { throw new Error('No se pudo leer «nota.ogg».') })).rejects.toThrow('nota.ogg')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
