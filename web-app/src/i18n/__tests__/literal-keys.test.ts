import { expect, it } from 'vitest'
import i18n from '../setup'

it('resolves literal dotted keys without replacing an existing scalar label or normal nested keys', () => {
  const previous = i18n.language
  const namespace = '__literal_key_fixture__'
  i18n.language = 'es'
  i18n.resources.es[namespace] = {
    preview: 'Vista previa',
    'preview.loading': 'Cargando vista previa',
    nested: { title: 'Título anidado' },
  } as unknown as Record<string, string>
  try {
    expect(i18n.t(`${namespace}:preview`)).toBe('Vista previa')
    expect(i18n.t(`${namespace}:preview.loading`)).toBe('Cargando vista previa')
    expect(i18n.t(`${namespace}:nested.title`)).toBe('Título anidado')
  } finally {
    delete i18n.resources.es[namespace]
    i18n.language = previous
  }
})
