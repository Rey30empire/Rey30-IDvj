import posthog from 'posthog-js'
import { useEffect } from 'react'

import { useServiceHub } from '@/hooks/useServiceHub'
import { useAnalytic, useProductAnalytic } from '@/hooks/useAnalytic'
import { usePrivacyMode } from '@/hooks/usePrivacyMode'
import { ensurePrivacyMode, getPrivacyModeSnapshot } from '@/lib/privacyPolicy'

export function AnalyticProvider() {
  const { productAnalytic } = useAnalytic()
  const serviceHub = useServiceHub()
  const { mode, loaded, saving, error } = usePrivacyMode()

  useEffect(() => {
    let active = true
    const allowed = () =>
      active &&
      useProductAnalytic.getState().productAnalytic &&
      getPrivacyModeSnapshot() === 'standard'
    if (!loaded && !error && !saving) void ensurePrivacyMode().catch(() => {})
    if (!productAnalytic || !loaded || saving || error || mode !== 'standard') {
      posthog.opt_out_capturing()
      return () => {
        active = false
        posthog.opt_out_capturing()
      }
    }
    if (!POSTHOG_KEY || !POSTHOG_HOST) {
      console.warn(
        'PostHog not initialized: Missing POSTHOG_KEY or POSTHOG_HOST environment variables'
      )
      return () => {
        active = false
        posthog.opt_out_capturing()
      }
    }
    if (productAnalytic) {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        person_profiles: 'always',
        persistence: 'localStorage',
        opt_out_capturing_by_default: true,

        sanitize_properties: function (properties) {
          const denylist = [
            '$pathname',
            '$initial_pathname',
            '$current_url',
            '$initial_current_url',
            '$host',
            '$initial_host',
            '$initial_person_info',
          ]

          denylist.forEach((key) => {
            if (properties[key]) {
              properties[key] = null // Set each denied property to null
            }
          })

          return properties
        },
      })
      // Attempt to restore distinct Id from app global settings
      serviceHub
        .analytic()
        .getAppDistinctId()
        .then((id) => {
          if (!allowed()) return
          if (id) posthog.identify(id)
          if (!allowed()) return
          posthog.opt_in_capturing()
          posthog.register({ app_version: VERSION })
          if (allowed())
            return serviceHub
              .analytic()
              .updateDistinctId(posthog.get_distinct_id())
        })
        .catch(() => {
          if (active) posthog.opt_out_capturing()
        })
    } else {
      posthog.opt_out_capturing()
    }
    return () => {
      active = false
      posthog.opt_out_capturing()
    }
  }, [productAnalytic, serviceHub, mode, loaded, saving, error])

  // This component doesn't render anything
  return null
}
