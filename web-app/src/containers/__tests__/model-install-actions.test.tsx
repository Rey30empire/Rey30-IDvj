import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ pull: vi.fn(), navigate: vi.fn(), error: vi.fn(), resume: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => ({ models: () => ({ pullModelWithMetadata: h.pull }) }) }))
vi.mock('@/hooks/useGeneralSetting', () => ({ useGeneralSetting: (selector: (value: { huggingfaceToken?: string }) => unknown) => selector({}) }))
vi.mock('@/hooks/useModelProvider', async () => {
  const { create } = await import('zustand')
  return { useModelProvider: create(() => ({ providers: [] as any[] })) }
})
vi.mock('@/hooks/useDownloadStore', async () => {
  const { create } = await import('zustand')
  const store = create<any>((set: any) => ({
    downloads: {}, localDownloadingModels: new Set(), setResumeParams: h.resume,
    addLocalDownloadingModel: (id: string) => set((state: any) => ({ localDownloadingModels: new Set([...state.localDownloadingModels, id]) })),
    removeLocalDownloadingModel: (id: string) => set((state: any) => ({ localDownloadingModels: new Set([...state.localDownloadingModels].filter(value => value !== id)) })),
  }))
  return { useDownloadStore: store }
})
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => h.navigate }))
vi.mock('@/i18n', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'hub:download': 'Download and install', 'hub:downloadModel': 'Download and install model', 'hub:newChat': 'New chat', 'hub:downloadFailed': 'Installation failed' }[key] || key) }) }))
vi.mock('sonner', () => ({ toast: { error: h.error } }))

import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useModelProvider } from '@/hooks/useModelProvider'
import { ModelDownloadAction } from '../ModelDownloadAction'
import { DownloadButtonPlaceholder } from '../DownloadButton'

const id = 'fixture-Q4_K_M'
const path = 'https://example.invalid/owned-fixture.gguf'
const model = { model_name: 'fixture', developer: 'qa', quants: [{ model_id: id, path }], mmproj_models: [] } as any
beforeEach(() => {
  h.pull.mockReset().mockResolvedValue(undefined)
  h.navigate.mockReset()
  h.error.mockReset()
  useModelProvider.setState({ providers: [] })
  useDownloadStore.setState({ downloads: {}, localDownloadingModels: new Set() })
})

it('variant download stays uninstalled at 100% bytes until its provider registers it', async () => {
  h.pull.mockImplementationOnce(() => new Promise(() => {}))
  render(<ModelDownloadAction model={model} variant={{ model_id: id, path }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Download and install model' }))
  expect(h.pull).toHaveBeenCalledWith(id, path, undefined, undefined)
  act(() => useDownloadStore.setState({ downloads: { [id]: { name: id, progress: 1 } as any } }))
  expect(screen.getByText('100%')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument()
  act(() => {
    useDownloadStore.setState({ downloads: {}, localDownloadingModels: new Set() })
    useModelProvider.setState({ providers: [{ provider: 'llamacpp', models: [{ id }] } as any] })
  })
  fireEvent.click(await screen.findByRole('button', { name: 'New chat' }))
  expect(h.navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { threadModel: { id, provider: 'llamacpp' } } }))
})

it('main catalog button reacts to canonical registration and exposes selection without loading', async () => {
  const select = vi.fn()
  render(<DownloadButtonPlaceholder model={model} handleUseModel={select} />)
  fireEvent.click(screen.getByRole('button', { name: /Download and install/ }))
  expect(h.pull.mock.calls[0].slice(0, 2)).toEqual([id, path])
  expect(select).not.toHaveBeenCalled()
  act(() => useModelProvider.setState({ providers: [{ provider: 'llamacpp', models: [{ id }] } as any] }))
  fireEvent.click(await screen.findByRole('button', { name: 'New chat' }))
  expect(select).toHaveBeenCalledWith(id)
})

it('a failed registration never becomes an installed selection', async () => {
  h.pull.mockRejectedValueOnce(new Error('fixture registration failure'))
  render(<ModelDownloadAction model={model} variant={{ model_id: id, path }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Download and install model' }))
  await waitFor(() => expect(h.error).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument()
  expect(useDownloadStore.getState().localDownloadingModels.size).toBe(0)
})
