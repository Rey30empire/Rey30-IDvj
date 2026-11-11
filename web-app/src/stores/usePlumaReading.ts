import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type PlumaReadingBook = { path: string; title: string; total: number }
type PlumaReadingState = {
  /** The book loaded in reading mode. Its text is read again from `path` when needed. */
  book: PlumaReadingBook | null
  /** Where each book was left, in passages, by path. */
  positions: Record<string, number>
  open: (book: PlumaReadingBook) => void
  clear: () => void
  save: (path: string, position: number) => void
}

export const usePlumaReading = create<PlumaReadingState>()(persist((set) => ({
  book: null,
  positions: {},
  open: (book) => set({ book }),
  clear: () => set({ book: null }),
  save: (path, position) => set(state => ({ positions: { ...state.positions, [path]: Math.max(0, Math.floor(position)) } })),
}), {
  name: 'rey30-pluma-reading',
  storage: createJSONStorage(() => localStorage),
  partialize: ({ book, positions }) => ({ book, positions }),
}))
