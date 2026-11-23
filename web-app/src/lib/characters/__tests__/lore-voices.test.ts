import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke }) }) }))

const { applyLoreVoice, loreGender, loreOwnFolder, loreVoiceGroups, loreVoiceKey, loreVoices, saveLoreVoice } = await import('../lore')
const { getOriginalProfile } = await import('../profiles')

describe('voces de Lore en cualquier formato', () => {
  beforeEach(() => { invoke.mockReset() })

  it('usa un WAV o un MP3 tal cual, desde su carpeta', async () => {
    invoke.mockResolvedValue({ ready: true, name: 'Pluma' })
    const convert = vi.fn()
    await applyLoreVoice({ group: 'Pluma', file: 'Pluma.wav' }, false, convert)
    await applyLoreVoice({ file: 'Canto.MP3' }, true, convert)
    expect(invoke.mock.calls).toEqual([
      ['lore_voice_use', { singing: false, group: 'Pluma', file: 'Pluma.wav' }],
      ['lore_voice_use', { singing: true, file: 'Canto.MP3' }],
    ])
    expect(convert).not.toHaveBeenCalled()
  })

  it('convierte una nota de voz M4A o MP4 a WAV sin tocar el archivo de Lore', async () => {
    invoke.mockImplementation(async (command: string) => command === 'lore_voice_read' ? btoa('audio original') : { ready: true, name: 'WhatsApp Audio' })
    const convert = vi.fn(async (audio: ArrayBuffer) => `WAV de ${new TextDecoder().decode(audio)}`)
    const status = await applyLoreVoice({ group: 'mujer', file: 'WhatsApp Audio.mp4' }, true, convert)
    expect(invoke).toHaveBeenNthCalledWith(1, 'lore_voice_read', { singing: true, group: 'mujer', file: 'WhatsApp Audio.mp4' })
    expect(convert).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.stringContaining('WhatsApp Audio.mp4'))
    expect(invoke).toHaveBeenNthCalledWith(2, 'lore_voice_use', { singing: true, group: 'mujer', file: 'WhatsApp Audio.mp4', audio: 'WAV de audio original' })
    expect(status).toEqual({ ready: true, name: 'WhatsApp Audio' })
  })

  it('si no se puede leer, no cambia la muestra', async () => {
    invoke.mockResolvedValueOnce(btoa('roto'))
    await expect(applyLoreVoice({ file: 'nota.ogg' }, false, async () => { throw new Error('No se pudo leer «nota.ogg».') })).rejects.toThrow('nota.ogg')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})

describe('carpetas de voces por asistente y por género', () => {
  beforeEach(() => { invoke.mockReset() })

  it('Pluma usa su carpeta y la de mujer; Beto, la suya y la de hombre', () => {
    expect(loreVoiceGroups(getOriginalProfile('literatura'))).toEqual({ own: 'Pluma', gender: 'mujer' })
    expect(loreVoiceGroups(getOriginalProfile('beto'))).toEqual({ own: 'Beto', gender: 'hombre' })
    expect(loreVoiceGroups(getOriginalProfile('nara'))).toEqual({ own: 'Nara', gender: 'mujer' })
  })

  it('un asistente creado por ti usa su propio nombre', () => {
    const custom = { ...getOriginalProfile('nara'), id: 'custom-1', name: 'Luna Roja' }
    expect(loreVoiceGroups(custom)).toEqual({ own: 'Luna', gender: 'mujer' })
  })

  it('el género sigue a la voz que tiene elegida', () => {
    const beto = getOriginalProfile('beto')
    expect(loreGender({ ...beto, voice: { ...beto.voice, voiceURI: 'espeak:es-419+f3' } })).toBe('mujer')
    expect(loreGender({ ...beto, voice: { ...beto.voice, voiceURI: 'otra-voz' } })).toBe('hombre')
  })

  it('la carpeta propia es el primer nombre, sin caracteres que una carpeta no admite', () => {
    expect(loreOwnFolder('Beto Carambola', 'beto')).toBe('Beto')
    expect(loreOwnFolder('  ..Lu:na/Roja ', 'nara')).toBe('Lu')
    expect(loreOwnFolder('', 'coder')).toBe('coder')
    expect(loreOwnFolder('Mujer fatal', 'nara')).toBe('nara')
  })

  it('pide solo sus carpetas y graba en la suya', async () => {
    invoke.mockResolvedValue({ root: 'C:\\Lore', voices: [], selected: null })
    await loreVoices(false, { own: 'Pluma', gender: 'mujer' })
    await loreVoices(true)
    await saveLoreVoice('Mi voz', 'UklGRg==', true, 'Pluma')
    expect(invoke.mock.calls).toEqual([
      ['lore_voices', { singing: false, groups: ['Pluma', 'mujer', ''] }],
      ['lore_voices', { singing: true }],
      ['lore_voice_save', { singing: true, group: 'Pluma', name: 'Mi voz', audio: 'UklGRg==' }],
    ])
  })

  it('nombra cada voz como la recuerda la app', () => {
    expect(loreVoiceKey({ group: 'Pluma', file: 'Pluma.wav' })).toBe('Pluma/Pluma.wav')
    expect(loreVoiceKey({ file: 'Vieja.wav' })).toBe('Vieja.wav')
  })
})
