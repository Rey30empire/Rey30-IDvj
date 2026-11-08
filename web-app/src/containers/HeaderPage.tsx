import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import { IconArrowLeft, IconLayoutSidebar } from '@tabler/icons-react'
import { ReactNode, memo } from 'react'
import { Button } from '@/components/ui/button'
import { DownloadManagement } from '@/containers/DownloadManegement'
import { useTitlebarLayout } from '@/stores/titlebar-layout-store'
import { useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router'
import { useThreads } from '@/hooks/useThreads'
import { route } from '@/constants/routes'

type HeaderPageProps = {
  children?: ReactNode
}
const HeaderPage = memo(function HeaderPage({ children }: HeaderPageProps) {
  const { open, setLeftPanel } = useLeftPanel()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const showBack =
    pathname !== route.home &&
    pathname !== route.cowork &&
    !/^\/threads\/[^/]+\/?$/.test(pathname)
  const goBack = () => {
    if (canGoBack) {
      router.history.back()
      return
    }
    const { threads, currentThreadId } = useThreads.getState()
    const previousThread =
      (currentThreadId && threads[currentThreadId]) ||
      Object.values(threads).reduce<Thread | undefined>((latest, thread) => {
        const updated = Number.isFinite(thread.updated) ? thread.updated : 0
        const previousUpdated =
          latest && Number.isFinite(latest.updated) ? latest.updated : 0
        return !latest || updated > previousUpdated ? thread : latest
      }, undefined)
    if (previousThread) {
      void router.navigate({
        to: route.threadsDetail,
        params: { threadId: previousThread.id },
        replace: true,
      })
    } else {
      void router.navigate({ to: route.home, replace: true })
    }
  }
  // Collapsed, this header owns the top-left strip — indent past left-anchored Linux
  // window controls (size-8 each at left-4); macOS uses the pl-24 class below.
  const leftButtons = useTitlebarLayout((s) => s.layout.left.length)
  const linuxControlsPad =
    !IS_MACOS && !open && leftButtons > 0 ? leftButtons * 32 + 24 : undefined
  // Right-anchored controls (Windows, and Linux DEs that place them there) sit at
  // right-4 above the header — keep header content clear of them at every width.
  const rightButtons = useTitlebarLayout((s) => s.layout.right.length)
  const rightControlsPad = rightButtons > 0 ? rightButtons * 32 + 24 : undefined

  return (
    <div
      className={cn(
        'h-15 flex items-center shrink-0',
        IS_MACOS && !open ? 'pl-24' : ' pl-4',
        children === undefined && 'border-none'
      )}
      style={{
        ...(linuxControlsPad ? { paddingLeft: linuxControlsPad } : {}),
        ...(rightControlsPad ? { paddingRight: rightControlsPad } : {}),
      }}
    >
      <div className={cn('flex items-center w-full gap-1')}>
        {!open && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full relative z-50"
              onClick={() => setLeftPanel(!open)}
              aria-label="Toggle sidebar"
            >
              <IconLayoutSidebar className="text-muted-foreground relative size-4.5" />
            </Button>
            {/* After the toggle so the toggle stays put when this appears */}
            <DownloadManagement />
          </>
        )}
        {showBack && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="relative z-50 shrink-0"
            data-testid="page-back"
            aria-label="Volver"
            onClick={goBack}
          >
            <IconArrowLeft aria-hidden="true" className="size-4" />
            Volver
          </Button>
        )}
        <div className={cn('flex-1 min-w-0')}>{children}</div>
      </div>
    </div>
  )
})

export default HeaderPage
