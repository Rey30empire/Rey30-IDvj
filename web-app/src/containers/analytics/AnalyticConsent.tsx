import { Button } from '@/components/ui/button'
import { useAnalytic } from '@/hooks/useAnalytic'
import posthog from 'posthog-js'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useState } from 'react'
import { usePrivacyMode } from '@/hooks/usePrivacyMode'
import { ensurePrivacyMode } from '@/lib/privacyPolicy'

/**
 * The analytics consent question with neither a heading nor positioning of its
 * own, so it can be a step on the setup wizard (which supplies its own heading)
 * as well as a floating prompt for users who upgraded past onboarding.
 */
export function AnalyticConsent() {
  const { t } = useTranslation()
  const { setProductAnalyticPrompt, setProductAnalytic } = useAnalytic()
  const { mode, loaded, saving } = usePrivacyMode()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleProductAnalytics = async (isAllowed: boolean) => {
    setBusy(true)
    setError(null)
    try {
      if (isAllowed && (await ensurePrivacyMode()) !== 'standard')
        throw new Error(
          'La telemetría está desactivada por el modo de privacidad.'
        )
      if (!isAllowed) posthog.opt_out_capturing()
      setProductAnalytic(isAllowed)
      setProductAnalyticPrompt(false)
    } catch {
      posthog.opt_out_capturing()
      setProductAnalytic(false)
      setError(
        'No se activó la telemetría. Revisa el modo en Ajustes > Privacidad.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="analytic-consent">
      <p className="text-xs text-muted-foreground leading-normal">
        {t('analyticsConsentDetail')}
      </p>
      <p className="mt-2 text-sm">{t('analyticsConsentQuestion')}</p>
      {mode !== 'standard' && (
        <p className="mt-2 text-xs">
          La telemetría permanece desactivada en el modo protegido.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end space-x-2">
        <Button
          data-testid="analytic-deny"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => handleProductAnalytics(false)}
        >
          {t('deny')}
        </Button>
        <Button
          data-testid="analytic-allow"
          size="sm"
          disabled={busy || saving || !loaded || mode !== 'standard'}
          onClick={() => handleProductAnalytics(true)}
        >
          {t('allow')}
        </Button>
      </div>
    </div>
  )
}
