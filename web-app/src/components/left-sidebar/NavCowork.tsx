import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
  SidebarGroup,
  SidebarGroupLabel,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { stopAgentSessionMonitors } from '@/lib/agentTools'
import { dropMonitorLane } from '@/lib/coworkMonitor'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import {
  Box,
  FolderOpen,
  SlidersHorizontal,
  MoreHorizontal,
  Trash2,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import {
  MessageCircleIcon,
  type MessageCircleIconHandle,
} from '@/components/animated-icon/message-circle'
import {
  AnimatedLucideIcon,
  type AnimatedLucideIconHandle,
  type AnimatedLucidePreset,
} from '@/components/animated-icon/animated-lucide'
import {
  startNewSession,
  useCoworkSessions,
  type CoworkSession,
} from '@/hooks/useCoworkSessions'
import { useCoworkRun, useIsSessionActive } from '@/hooks/useCoworkRun'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import SkillsManagerDialog from '@/containers/dialogs/SkillsManagerDialog'
import { useCoworkFolderPicker } from '@/hooks/useCoworkFolderPicker'
import { basenameOf } from '@/lib/coworkPreview'

type CoworkNavItem = {
  title: string
  icon: LucideIcon
  preset: AnimatedLucidePreset
  onClick: () => void
}

// An unbound, untouched session can be discarded once it leaves the sidebar.
const pruneEmpty = () => {
  const running = Object.keys(useCoworkRun.getState().runId)
  useCoworkSessions.getState().pruneEmptySessions(running)
}

// Own component (not inlined in a .map()) so it can be memoized: each row's
// running state comes from its own per-session selector (useIsSessionActive),
// so a session starting or stopping a run only re-renders its own row, not the
// whole session list — mirroring ThreadList.tsx's memoized ThreadItem +
// useIsThreadActive.
const SessionItem = memo(function SessionItem({
  session,
  isCurrent,
  isMobile,
  onSelect,
  onRequestDelete,
}: {
  session: CoworkSession
  isCurrent: boolean
  isMobile: boolean
  onSelect: (id: string) => void
  onRequestDelete: (pending: { id: string; title: string }) => void
}) {
  const { t } = useTranslation()
  const isRunning = useIsSessionActive(session.id)
  const label = session.folder ? basenameOf(session.folder) : session.title === 'New session' ? t('common:newSession') : session.title

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isCurrent}
        onClick={() => onSelect(session.id)}
        title={session.folder ?? label}
        data-testid={session.folder ? 'workspace-folder-session' : undefined}
      >
        {isRunning && (
          <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            showOnHover
            className="hover:bg-sidebar-foreground/8"
          >
            <MoreHorizontal />
            <span className="sr-only">{t('common:workspace.sessionOptions', { name: label })}</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48"
          side={isMobile ? 'bottom' : 'right'}
          align={isMobile ? 'end' : 'start'}
        >
          <DropdownMenuItem
            variant="destructive"
            onSelect={() =>
              onRequestDelete({ id: session.id, title: label })
            }
          >
            <Trash2 />
            <span>{t('common:deleteSession')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
})

function CoworkNavItemRow({ item }: { item: CoworkNavItem }) {
  const iconRef = useRef<AnimatedLucideIconHandle>(null)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onBlur={() => iconRef.current?.stopAnimation()}
        onClick={item.onClick}
        onFocus={() => iconRef.current?.startAnimation()}
        onMouseEnter={() => iconRef.current?.startAnimation()}
        onMouseLeave={() => iconRef.current?.stopAnimation()}
      >
        <AnimatedLucideIcon
          ref={iconRef}
          icon={item.icon}
          preset={item.preset}
          className="text-foreground/70"
          size={16}
        />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function NavCowork() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isMobile } = useSidebar()
  const sessions = useCoworkSessions((s) => s.sessions)
  const currentId = useCoworkSessions((s) => s.currentId)
  // An explicitly opened folder remains reachable before its first question.
  const runIds = useCoworkRun((s) => s.runId)
  const visibleSessions = useMemo(
    () => sessions.filter((s) => !!s.folder || s.turns.length > 0 || !!s.messages?.length || runIds[s.id] != null),
    [sessions, runIds]
  )
  const [skillsOpen, setSkillsOpen] = useState(false)
  // Session pending deletion; drives the confirm dialog (null = closed).
  const [pendingDelete, setPendingDelete] = useState<{
    id: string
    title: string
  } | null>(null)

  const goCowork = useCallback(() => navigate({ to: route.cowork }), [navigate])
  const folderPicker = useCoworkFolderPicker(goCowork)
  const newSessionIconRef = useRef<MessageCircleIconHandle>(null)
  const newSession = () => {
    startNewSession(Object.keys(useCoworkRun.getState().runId))
    goCowork()
  }
  const selectSession = useCallback(
    (id: string) => {
      useCoworkSessions.getState().selectSession(id)
      pruneEmpty()
      goCowork()
    },
    [goCowork]
  )

  const items: CoworkNavItem[] = [
    {
      title: t('common:artifacts'),
      icon: Box,
      preset: 'box',
      onClick: () => navigate({ to: route.artifacts }),
    },
    {
      title: t('common:customize'),
      icon: SlidersHorizontal,
      preset: 'sliders',
      onClick: () => setSkillsOpen(true),
    },
  ]

  const confirmDelete = () => {
    if (pendingDelete) {
      const sid = pendingDelete.id
      // Watchers are the session's, so they go with it: stopped in Rust, their
      // lane forgotten, their rail entries dropped.
      void stopAgentSessionMonitors(sid)
      dropMonitorLane(sid)
      useCoworkRun.getState().clearMonitors(sid)
      useCoworkSessions.getState().deleteSession(sid)
    }
    setPendingDelete(null)
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={newSession}
            onMouseEnter={() => newSessionIconRef.current?.startAnimation()}
            onMouseLeave={() => newSessionIconRef.current?.stopAnimation()}
          >
            <MessageCircleIcon
              ref={newSessionIconRef}
              className="text-foreground/70"
              size={16}
            />
            <span>{t('common:newSession')}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {folderPicker.available && (
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="open-project-folder"
              disabled={folderPicker.picking}
              onClick={() => void folderPicker.openFolder()}
            >
              <FolderOpen aria-hidden="true" className="size-4 text-foreground/70" />
              <span>{t('common:workspace.openFolder')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        {items.map((item) => (
          <CoworkNavItemRow key={item.title} item={item} />
        ))}
      </SidebarMenu>

      {/* px-0: the group's own p-2 would indent the session rows past the nav
          rows above it, which share the header's px-1. */}
      {visibleSessions.length > 0 && (
        <SidebarGroup className="px-0 group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>{t('common:sessions')}</SidebarGroupLabel>
          <SidebarMenu>
            {visibleSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isCurrent={session.id === currentId}
                isMobile={isMobile}
                onSelect={selectSession}
                onRequestDelete={setPendingDelete}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      )}

      <SkillsManagerDialog open={skillsOpen} onOpenChange={setSkillsOpen} />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common:deleteSessionTitle')}</DialogTitle>
            <DialogDescription>
              {t('common:deleteSessionBody', { title: pendingDelete?.title })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPendingDelete(null)}
            >
              {t('common:cancel')}
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDelete}>
              {t('common:delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
