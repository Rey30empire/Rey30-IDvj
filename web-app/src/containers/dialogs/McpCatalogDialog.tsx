import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { isPlatformTauri } from '@/lib/platform/utils'
import { normalizeAppError } from '@/utils/appError'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useMcpAuth, needsAuthDetail } from '@/hooks/useMcpAuth'
import { DEFAULT_MCP_SETTINGS, useMCPServers } from '@/hooks/useMCPServers'
import { McpServerAuth } from '@/containers/McpServerAuth'
import McpCatalogBrowser from '@/containers/McpCatalogBrowser'
import type { MCPServerConfig } from '@/hooks/useMCPServers'
import { SystemEvent } from '@/types/events'
import { commitResources, RESOURCE_IMPORT_EVENT } from '@/lib/resourceImport'
import {
  configureMcpCatalog,
  listMcpCatalog,
  OPENCLAW_MCP_TEMPLATE,
  reviewMcpCatalog,
  type CatalogReview,
  type CatalogServer,
} from '@/lib/mcpCatalog'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  presentation?: 'dialog' | 'page'
  onAddCustom?: () => void
  onManageServer?: (name: string) => void
}

export default function McpCatalogDialog({
  open,
  onOpenChange,
  presentation = 'dialog',
  onAddCustom,
  onManageServer,
}: Props) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const service = serviceHub.mcp()
  const desktop = isPlatformTauri()
  const searchId = useId()
  const fieldsId = useId()
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [servers, setServers] = useState<CatalogServer[]>([])
  const [listing, setListing] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [configured, setConfigured] = useState<Record<string, MCPServerConfig>>(
    {}
  )
  const [connected, setConnected] = useState<string[] | null>(null)
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [review, setReview] = useState<CatalogReview | null>(null)
  const [selected, setSelected] = useState('')
  const [installed, setInstalled] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [parameters, setParameters] = useState<Record<string, string>>({})
  const [parametersDirty, setParametersDirty] = useState(false)
  const [credentialsSaved, setCredentialsSaved] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const epoch = useRef(0)
  const catalogEpoch = useRef(0)
  const connectionEpoch = useRef(0)
  const active = useRef(open)
  const auth = useMcpAuth([
    ...new Set([...Object.keys(configured), ...(installed ? [installed] : [])]),
  ])
  const alternative = review?.alternatives.find(
    (item) => item.candidateId === selected
  )
  const candidate = review?.plan.candidates.find((item) => item.id === selected)
  const requirements = alternative?.requirements ?? []
  const openClawReview = review?.server.name === OPENCLAW_MCP_TEMPLATE.name
  const working = busy !== null || Object.values(auth.authorizing).some(Boolean)

  const load = async (nextSearch: string, nextCursor?: string) => {
    const request = ++catalogEpoch.current
    setListing(true)
    setCatalogError(null)
    try {
      const page = await listMcpCatalog(nextSearch, nextCursor)
      if (!active.current || request !== catalogEpoch.current) return
      if (nextCursor && page.nextCursor === nextCursor)
        throw new Error(t('mcp-servers:catalog.cursorError'))
      setServers((current) =>
        nextCursor
          ? [
              ...new Map(
                [...current, ...page.servers].map((item) => [item.name, item])
              ).values(),
            ]
          : page.servers
      )
      setCursor(page.nextCursor)
      setSearch(nextSearch)
    } catch (failure) {
      if (active.current && request === catalogEpoch.current)
        setCatalogError(normalizeAppError(failure))
    } finally {
      if (active.current && request === catalogEpoch.current) setListing(false)
    }
  }

  const loadConnections = async () => {
    const request = ++connectionEpoch.current
    setConnectionsLoading(true)
    setConnectionsError(null)
    const results = await Promise.allSettled([
      service.getMCPConfig(),
      service.getConnectedServers(),
    ])
    if (!active.current || request !== connectionEpoch.current) return
    if (results[0].status === 'fulfilled') {
      setConfigured(results[0].value.mcpServers ?? {})
    } else {
      setConfigured({})
    }
    if (
      results[1].status === 'fulfilled' &&
      Array.isArray(results[1].value) &&
      results[1].value.every((name) => typeof name === 'string')
    ) {
      setConnected(results[1].value)
    } else {
      setConnected(null)
    }
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected')
      setConnectionsError(normalizeAppError(failure.reason))
    else if (
      results[1].status === 'fulfilled' &&
      (!Array.isArray(results[1].value) ||
        !results[1].value.every((name) => typeof name === 'string'))
    )
      setConnectionsError(t('mcp-servers:catalog.browser.unknown'))
    setConnectionsLoading(false)
  }

  useEffect(() => {
    active.current = open
    epoch.current += 1
    catalogEpoch.current += 1
    connectionEpoch.current += 1
    let unlisten: (() => void) | undefined
    let disposed = false
    if (open) {
      setReview(null)
      setSelected('')
      setInstalled(null)
      setValues({})
      setCredentialsSaved(false)
      setMessage(null)
      setError(null)
      setNeedsAuth(false)
      setServers([])
      setCursor(null)
      setQuery('')
      setSearch('')
      setConfigured({})
      setConnected(null)
      setConnectionsError(null)
      setBusy(null)
      if (desktop) {
        void load('')
        void loadConnections()
        void serviceHub
          .events?.()
          .listen(SystemEvent.MCP_UPDATE, () => {
            void loadConnections()
          })
          .then((stop) => {
            if (!disposed) unlisten = stop
            else stop()
          })
          .catch(() => {})
      }
    } else {
      setValues({})
    }
    return () => {
      disposed = true
      active.current = false
      epoch.current += 1
      catalogEpoch.current += 1
      connectionEpoch.current += 1
      unlisten?.()
    }
    // A fresh catalog is requested when opening, not when editing the search field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, desktop])

  const refreshConfig = async () => {
    const config = await service.getMCPConfig()
    useMCPServers.setState((state) => ({
      mcpServers: config.mcpServers ?? {},
      settings: config.mcpSettings
        ? { ...DEFAULT_MCP_SETTINGS, ...config.mcpSettings }
        : state.settings,
    }))
    window.dispatchEvent(new CustomEvent(RESOURCE_IMPORT_EVENT))
    await loadConnections()
    return config
  }

  const inspect = async (
    server: Pick<CatalogServer, 'name' | 'version'>,
    nextParameters: Record<string, string> = {}
  ) => {
    const request = ++epoch.current
    setBusy('review')
    setError(null)
    setMessage(null)
    setInstalled(null)
    setValues({})
    setNeedsAuth(false)
    try {
      const result = await reviewMcpCatalog(
        server.name,
        server.version,
        nextParameters
      )
      if (!active.current || request !== epoch.current) return
      setReview(result)
      setParameters(nextParameters)
      setParametersDirty(false)
      setSelected(result.plan.candidates[0]?.id ?? '')
      setCredentialsSaved(false)
    } catch (failure) {
      if (active.current && request === epoch.current)
        setError(normalizeAppError(failure))
    } finally {
      if (active.current && request === epoch.current) setBusy(null)
    }
  }

  const install = async () => {
    if (!review || !candidate) return
    const request = ++epoch.current
    setBusy('install')
    setError(null)
    try {
      const receipt = await commitResources(review.plan.id, [candidate.id])
      let refreshFailed = false
      try {
        await refreshConfig()
      } catch {
        refreshFailed = true
      }
      if (!active.current || request !== epoch.current) return
      const item = receipt.installed.find((item) => item.kind === 'mcp')
      if (!item)
        throw new Error(
          receipt.errors.join('\n') || t('mcp-servers:catalog.installFailed')
        )
      setInstalled(item.name)
      setValues({})
      setCredentialsSaved(requirements.length === 0)
      setMessage(
        openClawReview
          ? t('mcp-servers:openClaw.saved')
          : t('mcp-servers:catalog.installed', { name: item.name })
      )
      if (receipt.errors.length) setError(receipt.errors.join('\n'))
      else if (refreshFailed) setError(t('mcp-servers:catalog.refreshFailed'))
    } catch (failure) {
      if (active.current && request === epoch.current)
        setError(normalizeAppError(failure))
    } finally {
      if (active.current && request === epoch.current) setBusy(null)
    }
  }

  const saveCredentials = async () => {
    if (!installed) return
    const request = ++epoch.current
    setBusy('credentials')
    setError(null)
    try {
      await configureMcpCatalog(
        installed,
        requirements.map((field) => ({
          field: field.field,
          key: field.key,
          value: values[`${field.field}:${field.key}`] ?? '',
        }))
      )
      if (active.current && request === epoch.current) setValues({})
      await refreshConfig()
      await auth.refresh()
      if (!active.current || request !== epoch.current) return
      setCredentialsSaved(true)
      setMessage(t('mcp-servers:catalog.credentialsSaved'))
    } catch {
      if (active.current && request === epoch.current)
        setError(t('mcp-servers:catalog.credentialsFailed'))
    } finally {
      if (active.current && request === epoch.current) setBusy(null)
    }
  }

  const connect = async (name = installed) => {
    if (!name) return
    const request = ++epoch.current
    setBusy('connect')
    setError(null)
    setNeedsAuth(false)
    let started = false
    try {
      const before = await service.getMCPConfig()
      const config = before.mcpServers?.[name]
      if (!config) throw new Error(t('mcp-servers:catalog.missingServer'))
      await service.activateMCPServer(name, { ...config, active: true })
      started = true
      if (!(await service.getConnectedServers()).includes(name))
        throw new Error(t('mcp-servers:catalog.connectionFailed'))
      const tools = await service.getToolsForServers([name])
      const latest = await service.getMCPConfig()
      const current = latest.mcpServers?.[name]
      if (!current) throw new Error(t('mcp-servers:catalog.missingServer'))
      await service.updateMCPConfig(
        JSON.stringify({
          ...latest,
          mcpServers: {
            ...latest.mcpServers,
            [name]: { ...current, active: true },
          },
        })
      )
      await refreshConfig()
      if (active.current && request === epoch.current)
        setMessage(t('mcp-servers:catalog.connected', { count: tools.length }))
    } catch (failure) {
      let stopFailed = false
      if (started) {
        try {
          await service.deactivateMCPServer(name)
        } catch {
          stopFailed = true
        }
      }
      void loadConnections()
      if (needsAuthDetail(failure) !== null) void auth.refresh()
      if (active.current && request === epoch.current) {
        setNeedsAuth(needsAuthDetail(failure) !== null)
        setError(
          (needsAuthDetail(failure) !== null
            ? t('mcp-servers:catalog.authorizationRequired')
            : normalizeAppError(failure)) +
            (stopFailed ? `\n${t('mcp-servers:catalog.stopFailed')}` : '')
        )
      }
    } finally {
      if (active.current && request === epoch.current) setBusy(null)
    }
  }

  const disconnect = async (name: string) => {
    const request = ++epoch.current
    setBusy('disconnect')
    setError(null)
    setMessage(null)
    try {
      await service.deactivateMCPServer(name)
      const latest = await service.getMCPConfig()
      const current = latest.mcpServers?.[name]
      if (!current) throw new Error(t('mcp-servers:catalog.missingServer'))
      await service.updateMCPConfig(
        JSON.stringify({
          ...latest,
          mcpServers: {
            ...latest.mcpServers,
            [name]: { ...current, active: false },
          },
        })
      )
      await refreshConfig()
      if (active.current && request === epoch.current)
        setMessage(
          t('mcp-servers:catalog.browser.disconnectedMessage', { name })
        )
    } catch (failure) {
      if (active.current && request === epoch.current)
        setError(normalizeAppError(failure))
      void loadConnections()
    } finally {
      if (active.current && request === epoch.current) setBusy(null)
    }
  }

  const authorize = async (name = installed) => {
    if (!name) return
    setError(null)
    try {
      await auth.authorize(name)
      if (active.current) {
        setNeedsAuth(false)
        setMessage(t('mcp-servers:catalog.authorized'))
      }
    } catch (failure) {
      if (active.current) setError(normalizeAppError(failure))
    }
  }

  const content = (
    <div
      className={
        presentation === 'page'
          ? 'space-y-4'
          : 'min-h-0 flex-1 space-y-4 overflow-y-auto pr-1'
      }
    >
      {!desktop ? (
        <p>{t('mcp-servers:catalog.desktopOnly')}</p>
      ) : (
        <>
          {error && (
            <p
              role="alert"
              className="whitespace-pre-wrap break-words text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              {t(`mcp-servers:catalog.busy.${busy}`)}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          {!review && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <h2 className="text-sm font-medium">OpenClaw</h2>
                <p className="text-sm text-muted-foreground">
                  {t('mcp-servers:openClaw.description')}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={working}
                onClick={() => void inspect(OPENCLAW_MCP_TEMPLATE)}
              >
                {t('mcp-servers:openClaw.review')}
              </Button>
            </div>
          )}
          {review ? (
            <section data-testid="mcp-catalog-review" className="space-y-3">
              <div>
                <h2 className="font-medium">{review.server.title}</h2>
                <p className="break-all text-xs text-muted-foreground">
                  {openClawReview
                    ? t('mcp-servers:openClaw.localBridge')
                    : `${review.server.name} · ${review.server.version}`}
                </p>
                <p className="mt-2 text-sm">{review.server.description}</p>
                {openClawReview && (
                  <a
                    href="https://docs.openclaw.ai/install"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block rounded-sm text-sm text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {t('mcp-servers:openClaw.installGuide')}
                  </a>
                )}
              </div>
              {review.parameters.length > 0 && !installed && (
                <form
                  className="space-y-3 rounded-md border p-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void inspect(review.server, parameters)
                  }}
                >
                  <p className="text-sm">
                    {t('mcp-servers:catalog.publicParameters')}
                  </p>
                  {review.parameters.map((parameter, index) => (
                    <div key={parameter.id} className="space-y-1">
                      <label
                        htmlFor={`${fieldsId}-parameter-${index}`}
                        className="text-sm font-medium"
                      >
                        {parameter.label}
                      </label>
                      <Input
                        id={`${fieldsId}-parameter-${index}`}
                        disabled={working}
                        maxLength={1024}
                        value={
                          parameters[parameter.id] ?? parameter.defaultValue
                        }
                        onChange={(event) => {
                          setParametersDirty(true)
                          setParameters((current) => ({
                            ...current,
                            [parameter.id]: event.target.value,
                          }))
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {parameter.description}
                        {parameter.choices.length
                          ? ` (${parameter.choices.join(', ')})`
                          : ''}
                      </p>
                    </div>
                  ))}
                  <Button type="submit" variant="outline" disabled={working}>
                    {t('mcp-servers:catalog.updateReview')}
                  </Button>
                </form>
              )}
              {review.plan.warnings.map((warning, index) => (
                <p key={index} className="text-sm text-muted-foreground">
                  {warning}
                </p>
              ))}
              {review.plan.candidates.length === 0 && (
                <p>{t('mcp-servers:catalog.manualOnly')}</p>
              )}
              <fieldset
                className="space-y-3"
                disabled={working || Boolean(installed)}
              >
                <legend className="mb-2 text-sm font-medium">
                  {t('mcp-servers:catalog.alternative')}
                </legend>
                {review.plan.candidates.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md border p-3"
                  >
                    <input
                      className="mt-1"
                      type="radio"
                      name={`${fieldsId}-alternative`}
                      checked={item.id === selected}
                      onChange={() => {
                        setSelected(item.id)
                        setValues({})
                      }}
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{item.name}</span>
                      <span className="mt-1 block text-sm">
                        {item.description}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {candidate && (
                <>
                  <pre
                    aria-label={t('mcp-servers:catalog.preview')}
                    className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-secondary p-3 text-xs"
                  >
                    {candidate.preview}
                  </pre>
                  {candidate.warnings.map((warning, index) => (
                    <p key={index} className="text-sm text-muted-foreground">
                      {warning}
                    </p>
                  ))}
                </>
              )}
              {!installed && candidate && (
                <Button
                  data-testid="mcp-catalog-install"
                  disabled={
                    working ||
                    parametersDirty ||
                    !candidate.importable ||
                    candidate.conflict
                  }
                  onClick={() => void install()}
                >
                  {openClawReview
                    ? t('mcp-servers:openClaw.save')
                    : t('mcp-servers:catalog.install')}
                </Button>
              )}
              {!installed && candidate?.conflict && (
                <p className="text-sm text-muted-foreground">
                  {t('mcp-servers:catalog.browser.existingConflict')}
                </p>
              )}
              {installed && (
                <div
                  className="space-y-3 rounded-md border p-3"
                  data-testid="mcp-catalog-installed"
                >
                  <p className="text-sm font-medium">
                    {t(openClawReview
                      ? 'mcp-servers:openClaw.finishConnection'
                      : 'mcp-servers:catalog.finishConnection')}
                  </p>
                  {requirements.length > 0 && !credentialsSaved && (
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void saveCredentials()
                      }}
                    >
                      <p className="text-sm text-muted-foreground">
                        {t('mcp-servers:catalog.secretStorage')}
                      </p>
                      {requirements.map((field, index) => (
                        <div
                          key={`${field.field}:${field.key}`}
                          className="space-y-1"
                        >
                          <label
                            htmlFor={`${fieldsId}-${index}`}
                            className="text-sm font-medium"
                          >
                            {field.key}
                            {field.required ? ' *' : ''}
                          </label>
                          <Input
                            id={`${fieldsId}-${index}`}
                            type={field.secret ? 'password' : 'text'}
                            autoComplete="off"
                            required={field.required}
                            maxLength={16384}
                            disabled={working}
                            value={values[`${field.field}:${field.key}`] ?? ''}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [`${field.field}:${field.key}`]:
                                  event.target.value,
                              }))
                            }
                          />
                          {field.description && (
                            <p className="text-xs text-muted-foreground">
                              {field.description}
                            </p>
                          )}
                        </div>
                      ))}
                      <Button
                        type="submit"
                        variant="outline"
                        disabled={working}
                      >
                        {t('mcp-servers:catalog.saveCredentials')}
                      </Button>
                    </form>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t(openClawReview
                      ? 'mcp-servers:openClaw.connectionHint'
                      : 'mcp-servers:catalog.providerConsent')}
                  </p>
                  <Button
                    data-testid="mcp-catalog-connect"
                    disabled={working || !credentialsSaved}
                    onClick={() => void connect()}
                  >
                    {t('mcp-servers:catalog.connect')}
                  </Button>
                  {(needsAuth || alternative?.remote) && (
                    <McpServerAuth
                      status={auth.statuses[installed]}
                      authorizing={Boolean(auth.authorizing[installed])}
                      consentUrl={auth.consentUrls[installed]}
                      onAuthorize={() => void authorize()}
                      onClearAuth={() => {
                        void auth
                          .clearAuth(installed)
                          .catch(() =>
                            setError(t('mcp-servers:catalog.clearFailed'))
                          )
                      }}
                    />
                  )}
                </div>
              )}
              <Button
                variant="outline"
                disabled={working}
                onClick={() => {
                  setReview(null)
                  setInstalled(null)
                  setMessage(null)
                  setValues({})
                  setError(null)
                }}
              >
                {t('mcp-servers:catalog.backToList')}
              </Button>
            </section>
          ) : (
            <McpCatalogBrowser
              servers={servers}
              query={query}
              onQueryChange={setQuery}
              onSearch={() => void load(query.trim())}
              onReview={(server) => void inspect(server)}
              onLoadMore={() => {
                if (cursor) void load(search, cursor)
              }}
              hasMore={Boolean(cursor)}
              listing={listing}
              catalogError={catalogError}
              configured={configured}
              connected={connected}
              connectionsLoading={connectionsLoading}
              connectionsError={connectionsError}
              onRefreshConnections={() => void loadConnections()}
              onConnect={(name) => void connect(name)}
              onDisconnect={(name) => void disconnect(name)}
              onManage={onManageServer}
              onAuthorize={(name) => void authorize(name)}
              onClearAuth={(name) => {
                void auth
                  .clearAuth(name)
                  .then(() => loadConnections())
                  .catch(() => setError(t('mcp-servers:catalog.clearFailed')))
              }}
              auth={auth}
              working={working}
              searchId={searchId}
            />
          )}
        </>
      )}
    </div>
  )

  if (presentation === 'page')
    return (
      <section className="space-y-5" data-testid="mcp-catalog-page">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">
              {t('mcp-servers:catalog.title')}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('mcp-servers:catalog.browser.description')}
            </p>
          </div>
          {onAddCustom && (
            <Button variant="outline" disabled={working} onClick={onAddCustom}>
              <Plus className="size-4" aria-hidden="true" />
              {t('mcp-servers:catalog.browser.addCustom')}
            </Button>
          )}
        </div>
        {content}
      </section>
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="mcp-catalog-dialog"
        className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-[min(76rem,calc(100vw-2rem))]"
      >
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>{t('mcp-servers:catalog.title')}</DialogTitle>
          <DialogDescription>
            {t('mcp-servers:catalog.browser.description')}
          </DialogDescription>
        </DialogHeader>
        {content}
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
