import type { CSSProperties } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { AvatarState, CharacterProfile, OriginalCharacterId } from '@/lib/characters/types'
import kairo from '@/assets/characters/kairo/avatar.svg?raw'
import beto from '@/assets/characters/beto/avatar.svg?raw'
import tino from '@/assets/characters/tino/avatar.svg?raw'
import milo from '@/assets/characters/milo/avatar.svg?raw'
import roco from '@/assets/characters/roco/avatar.svg?raw'
import nara from '@/assets/characters/nara/avatar.svg?raw'
import './CharacterAvatar.css'

const portraits: Partial<Record<OriginalCharacterId, string>> = { kairo, beto, tino, milo, roco, nara }
const states: Record<AvatarState, string> = {
  idle: 'en reposo', listening: 'escuchando', thinking: 'procesando', speaking: 'hablando',
  happy: 'alegre', surprised: 'sorprendido', focused: 'concentrado', error: 'reconociendo un error', celebrating: 'celebrando',
}
export type CharacterAvatarProps = { profile: CharacterProfile; state?: AvatarState; amplitude?: number; size?: number; className?: string }

export function CharacterAvatar({ profile, state = 'idle', amplitude = 0, size = 96, className = '' }: CharacterAvatarProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', undefined, { getInitialValueInEffect: false })
  if (!profile.avatar.enabled) return null
  const motion = reducedMotion ? 0 : profile.avatar.motion
  const mouth = motion > 0 && state === 'speaking' && Number.isFinite(amplitude) ? Math.max(0, Math.min(1, amplitude)) : 0
  const width = Number.isFinite(size) ? Math.max(16, Math.min(512, size)) : 96
  const safeColor = (color: string) => /^#[\da-f]{6}$/i.test(color) ? color : '#45404A'
  const style = {
    width, aspectRatio: '5 / 6',
    '--character-primary': safeColor(profile.avatar.primary), '--character-secondary': safeColor(profile.avatar.secondary),
    '--character-accent': safeColor(profile.avatar.accent), '--character-skin': safeColor(profile.avatar.skin), '--character-hair': safeColor(profile.avatar.hair),
    '--character-mouth': mouth, '--character-motion': motion,
  } as CSSProperties
  const portrait = Object.prototype.hasOwnProperty.call(portraits, profile.baseId) ? portraits[profile.baseId] : undefined
  if (!portrait) return null
  return <span
    role="img"
    aria-label={`${profile.name}, ${states[state] ?? states.idle}`}
    data-testid="character-avatar"
    data-character-id={profile.baseId}
    data-state={state}
    data-motion={motion}
    data-gestures={profile.avatar.gestures.join(' ')}
    className={`character-avatar ${className}`}
    style={style}
    // Only bundled, authored SVGs enter this slot; imported profiles supply colors and settings, never markup.
    dangerouslySetInnerHTML={{ __html: portrait }}
  />
}

export default CharacterAvatar
