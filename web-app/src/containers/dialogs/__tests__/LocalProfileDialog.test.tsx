import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LocalProfileDialog from '../LocalProfileDialog'
import { DEFAULT_LOCAL_PROFILE, LOCAL_PROFILE_KEY, useLocalProfile } from '@/hooks/useLocalProfile'

vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('local profile editor', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.removeItem(LOCAL_PROFILE_KEY)
    useLocalProfile.setState({ profile: { ...DEFAULT_LOCAL_PROFILE } })
  })

  it('saves a local name and initials without requiring any connected account', () => {
    const close = vi.fn()
    render(<LocalProfileDialog open onOpenChange={close} />)
    fireEvent.change(screen.getByLabelText('profile:name'), { target: { value: 'Reinier' } })
    fireEvent.change(screen.getByLabelText('profile:initials'), { target: { value: 'rt' } })
    fireEvent.click(screen.getByRole('button', { name: 'profile:save' }))
    expect(useLocalProfile.getState().profile).toEqual({ name: 'Reinier', initials: 'RT' })
    expect(close).toHaveBeenCalledWith(false)
  })

  it('reports a write failure and keeps the editor open', () => {
    const close = vi.fn()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    render(<LocalProfileDialog open onOpenChange={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'profile:save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('profile:saveFailed')
    expect(close).not.toHaveBeenCalled()
  })

  it('cancels without changing the saved profile', () => {
    const close = vi.fn()
    render(<LocalProfileDialog open onOpenChange={close} />)
    fireEvent.change(screen.getByLabelText('profile:name'), { target: { value: 'Unsaved' } })
    fireEvent.click(screen.getByRole('button', { name: 'common:cancel' }))
    expect(localStorage.getItem(LOCAL_PROFILE_KEY)).toBeNull()
    expect(close).toHaveBeenCalledWith(false)
  })
})
