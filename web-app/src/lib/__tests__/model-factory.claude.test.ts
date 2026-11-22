import { describe, expect, it, vi } from 'vitest'
import { claudeCompatibleBody, claudeCompatibleFetch } from '../model-factory'

describe('peticiones compatibles con los Claude actuales', () => {
  it('quita temperatura y muestreo en los modelos que los rechazan', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2', 'claude-opus-5', 'claude-opus-4-8']) {
      expect(claudeCompatibleBody({ model, temperature: 0.7, top_p: 0.9, top_k: 40, max_tokens: 10 }), model).toEqual({ model, max_tokens: 10 })
    }
  })

  it('deja el muestreo en los modelos que aún lo aceptan', () => {
    const body = { model: 'claude-sonnet-4-6', temperature: 0.7 }
    expect(claudeCompatibleBody(body)).toEqual(body)
  })

  it('no pide apagar el razonamiento a los modelos que siempre razonan', () => {
    expect(claudeCompatibleBody({ model: 'claude-opus-5-5', thinking: { type: 'disabled' } })).toEqual({ model: 'claude-opus-5-5' })
    expect(claudeCompatibleBody({ model: 'claude-opus-5-5', thinking: { type: 'adaptive' } })).toEqual({ model: 'claude-opus-5-5', thinking: { type: 'adaptive' } })
    expect(claudeCompatibleBody({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' } })).toEqual({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' } })
  })

  it('reescribe el cuerpo JSON antes de enviarlo y deja pasar lo demás', async () => {
    const base = vi.fn(async () => new Response('{}'))
    const send = claudeCompatibleFetch(base as unknown as typeof fetch)
    await send('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'claude-opus-5-5', temperature: 1, messages: [] }) })
    expect(JSON.parse((base.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ model: 'claude-opus-5-5', messages: [] })
    await send('https://api.anthropic.com/v1/models', { method: 'GET' })
    expect((base.mock.calls[1] as unknown as [string, RequestInit])[1]).toEqual({ method: 'GET' })
  })
})
