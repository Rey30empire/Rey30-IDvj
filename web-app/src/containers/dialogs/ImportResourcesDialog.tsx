import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { File, FolderOpen, Github, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { DEFAULT_MCP_SETTINGS, useMCPServers } from '@/hooks/useMCPServers'
import { refreshSubagents } from '@/lib/coworkSubagentRegistry'
import { openExternalUrl } from '@/lib/externalLink'
import { isPlatformTauri } from '@/lib/platform/utils'
import { normalizeAppError } from '@/utils/appError'
import {
  commitResources, githubCancel, githubLogin, githubPoll, githubRepos, githubScan,
  githubStatus, RESOURCE_IMPORT_EVENT, scanResources,
  type GitHubLogin, type GitHubRepository, type GitHubStatus, type ImportPlan, type ImportResult,
} from '@/lib/resourceImport'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath?: string
  initialSource?: 'local' | 'github'
  onOpenMCP?: () => void
  onImported?: (result: ImportResult) => void | Promise<void>
}

type ConnectionResult = { name: string; tools?: number; error?: string }

export default function ImportResourcesDialog({
  open, onOpenChange, projectPath, initialSource = 'local', onOpenMCP, onImported,
}: Props) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const desktop = isPlatformTauri()
  const [source, setSource] = useState<'local' | 'github'>('local')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [connectMCP, setConnectMCP] = useState(false)
  const [connections, setConnections] = useState<ConnectionResult[]>([])
  const [account, setAccount] = useState<GitHubStatus | null>(null)
  const [auth, setAuth] = useState<GitHubLogin | null>(null)
  const [repos, setRepos] = useState<GitHubRepository[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [repoFilter, setRepoFilter] = useState('')
  const [repository, setRepository] = useState('')
  const [localPath, setLocalPath] = useState('')
  const localPathId = useId()
  const active = useRef(false)
  const epoch = useRef(0)
  const pendingLogin = useRef<string | null>(null)
  const chosenSource = useRef(initialSource)
  const working = busy !== null || auth?.status === 'pending'

  useEffect(() => {
    active.current = open
    epoch.current += 1
    if (open) {
      chosenSource.current = initialSource
      setSource(initialSource)
      setPlan(null)
      setSelected([])
      setPreviewId(null)
      setResult(null)
      setConnections([])
      setConnectMCP(false)
      setError(null)
      setBusy(null)
    } else if (pendingLogin.current) {
      void githubCancel(pendingLogin.current).catch(() => {})
      pendingLogin.current = null
      setAuth(null)
    }
    return () => {
      active.current = false
      epoch.current += 1
    }
  }, [open, initialSource])

  useEffect(() => () => {
    if (pendingLogin.current) void githubCancel(pendingLogin.current).catch(() => {})
  }, [])

  const refreshGitHub = useCallback(async () => {
    const request = ++epoch.current
    setBusy('account')
    setError(null)
    try {
      const status = await githubStatus()
      if (!active.current || request !== epoch.current) return
      setAccount(status)
      if (status.authenticated) {
        const response = await githubRepos(1)
        if (!active.current || request !== epoch.current) return
        setRepos(response.repos)
        setPage(response.page)
        setHasMore(response.hasMore)
      } else {
        setRepos([])
        setPage(0)
        setHasMore(false)
      }
    } catch (failure) {
      if (active.current && request === epoch.current) setError(normalizeAppError(failure))
    } finally {
      if (active.current && request === epoch.current) setBusy(null)
    }
  }, [])

  useEffect(() => {
    if (open && source === 'github' && chosenSource.current === 'github' && desktop) void refreshGitHub()
  }, [open, source, desktop, refreshGitHub])

  useEffect(() => {
    if (!open || auth?.status !== 'pending') return
    const sessionId = auth.id
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const response = await githubPoll(sessionId)
        if (cancelled || !active.current || pendingLogin.current !== sessionId) return
        setAuth(response.status === 'cancelled'
          ? { id: sessionId, status: 'cancelled', message: response.message }
          : response)
        if (response.status === 'pending') {
          timer = setTimeout(poll, 1800)
        } else {
          pendingLogin.current = null
          if (response.status === 'complete') await refreshGitHub()
        }
      } catch (failure) {
        if (!cancelled && active.current && pendingLogin.current === sessionId) {
          pendingLogin.current = null
          setAuth({ id: sessionId, status: 'error', message: normalizeAppError(failure) })
          void githubCancel(sessionId).catch(() => {})
        }
      }
    }
    timer = setTimeout(poll, 1800)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, auth?.id, auth?.status, refreshGitHub])

  const showPlan = (next: ImportPlan) => {
    setPlan(next)
    setSelected([])
    setPreviewId(next.candidates[0]?.id ?? null)
    setResult(null)
    setConnections([])
  }

  const inspect = async (operation: () => Promise<ImportPlan>) => {
    const request = ++epoch.current
    setBusy('scan')
    setError(null)
    setPlan(null)
    setSelected([])
    setResult(null)
    try {
      const next = await operation()
      if (active.current && request === epoch.current) showPlan(next)
    } catch (failure) {
      if (active.current && request === epoch.current) setError(normalizeAppError(failure))
    } finally {
      if (active.current && request === epoch.current) setBusy(null)
    }
  }

  const chooseLocalPath = async (directory: boolean) => {
    const request = ++epoch.current
    setBusy('choose')
    setError(null)
    try {
      const path = await serviceHub.dialog().open({
        directory,
        multiple: false,
        ...(directory ? {} : { filters: [{ name: t('integrations:resourceFiles'), extensions: ['md', 'mdc', 'json', 'toml'] }] }),
      })
      if (typeof path === 'string' && active.current && request === epoch.current) {
        setLocalPath(path)
        await inspect(() => scanResources({ projectPath, path }))
      }
    } catch (failure) {
      if (active.current && request === epoch.current) setError(normalizeAppError(failure))
    } finally {
      if (active.current && request === epoch.current) setBusy(null)
    }
  }

  const changeSource = (next: 'local' | 'github') => {
    chosenSource.current = next
    if (pendingLogin.current) {
      void githubCancel(pendingLogin.current).catch(() => {})
      pendingLogin.current = null
      setAuth(null)
    }
    epoch.current += 1
    setSource(next)
    setPlan(null)
    setSelected([])
    setResult(null)
    setError(null)
    setBusy(null)
  }

  const connectGitHub = async () => {
    const request = ++epoch.current
    setBusy('login')
    setError(null)
    try {
      const response = await githubLogin()
      if (!active.current || request !== epoch.current) {
        if (response.status === 'pending') void githubCancel(response.id).catch(() => {})
        return
      }
      setAuth(response)
      pendingLogin.current = response.status === 'pending' ? response.id : null
      if (response.status === 'complete') await refreshGitHub()
    } catch (failure) {
      if (active.current && request === epoch.current) setError(normalizeAppError(failure))
    } finally {
      if (active.current && request === epoch.current) setBusy(null)
    }
  }

  const cancelLogin = async () => {
    const sessionId = pendingLogin.current
    pendingLogin.current = null
    setAuth(null)
    if (sessionId) {
      try { await githubCancel(sessionId) } catch (failure) { setError(normalizeAppError(failure)) }
    }
  }

  const loadMore = async () => {
    const request = ++epoch.current
    setBusy('repos')
    setError(null)
    try {
      const response = await githubRepos(page + 1)
      if (!active.current || request !== epoch.current) return
      setRepos((current) => [...new Map([...current, ...response.repos].map((repo) => [repo.fullName, repo])).values()])
      setPage(response.page)
      setHasMore(response.hasMore)
    } catch (failure) {
      if (active.current && request === epoch.current) setError(normalizeAppError(failure))
    } finally {
      if (active.current && request === epoch.current) setBusy(null)
    }
  }

  const prepareSelected = async () => {
    if (!plan || selected.length === 0) return
    const request = ++epoch.current
    setBusy('commit')
    setError(null)
    try {
      const receipt = await commitResources(plan.id, selected)
      if (!active.current || request !== epoch.current) return
      if (receipt.installed.some((item) => item.kind === 'agent')) refreshSubagents()
      if (receipt.installed.some((item) => item.kind === 'mcp')) {
        try {
          const config = await serviceHub.mcp().getMCPConfig()
          useMCPServers.setState((state) => ({
            mcpServers: { ...state.mcpServers, ...config.mcpServers },
            settings: config.mcpSettings ? { ...DEFAULT_MCP_SETTINGS, ...config.mcpSettings } : state.settings,
          }))
        } catch {
          receipt.warnings = [...receipt.warnings, t('integrations:refreshFailed')]
        }
        if (connectMCP) {
          const checked: ConnectionResult[] = []
          for (const item of receipt.installed.filter((entry) => entry.kind === 'mcp')) {
            let started = false
            try {
              const before = await serviceHub.mcp().getMCPConfig()
              const config = before.mcpServers?.[item.name]
              if (!config) throw new Error(t('integrations:missingMCP', { name: item.name }))
              await serviceHub.mcp().activateMCPServer(item.name, { ...config, active: true })
              started = true
              const connected = await serviceHub.mcp().getConnectedServers()
              if (!connected.includes(item.name)) throw new Error(t('integrations:notConnectedMCP', { name: item.name }))
              const tools = await serviceHub.mcp().getTools()
              const latest = await serviceHub.mcp().getMCPConfig()
              const current = latest.mcpServers?.[item.name]
              if (!current) throw new Error(t('integrations:missingMCP', { name: item.name }))
              const enabled = { ...current, active: true }
              await serviceHub.mcp().updateMCPConfig(JSON.stringify({
                ...latest,
                mcpServers: { ...latest.mcpServers, [item.name]: enabled },
              }))
              useMCPServers.setState((state) => ({ mcpServers: { ...state.mcpServers, [item.name]: enabled } }))
              checked.push({ name: item.name, tools: tools.filter((tool) => tool.server === item.name).length })
            } catch (failure) {
              let message = normalizeAppError(failure)
              if (started) {
                try { await serviceHub.mcp().deactivateMCPServer(item.name) } catch (stopFailure) {
                  message += '\n' + t('integrations:stopFailed') + ' ' + normalizeAppError(stopFailure)
                }
              }
              checked.push({ name: item.name, error: message })
            }
          }
          if (active.current && request === epoch.current) setConnections(checked)
        }
      }
      if (!active.current || request !== epoch.current) return
      setResult(receipt)
      setPlan(null)
      setSelected([])
      window.dispatchEvent(new CustomEvent(RESOURCE_IMPORT_EVENT, { detail: receipt }))
      try { await onImported?.(receipt) } catch {
        setResult({ ...receipt, warnings: [...receipt.warnings, t('integrations:refreshFailed')] })
      }
    } catch (failure) {
      if (active.current && request === epoch.current) setError(normalizeAppError(failure))
    } finally {
      if (active.current && request === epoch.current) setBusy(null)
    }
  }

  const preview = plan?.candidates.find((candidate) => candidate.id === previewId)
  const available = plan?.candidates.filter((candidate) => candidate.importable) ?? []
  const hasSelectedMCP = plan?.candidates.some((candidate) => candidate.kind === 'mcp' && selected.includes(candidate.id))
  const visibleRepos = repos.filter((repo) =>
    (repo.fullName + ' ' + (repo.description ?? '')).toLowerCase().includes(repoFilter.toLowerCase())
  )
  const authorizationUrl = auth?.url?.startsWith('https://github.com/') ? auth.url : null
  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (busy !== 'commit') onOpenChange(next) }}>
      <DialogContent data-testid="resource-import-dialog" className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-4xl" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('integrations:title')}</DialogTitle>
          <DialogDescription>{t('integrations:description')}</DialogDescription>
        </DialogHeader>
        {!desktop && <p role="status" className="shrink-0 text-sm text-muted-foreground">{t('integrations:desktopOnly')}</p>}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant={source === 'local' ? 'secondary' : 'outline'} disabled={working} onClick={() => changeSource('local')}>
            <FolderOpen size={15} />{t('integrations:local')}
          </Button>
          <Button size="sm" variant={source === 'github' ? 'secondary' : 'outline'} disabled={working || !desktop} onClick={() => changeSource('github')}>
            <Github size={15} />GitHub
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto space-y-4">
          {source === 'local' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={working || !desktop} onClick={() => inspect(() => scanResources({ projectPath }))}>
                  <Search size={15} />{t('integrations:detect')}
                </Button>
                <Button variant="outline" size="sm" disabled={working || !desktop} onClick={() => chooseLocalPath(true)}>
                  <FolderOpen size={15} />{t('integrations:chooseFolder')}
                </Button>
                <Button variant="outline" size="sm" disabled={working || !desktop} onClick={() => chooseLocalPath(false)}>
                  <File size={15} />{t('integrations:chooseFile')}
                </Button>
              </div>
              <form className="space-y-1" onSubmit={(event) => {
                event.preventDefault()
                if (desktop && !working && localPath.trim()) void inspect(() => scanResources({ path: localPath.trim() }))
              }}>
                <label htmlFor={localPathId} className="text-sm">{t('integrations:localPath')}</label>
                <div className="flex items-center gap-2">
                  <Input id={localPathId} data-testid="resource-import-local-path" value={localPath} onChange={(event) => setLocalPath(event.target.value)} disabled={working || !desktop} />
                  <Button data-testid="resource-import-analyze-path" type="submit" variant="outline" size="sm" disabled={working || !desktop || !localPath.trim()}>{t('integrations:analyzePath')}</Button>
                </div>
              </form>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>{account?.authenticated ? t('integrations:connectedAs', { login: account.login ?? 'GitHub' }) : t('integrations:notConnected')}</span>
                {account?.available && !account.authenticated && auth?.status !== 'pending' && (
                  <Button variant="outline" size="sm" disabled={working} onClick={connectGitHub}>{t('integrations:connect')}</Button>
                )}
                <Button variant="ghost" size="sm" disabled={working || !desktop || auth?.status === 'pending'} onClick={refreshGitHub}>{t('integrations:refresh')}</Button>
              </div>
              {account?.message && <p className="text-sm text-muted-foreground">{account.message}</p>}
              {auth?.status === 'pending' && (
                <div className="rounded-md border p-3 space-y-2">
                  <p className="text-sm">{t('integrations:deviceInstructions')}</p>
                  {auth.code && <code className="block select-all font-mono text-base">{auth.code}</code>}
                  <div className="flex flex-wrap gap-2">
                    {authorizationUrl && <Button size="sm" variant="outline" onClick={() => openExternalUrl(authorizationUrl)}>{t('integrations:openAuthorization')}</Button>}
                    <Button size="sm" variant="ghost" onClick={cancelLogin}>{t('integrations:cancelAuthorization')}</Button>
                  </div>
                </div>
              )}
              {auth?.status === 'error' && <p role="alert" className="text-sm text-destructive">{auth.message ?? t('integrations:authorizationFailed')}</p>}
              {auth?.status === 'cancelled' && <p role="status" className="text-sm text-muted-foreground">{auth.message ?? t('integrations:authorizationCancelled')}</p>}
              <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (repository.trim()) void inspect(() => githubScan(repository.trim())) }}>
                <Input aria-label={t('integrations:repository')} placeholder="owner/repository" value={repository} onChange={(event) => setRepository(event.target.value)} disabled={working || !desktop} />
                <Button type="submit" size="sm" variant="outline" disabled={working || !desktop || !repository.trim()}>{t('integrations:reviewRepository')}</Button>
              </form>
              {account?.authenticated && (
                <div className="space-y-2">
                  <Input aria-label={t('integrations:filterRepos')} placeholder={t('integrations:filterRepos')} value={repoFilter} onChange={(event) => setRepoFilter(event.target.value)} />
                  <div className="max-h-44 overflow-y-auto divide-y rounded-md border">
                    {visibleRepos.map((repo) => (
                      <div key={repo.fullName} className="flex items-center gap-3 p-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{repo.fullName}{repo.private && <span className="ml-2 text-xs text-muted-foreground">{t('integrations:private')}</span>}</p>
                          {repo.description && <p className="truncate text-muted-foreground">{repo.description}</p>}
                        </div>
                        <Button variant="outline" size="sm" aria-label={t('integrations:reviewNamedRepo', { name: repo.fullName })} disabled={working} onClick={() => inspect(() => githubScan(repo.fullName))}>{t('integrations:review')}</Button>
                      </div>
                    ))}
                    {visibleRepos.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t('integrations:noRepos')}</p>}
                  </div>
                  {hasMore && <Button variant="outline" size="sm" disabled={working} onClick={loadMore}>{t('integrations:loadMore')}</Button>}
                </div>
              )}
            </div>
          )}
          {busy !== null && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" />{t(busy === 'commit' ? 'integrations:preparing' : 'integrations:loading')}</p>}
          {error && <p role="alert" className="text-sm text-destructive whitespace-pre-wrap break-words">{error}</p>}
          {plan && (
            <div className="space-y-3" data-testid="resource-import-plan">
              {plan.warnings.map((warning, index) => <p key={index} className="text-sm text-muted-foreground">{warning}</p>)}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t('integrations:found', { count: plan.candidates.length })}</span>
                {available.length > 0 && <Button variant="ghost" size="sm" disabled={working} onClick={() => setSelected(selected.length === available.length ? [] : available.map((item) => item.id))}>{selected.length === available.length ? t('integrations:clearSelection') : t('integrations:selectAvailable')}</Button>}
              </div>
              {plan.candidates.length === 0 ? <p className="text-sm text-muted-foreground">{t('integrations:noResources')}</p> : (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="max-h-72 overflow-y-auto divide-y rounded-md border">
                    {plan.candidates.map((candidate) => (
                      <div key={candidate.id} className="flex items-start gap-2 p-3">
                        <input type="checkbox" data-testid="resource-import-candidate" data-resource-name={candidate.name} data-resource-kind={candidate.kind} className="mt-1 accent-primary" aria-label={t('integrations:selectNamed', { name: candidate.name })} checked={selected.includes(candidate.id)} disabled={working || !candidate.importable} onChange={(event) => setSelected((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))} />
                        <button type="button" onClick={() => setPreviewId(candidate.id)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                          <span className="block break-words text-sm font-medium">{candidate.name}</span>
                          <span className="block text-xs text-muted-foreground">{t(`integrations:kinds.${candidate.kind}`)} · {candidate.source}</span>
                          {candidate.description && <span className="mt-1 block text-xs text-muted-foreground line-clamp-2">{candidate.description}</span>}
                          {candidate.conflict && <span className="mt-1 block text-xs text-muted-foreground">{t('integrations:renamed')}</span>}
                          {!candidate.importable && <span className="mt-1 block text-xs text-muted-foreground">{t('integrations:reviewOnly')}</span>}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-md border p-3 min-w-0 space-y-2">
                    {preview && <>
                      <p className="break-words text-sm font-medium">{preview.name}</p>
                      <p className="break-all text-xs text-muted-foreground">{preview.sourcePath}</p>
                      {preview.warnings.map((warning, index) => <p key={index} className="text-xs text-muted-foreground">{warning}</p>)}
                      <pre aria-label={t('integrations:preview')} className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs font-mono">{preview.preview}</pre>
                    </>}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t('integrations:prepareNotice')}</p>
              {hasSelectedMCP && <div className="space-y-1">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" data-testid="resource-import-connect-mcp" className="mt-1 accent-primary" checked={connectMCP} disabled={working} onChange={(event) => setConnectMCP(event.target.checked)} />
                  {t('integrations:connectAfterImport')}
                </label>
                {connectMCP && <p className="text-xs text-muted-foreground">{t('integrations:connectNotice')}</p>}
              </div>}
            </div>
          )}
          {result && (
            <div className="rounded-md border p-3 space-y-2" data-testid="resource-import-receipt">
              <p role="status" className="text-sm font-medium">{t('integrations:prepared', { count: result.installed.length })}</p>
              {result.installed.map((item) => <div key={item.id} className="text-sm"><p>{item.name} · {t(`integrations:kinds.${item.kind}`)}</p><p className="text-xs break-all text-muted-foreground">{item.path}</p></div>)}
              {result.warnings.map((warning, index) => <p key={index} className="text-sm text-muted-foreground">{warning}</p>)}
              {result.errors.map((message, index) => <p key={index} role="alert" className="text-sm text-destructive">{message}</p>)}
              {result.installed.some((item) => item.kind === 'mcp') && <>
                <p className="text-sm text-muted-foreground">{connections.length === 0 ? t('integrations:mcpInactive') : t('integrations:mcpChecked')}</p>
                {connections.map((connection) => <p key={connection.name} data-testid="resource-import-mcp-result" data-server-name={connection.name} data-connected={!connection.error} role={connection.error ? 'alert' : 'status'} className={connection.error ? 'text-sm text-destructive whitespace-pre-wrap' : 'text-sm'}>{connection.error ? connection.name + ': ' + connection.error : t('integrations:mcpConnected', { name: connection.name, count: connection.tools ?? 0 })}</p>)}
                {onOpenMCP && <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); onOpenMCP() }}>{t('integrations:openMCP')}</Button>}
              </>}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="ghost" size="sm" disabled={busy === 'commit'} onClick={() => onOpenChange(false)}>{t('common:close')}</Button>
          <Button data-testid="resource-import-commit" size="sm" disabled={!desktop || working || !plan || selected.length === 0} onClick={prepareSelected}>{t(connectMCP && hasSelectedMCP ? 'integrations:prepareAndConnect' : 'integrations:prepareSelected', { count: selected.length })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
