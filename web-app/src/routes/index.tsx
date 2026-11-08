/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useSearch } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useTools } from '@/hooks/useTools'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/hooks/useModelProvider'
import SetupScreen from '@/containers/SetupScreen'
import { route } from '@/constants/routes'
import { hasUsableProvider } from '@/lib/providerReadiness'

type ThreadModel = {
  id: string
  provider: string
}

type SearchParams = {
  threadModel?: ThreadModel
}
import { useEffect } from 'react'
import { useThreads } from '@/hooks/useThreads'
import DropdownModelProvider from '@/containers/DropdownModelProvider'

export const Route = createFileRoute('/')({
  component: Index,
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    const result: SearchParams = {
      threadModel: search.threadModel as ThreadModel | undefined,
    }

    return result
  },
})

function Index() {
  const { t } = useTranslation()
  const { providers } = useModelProvider()
  const search = useSearch({ from: route.home as any })
  const threadModel = search.threadModel
  const { setCurrentThreadId } = useThreads()
  useTools()

  const hasValidProviders = hasUsableProvider(providers)

  useEffect(() => {
    setCurrentThreadId(undefined)
  }, [setCurrentThreadId])

  if (!hasValidProviders) {
    return <SetupScreen />
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <img src="/images/rey30-chat-background.png" alt="" aria-hidden="true" fetchPriority="high" className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover opacity-55 dark:opacity-10" width={1672} height={941} />
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <DropdownModelProvider model={threadModel} />
        </div>
      </HeaderPage>
      <div data-testid="home-welcome" className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-6">
        <div className="flex max-w-xl flex-col items-center text-center">
            <img src="/images/rey30-idvj.svg" alt="" aria-hidden="true" className="mb-3 size-14" width={56} height={56} />
            <p className="mb-2 font-studio text-sm font-medium">Rey30 IDvj</p>
            <h1
              className={cn(
                'text-2xl mt-2 font-studio font-medium',
              )}
            >
              {t('chat:description')}
            </h1>
        </div>
      </div>
      <div data-testid="home-composer-shell" className="relative mx-auto w-full shrink-0 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 md:w-4/5 xl:w-4/6">
        <ChatInput
          showSpeedToken={false}
          model={threadModel}
          initialMessage={true}
        />
      </div>
    </div>
  )
}
