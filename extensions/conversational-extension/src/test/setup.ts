import { vi } from 'vitest'

// The extension delegates every method to window.core.api.*; a base class is
// the only value-level import it needs from @rey30-idvj/core (the rest are types).
vi.mock('@rey30-idvj/core', () => ({
  ConversationalExtension: class {
    onLoad() {}
    onUnload() {}
  },
}))
