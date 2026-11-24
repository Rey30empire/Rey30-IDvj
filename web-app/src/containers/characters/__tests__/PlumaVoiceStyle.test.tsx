import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { PlumaVoiceStyleControls } from '../PlumaVoiceStyle'
import { usePlumaVoiceStyle } from '@/lib/characters/pluma-voice-style'

describe('forma de hablar de Pluma', () => {
  beforeEach(() => { usePlumaVoiceStyle.getState().reset() })

  it('elige ánimo, acento, velocidad y tono, y vuelve a lo normal', () => {
    render(<PlumaVoiceStyleControls />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Ánimo de Pluma' }), { target: { value: 'susurro' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Acento de Pluma' }), { target: { value: 'cuba' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Velocidad de Pluma' }), { target: { value: '1.2' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Tono de Pluma' }), { target: { value: '-2' } })
    expect(usePlumaVoiceStyle.getState()).toMatchObject({ emotion: 'susurro', accent: 'cuba', speed: 1.2, pitch: -2 })
    expect(screen.getByText('Tono · -2 semitonos')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Guinea Ecuatorial (África)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Volver a lo normal' }))
    expect(usePlumaVoiceStyle.getState()).toMatchObject({ emotion: 'normal', accent: 'neutro', speed: 1, pitch: 0 })
  })

  it('la voz expresiva viene activada y se puede apagar', () => {
    render(<PlumaVoiceStyleControls />)
    const expressive = screen.getByRole('checkbox', { name: /Voz expresiva \(VoxCPM2\)/ })
    expect(expressive).toBeChecked()
    expect(screen.getByText(/El ánimo se nota mucho; el acento, menos/)).toBeInTheDocument()
    fireEvent.click(expressive)
    expect(usePlumaVoiceStyle.getState().expressive).toBe(false)
    expect(screen.getByText(/Sin la voz expresiva, la voz suena siempre igual/)).toBeInTheDocument()
  })
})
