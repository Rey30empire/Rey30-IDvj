import { beforeEach, describe, expect, it } from 'vitest'
import { useAvatarVoiceSession } from '../useAvatarVoiceSession'

beforeEach(() => useAvatarVoiceSession.getState().close())
describe('autorización efímera de avatar y voz', () => {
  it('opens without authorization and requires explicit start', () => {
    useAvatarVoiceSession.getState().openFor('kairo', null)
    const session = useAvatarVoiceSession.getState()
    expect(session).toMatchObject({ open: true, active: false, phase: 'idle' })
    expect(session.claim(session.generation, 'idle', 'listening')).toBe(false)
    session.start()
    expect(useAvatarVoiceSession.getState()).toMatchObject({ active: true, phase: 'ready' })
  })
  it('claims microphone and playback once and rejects stale generations after pause', () => {
    const store = useAvatarVoiceSession
    store.getState().openFor('nara', 'thread-qa'); store.getState().start()
    const generation = store.getState().generation
    expect(store.getState().claim(generation, 'ready', 'listening')).toBe(true)
    expect(store.getState().claim(generation, 'ready', 'listening')).toBe(false)
    store.getState().pause()
    expect(store.getState().claim(generation, 'listening', 'waiting')).toBe(false)
    store.getState().start()
    expect(store.getState().claim(generation, 'ready', 'listening')).toBe(false)
  })
  it('adopts only one newly created thread while waiting for its first response', () => {
    const store = useAvatarVoiceSession
    store.getState().openFor('beto', null); store.getState().start()
    expect(store.getState().adoptThread('not-yet')).toBe(false)
    store.setState({ phase: 'waiting' })
    expect(store.getState().adoptThread('created-thread-qa')).toBe(true)
    expect(store.getState().adoptThread('different-thread-qa')).toBe(false)
    expect(store.getState().threadId).toBe('created-thread-qa')
  })
  it('clears identity transcript and authorization on exit without persistence', () => {
    const store = useAvatarVoiceSession
    store.getState().openFor('milo', 'thread-qa'); store.getState().start(); store.setState({ heardText: 'Frase temporal.' })
    const generation = store.getState().generation
    store.getState().close()
    expect(store.getState()).toMatchObject({ open: false, active: false, phase: 'idle', characterId: null, threadId: null, heardText: '' })
    expect(store.getState().generation).toBeGreaterThan(generation)
    expect('persist' in store).toBe(false)
  })
})
