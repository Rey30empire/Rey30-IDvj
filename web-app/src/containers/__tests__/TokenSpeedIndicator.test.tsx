import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'

const settingsRef = vi.hoisted(() => ({ showTokenSpeed: true }))
vi.mock('@/hooks/useInterfaceSettings', () => ({
  useInterfaceSettings: (selector: (s: typeof settingsRef) => unknown) =>
    selector(settingsRef),
}))

import { TokenSpeedIndicator } from '../TokenSpeedIndicator'

const metadata = { tokenSpeed: { tokenSpeed: 67.4, tokenCount: 229 } }

describe('TokenSpeedIndicator', () => {
  beforeEach(() => {
    i18n.changeLanguage('es')
    settingsRef.showTokenSpeed = true
  })

  it('shows inline stats, with the compact gauge as the narrow-column fallback', () => {
    render(<TranslationContext.Provider value={{ t: i18n.t, i18n }}><TokenSpeedIndicator metadata={metadata} /></TranslationContext.Provider>)
    const inline = screen.getByText('67 tokens/s').closest('div[class*="@max-md:hidden"]')
    expect(inline).not.toBeNull()
    // The gauge stays reachable when the inline stats give way.
    const gauge = screen.getByRole('button', { name: 'Detalles de velocidad de tokens' })
    expect(gauge.closest('div')?.className).toContain('@max-md:flex')
  })

  it('shows only the compact gauge when inline stats are off', () => {
    settingsRef.showTokenSpeed = false
    render(<TranslationContext.Provider value={{ t: i18n.t, i18n }}><TokenSpeedIndicator metadata={metadata} /></TranslationContext.Provider>)
    expect(screen.queryByText('67 tokens/s')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Detalles de velocidad de tokens' })
    ).toBeInTheDocument()
  })
})
