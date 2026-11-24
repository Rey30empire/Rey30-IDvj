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

  it('elige cuántos participan y configura a cada uno', async () => {
    render(<PlumaDebateSettings />)
    expect(screen.getAllByRole('group')).toHaveLength(2)
    fireEvent.change(screen.getByRole('combobox', { name: 'Participantes del debate' }), { target: { value: '4' } })
    expect(screen.getAllByRole('group')).toHaveLength(4)
    const third = within(screen.getByTestId('debate-agent-3'))
    expect(third.getByRole('textbox', { name: 'Papel del participante 3' })).toHaveAttribute('placeholder', expect.stringMatching(/^Automático: experta/))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del participante 2' }), { target: { value: 'Darío' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Papel del participante 2' }), { target: { value: 'abogado del diablo' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Tono del participante 2' }), { target: { value: 'enojada' } })
    const voice = screen.getByRole('combobox', { name: 'Voz del participante 2' })
    await within(voice).findByRole('option', { name: 'Veto 1' })
    expect(within(voice).getAllByRole('group').map(group => group.getAttribute('label'))).toEqual(['Voces de Pluma', 'Voces de Beto'])
    fireEvent.change(voice, { target: { value: 'Beto/Veto 1.mpeg' } })
    expect(usePlumaDebate.getState()).toMatchObject({ count: 4 })
    expect(usePlumaDebate.getState().agents[1]).toEqual({ name: 'Darío', role: 'abogado del diablo', tone: 'enojada', voice: { group: 'Beto', file: 'Veto 1.mpeg' } })
    expect(h.invoke).toHaveBeenCalledWith('lore_voices', { singing: false })
  })

  it('el modo debate se activa y se desactiva, y todo vuelve a lo predeterminado', () => {
    render(<PlumaDebateSettings />)
    const mode = screen.getByRole('checkbox', { name: /Modo debate/ })
    expect(mode).not.toBeChecked()
    fireEvent.click(mode)
    expect(usePlumaDebate.getState().enabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: 'Duración del debate' }), { target: { value: 'largo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Volver a lo predeterminado' }))
    expect(usePlumaDebate.getState()).toMatchObject({ enabled: false, count: 2, length: 'normal' })
  })
})
