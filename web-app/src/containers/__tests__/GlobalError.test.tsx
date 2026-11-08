import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GlobalError from '../GlobalError'
import '@testing-library/jest-dom'
import i18n from '@/i18n/setup'

describe('GlobalError Component', () => {
  beforeEach(() => {
    i18n.changeLanguage('es')
  })

  it('should render error message for Error instance', () => {
    const error = new Error('Test error message')
    render(<GlobalError error={error} />)

    expect(screen.getByText('Se produjo un error inesperado.')).toBeDefined()
    expect(screen.getByText('Test error message')).toBeDefined()
  })

  it('should render error message for non-Error instance', () => {
    const error = 'String error message'
    render(<GlobalError error={error} />)

    expect(screen.getByText('Se produjo un error inesperado.')).toBeDefined()
    expect(screen.getAllByText('String error message')).toHaveLength(2)
  })

  it('should show truncated stack trace initially', () => {
    const error = new Error('Test error')
    error.stack = 'a'.repeat(300)
    render(<GlobalError error={error} />)

    const stackTrace = screen.getByText('a'.repeat(200))
    expect(stackTrace).toBeDefined()
  })

  it('should toggle between truncated and full stack trace', () => {
    const error = new Error('Test error')
    error.stack = 'a'.repeat(300)
    render(<GlobalError error={error} />)

    const showMoreButton = screen.getByText('Mostrar más')
    fireEvent.click(showMoreButton)

    expect(screen.getByText('a'.repeat(300))).toBeDefined()
    expect(screen.getByText('Mostrar menos')).toBeDefined()

    const showLessButton = screen.getByText('Mostrar menos')
    fireEvent.click(showLessButton)

    expect(screen.getByText('a'.repeat(200))).toBeDefined()
    expect(screen.getByText('Mostrar más')).toBeDefined()
  })

  it('should handle refresh page button click', () => {
    const originalLocation = window.location
    const reloadSpy = vi.fn()

    delete (window as any).location
    ;(window as any).location = { ...originalLocation, reload: reloadSpy }

    const error = new Error('Test error')
    render(<GlobalError error={error} />)

    const refreshButton = screen.getByRole('button', { name: 'actualizar esta página' })
    fireEvent.click(refreshButton)

    expect(reloadSpy).toHaveBeenCalledTimes(1)
    ;(window as any).location = originalLocation
  })

  it('shows the local error details without an unrelated support link', () => {
    const error = new Error('Test error')
    render(<GlobalError error={error} />)

    expect(screen.getByText(/Consulta los detalles del error que aparecen debajo\./)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('should log error to console', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('Test error')

    render(<GlobalError error={error} />)

    expect(consoleSpy).toHaveBeenCalledWith('Error in root route:', error)
    consoleSpy.mockRestore()
  })

  it('should render proper error structure with styling', () => {
    const error = new Error('Test error')
    render(<GlobalError error={error} />)

    const errorContainer = screen.getByRole('alert')
    expect(errorContainer).toHaveClass(
      'mt-5',
      'w-full',
      'md:w-4/5',
      'mx-auto',
      'rounded',
      'border',
      'border-red-400',
      'bg-red-100',
      'px-4',
      'py-3',
      'text-red-700'
    )
  })
})
