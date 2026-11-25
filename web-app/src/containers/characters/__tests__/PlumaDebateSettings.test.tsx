import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: h.invoke }) }) }))

const { PlumaDebateSettings } = await import('../PlumaDebateSettings')
const { usePlumaDebate } = await import('@/lib/characters/pluma-debate')

const voices = [
  { group: 'Pluma', file: 'Pluma v1.wav', name: 'Pluma v1', bytes: 100 },
  { group: 'Beto', file: 'Veto 1.mpeg', name: 'Veto 1', bytes: 100, convert: true },
]

describe('configuración del debate de Pluma', () => {
  beforeEach(() => {
    usePlumaDebate.getState().reset()
    h.invoke.mockReset()
    h.invoke.mockResolvedValue({ root: 'C:\\Lore', voices, selected: null })
  })

  it('muestra quién debate y el lápiz abre la lista de agentes', async () => {
    render(<PlumaDebateSettings />)
    expect(screen.getByTestId('debate-cast')).toHaveTextContent('Pluma, Crítico · 14 en la lista')
    fireEvent.click(screen.getByRole('button', { name: 'Editar agentes' }))
    const dialog = within(await screen.findByTestId('debate-agents-dialog'))
    expect(dialog.getAllByRole('listitem')).toHaveLength(14)
    expect(dialog.getByRole('checkbox', { name: 'Pluma participa' })).toBeChecked()
    expect(dialog.getByRole('checkbox', { name: 'Luna participa' })).not.toBeChecked()
    expect(h.invoke).toHaveBeenCalledWith('lore_voices', { singing: false })
  })

  it('activa hasta cuatro y edita a cada uno', async () => {
    render(<PlumaDebateSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar agentes' }))
    const dialog = within(await screen.findByTestId('debate-agents-dialog'))
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Luna participa' }))
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Coyote participa' }))
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Lírico participa' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('Ya hay 4 agentes activos')
    expect(dialog.getByRole('checkbox', { name: 'Lírico participa' })).not.toBeChecked()
    // Lore has one man's voice (Beto's) and one woman's (Pluma's own): the second of each shares it.
    expect(dialog.getByRole('status')).toHaveTextContent('Debaten: Pluma, Crítico, Coyote, Luna. Faltan voces en Lore: Coyote, Luna comparten voz.')

    const luna = within(dialog.getByTestId('debate-agent-luna'))
    fireEvent.change(luna.getByRole('textbox', { name: 'Nombre de Luna' }), { target: { value: 'Selene' } })
    fireEvent.change(luna.getByRole('combobox', { name: 'Género de Selene' }), { target: { value: 'mujer' } })
    fireEvent.change(luna.getByRole('textbox', { name: 'Papel de Selene' }), { target: { value: 'defiende al autor' } })
    fireEvent.change(luna.getByRole('combobox', { name: 'Tono de Selene' }), { target: { value: 'alegre' } })
    const voice = luna.getByRole('combobox', { name: 'Voz de Selene' })
    expect(within(voice).getByRole('option', { name: 'Automática (de mujer)' })).toBeInTheDocument()
    await within(voice).findByRole('option', { name: 'Veto 1' })
    fireEvent.change(voice, { target: { value: 'Pluma/Pluma v1.wav' } })
    fireEvent.change(luna.getByRole('combobox', { name: 'Holograma de Selene' }), { target: { value: 'pluma' } })
    expect(usePlumaDebate.getState().agents.find(agent => agent.id === 'luna')).toMatchObject({
      name: 'Selene', gender: 'mujer', role: 'defiende al autor', tone: 'alegre', voice: { group: 'Pluma', file: 'Pluma v1.wav' }, portrait: 'pluma', active: true,
    })
  })

  it('añade y quita agentes, y vuelve a los predeterminados', async () => {
    render(<PlumaDebateSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar agentes' }))
    const dialog = within(await screen.findByTestId('debate-agents-dialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'Añadir agente' }))
    expect(dialog.getAllByRole('listitem')).toHaveLength(15)
    expect(dialog.getByRole('checkbox', { name: 'Agente 15 participa' })).toBeInTheDocument()
    fireEvent.click(within(dialog.getAllByRole('listitem')[14]).getByRole('button', { name: 'Quitar de la lista' }))
    expect(dialog.getAllByRole('listitem')).toHaveLength(14)
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Pluma participa' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Volver a los agentes predeterminados' }))
    expect(dialog.getByRole('checkbox', { name: 'Pluma participa' })).toBeChecked()
  })

  it('el modo debate y la duración se guardan', () => {
    render(<PlumaDebateSettings />)
    const mode = screen.getByRole('checkbox', { name: /Modo debate/ })
    expect(mode).not.toBeChecked()
    fireEvent.click(mode)
    fireEvent.change(screen.getByRole('combobox', { name: 'Duración del debate' }), { target: { value: 'largo' } })
    expect(usePlumaDebate.getState()).toMatchObject({ enabled: true, length: 'largo' })
  })
})
