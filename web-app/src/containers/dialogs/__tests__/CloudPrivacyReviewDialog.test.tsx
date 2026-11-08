import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CloudPrivacyReviewDialog from '../CloudPrivacyReviewDialog'
import { cancelAllPrivacyReviews, requestPrivacyReview } from '@/lib/privacyReview'
const context = { provider: 'fixture-provider', model: 'fixture-model', endpoint: 'https://example.test/v1', operation: 'generate' as const }
beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => { cancelAllPrivacyReviews(); vi.unstubAllGlobals() })
describe('CloudPrivacyReviewDialog', () => {
  it('shows the real pending payload as text and sends only after manual review', async () => {
    render(<CloudPrivacyReviewDialog />)
    const pending = requestPrivacyReview(context, { prompt: 'Proyecto Fixture <img src=x>' }, 0)
    await screen.findByRole('dialog')
    expect(screen.getByLabelText('Contenido que se enviará').textContent).toContain('Proyecto Fixture <img src=x>')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Texto adicional que quieres ocultar'), { target: { value: 'Fixture' } })
    expect(screen.getByRole('button', { name: 'Enviar esta petición' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar texto' }))
    await waitFor(() => expect(screen.getByLabelText('Contenido que se enviará').textContent).toContain('[OCULTO_MANUAL]'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar esta petición' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Enviar esta petición' }))
    expect((await pending).payload).toEqual({ prompt: 'Proyecto [OCULTO_MANUAL] <img src=x>' })
  })
  it('cancel rejects the operation and removes the in-memory preview', async () => {
    render(<CloudPrivacyReviewDialog />)
    const pending = requestPrivacyReview(context, { prompt: 'fixture' }, 0)
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar envío' }))
    await rejection
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
