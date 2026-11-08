import type { ReactNode } from 'react'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  render as baseRender,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react'
import '@testing-library/jest-dom'

const render = (ui: ReactNode) =>
  baseRender(
    <TranslationContext.Provider value={{ t: i18n.t, i18n }}>
      {ui}
    </TranslationContext.Provider>
  )

const hoisted = vi.hoisted(() => ({
  providers: [] as any[],
  dialogOpen: vi.fn(),
  pullModel: vi.fn(),
  validateGgufFile: vi.fn(),
  basename: vi.fn((p: string) => p.split('/').pop() || p),
  invoke: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: hoisted.toast }))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (state: { providers: any[] }) => unknown) =>
    selector({ providers: hoisted.providers }),
}))

// Override the global useServiceHub mock from setup.ts with a tailored one.
vi.mock('@/hooks/useServiceHub', () => {
  const hub = {
    dialog: () => ({ open: hoisted.dialogOpen }),
    models: () => ({
      pullModel: hoisted.pullModel,
      validateGgufFile: hoisted.validateGgufFile,
    }),
    path: () => ({ basename: hoisted.basename }),
  }
  return {
    useServiceHub: () => hub,
    getServiceHub: () => hub,
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: hoisted.invoke,
}))

import { ImportLlamacppModelDialog } from '../ImportLlamacppModelDialog'
import LocalModelInstaller from '@/containers/LocalModelInstaller'

const provider = { models: [] } as unknown as any

const openDialog = () => {
  fireEvent.click(screen.getByText('Open'))
}

describe('ImportLlamacppModelDialog', () => {
  beforeEach(() => {
    i18n.changeLanguage('es')
    vi.clearAllMocks()
    hoisted.validateGgufFile.mockResolvedValue({
      isValid: true,
      metadata: { metadata: { 'general.architecture': 'llama' } },
    })
    hoisted.invoke.mockResolvedValue({
      metadata: { 'general.architecture': 'clip' },
    })
  })

  it('renders the trigger and opens the dialog content', () => {
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    expect(screen.getAllByText('Importar modelo').length).toBeGreaterThan(0)
    expect(screen.getByText('Seleccionar archivo GGUF')).toBeInTheDocument()
  })

  it('shows Select Draft GGUF File when the draft model switch is enabled', () => {
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(document.getElementById('draft-model')!)
    expect(
      screen.getByText('Seleccionar archivo GGUF borrador')
    ).toBeInTheDocument()
  })

  it('passes the draft model path through to pullModel', async () => {
    hoisted.dialogOpen
      .mockResolvedValueOnce('/tmp/ok.gguf')
      .mockResolvedValueOnce('/tmp/draft.gguf')
    hoisted.pullModel.mockResolvedValueOnce(undefined)
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF'))
    await waitFor(() => expect(hoisted.validateGgufFile).toHaveBeenCalled())
    fireEvent.click(document.getElementById('draft-model')!)
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF borrador'))
    await waitFor(() =>
      expect(screen.getByText('draft.gguf')).toBeInTheDocument()
    )
    const importBtn = await screen.findByRole('button', {
      name: /Importar modelo/i,
    })
    await waitFor(() => expect(importBtn).not.toBeDisabled())
    fireEvent.click(importBtn)
    await waitFor(() =>
      expect(hoisted.pullModel).toHaveBeenCalledWith(
        'ok.gguf',
        '/tmp/ok.gguf',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '/tmp/draft.gguf'
      )
    )
  })

  it('rejects a draft model whose tokenizer type does not match the main model', async () => {
    hoisted.dialogOpen
      .mockResolvedValueOnce('/tmp/ok.gguf')
      .mockResolvedValueOnce('/tmp/draft.gguf')
    hoisted.validateGgufFile.mockImplementation(async (path: string) => ({
      isValid: true,
      metadata: {
        metadata: {
          'general.architecture': 'llama',
          'tokenizer.ggml.model': path.includes('draft') ? 'bpe' : 'llama',
        },
      },
    }))
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF'))
    await waitFor(() => expect(hoisted.validateGgufFile).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getAllByText('ok.gguf').length).toBeGreaterThan(0)
    )
    fireEvent.click(document.getElementById('draft-model')!)
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF borrador'))
    await waitFor(() =>
      expect(screen.getAllByText('draft.gguf').length).toBeGreaterThan(0)
    )
    await waitFor(() =>
      expect(
        screen.getByText(/no es compatible con el principal/i)
      ).toBeInTheDocument()
    )
  })

  it('accepts a draft model whose architecture name differs but tokenizer matches (MTP assistant heads)', async () => {
    hoisted.dialogOpen
      .mockResolvedValueOnce('/tmp/ok.gguf')
      .mockResolvedValueOnce('/tmp/mtp.gguf')
    hoisted.validateGgufFile.mockImplementation(async (path: string) => ({
      isValid: true,
      metadata: {
        metadata: {
          'general.architecture': path.includes('mtp')
            ? 'gemma4-assistant'
            : 'gemma4',
          'tokenizer.ggml.model': 'llama',
          'tokenizer.ggml.bos_token_id': '2',
          'tokenizer.ggml.eos_token_id': '1',
        },
      },
    }))
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF'))
    await waitFor(() => expect(hoisted.validateGgufFile).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getAllByText('ok.gguf').length).toBeGreaterThan(0)
    )
    fireEvent.click(document.getElementById('draft-model')!)
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF borrador'))
    await waitFor(() =>
      expect(screen.getAllByText('mtp.gguf').length).toBeGreaterThan(0)
    )
    expect(
      screen.queryByText('Error de validación del modelo borrador')
    ).not.toBeInTheDocument()
  })

  it('shows Select MMPROJ File when the vision switch is enabled', () => {
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    const sw = document.getElementById('multimodal')!
    fireEvent.click(sw)
    expect(screen.getByText('Seleccionar archivo MMPROJ')).toBeInTheDocument()
  })

  it('toasts an error when Import is clicked with no model file selected', () => {
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    // The Import button is disabled without a model, so directly invoke handleImport via click.
    // With no modelFile, the button is disabled; assert it's disabled instead.
    const importBtn = screen.getByRole('button', { name: /Importar modelo/i })
    expect(importBtn).toBeDisabled()
  })

  it('selects a model file via the dialog service and validates it', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/model.gguf')
    hoisted.basename.mockReturnValueOnce('model.gguf')
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF'))
    await waitFor(() =>
      expect(hoisted.validateGgufFile).toHaveBeenCalledWith('/tmp/model.gguf')
    )
    // File chip is rendered with the file name
    await waitFor(() =>
      expect(screen.getAllByText('model.gguf').length).toBeGreaterThan(0)
    )
  })

  it('surfaces a validation error when the model is CLIP', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/clip.gguf')
    hoisted.validateGgufFile.mockResolvedValueOnce({
      isValid: true,
      metadata: { metadata: { 'general.architecture': 'clip' } },
    })
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF'))
    await waitFor(() =>
      expect(
        screen.getByText('Error de validación del modelo')
      ).toBeInTheDocument()
    )
  })

  it('rejects importing when the model name already exists in the provider', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/dup.gguf')
    const providerWithModel = {
      models: [{ name: 'dup.gguf' }],
    } as unknown as any
    render(
      <ImportLlamacppModelDialog
        provider={providerWithModel}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF'))
    await waitFor(() => expect(hoisted.validateGgufFile).toHaveBeenCalled())
    const importBtn = await screen.findByRole('button', {
      name: /Importar modelo/i,
    })
    await waitFor(() => expect(importBtn).not.toBeDisabled())
    fireEvent.click(importBtn)
    await waitFor(() =>
      expect(hoisted.toast.error).toHaveBeenCalledWith(
        'El modelo ya existe',
        expect.any(Object)
      )
    )
    expect(hoisted.pullModel).not.toHaveBeenCalled()
  })

  it('imports a regular model successfully via pullModel', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/ok.gguf')
    hoisted.pullModel.mockResolvedValueOnce(undefined)
    const onSuccess = vi.fn()
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
        onSuccess={onSuccess}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF'))
    await waitFor(() => expect(hoisted.validateGgufFile).toHaveBeenCalled())
    const importBtn = await screen.findByRole('button', {
      name: /Importar modelo/i,
    })
    await waitFor(() => expect(importBtn).not.toBeDisabled())
    fireEvent.click(importBtn)
    await waitFor(() =>
      expect(hoisted.pullModel).toHaveBeenCalledWith(
        'ok.gguf',
        '/tmp/ok.gguf',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      )
    )
    await waitFor(() =>
      expect(hoisted.toast.success).toHaveBeenCalledWith(
        'Modelo importado correctamente',
        expect.any(Object)
      )
    )
    expect(onSuccess).toHaveBeenCalledWith('ok.gguf')
  })

  it('toasts a failure when pullModel rejects', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/fail.gguf')
    hoisted.pullModel.mockRejectedValueOnce(new Error('boom'))
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF'))
    await waitFor(() => expect(hoisted.validateGgufFile).toHaveBeenCalled())
    const importBtn = await screen.findByRole('button', {
      name: /Importar modelo/i,
    })
    await waitFor(() => expect(importBtn).not.toBeDisabled())
    fireEvent.click(importBtn)
    await waitFor(() =>
      expect(hoisted.toast.error).toHaveBeenCalledWith(
        'No se pudo importar el modelo',
        expect.any(Object)
      )
    )
  })

  it('renders the MMPROJ file chip after selection', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/mmproj.gguf')
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    // Enable vision mode first
    fireEvent.click(document.getElementById('multimodal')!)
    fireEvent.click(screen.getByText('Seleccionar archivo MMPROJ'))
    await waitFor(() =>
      expect(hoisted.invoke).toHaveBeenCalledWith(
        'plugin:llamacpp|read_gguf_metadata',
        { path: '/tmp/mmproj.gguf' }
      )
    )
    await waitFor(() =>
      expect(screen.getByText('mmproj.gguf')).toBeInTheDocument()
    )
  })

  it('rejects the MMPROJ file when its architecture is not clip', async () => {
    hoisted.dialogOpen.mockResolvedValueOnce('/tmp/bad-mmproj.gguf')
    hoisted.invoke.mockResolvedValueOnce({
      metadata: { 'general.architecture': 'llama' },
    })
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(document.getElementById('multimodal')!)
    fireEvent.click(screen.getByText('Seleccionar archivo MMPROJ'))
    await waitFor(() =>
      expect(screen.getByText('Error de validación MMProj')).toBeInTheDocument()
    )
  })

  it('Cancel button closes the dialog', async () => {
    render(
      <ImportLlamacppModelDialog
        provider={provider}
        trigger={<button>Open</button>}
      />
    )
    openDialog()
    fireEvent.click(screen.getByText('Cancelar'))
    await waitFor(() =>
      expect(screen.queryByText('Importar modelo')).not.toBeInTheDocument()
    )
  })
})

describe('Hub local model installer entry', () => {
  beforeEach(() => {
    i18n.changeLanguage('es')
    vi.clearAllMocks()
    hoisted.providers = []
    hoisted.dialogOpen.mockReset()
    hoisted.pullModel.mockReset().mockResolvedValue(undefined)
    hoisted.validateGgufFile
      .mockReset()
      .mockResolvedValue({
        isValid: true,
        metadata: { metadata: { 'general.architecture': 'llama' } },
      })
    hoisted.invoke
      .mockReset()
      .mockResolvedValue({ metadata: { 'general.architecture': 'llama' } })
  })
  it('disables installation until the current local provider is available', () => {
    render(<LocalModelInstaller />)
    expect(
      screen.getByRole('button', { name: 'Instalar GGUF local' })
    ).toBeDisabled()
    expect(hoisted.dialogOpen).not.toHaveBeenCalled()
  })
  it('opens the real import dialog and registers the selected absolute path', async () => {
    hoisted.providers = [{ provider: 'llamacpp', models: [] }]
    hoisted.dialogOpen.mockResolvedValueOnce('C:/fixtures/qa-owned.gguf')
    render(<LocalModelInstaller />)
    fireEvent.click(screen.getByRole('button', { name: 'Instalar GGUF local' }))
    expect(
      screen.getByRole('heading', { name: 'Instalar modelo GGUF local' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText('Seleccionar archivo GGUF'))
    await waitFor(() =>
      expect(hoisted.validateGgufFile).toHaveBeenCalledWith(
        'C:/fixtures/qa-owned.gguf'
      )
    )
    const confirm = screen.getByRole('button', { name: /Importar modelo/i })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(hoisted.pullModel).toHaveBeenCalledTimes(1))
    expect(hoisted.pullModel.mock.calls[0][1]).toBe('C:/fixtures/qa-owned.gguf')
    expect(
      hoisted.invoke.mock.calls.some((call) =>
        /completion|inference|download|models\/load/.test(call[0])
      )
    ).toBe(false)
  })
})
