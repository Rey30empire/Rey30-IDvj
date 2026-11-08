import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { route } from '@/constants/routes'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { formatBytes } from '@/lib/utils'

export type HubSource = 'huggingFace' | 'wsl'

type WslModel = {
  id: string
  name: string
  sizeBytes: number
  hasProjector: boolean
}

type WslCatalog = {
  root: string
  models: WslModel[]
}

type ResolvedWslModel = {
  path: string
  sizeBytes: number
  projectorPath?: string | null
}

type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; catalog: WslCatalog }
  | { status: 'error'; detail: string }

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : ''
}

async function registrationId(root: string, model: WslModel): Promise<string> {
  const stem = model.name.replace(/\.gguf$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 64) || 'model'
  const identity = new TextEncoder().encode(JSON.stringify([root, model.id]))
  const hash = await crypto.subtle.digest('SHA-256', identity)
  const suffix = Array.from(new Uint8Array(hash, 0, 16), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  return `wsl-${stem}-${suffix}`
}

export function HubSourcePicker({
  source,
  onChange,
}: {
  source: HubSource
  onChange: (source: HubSource) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('hub:catalogSource')}>
      <Button
        type="button"
        size="sm"
        variant={source === 'huggingFace' ? 'default' : 'outline'}
        aria-pressed={source === 'huggingFace'}
        onClick={() => onChange('huggingFace')}
      >
        {t('hub:huggingFaceOnline')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={source === 'wsl' ? 'default' : 'outline'}
        aria-pressed={source === 'wsl'}
        onClick={() => onChange('wsl')}
      >
        {t('hub:wslLocal')}
      </Button>
    </div>
  )
}

export function WslHub() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const navigate = useNavigate()
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: 'loading' })
  const [refresh, setRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const [loadingModel, setLoadingModel] = useState<string>()
  const [loadError, setLoadError] = useState<string>()
  const pendingLoad = useRef<AbortController | null>(null)

  useEffect(() => {
    let active = true
    serviceHub.core().invoke<WslCatalog>('wsl_hub_list')
      .then((catalog) => {
        if (active) setCatalogState({ status: 'ready', catalog })
      })
      .catch((error) => {
        if (active) setCatalogState({ status: 'error', detail: errorDetail(error) })
      })
    return () => { active = false }
  }, [serviceHub, refresh])

  useEffect(() => () => pendingLoad.current?.abort(), [])

  const load = async (root: string, model: WslModel) => {
    if (pendingLoad.current) return
    const controller = new AbortController()
    pendingLoad.current = controller
    setLoadingModel(model.id)
    setLoadError(undefined)
    try {
      const { signal } = controller
      const store = useModelProvider.getState()
      if (store.getProviderByName('llamacpp')?.active === false) {
        throw new Error(t('hub:wslProviderDisabled'))
      }

      const id = await registrationId(root, model)
      if (signal.aborted) return
      const resolved = await serviceHub.core().invoke<ResolvedWslModel>(
        'wsl_hub_resolve_model', { modelId: model.id }
      )
      if (signal.aborted) return

      const models = serviceHub.models()
      const installed = await models.getModel(id)
      if (installed && installed.path !== resolved.path) {
        throw new Error(t('hub:wslRegistrationConflict'))
      }
      if (!installed) {
        const validation = await models.validateGgufFile(resolved.path)
        if (!validation.isValid) {
          throw new Error(validation.error || t('hub:wslInvalidModel'))
        }
        if (signal.aborted) return
        await models.pullModel(
          id, resolved.path, undefined, resolved.sizeBytes, resolved.projectorPath ?? undefined
        )
      }
      if (signal.aborted) return

      let provider = store.getProviderByName('llamacpp')
      let entry = provider?.models.find((item) => item.id === id)
      if (!entry) {
        const providers = await serviceHub.providers().getProviders()
        if (signal.aborted) return
        provider = store.getProviderByName('llamacpp')
        entry = provider?.models.find((item) => item.id === id)
        const refreshed = providers.find((item) => item.provider === 'llamacpp')
        if (!entry && refreshed?.models.some((item) => item.id === id)) {
          store.setProviders([refreshed])
          provider = store.getProviderByName('llamacpp')
          entry = provider?.models.find((item) => item.id === id)
        }
      }
      if (!provider || !entry) throw new Error(t('hub:wslModelUnavailable'))
      if (!provider.active) throw new Error(t('hub:wslProviderDisabled'))

      if (entry.embedding) {
        await navigate({ to: route.settings.providers, params: { providerName: 'llamacpp' } })
      } else {
        await models.startModel(provider, id)
        if (signal.aborted) return
        await navigate({
          to: route.home,
          search: { threadModel: { id, provider: 'llamacpp' } },
        })
      }
    } catch (error) {
      if (!controller.signal.aborted) setLoadError(errorDetail(error) || t('hub:wslModelUnavailable'))
    } finally {
      pendingLoad.current = null
      if (!controller.signal.aborted) setLoadingModel(undefined)
    }
  }

  const catalog = catalogState.status === 'ready' ? catalogState.catalog : undefined
  const query = search.trim().toLowerCase()
  const visibleModels = catalog?.models.filter(
    (model) => !query || model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query)
  ) ?? []

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full flex-col gap-4 md:w-4/5 xl:w-4/6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-52 space-y-1 text-sm text-muted-foreground">
              <p>{t('hub:wslDescription')}</p>
              {catalog && <code className="block break-all">{catalog.root}</code>}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={catalogState.status === 'loading' || Boolean(loadingModel)}
              onClick={() => {
                setCatalogState({ status: 'loading' })
                setLoadError(undefined)
                setRefresh((value) => value + 1)
              }}
            >
              {t('hub:wslRefresh')}
            </Button>
          </div>
          {catalog && catalog.models.length > 0 && (
            <Input
              type="search"
              aria-label={t('hub:wslSearch')}
              placeholder={t('hub:wslSearch')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          {catalogState.status === 'loading' && (
            <p role="status" className="text-sm text-muted-foreground">{t('hub:wslLoading')}</p>
          )}
          {catalogState.status === 'error' && (
            <div role="alert" className="space-y-1 rounded-lg border border-border p-4 text-sm">
              <p className="font-medium">{t('hub:wslListFailed')}</p>
              {catalogState.detail && <p className="break-words text-muted-foreground">{catalogState.detail}</p>}
            </div>
          )}
          {loadError && (
            <div role="alert" className="space-y-1 rounded-lg border border-border p-4 text-sm">
              <p className="font-medium">{t('hub:wslLoadFailed')}</p>
              <p className="break-words text-muted-foreground">{loadError}</p>
            </div>
          )}
          {catalog && visibleModels.length === 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              {t(catalog.models.length ? 'hub:wslNoMatches' : 'hub:wslNoModels')}
            </p>
          )}
          {catalog && visibleModels.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {visibleModels.map((model) => (
                <li key={model.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1 basis-52">
                    <h2 className="break-words text-sm font-medium">{model.name}</h2>
                    <p className="break-words text-xs text-muted-foreground">{model.id}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatBytes(model.sizeBytes)}
                      {model.hasProjector && ` · ${t('hub:wslWithProjector')}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-busy={loadingModel === model.id}
                    disabled={Boolean(loadingModel)}
                    onClick={() => void load(catalog.root, model)}
                  >
                    {t(loadingModel === model.id ? 'hub:wslLoadingModel' : 'hub:wslLoadModel')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
    </div>
  )
}
