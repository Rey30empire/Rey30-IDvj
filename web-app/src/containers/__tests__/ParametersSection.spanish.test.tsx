import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ParametersSection } from '../ParametersSection'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'

it('shows Spanish parameter labels and removes the original protocol identifier', () => {
  const previous = i18n.language
  i18n.language = 'es'
  const remove = vi.fn()
  try {
    render(<TranslationContext.Provider value={{ t: i18n.t, i18n }}>
      <ParametersSection params={{ temperature: 0.8, max_output_tokens: 256 }} providers={[{ provider: 'llamacpp' }]} onToggle={vi.fn()} onChange={vi.fn()} onRemove={remove} />
    </TranslationContext.Provider>)
    expect(screen.getByText('Temperatura')).toBeVisible()
    expect(screen.getByText('Máximo de tokens de salida')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Añadir parámetro' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Temperatura' }))
    expect(remove).toHaveBeenCalledWith('temperature')
  } finally { i18n.language = previous }
})
