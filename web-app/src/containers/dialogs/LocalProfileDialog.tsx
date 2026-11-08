import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { normalizeLocalProfile, useLocalProfile } from '@/hooks/useLocalProfile'
import { useTranslation } from '@/i18n/react-i18next-compat'

export default function LocalProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const { profile, saveProfile } = useLocalProfile()
  const nameId = useId()
  const initialsId = useId()
  const [name, setName] = useState(profile.name)
  const [initials, setInitials] = useState(profile.initials)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(profile.name)
      setInitials(profile.initials)
      setError(null)
    }
  }, [open, profile.name, profile.initials])

  const save = (event: React.FormEvent) => {
    event.preventDefault()
    let next
    try { next = normalizeLocalProfile({ name, initials }) } catch (failure) {
      setError(t(failure instanceof Error && failure.message === 'initials' ? 'profile:invalidInitials' : 'profile:invalidName'))
      return
    }
    try {
      saveProfile(next)
      onOpenChange(false)
    } catch {
      setError(t('profile:saveFailed'))
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-testid="local-profile-dialog" className="flex max-h-[85dvh] flex-col overflow-hidden">
      <DialogHeader className="shrink-0">
        <DialogTitle>{t('profile:title')}</DialogTitle>
        <DialogDescription>{t('profile:localDescription')}</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-foreground">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 font-studio font-medium text-foreground">{initials.trim().slice(0, 3).toUpperCase() || profile.initials}</span>
          <span className="min-w-0 break-words text-sm font-medium">{name.trim() || profile.name}</span>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={nameId} className="text-sm font-medium">{t('profile:name')}</label>
          <Input id={nameId} data-testid="local-profile-name" className="focus-visible:border-foreground focus-visible:ring-foreground/60" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoComplete="nickname" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={initialsId} className="text-sm font-medium">{t('profile:initials')}</label>
          <Input id={initialsId} data-testid="local-profile-initials" className="focus-visible:border-foreground focus-visible:ring-foreground/60" value={initials} onChange={(event) => setInitials(event.target.value)} maxLength={3} autoComplete="off" />
          <p className="text-xs text-muted-foreground">{t('profile:initialsHint')}</p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="shrink-0">
          <Button data-testid="local-profile-cancel" type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
          <Button data-testid="local-profile-save" type="submit" size="sm">{t('profile:save')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
