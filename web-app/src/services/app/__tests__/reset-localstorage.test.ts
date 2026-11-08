import { describe, it, expect, beforeEach } from 'vitest'
import { pruneLocalStorageByFlags } from '../reset-localstorage'

describe('legacy reset sentinels preserve all webview data', () => {
  beforeEach(() => localStorage.clear())
  it.each([
    { keepAppData: false, keepModelsAndConfigs: false },
    { keepAppData: false, keepModelsAndConfigs: true },
    { keepAppData: true, keepModelsAndConfigs: false },
    { keepAppData: false, keepModelsAndConfigs: false, clearWebData: true },
  ])('ignores destructive legacy flags %j', flags => {
    for (const key of ['model-provider', 'threads', 'messages', 'last-used-model', 'setup-completed', 'setting-general']) localStorage.setItem(key, 'fixture-' + key)
    const before = { ...localStorage }
    pruneLocalStorageByFlags(flags)
    expect({ ...localStorage }).toEqual(before)
  })
})
