import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { IconLoader2, IconRefresh } from '@tabler/icons-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAppState } from '@/hooks/useAppState'
import { useLlamacppDevices } from '@/hooks/useLlamacppDevices'
import { cn, formatBytes, formatMegaBytes } from '@/lib/utils'
import {
  ALL_GPUS,
  activationsForGpuChoice,
  currentGpuChoice,
  groupDevices,
  selectedDevice,
} from '@/lib/gpuDevices'
import {
  LocalModelError,
  allowLocalModel,
  describeLocalModelError,
  installedIdFor,
  isModelLoaded,
  loadLocalModel,
  scanLocalModels,
  type LoadStage,
  type LocalModel,
  type LocalModelScan,
} from '@/lib/localModels'

type ScanState =
  | { status: 'scanning' }
  | { status: 'ready'; result: LocalModelScan }
  | { status: 'error'; detail: string }

type Busy = { path: string; stage: LoadStage | 'releasing' }

type LocalModelsDialogProps = {
  /** Opens the dialog when clicked; leave out to control it with `open`. */
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Called after a chat model was loaded on the GPU. */
  onModelLoaded?: (modelId: string) => void
}

const key = (name: string) => `providers:localModels.${name}`

/**
 * "Modelos del PC": lists the GGUF models found on this computer and loads
 * one on the GPU, or releases it, with one click.
 */
export function LocalModelsDialog({
  trigger,
  open: openProp,
  onOpenChange,
  onModelLoaded,
}: LocalModelsDialogProps) {
  const { t } = useTranslation()
  const [ownOpen, setOwnOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const open = openProp ?? ownOpen

  const handleOpenChange = (next: boolean) => {
    // Closing mid-load would hide how it ended; wait for it.
    if (busy && !next) return
    if (openProp === undefined) setOwnOpen(next)
    onOpenChange?.(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(key('title'))}</DialogTitle>
          <DialogDescription>{t(key('description'))}</DialogDescription>
        </DialogHeader>
        <LocalModelsList onBusyChange={setBusy} onModelLoaded={onModelLoaded} />
      </DialogContent>
    </Dialog>
  )
}

/**
 * The dialog's body. Mounted only while the dialog is open, so every opening
 * scans afresh and a closed dialog touches no store.
 */
function LocalModelsList({
  onBusyChange,
  onModelLoaded,
}: {
  onBusyChange: (busy: boolean) => void
  onModelLoaded?: (modelId: string) => void
}) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()

  const providers = useModelProvider((state) => state.providers)
  const setProviders = useModelProvider((state) => state.setProviders)
  const llamacpp = providers.find((provider) => provider.provider === 'llamacpp')
  const activeModels = useAppState((state) => state.activeModels)
  const setActiveModels = useAppState((state) => state.setActiveModels)
  const devices = useLlamacppDevices((state) => state.devices)
  const fetchDevices = useLlamacppDevices((state) => state.fetchDevices)
  const setActivations = useLlamacppDevices((state) => state.setActivations)

  const [scan, setScan] = useState<ScanState>({ status: 'scanning' })
  /** Ids registered while the dialog is open, by file path. */
  const [registered, setRegistered] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Busy | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  /** The GPU picked here, applied on the next load; null keeps the current. */
  const [gpuChoice, setGpuChoice] = useState<string | null>(null)
  const scanRun = useRef(0)

  const invoke = useCallback(
    <T,>(command: string, args?: Record<string, unknown>) =>
      serviceHub.core().invoke<T>(command, args),
    [serviceHub]
  )

  const refreshActiveModels = useCallback(async () => {
    try {
      setActiveModels((await serviceHub.models().getActiveModels('llamacpp')) ?? [])
    } catch (error) {
      console.warn('Could not read the loaded models:', error)
    }
  }, [serviceHub, setActiveModels])

  const runScan = useCallback(async () => {
    const run = ++scanRun.current
    setScan({ status: 'scanning' })
    setRowErrors({})
    try {
      const result = await scanLocalModels(invoke)
      if (run === scanRun.current) setScan({ status: 'ready', result })
    } catch (error) {
      if (run === scanRun.current) {
        setScan({ status: 'error', detail: describeLocalModelError(error) })
      }
    }
  }, [invoke])

  useEffect(() => {
    void runScan()
    void refreshActiveModels()
    if (!IS_MACOS) void fetchDevices()
  }, [runScan, refreshActiveModels, fetchDevices])

  useEffect(() => {
    onBusyChange(busy !== null)
  }, [busy, onBusyChange])

  const groups = useMemo(() => (IS_MACOS ? [] : groupDevices(devices)), [devices])
  const currentChoice = currentGpuChoice(groups)
  const shownChoice = gpuChoice ?? currentChoice
  const gpusOff = groups.length > 0 && shownChoice === ''

  const setRowError = (path: string, message?: string) =>
    setRowErrors((previous) => {
      const next = { ...previous }
      if (message) next[path] = message
      else delete next[path]
      return next
    })

  /** Puts the engine on the GPU picked here, the way Settings > Hardware does. */
  const applyGpuChoice = async () => {
    if (groups.length < 2 || !gpuChoice || gpuChoice === currentChoice) return
    try {
      await setActivations(activationsForGpuChoice(groups, gpuChoice))
      await serviceHub.models().stopAllModels()
    } catch (error) {
      throw new LocalModelError('gpu', describeLocalModelError(error))
    }
    setGpuChoice(null)
    await refreshActiveModels()
  }

  const handleLoad = async (model: LocalModel) => {
    if (busy) return
    setBusy({ path: model.path, stage: 'preparing' })
    setRowError(model.path)
    try {
      await applyGpuChoice()
      const result = await loadLocalModel(
        { ...model, installedModelId: registered[model.path] ?? model.installedModelId },
        useModelProvider.getState().getProviderByName('llamacpp'),
        {
          allow: (path) => allowLocalModel(invoke, path),
          validate: (path) => serviceHub.models().validateGgufFile(path),
          install: (id, path, projectorPath) =>
            serviceHub.models().pullModel(id, path, undefined, undefined, projectorPath),
          refreshProvider: async () => {
            const fresh = await serviceHub.providers().getProviders()
            setProviders(fresh)
            return fresh.find((provider) => provider.provider === 'llamacpp')
          },
          start: (provider, id) => serviceHub.models().startModel(provider, id),
          onStage: (stage) => setBusy({ path: model.path, stage }),
        }
      )
      setRegistered((previous) => ({ ...previous, [model.path]: result.modelId }))
      await refreshActiveModels()
      if (result.embedding) {
        toast.info(t(key('embeddingInstalled'), { name: model.name }))
      } else {
        toast.success(t(key('loadedToast'), { name: model.name }))
        onModelLoaded?.(result.modelId)
      }
    } catch (error) {
      console.error('Could not load the local model:', error)
      setRowError(model.path, describeLocalModelError(error))
      await refreshActiveModels()
    } finally {
      setBusy(null)
    }
  }

  const handleRelease = async (model: LocalModel, modelId: string) => {
    if (busy) return
    setBusy({ path: model.path, stage: 'releasing' })
    setRowError(model.path)
    try {
      const result = await serviceHub.models().stopModel(modelId, 'llamacpp')
      if (result && !result.success) throw new Error(result.error || '')
      toast.success(t(key('releasedToast'), { name: model.name }))
    } catch (error) {
      console.error('Could not release the local model:', error)
      setRowError(model.path, describeLocalModelError(error))
    } finally {
      await refreshActiveModels()
      setBusy(null)
    }
  }

  const result = scan.status === 'ready' ? scan.result : undefined

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-sm text-muted-foreground">
          {scan.status === 'scanning' ? (
            <span className="inline-flex items-center gap-2">
              <IconLoader2 size={16} className="animate-spin" aria-hidden />
              {t(key('scanning'))}
            </span>
          ) : result ? (
            t(key('found'), { count: result.models.length })
          ) : null}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={scan.status === 'scanning' || Boolean(busy)}
          onClick={() => void runScan()}
        >
          <IconRefresh size={16} aria-hidden />
          {t(key('scanAgain'))}
        </Button>
      </div>

      {groups.length > 1 && (
        <fieldset className="space-y-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{t(key('gpuLabel'))}</legend>
          <RadioGroup
            value={shownChoice}
            onValueChange={setGpuChoice}
            disabled={Boolean(busy)}
            className="gap-2"
          >
            {groups.map((group) => {
              const device = selectedDevice(group)
              const id = `local-models-gpu-${group.key}`
              return (
                <div key={group.key} className="flex items-center gap-2">
                  <RadioGroupItem value={group.key} id={id} />
                  <label htmlFor={id} className="text-sm">
                    {group.name}
                    {device.mem > 0 && (
                      <span className="text-muted-foreground">
                        {' · '}
                        {t(key('gpuMemory'), {
                          free: formatMegaBytes(device.free),
                          total: formatMegaBytes(device.mem),
                        })}
                      </span>
                    )}
                  </label>
                </div>
              )
            })}
            <div className="flex items-center gap-2">
              <RadioGroupItem value={ALL_GPUS} id="local-models-gpu-all" />
              <label htmlFor="local-models-gpu-all" className="text-sm">
                {t(key('gpuAll'))}
              </label>
            </div>
          </RadioGroup>
          <p className="text-xs text-muted-foreground">{t(key('gpuNote'))}</p>
        </fieldset>
      )}
      {gpusOff && <p className="text-sm text-muted-foreground">{t(key('gpuOff'))}</p>}

      {scan.status === 'error' && (
        <div
          role="alert"
          className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          <p className="font-medium text-destructive">{t(key('scanFailed'))}</p>
          <p className="break-words text-destructive/90">{scan.detail}</p>
        </div>
      )}

      {result?.truncated && (
        <p className="text-xs text-muted-foreground">{t(key('truncated'))}</p>
      )}

      {result && result.models.length === 0 && (
        <div className="space-y-1 rounded-lg border p-4 text-sm">
          <p className="font-medium">{t(key('empty'))}</p>
          <p className="text-muted-foreground">{t(key('emptyHint'))}</p>
        </div>
      )}

      {result && result.models.length > 0 && (
        <ul className="divide-y rounded-lg border" aria-label={t(key('title'))}>
          {result.models.map((model) => {
            const modelId = registered[model.path] ?? installedIdFor(model, llamacpp)
            const loaded = isModelLoaded(modelId, activeModels)
            const working = busy?.path === model.path
            const error = rowErrors[model.path]
            return (
              <li
                key={model.path}
                data-testid="local-model-row"
                className="flex flex-wrap items-center gap-3 p-3"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="break-words text-sm font-medium">{model.name}</p>
                  <p className="truncate text-xs text-muted-foreground" title={model.path}>
                    {formatBytes(model.sizeBytes)} · {model.folder}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 font-medium',
                        loaded ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'size-2 rounded-full',
                          loaded ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                        )}
                      />
                      {loaded ? t(key('loaded')) : t(key('notLoaded'))}
                    </span>
                    {model.projectorPath && <Tag>{t(key('vision'))}</Tag>}
                    {model.shardCount > 1 && (
                      <Tag>{t(key('parts'), { count: model.shardCount })}</Tag>
                    )}
                    {modelId && <Tag>{t(key('installed'))}</Tag>}
                  </div>
                  {error && (
                    <p role="alert" className="mt-1.5 break-words text-xs text-destructive">
                      {error}
                    </p>
                  )}
                </div>
                {loaded && modelId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-busy={working}
                    disabled={Boolean(busy)}
                    onClick={() => void handleRelease(model, modelId)}
                  >
                    {working ? t(key('releasing')) : t(key('release'))}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    aria-busy={working}
                    disabled={Boolean(busy)}
                    onClick={() => void handleLoad(model)}
                  >
                    {working && <IconLoader2 size={16} className="animate-spin" aria-hidden />}
                    {working
                      ? t(key(busy?.stage === 'preparing' ? 'preparing' : 'loading'))
                      : t(key('load'))}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {result && result.searchedFolders.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">{t(key('searchedIn'))}</summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {result.searchedFolders.map((folder) => (
              <li key={folder} className="break-all">
                {folder}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  )
}
