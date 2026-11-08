import { useCallback, useEffect, useRef } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { isPlatformTauri } from '@/lib/platform/utils'
import { validateCoworkFolder } from '@/lib/agentTools'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useCoworkRun } from './useCoworkRun'
import { useCoworkSessions } from './useCoworkSessions'

const usePickerStatus = create<{ picking: boolean }>(() => ({ picking: false }))

export function useCoworkFolderPicker(onOpened?: (folder: string) => Promise<unknown> | void) {
  const { t } = useTranslation()
  const picking = usePickerStatus((state) => state.picking)
  const available = isPlatformTauri() && !IS_IOS && !IS_ANDROID
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const openFolder = useCallback(async (savedFolder?: string) => {
    if (!available || !mounted.current || usePickerStatus.getState().picking) return
    usePickerStatus.setState({ picking: true })
    try {
      if (!useCoworkSessions.persist.hasHydrated()) {
        throw new Error(t('common:workspace.sessionsUnavailable'))
      }
      const picked = savedFolder ?? await getServiceHub().core().invoke<string | null>('open_dialog', {
        options: { directory: true, multiple: false },
      }).catch(() => { throw new Error(t('common:workspace.pickerFailed')) })
      if (!mounted.current || picked === null) return
      if (typeof picked !== 'string' || !picked.trim()) {
        throw new Error(t('common:workspace.invalidSelection'))
      }
      const folder = await validateCoworkFolder(picked)
      if (!mounted.current) return
      if (savedFolder && savedFolder !== folder) throw new Error(t('common:workspace.savedFolderChanged'))
      if (!useCoworkSessions.persist.hasHydrated()) {
        throw new Error(t('common:workspace.sessionsUnavailable'))
      }
      const sessions = useCoworkSessions.getState()
      const existing = savedFolder && sessions.sessions.find(session => session.folder === folder)
      if (existing) {
        sessions.selectSession(existing.id)
        await onOpened?.(folder)
        return
      }
      const { selectedProvider, selectedModel, providers } = useModelProvider.getState()
      const selected = providers
        .find((provider) => provider.provider === selectedProvider && provider.active)
        ?.models.find((model) => model.id === selectedModel?.id)
      const binding = selected?.capabilities?.includes('tools')
        ? { provider: selectedProvider, id: selected.id }
        : undefined
      const runningIds = Object.keys(useCoworkRun.getState().runId)
      const id = sessions.openFolder(folder, runningIds, binding)
      if (!id) throw new Error(t('common:workspace.folderBusy'))
      await onOpened?.(folder)
    } catch (error) {
      if (!mounted.current) return
      const description = error instanceof Error ? error.message : typeof error === 'string' ? error : t('common:workspace.invalidSelection')
      toast.error(t('common:workspace.openFailed'), { description })
    } finally {
      usePickerStatus.setState({ picking: false })
    }
  }, [available, onOpened, t])

  return { available, picking, openFolder }
}
