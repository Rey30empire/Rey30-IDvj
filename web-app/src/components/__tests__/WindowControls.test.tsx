import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ invoke: vi.fn(), minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(), resized: undefined as (() => void) | undefined, unlisten: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => ({
  minimize: h.minimize, toggleMaximize: h.toggleMaximize, close: h.close, isMaximized: h.isMaximized,
  onResized: (handler: () => void) => { h.resized = handler; return Promise.resolve(h.unlisten) },
  onFocusChanged: () => Promise.resolve(h.unlisten),
}) }))
import { WindowControls } from '../WindowControls'
import { DEFAULT_TITLEBAR_LAYOUT, useTitlebarLayout } from '@/stores/titlebar-layout-store'
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_LINUX', false); h.resized = undefined
  useTitlebarLayout.setState({ layout: DEFAULT_TITLEBAR_LAYOUT })
  h.invoke.mockResolvedValue(DEFAULT_TITLEBAR_LAYOUT); h.isMaximized.mockResolvedValue(false)
  h.minimize.mockResolvedValue(undefined); h.toggleMaximize.mockResolvedValue(undefined); h.close.mockResolvedValue(undefined)
})
describe('controles reales de ventana con comandos nativos sustituidos en pruebas', () => {
  it('renders all three Spanish controls and invokes their original actions', async () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Minimizar' })); fireEvent.click(screen.getByRole('button', { name: 'Maximizar' })); fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('get_titlebar_layout'))
    expect(screen.getAllByRole('button')).toHaveLength(3); expect(h.minimize).toHaveBeenCalledTimes(1); expect(h.toggleMaximize).toHaveBeenCalledTimes(1); expect(h.close).toHaveBeenCalledTimes(1)
  })
  it('updates to Restaurar after the actual maximized state changes', async () => {
    render(<WindowControls />)
    await waitFor(() => expect(h.isMaximized).toHaveBeenCalledTimes(1))
    h.isMaximized.mockResolvedValue(true)
    await act(async () => h.resized?.())
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar' }))
    expect(h.toggleMaximize).toHaveBeenCalledTimes(1); expect(screen.queryByRole('button', { name: 'Maximizar' })).toBeNull()
  })
  it('retains visible controls when native layout lookup fails', async () => {
    h.invoke.mockRejectedValue(new Error('fixture unavailable'))
    render(<WindowControls />)
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeVisible(); expect(screen.getByRole('button', { name: 'Minimizar' })).toBeVisible(); expect(screen.getByRole('button', { name: 'Maximizar' })).toBeVisible()
  })
})
