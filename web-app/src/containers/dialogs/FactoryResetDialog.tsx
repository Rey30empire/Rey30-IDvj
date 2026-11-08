import { useState } from 'react'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  getPreferencePoint,
  savePreferencePoint,
  restorePreferencePoint,
  resetPreferences,
  applyDefaultPreferences,
  type PreferencePoint,
} from '@/services/app/preferences-recovery'
import { useTranslation } from '@/i18n/react-i18next-compat'

export function FactoryResetDialog({
  children,
}: {
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [point, setPoint] = useState<PreferencePoint | null>(null)
  const [beforeDefaults, setBeforeDefaults] = useState<PreferencePoint | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [readWarning, setReadWarning] = useState('')
  const [pointUnavailable, setPointUnavailable] = useState(false)

  const refresh = async () => {
    const [saved, previous] = await Promise.allSettled([
      getPreferencePoint(),
      getPreferencePoint('before-defaults'),
    ])
    setPoint(saved.status === 'fulfilled' ? saved.value : null)
    setBeforeDefaults(previous.status === 'fulfilled' ? previous.value : null)
    setPointUnavailable(saved.status === 'rejected')
    setReadWarning(
      saved.status === 'rejected' || previous.status === 'rejected'
        ? t('preferences-recovery:readWarning')
        : ''
    )
  }
  const run = async <T,>(
    action: () => Promise<T>,
    message: string | ((result: T) => string)
  ) => {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const result = await action()
      await refresh()
      setStatus(typeof message === 'function' ? message(result) : message)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('preferences-recovery:failed')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (busy) return
        setOpen(nextOpen)
        if (nextOpen) void run(async () => {}, '')
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-[540px] max-w-[90vw]"
        aria-busy={busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('preferences-recovery:title')}</DialogTitle>
          <DialogDescription>
            {t('preferences-recovery:description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t(
              point
                ? 'preferences-recovery:restoreSavedIntro'
                : 'preferences-recovery:restoreDefaultsIntro'
            )}
          </p>
          <div className="space-y-2">
            <p className="text-sm">
              {point
                ? t('preferences-recovery:savedAt', {
                    date: new Date(point.createdAt).toLocaleString(),
                  })
                : t(
                    pointUnavailable
                      ? 'preferences-recovery:pointUnavailable'
                      : 'preferences-recovery:noPoint'
                  )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || pointUnavailable}
                onClick={() =>
                  void run(resetPreferences, (result) =>
                    t(
                      result === 'saved'
                        ? 'preferences-recovery:restoredSaved'
                        : 'preferences-recovery:restoredDefaults'
                    )
                  )
                }
              >
                {t('preferences-recovery:resetButton')}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => savePreferencePoint(),
                    t('preferences-recovery:saved')
                  )
                }
              >
                {t('preferences-recovery:save')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                point
                  ? 'preferences-recovery:overwrite'
                  : 'preferences-recovery:saveHint'
              )}
            </p>
          </div>
          {(point || pointUnavailable) && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm">
                {t('preferences-recovery:defaultsHint')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(applyDefaultPreferences, () =>
                      t('preferences-recovery:restoredDefaults')
                    )
                  }
                >
                  {t('preferences-recovery:defaults')}
                </Button>
              </div>
            </div>
          )}
          {beforeDefaults && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(
                  () => restorePreferencePoint('before-defaults'),
                  () => t('preferences-recovery:undone')
                )
              }
            >
              {t('preferences-recovery:undo')}
            </Button>
          )}
          {busy && (
            <p role="status" className="text-sm">
              {t('preferences-recovery:busy')}
            </p>
          )}
          {status && (
            <p role="status" className="text-sm">
              {status}
            </p>
          )}
          {readWarning && (
            <p role="alert" className="text-sm text-destructive">
              {readWarning}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {t('preferences-recovery:close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
