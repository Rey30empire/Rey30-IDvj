import { beforeEach, describe, expect, it, vi } from 'vitest'

const hub = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: hub.invoke }) }) }))

import { avatarImageData, deleteAvatarImage, portraitProblem } from '../avatar-image'
import { getOriginalProfile } from '../profiles'
import { validateCharacterProfile } from '../validation'
import { usesHologram } from '@/containers/characters/HologramAvatar'

const file = '67e55044-10b1-426f-9247-bb680e5fe0c8.png'
const portrait = { file, leftEye: [100, 120] as [number, number], rightEye: [180, 118] as [number, number], mouth: [140, 200] as [number, number] }

beforeEach(() => vi.clearAllMocks())

describe('imagen elegida para el holograma', () => {
  it('se guarda con el perfil y sobrevive a la validación', () => {
    const profile = getOriginalProfile('literatura')
    const saved = validateCharacterProfile(JSON.parse(JSON.stringify({ ...profile, avatar: { ...profile.avatar, portrait } })))
    expect(saved.avatar.portrait).toEqual(portrait)
    expect(validateCharacterProfile(JSON.parse(JSON.stringify(profile))).avatar.portrait).toBeUndefined()
  })

  it('rechaza rutas y puntos imposibles', () => {
    const profile = getOriginalProfile('literatura')
    const withPortrait = (value: object) => () => validateCharacterProfile(JSON.parse(JSON.stringify({ ...profile, avatar: { ...profile.avatar, portrait: { ...portrait, ...value } } })))
    expect(withPortrait({ file: '../settings.json' })).toThrow('imagen del avatar')
    expect(withPortrait({ file: 'C:\\fotos\\yo.png' })).toThrow('imagen del avatar')
    expect(withPortrait({ mouth: [1, -5] })).toThrow('boca')
    expect(withPortrait({ leftEye: [1] })).toThrow('ojo izquierdo')
    expect(withPortrait({ extra: true })).toThrow('imagen del avatar')
  })

  it('cualquier asistente con imagen puede ser holograma, salvo que elijan la esfera', () => {
    const plain = { baseId: 'kai', avatar: {} }
    expect(usesHologram(plain)).toBe(false)
    expect(usesHologram({ ...plain, avatar: { portrait } })).toBe(true)
    expect(usesHologram({ ...plain, avatar: { portrait, display: 'sphere' } })).toBe(false)
    expect(usesHologram({ baseId: 'literatura', avatar: {} })).toBe(true)
  })

  it('comprueba que las marcas formen una cara', () => {
    expect(portraitProblem([[100, 120], [180, 118], [140, 200]])).toBeUndefined()
    expect(portraitProblem([[180, 118], [100, 120], [140, 200]])).toMatch('izquierda')
    expect(portraitProblem([[100, 120], [180, 118], [140, 90]])).toMatch('debajo')
    expect(portraitProblem([[100, 120]])).toMatch('Marca')
  })

  it('pide la imagen una sola vez y la olvida al borrarla', async () => {
    hub.invoke.mockResolvedValue('data:image/png;base64,AAAA')
    await avatarImageData(file)
    await avatarImageData(file)
    expect(hub.invoke).toHaveBeenCalledTimes(1)
    hub.invoke.mockResolvedValueOnce(undefined)
    await deleteAvatarImage(file)
    expect(hub.invoke).toHaveBeenLastCalledWith('avatar_image_delete', { file })
    await avatarImageData(file)
    expect(hub.invoke).toHaveBeenLastCalledWith('avatar_image_data', { file })
  })
})
