import type { ReactNode } from 'react'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  render as baseRender,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import '@testing-library/jest-dom'
import type { LocalModelScan } from '@/lib/localModels'

const render = (ui: ReactNode) =>
  baseRender(
    <TranslationContext.Provider value={{ t: i18n.t, i18n }}>
      {ui}
    </TranslationContext.Provider>
  )

const hoisted = vi.hoisted(() => ({
  loaded: [] as string[],
  calls: [] as string[],
  invoke: vi.fn(),
  getActiveModels: vi.fn(),
  validateGgufFile: vi.fn(),
  pullModel: vi.fn(),
  startModel: vi.fn(),
  stopModel: vi.fn(),
  stopAllModels: vi.fn(),
  getProviders: vi.fn(),
  fetchDevices: vi.fn(),
  setActivations: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: hoisted.toast }))

vi.mock('@/hooks/useServiceHub', () => {
  const hub = {
    core: () => ({ invoke: hoisted.invoke }),
    models: () => ({
      getActiveModels: hoisted.getActiveModels,
      validateGgufFile: hoisted.validateGgufFile,
      pullModel: hoisted.pullModel,
      startModel: hoisted.startModel,
      stopModel: hoisted.stopModel,
      stopAllModels: hoisted.stopAllModels,
    }),
    providers: () => ({ getProviders: hoisted.getProviders }),
  }
  return { useServiceHub: () => hub, getServiceHub: () => hub }
})

vi.mock('@/hooks/useModelProvider', async () => {
  const { create } = await import('zustand')
  type State = {
    providers: ModelProvider[]
    setProviders: (providers: ModelProvider[]) => void
    getProviderByName: (name: string) => ModelProvider | undefined
  }
  return {
    useModelProvider: create<State>()((set, get) => ({
      providers: [],
      setProviders: (providers) => set({ providers }),
      getProviderByName: (name) =>
        get().providers.find((provider) => provider.provider === name),
    })),
  }
})

vi.mock('@/hooks/useAppState', async () => {
  const { create } = await import('zustand')
  type State = {
    activeModels: string[]
    setActiveModels: (models: string[]) => void
  }
  return {
    useAppState: create<State>()((set) => ({
      activeModels: [],
      setActiveModels: (activeModels) => set({ activeModels }),
    })),
  }
})

vi.mock('@/hooks/useLlamacppDevices', async () => {
  const { create } = await import('zustand')
  return {
    useLlamacppDevices: create<Record<string, unknown>>()(() => ({
      devices: [],
      fetchDevices: hoisted.fetchDevices,
      setActivations: hoisted.setActivations,
    })),
  }
})

import { LocalModelsDialog } from '../LocalModelsDialog'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAppState } from '@/hooks/useAppState'
import { useLlamacppDevices } from '@/hooks/useLlamacppDevices'

const GiB = 1024 ** 3
const VISION_PATH = 'C:\\Modelos IA Rey30\\Vision\\gemma-vl.gguf'
const PROJECTOR_PATH = 'C:\\Modelos IA Rey30\\Vision\\mmproj-gemma-vl.gguf'
const QWEN_PATH = 'C:\\Modelos IA Rey30\\Qwen3.5-9B-Q4_K_M\\model.gguf'

const scanResult = (): LocalModelScan => ({
  models: [
    {
      name: 'gemma-vl',
      fileName: 'gemma-vl.gguf',
      path: VISION_PATH,
      folder: 'C:\\Modelos IA Rey30\\Vision',
      sizeBytes: 3 * GiB,
      shardCount: 1,
      projectorPath: PROJECTOR_PATH,
      installedModelId: null,
    },
    {
      name: 'Qwen3.5-9B-Q4_K_M',
      fileName: 'model.gguf',
      path: QWEN_PATH,
      folder: 'C:\\Modelos IA Rey30\\Qwen3.5-9B-Q4_K_M',
      sizeBytes: 6 * GiB,
      shardCount: 1,
      projectorPath: null,
      installedModelId: 'Qwen3.5-9B-Q4_K_M',
    },
  ],
  searchedFolders: ['C:\\Modelos IA Rey30', 'D:\\'],
  truncated: false,
  elapsedMs: 40,
})

const llamacpp = (ids: string[]): ModelProvider =>
  ({
    provider: 'llamacpp',
    active: true,
    settings: [],
    models: ids.map((id) => ({ id, name: id, capabilities: [] })),
  }) as unknown as ModelProvider

const openDialog = async (props: Partial<Parameters<typeof LocalModelsDialog>[0]> = {}) => {
  render(<LocalModelsDialog trigger={<button>Abrir</button>} {...props} />)
  fireEvent.click(screen.getByText('Abrir'))
  await screen.findByText('Modelos encontrados: 2')
}

const row = (name: string) =>
  screen
    .getAllByTestId('local-model-row')
    .find((item) => within(item).queryByText(name)) as HTMLElement

describe('LocalModelsDialog', () => {
  beforeEach(() => {
    i18n.changeLanguage('es')
    vi.clearAllMocks()
    hoisted.loaded = []
    hoisted.calls = []
    useModelProvider.setState({ providers: [llamacpp(['Qwen3.5-9B-Q4_K_M'])] })
    useAppState.setState({ activeModels: [] })
    useLlamacppDevices.setState({ devices: [] })
    hoisted.invoke.mockImplementation(async (command: string, args?: { path: string }) => {
      if (command === 'local_models_scan') return scanResult()
      if (command === 'local_models_allow') {
        return {
          path: args!.path,
          projectorPath: args!.path === VISION_PATH ? PROJECTOR_PATH : null,
        }
      }
      throw new Error(`unexpected ${command}`)
    })
    hoisted.getActiveModels.mockImplementation(async () => [...hoisted.loaded])
    hoisted.validateGgufFile.mockResolvedValue({ isValid: true })
    hoisted.pullModel.mockResolvedValue(undefined)
    hoisted.getProviders.mockResolvedValue([
      llamacpp(['Qwen3.5-9B-Q4_K_M', 'gemma-vl']),
    ])
    hoisted.startModel.mockImplementation(async (_provider: ModelProvider, id: string) => {
      hoisted.calls.push(`start ${id}`)
      hoisted.loaded.push(id)
    })
    hoisted.stopModel.mockImplementation(async (id: string) => {
      hoisted.loaded = hoisted.loaded.filter((item) => item !== id)
      return { success: true }
    })
    hoisted.stopAllModels.mockImplementation(async () => {
      hoisted.calls.push('stopAll')
      hoisted.loaded = []
    })
    hoisted.setActivations.mockImplementation(async (updates: Record<string, boolean>) => {
      hoisted.calls.push(`gpu ${JSON.stringify(updates)}`)
    })
  })

  it('lists what the scan found with size, folder and state', async () => {
    await openDialog()

    expect(hoisted.invoke).toHaveBeenCalledWith('local_models_scan', undefined)
    const vision = row('gemma-vl')
    expect(within(vision).getByText('3.0 GB · C:\\Modelos IA Rey30\\Vision')).toBeInTheDocument()
    expect(within(vision).getByText('Visión')).toBeInTheDocument()
    expect(within(vision).getByText('Sin cargar')).toBeInTheDocument()
    expect(within(vision).queryByText('Instalado')).not.toBeInTheDocument()
    expect(within(vision).getByRole('button', { name: 'Cargar en GPU' })).toBeEnabled()
    expect(within(row('Qwen3.5-9B-Q4_K_M')).getByText('Instalado')).toBeInTheDocument()
    expect(screen.queryByText('GPU donde se carga el modelo')).not.toBeInTheDocument()
  })

  it('registers a new file in place, loads it on the GPU and shows it loaded', async () => {
    const onModelLoaded = vi.fn()
    await openDialog({ onModelLoaded })

    fireEvent.click(within(row('gemma-vl')).getByRole('button', { name: 'Cargar en GPU' }))

    await waitFor(() =>
      expect(within(row('gemma-vl')).getByText('Cargado en la GPU')).toBeInTheDocument()
    )
    expect(hoisted.invoke).toHaveBeenCalledWith('local_models_allow', { path: VISION_PATH })
    expect(hoisted.validateGgufFile).toHaveBeenCalledWith(VISION_PATH)
    expect(hoisted.pullModel).toHaveBeenCalledWith(
      'gemma-vl',
      VISION_PATH,
      undefined,
      undefined,
      PROJECTOR_PATH
    )
    expect(hoisted.startModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'llamacpp' }),
      'gemma-vl'
    )
    expect(within(row('gemma-vl')).getByRole('button', { name: 'Liberar' })).toBeInTheDocument()
    expect(within(row('gemma-vl')).getByText('Instalado')).toBeInTheDocument()
    expect(hoisted.toast.success).toHaveBeenCalledWith('gemma-vl ya está cargado en la GPU.')
    expect(onModelLoaded).toHaveBeenCalledWith('gemma-vl')
  })

  it('loads an installed model without registering it again', async () => {
    await openDialog()

    fireEvent.click(
      within(row('Qwen3.5-9B-Q4_K_M')).getByRole('button', { name: 'Cargar en GPU' })
    )

    await waitFor(() =>
      expect(hoisted.startModel).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'llamacpp' }),
        'Qwen3.5-9B-Q4_K_M'
      )
    )
    expect(hoisted.pullModel).not.toHaveBeenCalled()
    expect(hoisted.invoke).not.toHaveBeenCalledWith('local_models_allow', expect.anything())
  })

  it('releases a loaded model', async () => {
    hoisted.loaded = ['Qwen3.5-9B-Q4_K_M']
    await openDialog()
    const qwen = () => row('Qwen3.5-9B-Q4_K_M')
    await waitFor(() => expect(within(qwen()).getByText('Cargado en la GPU')).toBeInTheDocument())

    fireEvent.click(within(qwen()).getByRole('button', { name: 'Liberar' }))

    await waitFor(() => expect(within(qwen()).getByText('Sin cargar')).toBeInTheDocument())
    expect(hoisted.stopModel).toHaveBeenCalledWith('Qwen3.5-9B-Q4_K_M', 'llamacpp')
    expect(within(qwen()).getByRole('button', { name: 'Cargar en GPU' })).toBeInTheDocument()
    expect(hoisted.toast.success).toHaveBeenCalledWith('Se liberó Qwen3.5-9B-Q4_K_M.')
  })

  it('explains a failed load in plain Spanish next to the model', async () => {
    hoisted.startModel.mockRejectedValueOnce(new Error('CUDA error: out of memory'))
    await openDialog()

    fireEvent.click(
      within(row('Qwen3.5-9B-Q4_K_M')).getByRole('button', { name: 'Cargar en GPU' })
    )

    const alert = await within(row('Qwen3.5-9B-Q4_K_M')).findByRole('alert')
    expect(alert).toHaveTextContent(
      'No hay memoria suficiente en la GPU para este modelo. Libera otros modelos o prueba con uno más pequeño.'
    )
    expect(within(row('Qwen3.5-9B-Q4_K_M')).getByText('Sin cargar')).toBeInTheDocument()
  })

  it('offers a GPU choice only with more than one GPU and applies it before loading', async () => {
    useLlamacppDevices.setState({
      devices: [
        { id: 'CUDA0', name: 'RTX 4090', mem: 24_000, free: 20_000, activated: true },
        { id: 'Vulkan1', name: 'Radeon 780M', mem: 8_000, free: 7_000, activated: false },
      ],
    })
    await openDialog()

    expect(screen.getByText('GPU donde se carga el modelo')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /RTX 4090/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /Radeon 780M/ }))
    fireEvent.click(
      within(row('Qwen3.5-9B-Q4_K_M')).getByRole('button', { name: 'Cargar en GPU' })
    )

    await waitFor(() => expect(hoisted.startModel).toHaveBeenCalled())
    expect(hoisted.calls).toEqual([
      'gpu {"CUDA0":false,"Vulkan1":true}',
      'stopAll',
      'start Qwen3.5-9B-Q4_K_M',
    ])
  })

  it('does not show a GPU choice with a single GPU', async () => {
    useLlamacppDevices.setState({
      devices: [
        { id: 'CUDA0', name: 'RTX 4090', mem: 24_000, free: 20_000, activated: true },
        { id: 'Vulkan0', name: 'RTX 4090', mem: 24_000, free: 20_000, activated: false },
      ],
    })
    await openDialog()

    expect(screen.queryByText('GPU donde se carga el modelo')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('says when nothing was found', async () => {
    hoisted.invoke.mockResolvedValueOnce({
      models: [],
      searchedFolders: ['C:\\Modelos IA Rey30'],
      truncated: true,
      elapsedMs: 5000,
    })
    render(<LocalModelsDialog trigger={<button>Abrir</button>} />)
    fireEvent.click(screen.getByText('Abrir'))

    expect(
      await screen.findByText('No se encontró ningún modelo GGUF en las carpetas habituales.')
    ).toBeInTheDocument()
    expect(screen.getByText(/La búsqueda se detuvo antes de terminar/)).toBeInTheDocument()
  })

  it('shows a scan failure in Spanish', async () => {
    hoisted.invoke.mockRejectedValueOnce('Busca los modelos del PC desde la ventana principal.')
    render(<LocalModelsDialog trigger={<button>Abrir</button>} />)
    fireEvent.click(screen.getByText('Abrir'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se pudo buscar modelos en el PC.')
    expect(alert).toHaveTextContent('Busca los modelos del PC desde la ventana principal.')
  })

  it('stops before loading when llama.cpp is turned off', async () => {
    useModelProvider.setState({
      providers: [{ ...llamacpp(['Qwen3.5-9B-Q4_K_M']), active: false }],
    })
    await openDialog()

    fireEvent.click(
      within(row('Qwen3.5-9B-Q4_K_M')).getByRole('button', { name: 'Cargar en GPU' })
    )

    expect(await within(row('Qwen3.5-9B-Q4_K_M')).findByRole('alert')).toHaveTextContent(
      'El motor local (llama.cpp) está desactivado.'
    )
    expect(hoisted.startModel).not.toHaveBeenCalled()
  })
})
