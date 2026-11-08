import { expect, it } from 'vitest'
import { paramCategories, paramGroups, paramsSettings } from '@/lib/predefinedParams'
import spanish from '@/locales/es/ui-spanish.json'
import english from '@/locales/en/ui-spanish.json'

it('translates every current parameter and group while preserving protocol identifiers', () => {
  for (const locale of [spanish, english]) {
    for (const parameter of Object.values(paramsSettings)) {
      expect(locale.paramTitles).toHaveProperty(parameter.key)
      expect(locale.paramDescriptions).toHaveProperty(parameter.key)
      if (parameter.effectHint) expect(locale.paramHints).toHaveProperty(parameter.key)
    }
    for (const group of paramGroups) {
      expect(locale.groupTitles).toHaveProperty(group.id)
      expect(locale.groupDescriptions).toHaveProperty(group.id)
    }
    for (const category of paramCategories) expect(locale.categories).toHaveProperty(category.id)
  }
})
