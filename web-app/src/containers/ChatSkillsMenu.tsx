import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useSkills } from '@/hooks/useSkills'
import { usePrompt } from '@/hooks/usePrompt'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import SkillsManagerDialog from '@/containers/dialogs/SkillsManagerDialog'
import PrivacyControl from '@/containers/PrivacyControl'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { getMasterSkillPack, installMasterSkillPack, loadMasterPreference, MASTER_ERROR_KEYS, setMasterAutomatic, useMasterOrchestrator, type SkillPackStatus } from '@/lib/masterOrchestrator'
const STATUS_KEYS = { installed: 'master:installed', modified: 'master:modified', missing: 'master:missing', conflict: 'master:conflict' }
const ORIGIN_KEYS: Record<string, string> = { upstream: 'master:upstream', 'upstream-adapted-es': 'master:adapted', 'rey30-original': 'master:original', 'integration-guide': 'master:integrationGuide' }

export default function ChatSkillsMenu() {
  const { t } = useTranslation()
  const { skills } = useSkills(null)
  const { automatic, loaded, saving, last, error } = useMasterOrchestrator()
  const [packOpen, setPackOpen] = useState(false)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [pack, setPack] = useState<SkillPackStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [packError, setPackError] = useState(false)
  const setPrompt = usePrompt((s) => s.setPrompt)
  const prompt = usePrompt((s) => s.prompt)
  const invocable = skills.filter((s) => s.user_invocable !== false)
  useEffect(() => { void loadMasterPreference() }, [])
  const refreshPack = useCallback(async (install = false) => {
    setLoading(true)
    setPackError(false)
    try { setPack(await (install ? installMasterSkillPack() : getMasterSkillPack())) } catch { setPackError(true) } finally { setLoading(false) }
  }, [])
  useEffect(() => { if (packOpen) void refreshPack() }, [packOpen, refreshPack])
  const lastNames = last ? [...last.skills, ...(last.agent ? [last.agent] : [])].join(', ') : ''
  return (
    <>
    <PrivacyControl />
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('master:skills')} data-testid="chat-skills-menu" title={error ? t(MASTER_ERROR_KEYS[error]) : t('master:description')}>
          {t('master:skills')}
          {error ? <AlertTriangle size={14} aria-label={t('master:warning')} /> : <span className="text-xs text-muted-foreground">{loaded ? t(automatic ? 'master:autoOn' : 'master:autoOff') : '…'}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto max-w-[min(24rem,85vw)]">
        <DropdownMenuCheckboxItem data-testid="master-automatic" checked={automatic} disabled={!loaded || saving} onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => { void setMasterAutomatic(checked) }}>
          {t('master:automatic')}
        </DropdownMenuCheckboxItem>
        <p className="px-2 py-1 text-xs text-muted-foreground">{t('master:description')}</p>
        {last && <p data-testid="master-last-selection" className="max-w-80 break-words px-2 py-1 text-xs" role="status">{t('master:lastSelection')}: {lastNames || t(last.mode === 'off' ? 'master:autoOff' : 'master:noSelection')}</p>}
        {error && <p role="alert" className="max-w-80 px-2 py-1 text-xs text-destructive">{t(MASTER_ERROR_KEYS[error])}</p>}
        <DropdownMenuItem onSelect={() => setPackOpen(true)}>{t('master:manage')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {invocable.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">{t('master:noSkills')}</p>}
        {invocable.map((skill) => (
          <DropdownMenuItem
            key={skill.name}
            onSelect={() => setPrompt(`/skill:${skill.name} ${prompt.replace(/^\/skill:\S+\s*/, '')}`)}
            className="flex flex-col items-start"
          >
            <span>{skill.name}</span>
            {skill.description && <span className="text-xs text-muted-foreground line-clamp-2">{skill.description}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={packOpen} onOpenChange={setPackOpen}>
      <DialogContent data-testid="master-resources-dialog" className="flex max-h-[85dvh] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('master:manage')}</DialogTitle>
          <DialogDescription>{t('master:roleLimit')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {loading && <p role="status">{t('master:loading')}</p>}
          {packError && <p role="alert" className="text-sm text-destructive">{t('master:errors.discovery')}</p>}
          {pack?.warnings.map((warning, index) => <p key={index} className="text-sm text-muted-foreground">{warning}</p>)}
          {pack?.items.map(item => <article key={item.id} className="space-y-1 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{item.label}</h3><span>{t(STATUS_KEYS[item.status])}</span></div>
            {item.skillNames.length > 0 && <p className="break-words">{t('master:skills')}: {item.skillNames.join(', ')}</p>}
            {item.agentName && <p>{t('master:agentProfile')}: {item.agentName}</p>}
            {item.requires.length > 0 && <p className="text-muted-foreground">{t('master:declaredDependencies')}: {item.requires.join(', ')}</p>}
            {item.notes && <p className="text-muted-foreground">{item.notes}</p>}
            <p className="break-words text-xs text-muted-foreground">{t(ORIGIN_KEYS[item.origin] ?? 'master:resourceOrigin')} · {item.license} · {item.source}{item.commit ? ` @ ${item.commit}` : ''}</p>
          </article>)}
        </div>
        <DialogFooter className="shrink-0 flex-wrap">
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => { void refreshPack() }}>{t('master:refresh')}</Button>
          <Button variant="outline" size="sm" disabled={loading || !pack?.items.some(item => item.status === 'missing')} onClick={() => { void refreshPack(true) }}>{t('master:installMissing')}</Button>
          <Button size="sm" onClick={() => { setPackOpen(false); setSkillsOpen(true) }}>{t('master:editSkills')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <SkillsManagerDialog open={skillsOpen} onOpenChange={setSkillsOpen} folderOverride={null} />
    </>
  )
}
