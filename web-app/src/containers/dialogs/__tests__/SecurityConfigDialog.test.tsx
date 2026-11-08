import type { ReactNode } from 'react'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  render as baseRender,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react'
import '@testing-library/jest-dom'

const render = (ui: ReactNode) =>
  baseRender(
    <TranslationContext.Provider value={{ t: i18n.t, i18n }}>
      {ui}
    </TranslationContext.Provider>
  )

const hoisted = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: hoisted.invoke,
}))

vi.mock('sonner', () => ({ toast: hoisted.toast }))

import { SecurityConfigDialog } from '../SecurityConfigDialog'

const statusNone = {
  auth_mode: 'none' as const,
  has_token: false,
  has_password: false,
  require_pairing: false,
  approved_device_count: 0,
  recent_auth_failures: 0,
}

const setInvokeMap = (map: Record<string, unknown>) => {
  hoisted.invoke.mockImplementation(async (cmd: string) => {
    if (cmd in map) {
      const v = map[cmd]
      if (v instanceof Error) throw v
      return v
    }
    return undefined
  })
}

describe('SecurityConfigDialog', () => {
  beforeEach(() => {
    i18n.changeLanguage('es')
    vi.clearAllMocks()
  })

  it('does not render content when closed', () => {
    render(<SecurityConfigDialog isOpen={false} onClose={vi.fn()} />)
    expect(
      screen.queryByText('Configuración de seguridad')
    ).not.toBeInTheDocument()
  })

  it('fetches status on open and renders the auth tab', async () => {
    setInvokeMap({ security_get_status: statusNone })
    render(<SecurityConfigDialog isOpen={true} onClose={vi.fn()} />)
    await waitFor(() =>
      expect(hoisted.invoke).toHaveBeenCalledWith('security_get_status')
    )
    expect(
      await screen.findByText('Configuración de seguridad')
    ).toBeInTheDocument()
    expect(await screen.findByText('Estado actual')).toBeInTheDocument()
  })

  it('shows an error toast if status fetch fails', async () => {
    setInvokeMap({ security_get_status: new Error('nope') })
    render(<SecurityConfigDialog isOpen={true} onClose={vi.fn()} />)
    await waitFor(() =>
      expect(hoisted.toast.error).toHaveBeenCalledWith(
        'No se pudo cargar la configuración de seguridad'
      )
    )
  })

  it('calls onClose when Close is clicked', async () => {
    setInvokeMap({ security_get_status: statusNone })
    const onClose = vi.fn()
    render(<SecurityConfigDialog isOpen={true} onClose={onClose} />)
    const closeBtns = await screen.findAllByText('Cerrar')
    // The visible footer button is the non-sr-only one; click the last.
    fireEvent.click(closeBtns[closeBtns.length - 1])
    expect(onClose).toHaveBeenCalled()
  })

  it('loads devices when switching to the Devices tab', async () => {
    setInvokeMap({
      security_get_status: statusNone,
      security_get_devices: [
        {
          id: 'd1',
          name: 'Laptop',
          channel: 'lan',
          user_id: 'u1',
          approved_at: '2025-01-01',
          last_access: null,
        },
      ],
    })
    render(<SecurityConfigDialog isOpen={true} onClose={vi.fn()} />)
    await screen.findByText('Configuración de seguridad')
    fireEvent.click(
      await screen.findByRole('button', { name: /dispositivos/i })
    )
    await waitFor(() =>
      expect(hoisted.invoke).toHaveBeenCalledWith('security_get_devices')
    )
    expect(await screen.findByText('Laptop')).toBeInTheDocument()
  })

  it('loads logs when switching to the Logs tab and renders empty state', async () => {
    setInvokeMap({
      security_get_status: statusNone,
      security_get_logs: [],
    })
    render(<SecurityConfigDialog isOpen={true} onClose={vi.fn()} />)
    await screen.findByText('Configuración de seguridad')
    fireEvent.click(await screen.findByRole('button', { name: /registros/i }))
    await waitFor(() =>
      expect(hoisted.invoke).toHaveBeenCalledWith('security_get_logs', {
        limit: 100,
      })
    )
    expect(
      await screen.findByText('No hay registros de acceso')
    ).toBeInTheDocument()
  })

  it('generates a new token via the auth tab', async () => {
    setInvokeMap({
      security_get_status: { ...statusNone, auth_mode: 'token' },
      security_generate_token: 'abcdef1234567890',
    })
    render(<SecurityConfigDialog isOpen={true} onClose={vi.fn()} />)
    const genBtn = await screen.findByText('Generar nuevo token')
    fireEvent.click(genBtn)
    await waitFor(() =>
      expect(hoisted.invoke).toHaveBeenCalledWith('security_generate_token')
    )
    await waitFor(() =>
      expect(hoisted.toast.success).toHaveBeenCalledWith(
        'Se generó un nuevo token de acceso'
      )
    )
  })

  it('rejects mismatched passwords in the password flow', async () => {
    setInvokeMap({
      security_get_status: { ...statusNone, auth_mode: 'password' },
    })
    render(<SecurityConfigDialog isOpen={true} onClose={vi.fn()} />)
    await screen.findAllByText('Guardar contraseña')
    const pw = screen.getByPlaceholderText('Introduce la contraseña')
    const confirm = screen.getByPlaceholderText('Confirma la contraseña')
    fireEvent.change(pw, { target: { value: 'longenough' } })
    fireEvent.change(confirm, { target: { value: 'different' } })
    // Inline message renders
    expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument()
    // Save button disabled due to mismatch
    const setBtns = screen.getAllByText('Guardar contraseña')
    const btn = setBtns
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)!
    expect(btn).toBeDisabled()
  })

  it('invokes security_set_password with a valid password', async () => {
    setInvokeMap({
      security_get_status: { ...statusNone, auth_mode: 'password' },
      security_set_password: undefined,
    })
    render(<SecurityConfigDialog isOpen={true} onClose={vi.fn()} />)
    const pw = await screen.findByPlaceholderText('Introduce la contraseña')
    const confirm = screen.getByPlaceholderText('Confirma la contraseña')
    fireEvent.change(pw, { target: { value: 'longenough' } })
    fireEvent.change(confirm, { target: { value: 'longenough' } })
    const setBtns = screen.getAllByText('Guardar contraseña')
    const btn = setBtns
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)!
    fireEvent.click(btn)
    await waitFor(() =>
      expect(hoisted.invoke).toHaveBeenCalledWith('security_set_password', {
        password: 'longenough',
      })
    )
  })

  it('toggles the pairing switch and invokes backend', async () => {
    setInvokeMap({
      security_get_status: statusNone,
      security_get_devices: [],
      security_set_require_pairing: undefined,
    })
    render(<SecurityConfigDialog isOpen={true} onClose={vi.fn()} />)
    await screen.findByText('Configuración de seguridad')
    fireEvent.click(
      await screen.findByRole('button', { name: /dispositivos/i })
    )
    await screen.findByText('Exigir vinculación de dispositivos')
    // Radix Switch exposes role="switch"
    const sw = screen.getByRole('switch')
    fireEvent.click(sw)
    await waitFor(() =>
      expect(hoisted.invoke).toHaveBeenCalledWith(
        'security_set_require_pairing',
        { require: true }
      )
    )
  })
})
