import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticProvider } from '../AnalyticProvider'
import { AnalyticConsent } from '@/containers/analytics/AnalyticConsent'
import { usePrivacyMode } from '@/hooks/usePrivacyMode'
import { useProductAnalytic, useProductAnalyticPrompt } from '@/hooks/useAnalytic'

const mocks = vi.hoisted(() => ({ distinct: vi.fn(), update: vi.fn(), init: vi.fn(), identify: vi.fn(), optIn: vi.fn(), optOut: vi.fn(), register: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => {
  const hub = { analytic: () => ({ getAppDistinctId: mocks.distinct, updateDistinctId: mocks.update }) }
  return { useServiceHub: () => hub, getServiceHub: () => hub }
})
vi.mock('posthog-js', () => ({ default: { init: mocks.init, identify: mocks.identify, opt_in_capturing: mocks.optIn, opt_out_capturing: mocks.optOut, register: mocks.register, get_distinct_id: () => 'fixture-distinct' } }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('POSTHOG_KEY', 'fixture-key'); vi.stubGlobal('POSTHOG_HOST', 'https://not-called.example.test'); vi.stubGlobal('VERSION', 'fixture')
  usePrivacyMode.setState({ mode: 'standard', loaded: true, saving: false, error: null })
  useProductAnalytic.setState({ productAnalytic: true }); useProductAnalyticPrompt.setState({ productAnalyticPrompt: true })
})
afterEach(() => vi.unstubAllGlobals())
describe('telemetry privacy races', () => {
  it('does not identify or opt in when an old distinct-id promise resolves after protected mode', async () => {
    let resolve!: (value: string) => void
    mocks.distinct.mockReturnValue(new Promise<string>(done => { resolve = done }))
    render(<AnalyticProvider />)
    expect(mocks.distinct).toHaveBeenCalledOnce()
    act(() => { usePrivacyMode.setState({ mode: 'local-only' }); useProductAnalytic.getState().setProductAnalytic(false) })
    await act(async () => { resolve('fixture-private-id'); await Promise.resolve() })
    expect(mocks.identify).not.toHaveBeenCalled(); expect(mocks.optIn).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.optOut).toHaveBeenCalled()
  })
  it('does not enable capture after the user revoked consent or the provider unmounted', async () => {
    let resolve!: (value: string) => void
    mocks.distinct.mockReturnValue(new Promise<string>(done => { resolve = done }))
    const view = render(<AnalyticProvider />)
    await act(async () => { await useProductAnalytic.getState().setProductAnalytic(false) }); view.unmount()
    await act(async () => { resolve('fixture-id'); await Promise.resolve() })
    expect(mocks.identify).not.toHaveBeenCalled(); expect(mocks.optIn).not.toHaveBeenCalled()
  })
  it('handles identity lookup failure without finally opting in or logging the raw error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.distinct.mockRejectedValue(new Error('fixture-private-text'))
    render(<AnalyticProvider />)
    await waitFor(() => expect(mocks.optOut).toHaveBeenCalled())
    expect(mocks.optIn).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); log.mockRestore()
  })
  it('keeps consent opt-in disabled in protected mode while allowing refusal', async () => {
    usePrivacyMode.setState({ mode: 'cloud-review' }); useProductAnalytic.setState({ productAnalytic: false })
    render(<AnalyticConsent />)
    expect(screen.getByTestId('analytic-allow')).toBeDisabled()
    fireEvent.click(screen.getByTestId('analytic-allow'))
    expect(mocks.optIn).not.toHaveBeenCalled(); expect(useProductAnalytic.getState().productAnalytic).toBe(false)
    fireEvent.click(screen.getByTestId('analytic-deny'))
    await waitFor(() => expect(useProductAnalyticPrompt.getState().productAnalyticPrompt).toBe(false))
  })
})
