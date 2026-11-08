import { create } from 'zustand'

export type AvatarVoicePhase = 'idle' | 'ready' | 'listening' | 'waiting' | 'speaking' | 'paused'
type AvatarVoiceSession = {
  open: boolean
  active: boolean
  characterId: string | null
  threadId: string | null
  phase: AvatarVoicePhase
  generation: number
  muted: boolean
  baselineMessageId: string | null
  submittedMessageId: string | null
  spokenMessageId: string | null
  heardText: string
  sawBusy: boolean
  waitingSince: number
  error: string | null
  openFor: (characterId: string, threadId: string | null) => void
  start: () => void
  pause: (error?: string) => void
  close: () => void
  claim: (generation: number, from: AvatarVoicePhase, to: AvatarVoicePhase) => boolean
  adoptThread: (threadId: string) => boolean
  markSubmitted: (generation: number, threadId: string, messageId: string) => boolean
}

// Session authorization stays in memory and survives only the new-chat route handoff.
export const useAvatarVoiceSession = create<AvatarVoiceSession>((set, get) => ({
  open: false, active: false, characterId: null, threadId: null, phase: 'idle', generation: 0,
  muted: false, baselineMessageId: null, submittedMessageId: null, spokenMessageId: null, heardText: '', sawBusy: false,
  waitingSince: 0, error: null,
  openFor: (characterId, threadId) => set(state => ({
    open: true, active: false, characterId, threadId, phase: 'idle', generation: state.generation + 1,
    muted: false, baselineMessageId: null, submittedMessageId: null, spokenMessageId: null, heardText: '', sawBusy: false,
    waitingSince: 0, error: null,
  })),
  start: () => { if (get().open) set(state => ({ active: true, phase: 'ready', error: null, generation: state.generation + 1 })) },
  pause: (error) => set(state => ({ active: false, phase: 'paused', error: error ?? null, generation: state.generation + 1 })),
  close: () => set(state => ({ open: false, active: false, phase: 'idle', characterId: null, threadId: null, submittedMessageId: null, heardText: '', error: null, generation: state.generation + 1 })),
  claim: (generation, from, to) => {
    const state = get()
    if (!state.open || !state.active || state.generation !== generation || state.phase !== from) return false
    set({ phase: to })
    return true
  },
  adoptThread: (threadId) => {
    const state = get()
    if (!state.open || !state.active || state.threadId !== null || state.phase !== 'waiting') return false
    set({ threadId })
    return true
  },
  markSubmitted: (generation, threadId, messageId) => {
    const state = get()
    if (!isPendingVoiceTurn(generation, threadId) || state.submittedMessageId !== null) return false
    set({ submittedMessageId: messageId })
    return true
  },
}))

export function isPendingVoiceTurn(generation: number, threadId: string | null) {
  const state = useAvatarVoiceSession.getState()
  return state.open && state.active && state.phase === 'waiting' &&
    state.generation === generation && state.threadId === threadId
}
