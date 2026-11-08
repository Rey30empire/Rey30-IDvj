import { beforeEach, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render as renderComponent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
const h = vi.hoisted(() => ({
  point: null as null | {
    version: 1
    createdAt: string
    values: Record<string, never>
  },
  before: null as null | {
    version: 1
    createdAt: string
    values: Record<string, never>
  },
  restore: vi.fn(),
  defaults: vi.fn(),
  save: vi.fn(),
}))
vi.mock('@/services/app/preferences-recovery', () => ({
  getPreferencePoint: async (kind: string) =>
    kind === 'before-defaults' ? h.before : h.point,
  savePreferencePoint: async () => {
    h.save()
    h.point = { version: 1, createdAt: '2026-11-04T18:00:00Z', values: {} }
    return h.point
  },
  restorePreferencePoint: (...args: unknown[]) => h.restore(...args),
  applyDefaultPreferences: () => h.defaults(),
  resetPreferences: async () => {
    const target = h.point ? 'saved' : 'defaults'
    await (h.point ? h.restore() : h.defaults())
    h.before = { version: 1, createdAt: '2026-11-04T18:00:00Z', values: {} }
    return target
  },
}))
import { FactoryResetDialog } from '../FactoryResetDialog'

const render = (ui: ReactNode) =>
  renderComponent(ui, {
    wrapper: ({ children }) => (
      <TranslationContext.Provider value={{ t: i18n.t, i18n }}>
        {children}
      </TranslationContext.Provider>
    ),
  })
const closeIcon = () =>
  screen
    .getAllByRole('button', { name: 'Cerrar' })
    .find((button) => button.querySelector('svg'))!
const closeFooter = () =>
  within(
    document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
  ).getByRole('button', { name: 'Cerrar' })

beforeEach(() => {
  i18n.changeLanguage('es')
  h.point = null
  h.before = null
  h.save.mockReset()
  h.restore.mockReset().mockResolvedValue(undefined)
  h.defaults.mockReset().mockResolvedValue(undefined)
})
it('can reset safely without requiring a previously saved point', async () => {
  render(
    <FactoryResetDialog>
      <button>Gestionar</button>
    </FactoryResetDialog>
  )
  fireEvent.click(screen.getByText('Gestionar'))
  await screen.findByText(
    'No hay un punto guardado; se usarán los valores predeterminados en español.'
  )
  const reset = screen.getByRole('button', {
    name: 'Restablecer configuración',
  })
  await waitFor(() => expect(reset).toBeEnabled())
  fireEvent.click(reset)
  await screen.findByText(
    'Configuración restablecida a los valores predeterminados en español. Tus recursos se conservan.'
  )
  expect(h.defaults).toHaveBeenCalledOnce()
  expect(h.restore).not.toHaveBeenCalled()
  expect(
    screen.getByRole('button', { name: 'Deshacer último restablecimiento' })
  ).toBeEnabled()
})
it('exposes a clear saved point and resets to it without destructive operations', async () => {
  render(
    <FactoryResetDialog>
      <button>Gestionar</button>
    </FactoryResetDialog>
  )
  fireEvent.click(screen.getByText('Gestionar'))
  await screen.findByText(
    'No hay un punto guardado; se usarán los valores predeterminados en español.'
  )
  expect(
    screen.getByRole('button', { name: 'Restablecer configuración' })
  ).toBeEnabled()
  expect(
    screen.queryByText(/Eliminar datos|Borrar modelos/)
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Guardar punto de configuración' })
  )
  await screen.findByText(/Punto guardado:/)
  expect(h.save).toHaveBeenCalledTimes(1)
  fireEvent.click(
    screen.getByRole('button', { name: 'Restablecer configuración' })
  )
  await screen.findByText(
    'Configuración restablecida desde el punto guardado. Tus recursos se conservan.'
  )
  expect(h.restore).toHaveBeenCalledTimes(1)
  expect(h.defaults).not.toHaveBeenCalled()
})
it('reports a failed preference restore and keeps the dialog available', async () => {
  h.point = { version: 1, createdAt: '2026-11-04T18:00:00Z', values: {} }
  h.restore.mockRejectedValueOnce(new Error('fixture restore failure'))
  render(
    <FactoryResetDialog>
      <button>Gestionar</button>
    </FactoryResetDialog>
  )
  fireEvent.click(screen.getByText('Gestionar'))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Restablecer configuración' })
    ).toBeEnabled()
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Restablecer configuración' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'fixture restore failure'
  )
  expect(closeFooter()).toBeEnabled()
  fireEvent.click(closeFooter())
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})
it('blocks X and Escape during a pending restore, then allows closing', async () => {
  h.point = { version: 1, createdAt: '2026-11-04T18:00:00Z', values: {} }
  let finish!: () => void
  h.restore.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  render(
    <FactoryResetDialog>
      <button>Gestionar</button>
    </FactoryResetDialog>
  )
  fireEvent.click(screen.getByText('Gestionar'))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Restablecer configuración' })
    ).toBeEnabled()
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Restablecer configuración' })
  )
  await screen.findByText('Restableciendo o guardando configuración…')
  fireEvent.click(closeIcon())
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(closeFooter()).toBeDisabled()
  finish()
  await screen.findByText(
    'Configuración restablecida desde el punto guardado. Tus recursos se conservan.'
  )
  fireEvent.click(closeIcon())
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it('keeps reset available in English and switches its completion message to Spanish defaults', async () => {
  i18n.changeLanguage('en')
  h.defaults.mockImplementationOnce(async () => {
    i18n.changeLanguage('es')
  })
  render(
    <FactoryResetDialog>
      <button>Manage</button>
    </FactoryResetDialog>
  )
  fireEvent.click(screen.getByText('Manage'))
  const reset = await screen.findByRole('button', { name: 'Reset settings' })
  await waitFor(() => expect(reset).toBeEnabled())
  fireEvent.click(reset)
  await screen.findByText(
    'Configuración restablecida a los valores predeterminados en español. Tus recursos se conservan.'
  )
  expect(
    screen.getByRole('button', { name: 'Restablecer configuración' })
  ).toBeEnabled()
})

it('uses the safe Spanish fallback instead of legacy factory-wipe translations in another language', async () => {
  i18n.changeLanguage('fr')
  render(
    <FactoryResetDialog>
      <button>Gestionar</button>
    </FactoryResetDialog>
  )
  fireEvent.click(screen.getByText('Gestionar'))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Restablecer configuración' })
    ).toBeEnabled()
  )
  expect(
    screen.getByText(/Conserva modelos, chats, asistentes, skills/)
  ).toBeInTheDocument()
  expect(
    screen.queryByText(/irréversible|effaçant|supprimant/i)
  ).not.toBeInTheDocument()
})
