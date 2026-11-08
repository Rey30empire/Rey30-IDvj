import { describe, expect, it } from 'vitest'
import { mcpCatalogCategory, mcpCatalogMonogram } from '../mcpCatalog'

describe('catalog display metadata', () => {
  it.each([
    ['Public calendar', '', 'workspaces'],
    ['Remote connector', 'Search a PostgreSQL database', 'data'],
    ['Facturas', 'Pagos de comercio', 'commerce'],
    ['Owned publisher', 'Herramientas de desarrollo de código', 'development'],
    ['Network', 'Social media posts', 'social'],
    ['Imágenes', 'Diseño y música', 'media'],
    ['Unclassified publisher', 'Unspecified actions', 'other'],
  ])(
    'suggests a category from supplied metadata: %s',
    (name, description, expected) => {
      expect(mcpCatalogCategory(name, description)).toBe(expected)
    }
  )

  it('uses actual names for placeholders rather than inventing supplier branding', () => {
    expect(mcpCatalogMonogram('Owned fixture')).toBe('OF')
    expect(mcpCatalogMonogram('io.fixture/catalog')).toBe('IC')
    expect(mcpCatalogMonogram('')).toBe('MC')
  })
})
