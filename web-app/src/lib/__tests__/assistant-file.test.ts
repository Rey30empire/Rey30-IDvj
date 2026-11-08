import { describe, expect, it } from 'vitest'
import { MAX_ASSISTANT_FILE_BYTES, parseAssistantFile } from '../assistant-file'

describe('local assistant files are inspected as data', () => {
  it('reads the exported JSON shape and never carries over its ID', () => {
    const draft = parseAssistantFile('assistant.json', JSON.stringify({ id: 'rey30', name: 'Mi copia', instructions: 'Instrucciones locales', parameters: { temperature: 0.5, stop: ['fin'] } }))
    expect(draft.name).toBe('Mi copia')
    expect(draft).not.toHaveProperty('id')
    expect(draft.warnings.join(' ')).toContain('identificador nuevo')
  })
  it('reads YAML and Markdown frontmatter without executing expressions', () => {
    expect(parseAssistantFile('helper.yml', 'name: Ayuda\ninstructions: |\n  Texto\n  con varias líneas').instructions).toContain('varias líneas')
    const draft = parseAssistantFile('helper.md', '---\nname: Revisor\ndescription: Revisión local\n---\nNo ejecutes `${codigo}`.')
    expect(draft.name).toBe('Revisor')
    expect(draft.instructions).toBe('No ejecutes `${codigo}`.')
    expect(parseAssistantFile('Apuntes.md', '# Instrucciones').name).toBe('Apuntes')
  })
  it.each(['null', '[]', 'true', '{"name":"Vacío"}', '{"name":false,"instructions":"x"}'])('rejects invalid JSON assistant shape %s', text => {
    expect(() => parseAssistantFile('bad.json', text)).toThrow()
  })
  it.each([
    'name: Uno\nname: Dos\ninstructions: texto',
    'name: Ayuda\ninstructions: !custom texto',
    'name: &nombre Ayuda\ninstructions: *nombre',
    'name: Uno\ninstructions: texto\n---\nname: Dos',
  ])('rejects ambiguous YAML, custom tags, aliases and multiple documents', text => {
    expect(() => parseAssistantFile('bad.yaml', text)).toThrow()
  })
  it.each(['tools', 'disallowedTools', 'permissionMode', 'sandbox_mode', 'hooks', 'mcpServers', 'read_only', 'readonly', 'readOnly', 'isolation', 'writable_roots', 'capabilities', 'policy', 'allowedPaths', 'deny', 'restrictions'])('does not discard agent restriction %s and grant classic permissions', key => {
    expect(() => parseAssistantFile('agent.json', JSON.stringify({ name: 'Agente', instructions: 'Texto', [key]: [] }))).toThrow('restricciones')
  })
  it('omits external avatars before review can cause a network request', () => {
    expect(parseAssistantFile('a.json', JSON.stringify({ name: 'A', instructions: 'X', avatar: 'https://example.invalid/pixel' })).avatar).toBeUndefined()
  })
  it('rejects unsupported parameters and oversized inputs', () => {
    expect(() => parseAssistantFile('a.json', '{"name":"A","instructions":"X","parameters":{"__proto__":"x"}}')).toThrow('parámetro')
    expect(() => parseAssistantFile('a.json', JSON.stringify({ name: 'A', instructions: 'X', parameters: { model: { nested: true } } }))).toThrow('parámetro')
    expect(() => parseAssistantFile('a.md', 'x'.repeat(MAX_ASSISTANT_FILE_BYTES + 1))).toThrow('1 MiB')
  })
})
