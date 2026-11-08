import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocalApiConnectionCard } from '../LocalApiConnectionCard'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAppState } from '@/hooks/useAppState'

vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const writeText = vi.fn()

describe('client connection card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    writeText.mockResolvedValue(undefined)
    useLocalApiServer.setState({ serverPort: 1337, apiPrefix: '/v1', apiKey: 'owned-private-fixture-key', serverHost: '0.0.0.0', defaultModelLocalApiServer: { model: 'owned-model', provider: 'llamacpp' }, lastServerModels: [] })
    useModelProvider.setState({ providers: [] })
    useAppState.setState({ serverStatus: 'stopped' })
  })

  it('copies a useful URL and redacted configuration while leaving the secret masked', async () => {
    render(<LocalApiConnectionCard />)
    expect(screen.getByLabelText('baseUrl')).toHaveValue('http://127.0.0.1:1337/v1')
    expect(screen.getByLabelText('key')).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByText('copyUrl'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:1337/v1'))
    fireEvent.click(screen.getByText('copyConfig'))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText.mock.calls[1][0]).not.toContain('owned-private-fixture-key')
    expect(JSON.parse(writeText.mock.calls[1][0]).model).toBe('owned-model')
  })

  it('creates a key only on request while stopped', () => {
    useLocalApiServer.setState({ apiKey: '' })
    render(<LocalApiConnectionCard />)
    expect(useLocalApiServer.getState().apiKey).toBe('')
    fireEvent.click(screen.getByText('generateKey'))
    expect(useLocalApiServer.getState().apiKey).toMatch(/^rey30_[a-f0-9]{64}$/)
  })

  it('does not offer a bad URL for an unassigned port', () => {
    useLocalApiServer.setState({ serverPort: 0, defaultModelLocalApiServer: null })
    render(<LocalApiConnectionCard />)
    expect(screen.getByRole('alert')).toHaveTextContent('invalidAddress')
    expect(screen.queryByText('copyUrl')).not.toBeInTheDocument()
  })

  it('uses the running server model instead of a different configured default', () => {
    useAppState.setState({ serverStatus: 'running' })
    useLocalApiServer.setState({ lastServerModels: [{ model: 'running-owned-model', provider: 'llamacpp' }] })
    render(<LocalApiConnectionCard />)
    expect(screen.getByLabelText('model')).toHaveValue('running-owned-model')
    expect(screen.getByRole('status')).toHaveTextContent('running')
  })
})
