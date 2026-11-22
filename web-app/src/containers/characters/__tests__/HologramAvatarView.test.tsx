import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HologramAvatar, HOLOGRAM_PORTRAITS } from '../HologramAvatar'

const props = { portrait: HOLOGRAM_PORTRAITS.literatura, state: 'idle' as const, level: 0, color: '#5ce1e6', label: 'Holograma de Pluma' }

describe('recuadro del holograma', () => {
  it('doble clic o el teclado cambian su tamaño', () => {
    const toggle = vi.fn()
    render(<HologramAvatar {...props} size="stage" onToggleSize={toggle} toggleHint="hacerlo pequeño" />)
    const box = screen.getByRole('button', { name: 'Holograma de Pluma. Doble clic para hacerlo pequeño' })
    fireEvent.doubleClick(box)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(toggle).toHaveBeenCalledTimes(2)
  })

  it('sin quien lo cambie es solo una imagen, y nunca tapa todo el editor', () => {
    render(<HologramAvatar {...props} size="corner" />)
    expect(screen.queryByRole('button')).toBeNull()
    fireEvent.doubleClick(screen.getByTestId('hologram-avatar'))
    expect(document.querySelector('[data-testid="hologram-enlarged"]')).toBeNull()
  })

  it('el grande dibuja con más resolución', () => {
    const { unmount } = render(<HologramAvatar {...props} size="stage" />)
    expect(screen.getByTestId('hologram-avatar')).toHaveAttribute('width', '720')
    unmount()
    render(<HologramAvatar {...props} size="call" />)
    expect(screen.getByTestId('hologram-avatar')).toHaveAttribute('width', '480')
  })
})
