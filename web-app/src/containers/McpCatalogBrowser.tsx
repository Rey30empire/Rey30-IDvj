import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Unplug,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { McpServerAuth } from '@/containers/McpServerAuth'
import type { useMcpAuth } from '@/hooks/useMcpAuth'
import type { MCPServerConfig } from '@/hooks/useMCPServers'
import {
  MCP_CATALOG_CATEGORIES,
  mcpCatalogCategory,
  mcpCatalogMonogram,
  type CatalogServer,
  type McpCatalogCategory,
} from '@/lib/mcpCatalog'

type Props = {
  servers: CatalogServer[]
  query: string
  onQueryChange: (query: string) => void
  onSearch: () => void
  onReview: (server: CatalogServer) => void
  onLoadMore: () => void
  hasMore: boolean
  listing: boolean
  catalogError: string | null
  configured: Record<string, MCPServerConfig>
  connected: string[] | null
  connectionsLoading: boolean
  connectionsError: string | null
  onRefreshConnections: () => void
  onConnect: (name: string) => void
  onDisconnect: (name: string) => void
  onManage?: (name: string) => void
  onAuthorize: (name: string) => void
  onClearAuth: (name: string) => void
  auth: ReturnType<typeof useMcpAuth>
  working: boolean
  searchId: string
}

export default function McpCatalogBrowser(props: Props) {
  const { t } = useTranslation()
  const [view, setView] = useState<'discover' | 'connected'>('discover')
  const [category, setCategory] = useState<McpCatalogCategory | 'all'>('all')
  const saved = useMemo(
    () =>
      Object.entries(props.configured).map(([name, config]) => ({
        name,
        config,
        category: mcpCatalogCategory(
          name,
          [config.description, ...(config.capabilities ?? [])]
            .filter(Boolean)
            .join(' ')
        ),
      })),
    [props.configured]
  )
  const availableCategories = new Set(
    view === 'discover'
      ? props.servers.map((server) =>
          mcpCatalogCategory(server.title || server.name, server.description)
        )
      : saved.map((server) => server.category)
  )
  const selectedCategory =
    category === 'all' || availableCategories.has(category) ? category : 'all'
  const groups = MCP_CATALOG_CATEGORIES.filter(
    (id) =>
      availableCategories.has(id) &&
      (selectedCategory === 'all' || selectedCategory === id)
  )
  const query = props.query.trim().toLocaleLowerCase()
  const visibleSaved = saved.filter(
    (server) =>
      (selectedCategory === 'all' || server.category === selectedCategory) &&
      (!query ||
        `${server.name} ${server.config.description ?? ''}`
          .toLocaleLowerCase()
          .includes(query))
  )
  const connectedCount = props.connected?.filter(
    (name) => name in props.configured
  ).length
  const cardClass =
    'flex h-full min-w-0 flex-col gap-3 rounded-xl border bg-background p-4'

  const renderSaved = (server: (typeof saved)[number]) => {
    const connected = props.connected?.includes(server.name)
    return (
      <li key={server.name}>
        <article
          className={cardClass}
          data-testid="mcp-saved-card"
          data-server-name={server.name}
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-semibold"
            >
              {mcpCatalogMonogram(server.name)}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="break-words font-medium">{server.name}</h3>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                {connected ? (
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                ) : (
                  <Unplug className="size-3.5" aria-hidden="true" />
                )}
                {t(
                  props.connected === null
                    ? 'mcp-servers:catalog.browser.unknown'
                    : connected
                      ? 'mcp-servers:catalog.browser.connected'
                      : 'mcp-servers:catalog.browser.disconnected'
                )}
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {server.config.description ||
              t(
                server.config.type === 'http' || server.config.type === 'sse'
                  ? 'mcp-servers:catalog.browser.remote'
                  : 'mcp-servers:catalog.browser.local'
              )}
          </p>
          <McpServerAuth
            status={props.auth.statuses[server.name]}
            authorizing={Boolean(props.auth.authorizing[server.name])}
            consentUrl={props.auth.consentUrls[server.name]}
            onAuthorize={() => props.onAuthorize(server.name)}
            onClearAuth={() => props.onClearAuth(server.name)}
          />
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant={connected ? 'outline' : 'default'}
              disabled={
                props.working ||
                props.connected === null ||
                props.connectionsLoading
              }
              onClick={() =>
                connected
                  ? props.onDisconnect(server.name)
                  : props.onConnect(server.name)
              }
            >
              {t(
                connected
                  ? 'mcp-servers:catalog.browser.disconnect'
                  : 'mcp-servers:catalog.browser.connect'
              )}
            </Button>
            {props.onManage && (
              <Button
                size="sm"
                variant="ghost"
                disabled={props.working}
                onClick={() => props.onManage?.(server.name)}
              >
                {t('mcp-servers:catalog.browser.manage')}
              </Button>
            )}
          </div>
        </article>
      </li>
    )
  }

  return (
    <div className="space-y-6" data-testid="mcp-catalog-browser">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (
            view === 'discover' &&
            !props.listing &&
            !props.working &&
            (!query || query.length >= 3)
          ) {
            setCategory('all')
            props.onSearch()
          }
        }}
      >
        <label className="sr-only" htmlFor={props.searchId}>
          {t('mcp-servers:catalog.searchLabel')}
        </label>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-48 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={props.searchId}
              data-testid="mcp-catalog-search"
              className="pl-9"
              placeholder={t('mcp-servers:catalog.browser.searchPlaceholder')}
              value={props.query}
              maxLength={256}
              onChange={(event) => props.onQueryChange(event.target.value)}
              disabled={props.working}
            />
          </div>
          {view === 'discover' && (
            <Button
              type="submit"
              variant="outline"
              disabled={
                props.working ||
                props.listing ||
                (query.length > 0 && query.length < 3)
              }
            >
              {t('mcp-servers:catalog.search')}
            </Button>
          )}
        </div>
        {view === 'discover' && (
          <p className="text-xs text-muted-foreground">
            {t('mcp-servers:catalog.searchHint')}
          </p>
        )}
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label={t('mcp-servers:catalog.browser.views')}
          className="flex gap-2"
        >
          <Button
            type="button"
            size="sm"
            variant={view === 'discover' ? 'secondary' : 'ghost'}
            className="rounded-full"
            aria-pressed={view === 'discover'}
            disabled={props.working}
            onClick={() => {
              setView('discover')
              setCategory('all')
            }}
          >
            {t('mcp-servers:catalog.browser.discover')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'connected' ? 'secondary' : 'ghost'}
            className="rounded-full"
            aria-pressed={view === 'connected'}
            disabled={props.working}
            onClick={() => {
              setView('connected')
              setCategory('all')
              props.onRefreshConnections()
            }}
          >
            {t('mcp-servers:catalog.browser.connections')}
            {connectedCount !== undefined && (
              <span className="text-muted-foreground">{connectedCount}</span>
            )}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">
            {t('mcp-servers:catalog.browser.category')}
          </span>
          <select
            className="max-w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            value={selectedCategory}
            onChange={(event) =>
              setCategory(event.target.value as McpCatalogCategory | 'all')
            }
            disabled={props.working}
          >
            <option value="all">
              {t('mcp-servers:catalog.browser.allCategories')}
            </option>
            {MCP_CATALOG_CATEGORIES.filter((id) =>
              availableCategories.has(id)
            ).map((id) => (
              <option key={id} value={id}>
                {t(`mcp-servers:catalog.browser.categories.${id}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {view === 'discover' ? (
        <div className="space-y-6">
          {props.catalogError && (
            <div role="alert" className="space-y-2 text-sm">
              <p className="text-destructive whitespace-pre-wrap break-words">
                {props.catalogError}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={props.onSearch}
                disabled={
                  props.working ||
                  props.listing ||
                  (query.length > 0 && query.length < 3)
                }
              >
                {t('mcp-servers:catalog.browser.retry')}
              </Button>
            </div>
          )}
          {props.listing && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              {t('mcp-servers:catalog.busy.list')}
            </p>
          )}
          {!props.listing &&
            !props.catalogError &&
            props.servers.length === 0 && (
              <p className="py-6 text-sm text-muted-foreground">
                {t('mcp-servers:catalog.empty')}
              </p>
            )}
          {groups.map((id) => (
            <section
              key={id}
              aria-label={t(`mcp-servers:catalog.browser.categories.${id}`)}
              className="space-y-3"
            >
              <h2 className="text-base font-medium">
                {t(`mcp-servers:catalog.browser.categories.${id}`)}
              </h2>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {props.servers
                  .filter(
                    (server) =>
                      mcpCatalogCategory(
                        server.title || server.name,
                        server.description
                      ) === id
                  )
                  .map((server) => (
                    <li key={server.name}>
                      <article
                        className={cardClass}
                        data-testid="mcp-registry-card"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            aria-hidden="true"
                            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-semibold"
                          >
                            {mcpCatalogMonogram(server.title || server.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <h3 className="break-words font-medium">
                              {server.title || server.name}
                            </h3>
                            <p className="mt-1 break-all text-xs text-muted-foreground">
                              {server.name}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="outline"
                            aria-label={t(
                              'mcp-servers:catalog.browser.reviewServer',
                              { name: server.title || server.name }
                            )}
                            title={t('mcp-servers:catalog.review')}
                            disabled={props.working}
                            onClick={() => props.onReview(server)}
                          >
                            <Plus aria-hidden="true" className="size-4" />
                          </Button>
                        </div>
                        <p className="line-clamp-3 text-sm text-muted-foreground">
                          {server.description}
                        </p>
                        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
                          <span>v{server.version}</span>
                          {[
                            ...new Set([
                              ...server.transports,
                              ...server.packages,
                            ]),
                          ].map((value) => (
                            <span key={value}>{value}</span>
                          ))}
                        </div>
                      </article>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          {props.servers.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('mcp-servers:catalog.browser.categoryHint', {
                count: props.servers.length,
              })}
            </p>
          )}
          {props.hasMore && (
            <Button
              variant="outline"
              onClick={props.onLoadMore}
              disabled={props.working || props.listing}
            >
              {t('mcp-servers:catalog.loadMore')}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {t('mcp-servers:catalog.browser.connectionHint')}
            </p>
            <Button
              size="sm"
              variant="ghost"
              disabled={props.connectionsLoading || props.working}
              onClick={props.onRefreshConnections}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              {t('mcp-servers:catalog.browser.refresh')}
            </Button>
          </div>
          {props.connectionsLoading && (
            <p role="status" className="text-sm">
              {t('mcp-servers:catalog.browser.checking')}
            </p>
          )}
          {props.connectionsError && (
            <p role="alert" className="text-sm text-destructive">
              {props.connectionsError}
            </p>
          )}
          {visibleSaved.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">
              {t(
                saved.length
                  ? 'mcp-servers:catalog.browser.noSavedMatch'
                  : 'mcp-servers:catalog.browser.noConnections'
              )}
            </p>
          )}
          {visibleSaved.some((server) =>
            props.connected?.includes(server.name)
          ) && (
            <section className="space-y-3">
              <h2 className="font-medium">
                {t('mcp-servers:catalog.browser.connected')}
              </h2>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleSaved
                  .filter((server) => props.connected?.includes(server.name))
                  .map(renderSaved)}
              </ul>
            </section>
          )}
          {visibleSaved.some(
            (server) => !props.connected?.includes(server.name)
          ) && (
            <section className="space-y-3">
              <h2 className="font-medium">
                {t(
                  props.connected === null
                    ? 'mcp-servers:catalog.browser.saved'
                    : 'mcp-servers:catalog.browser.savedDisconnected'
                )}
              </h2>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleSaved
                  .filter((server) => !props.connected?.includes(server.name))
                  .map(renderSaved)}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
