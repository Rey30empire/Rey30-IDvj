import { useState } from 'react'
import { DownloadManagement } from '@/containers/DownloadManegement'
import { NavChats } from './NavChats'
import { NavCowork } from './NavCowork'
import { NavMain } from './NavMain'
import { NavProjects } from './NavProjects'
import { NavTabs } from './NavTabs'
import { SidebarProfile } from './SidebarProfile'
import { useLeftPanel } from '@/hooks/useLeftPanel'

import {
  Sidebar,
  SidebarContent,
  SidebarTrigger,
  SidebarHeader,
  SidebarFooter,
  SidebarRail,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { useTitlebarLayout } from '@/stores/titlebar-layout-store'
import { useLocation } from '@tanstack/react-router'
import { isCoworkRoute, route } from '@/constants/routes'
import { isCoworkEnabled } from '@/lib/version'

export function LeftSidebar() {
  const { open: isLeftPanelOpen } = useLeftPanel()
  const { pathname } = useLocation()
  const inSettings =
    pathname === route.settings.index || pathname.startsWith('/settings/') || /^\/hub(?:\/|$)/.test(pathname)
  const [lastSurfacePath, setLastSurfacePath] = useState(pathname)
  if (!inSettings && lastSurfacePath !== pathname) setLastSurfacePath(pathname)
  const surfacePath = inSettings ? lastSurfacePath : pathname
  const isCowork = isCoworkRoute(surfacePath) && isCoworkEnabled()
  // Right-align the header and hide "Rey30 IDvj" when native controls own the top-left
  // (macOS, or a Linux DE placing buttons left).
  const leftButtons = useTitlebarLayout((s) => s.layout.left.length)
  const reserveLeft = IS_MACOS || leftButtons > 0
  return (
    <div className='relative z-50'>
      <Sidebar variant="floating" collapsible="offcanvas">
        <SidebarHeader className="flex px-1">
          <div className={cn("flex items-center w-full justify-between", reserveLeft && "justify-end")}>
            {!reserveLeft && <div className="ml-2 flex min-w-0 items-center gap-2">
              <img src="/images/rey30-idvj.svg" alt="" aria-hidden="true" className="size-7 shrink-0" width={28} height={28} />
              <span className="truncate font-medium font-studio">Rey30 IDvj</span>
            </div>}
            <div className="flex items-center">
              {isLeftPanelOpen && <DownloadManagement />}
              <SidebarTrigger className="text-muted-foreground rounded-full hover:bg-sidebar-foreground/8! -mt-0.5 relative z-50 ml-0.5" />
            </div>
          </div>
          <NavTabs surfacePath={surfacePath} />
          {isCowork ? <NavCowork /> : <NavMain />}
        </SidebarHeader>
        <SidebarContent className="mask-b-from-95% mask-t-from-98%">
          {!isCowork && (
            <>
              <NavProjects />
              <NavChats />
            </>
          )}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border bg-background/80 px-2 py-2">
          <SidebarProfile />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </div>
  )
}
