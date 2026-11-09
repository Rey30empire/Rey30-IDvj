import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/backendStorage', () => ({ backendStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: vi.fn(async () => null) }) }) }))

import { useWebSearchConfig } from '../useWebSearchConfig'

const migrate = (state: object, version: number) => useWebSearchConfig.persist.getOptions().migrate!(state, version)

describe('búsqueda web', () => {
  it('viene apagada: nada sale del equipo sin que la persona lo pida', () => {
    expect(useWebSearchConfig.getState().webSearchEnabled).toBe(false)
  })

  it('apaga una vez la búsqueda que venía activa de fábrica', () => {
    expect(migrate({ webSearchEnabled: true, searchProvider: 'exa', endpoints: {} }, 0)).toMatchObject({ webSearchEnabled: false, searchProvider: 'exa' })
  })

  it('respeta a quien eligió otro proveedor', () => {
    expect(migrate({ webSearchEnabled: true, searchProvider: 'tavily', endpoints: {} }, 0)).toMatchObject({ webSearchEnabled: true, searchProvider: 'tavily' })
  })

  it('no toca lo guardado después de la migración', () => {
    expect(migrate({ webSearchEnabled: true, searchProvider: 'exa', endpoints: {} }, 1)).toMatchObject({ webSearchEnabled: true })
  })
})
