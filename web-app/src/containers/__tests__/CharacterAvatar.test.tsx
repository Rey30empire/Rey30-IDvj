import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CharacterAvatar from '../characters/CharacterAvatar'
import { LEGACY_CHARACTER_IDS, getOriginalProfile } from '@/lib/characters/profiles'
import type { AvatarState } from '@/lib/characters/types'

beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList)
})
afterEach(() => { vi.restoreAllMocks() })
describe('retratos originales y estados de avatar', () => {
  it('loads six distinct independently authored SVG portraits with animatable parts and no external resources', () => {
    const portraits: string[] = []
    for (const profile of LEGACY_CHARACTER_IDS.map(getOriginalProfile)) {
      const { container, unmount } = render(<CharacterAvatar profile={profile} />)
      expect(screen.getByRole('img')).toHaveAccessibleName(`${profile.name}, en reposo`)
      const svg = container.querySelector('svg')!
      expect(svg).toHaveAttribute('viewBox', '0 0 200 240')
      for (const part of ['portrait', 'eyes', 'mouth', 'arms']) expect(svg.querySelector(`[data-part="${part}"]`)).not.toBeNull()
      expect(svg.querySelector('script,foreignObject,image,use')).toBeNull()
      portraits.push(svg.innerHTML)
      unmount()
    }
    expect(new Set(portraits).size).toBe(6)
  })
  it('maps the measured amplitude only during speaking and clamps invalid levels', () => {
    const profile = getOriginalProfile('roco')
    const { rerender } = render(<CharacterAvatar profile={profile} state="speaking" amplitude={0.7} />)
    expect(screen.getByRole('img').style.getPropertyValue('--character-mouth')).toBe('0.7')
    rerender(<CharacterAvatar profile={profile} state="speaking" amplitude={2} />)
    expect(screen.getByRole('img').style.getPropertyValue('--character-mouth')).toBe('1')
    rerender(<CharacterAvatar profile={profile} state="thinking" amplitude={1} />)
    expect(screen.getByRole('img').style.getPropertyValue('--character-mouth')).toBe('0')
    rerender(<CharacterAvatar profile={profile} state="speaking" amplitude={NaN} />)
    expect(screen.getByRole('img').style.getPropertyValue('--character-mouth')).toBe('0')
  })
  it('honors independent avatar visibility and zero motion', () => {
    const profile = getOriginalProfile('nara')
    profile.avatar.motion = 0
    const { rerender } = render(<CharacterAvatar profile={profile} state="speaking" amplitude={1} />)
    expect(screen.getByRole('img')).toHaveAttribute('data-motion', '0')
    expect(screen.getByRole('img').style.getPropertyValue('--character-mouth')).toBe('0')
    profile.avatar.enabled = false
    rerender(<CharacterAvatar profile={profile} />)
    expect(screen.queryByRole('img')).toBeNull()
  })
  it('respects reduced motion even when avatar motion and audio amplitude are enabled', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
    render(<CharacterAvatar profile={getOriginalProfile('kairo')} state="speaking" amplitude={1} />)
    expect(screen.getByRole('img')).toHaveAttribute('data-motion', '0')
    expect(screen.getByRole('img').style.getPropertyValue('--character-mouth')).toBe('0')
  })
  it.each<AvatarState>(['idle', 'listening', 'thinking', 'speaking', 'happy', 'surprised', 'focused', 'error', 'celebrating'])('describes the real supplied state accessibly: %s', state => {
    render(<CharacterAvatar profile={getOriginalProfile('beto')} state={state} />)
    expect(screen.getByRole('img')).toHaveAttribute('data-state', state)
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toMatch(/undefined/)
  })
})
