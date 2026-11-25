import { create } from 'zustand'
import type { DebatePortrait } from '@/lib/characters/pluma-debate'

export type DebateStageAgent = { name: string; portrait: DebatePortrait }

/**
 * The debate being heard, for the holograms: who takes part, who is speaking
 * and how loud. Only one debate plays at a time; while it does, Pluma's own
 * card steps aside for the debate's cards.
 */
type DebateStageState = {
  agents: DebateStageAgent[]
  speaking: number | null
  /** The card shown large (double click), if any. */
  large: number | null
  level: () => number
  /** Who owns the stage now, so an old player cannot clear a newer one. */
  owner: symbol | null
  show: (owner: symbol, agents: DebateStageAgent[], level: () => number) => void
  speak: (owner: symbol, speaking: number | null) => void
  hide: (owner: symbol) => void
  toggleLarge: (index: number) => void
}

const silent = () => 0

export const useDebateStage = create<DebateStageState>()((set, get) => ({
  agents: [],
  speaking: null,
  large: null,
  level: silent,
  owner: null,
  show: (owner, agents, level) => set({ owner, agents, level, speaking: null, large: null }),
  speak: (owner, speaking) => { if (get().owner === owner) set({ speaking }) },
  hide: (owner) => { if (get().owner === owner) set({ owner: null, agents: [], speaking: null, large: null, level: silent }) },
  toggleLarge: (index) => set(state => ({ large: state.large === index ? null : index })),
}))
