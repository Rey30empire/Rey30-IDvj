import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../HologramAvatar', async original => ({
  ...(await original<typeof import('../HologramAvatar')>()),
  HologramAvatar: ({ label, size, onToggleSize }: { label: string; size: string; onToggleSize?: () => void }) => <div role="img" aria-label={label} data-size={size} onDoubleClick={onToggleSize} />,
}))

const { DebateHologramDock } = await import('../DebateHologramDock')
const { useDebateStage } = await import('@/stores/useDebateStage')

describe('hologramas del debate', () => {
  afterEach(() => { act(() => useDebateStage.setState({ owner: null, agents: [], speaking: null, large: null })) })

  it('solo aparecen mientras suena un debate, uno por agente y el que habla se nota', () => {
    const { container } = render(<DebateHologramDock />)
    expect(container).toBeEmptyDOMElement()
    const owner = Symbol('prueba')
    act(() => useDebateStage.getState().show(owner, [{ name: 'Pluma', portrait: 'pluma' }, { name: 'Crítico', portrait: 'blaster' }, { name: 'Luna', portrait: 'ninguna' }], () => 0.5))
    expect(screen.getByRole('img', { name: 'Holograma de Pluma' })).toHaveAttribute('data-size', 'corner')
    expect(screen.getByRole('img', { name: 'Holograma de Crítico' })).toBeInTheDocument()
    // Without a face, a plain card.
    expect(screen.getByRole('button', { name: /Holograma de Luna/ })).toBeInTheDocument()
    act(() => useDebateStage.getState().speak(owner, 1))
    expect(screen.getByRole('img', { name: 'Holograma de Crítico · hablando' })).toBeInTheDocument()
    expect(screen.getByTestId('debate-hologram-1')).toHaveAttribute('data-speaking', 'true')
    // Another player cannot clear this one's stage.
    act(() => useDebateStage.getState().hide(Symbol('otro')))
    expect(screen.getByTestId('debate-hologram-dock')).toBeInTheDocument()
    act(() => useDebateStage.getState().hide(owner))
    expect(screen.queryByTestId('debate-hologram-dock')).toBeNull()
  })

  it('doble clic agranda una tarjeta en el área del chat y otro la vuelve pequeña', () => {
    const stage = document.createElement('div')
    stage.id = 'hologram-thread-stage'
    document.body.appendChild(stage)
    try {
      render(<DebateHologramDock />)
      act(() => useDebateStage.getState().show(Symbol('prueba'), [{ name: 'Pluma', portrait: 'pluma' }, { name: 'Crítico', portrait: 'blaster' }], () => 0))
      fireEvent.doubleClick(screen.getByRole('img', { name: 'Holograma de Crítico' }))
      expect(stage.querySelector('[data-testid="debate-hologram-large"]')).not.toBeNull()
      expect(screen.getByRole('img', { name: 'Holograma de Crítico' })).toHaveAttribute('data-size', 'stage')
      fireEvent.doubleClick(screen.getByRole('img', { name: 'Holograma de Crítico' }))
      expect(stage.querySelector('[data-testid="debate-hologram-large"]')).toBeNull()
      expect(screen.getByRole('img', { name: 'Holograma de Crítico' })).toHaveAttribute('data-size', 'corner')
    } finally {
      stage.remove()
    }
  })
})
