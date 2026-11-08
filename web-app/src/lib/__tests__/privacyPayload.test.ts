import { describe, expect, it } from 'vitest'
import { assertPrivacyTextOnly, hidePrivacyText, redactPrivacyPayload } from '../privacyPayload'

describe('privacy payload', () => {
  it('redacts possible identifiers throughout system/history/options without changing the source', () => {
    const original = { prompt: [{ role: 'system', content: 'Correo ana@example.test C:\\Users\\Fixture\\private.txt' }, { role: 'user', content: [{ type: 'text', text: 'Llama al +1 (555) 123-4567. Clave hf_ABCDEFGHIJKLMN. /home/fixture/private.txt' }] }], providerOptions: { vendor: { metadata: 'ana@example.test' } } }
    const source = JSON.stringify(original)
    const { payload, redactions } = redactPrivacyPayload(original)
    const text = JSON.stringify(payload)
    expect(redactions).toBeGreaterThanOrEqual(6)
    for (const secret of ['ana@example.test', 'Fixture', 'hf_ABCDEFGHIJKLMN', '/home/fixture', '123-4567']) expect(text).not.toContain(secret)
    expect(text).toContain('[CORREO_POSIBLE_1]')
    expect(JSON.stringify(original)).toBe(source)
  })
  it('omits auth/header fields from reviewed body and never traverses abort signals', () => {
    const { payload } = redactPrivacyPayload({ prompt: [], headers: { Authorization: 'fixture-header' }, abortSignal: new AbortController().signal, providerOptions: { custom: { apiKey: 'fixture-key', token: 'fixture-token', thoughtBudget: 10 } } })
    expect(payload).toEqual({ prompt: [], providerOptions: { custom: { thoughtBudget: 10 } } })
  })
  it.each([{ type: 'file', data: 'opaque' }, { type: 'image-url', url: 'https://example.test/image' }, { type: 'input_audio' }, new Uint8Array([1]), new URL('https://example.test/file'), 'data:image/png;base64,AAAA', ' __REY30_VIDEO__AAAA ', ' __REY30_TOOL_IMAGE__data:image/png;base64,AAAA '])('rejects an opaque attachment without silently omitting it (%j)', value => {
    expect(() => assertPrivacyTextOnly({ content: value })).toThrow('adjuntos')
  })
  it('keeps visible text URLs and masks manually in values, never in structural keys', () => {
    expect(() => assertPrivacyTextOnly({ text: 'Consulta https://example.test' })).not.toThrow()
    expect(hidePrivacyText({ instruction: 'Proyecto Fixture', Fixture: ['Fixture'] }, 'Fixture')).toEqual({ instruction: 'Proyecto [OCULTO_MANUAL]', Fixture: ['[OCULTO_MANUAL]'] })
  })
  it('rejects circular/non-textual or oversized data', () => {
    const circular: Record<string, unknown> = {}; circular.self = circular
    expect(() => assertPrivacyTextOnly(circular)).toThrow()
    expect(() => redactPrivacyPayload({ text: 'a'.repeat(4 * 1024 * 1024 + 1) })).toThrow('4 MiB')
  })
})
