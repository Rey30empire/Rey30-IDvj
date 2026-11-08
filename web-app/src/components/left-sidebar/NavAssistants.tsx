import { useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { Bot, ChevronDown, Mic, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { route } from '@/constants/routes'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useAssistant } from '@/hooks/useAssistant'
import { useAvailableAssistants } from '@/hooks/useAvailableAssistants'
import { useThreads } from '@/hooks/useThreads'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  characterIdFromAssistantId,
  selectIntegratedAssistant,
} from '@/lib/characters/assistant-integration'
import { getCharacterChatRole, isCoderCharacter, isVoiceOnlyCharacter } from '@/lib/characters/profiles'
import { useCharacterStore } from '@/stores/useCharacterStore'

export function NavAssistants() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const assistants = useAvailableAssistants()
  const selectedId = useAssistant((state) => state.currentAssistant?.id)
  const profiles = useCharacterStore((state) => state.profiles)
  const loaded = useCharacterStore((state) => state.loaded)
  const error = useCharacterStore((state) => state.error)
  const threads = useThreads((state) => state.threads)
  const loadingThreads = useThreads((state) => state.isLoadingThreads)
  const [expanded, setExpanded] = useState(true)
  const [openingId, setOpeningId] = useState<string>()
  const opening = useRef(false)

  const latestChats = useMemo(() => {
    const byAssistant = new Map<string, Thread>()
    for (const thread of Object.values(threads)) {
      const id = thread.assistants?.[0]?.id
      if (!id || thread.metadata?.project || thread.metadata?.isTemporary || thread.id === TEMPORARY_CHAT_ID) continue
      const latest = byAssistant.get(id)
      if (!latest || thread.updated > latest.updated) byAssistant.set(id, thread)
    }
    return byAssistant
  }, [threads])

  async function openNewChat(id: string) {
    if (opening.current) return
    opening.current = true
    setOpeningId(id)
    try {
      await selectIntegratedAssistant(id)
      useAgentMode.getState().removeThread(TEMPORARY_CHAT_ID)
      await navigate({ to: route.home, search: {} })
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('assistants:openError'))
    } finally {
      opening.current = false
      setOpeningId(undefined)
    }
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel asChild>
        <button type="button" aria-expanded={expanded} aria-controls="sidebar-assistants" className="w-fit cursor-pointer gap-1" onClick={() => setExpanded(!expanded)}>
          {t('assistants:title')}
          <ChevronDown aria-hidden="true" className={expanded ? 'size-3' : 'size-3 -rotate-90'} />
        </button>
      </SidebarGroupLabel>
      <SidebarGroupAction asChild>
        <Link to={route.settings.assistant} aria-label={t('assistants:manage')} title={t('assistants:manage')}>
          <Settings2 aria-hidden="true" />
        </Link>
      </SidebarGroupAction>
      <SidebarMenu id="sidebar-assistants" hidden={!expanded} className={expanded ? undefined : 'hidden'}>
        {!loaded && (
          <li className="px-2 text-xs text-muted-foreground" role={error ? 'alert' : 'status'}>
            {error ? t('assistants:loadError') : t('assistants:loading')}
          </li>
        )}
        {assistants.map((assistant) => {
          const profileId = characterIdFromAssistantId(assistant.id)
          if (profileId && !loaded) return null
          const profile = profiles.find((item) => item.id === profileId)
          const voiceOnly = profile && isVoiceOnlyCharacter(profile)
          const subtitle = voiceOnly ? t('assistants:voiceOnly') : profile ? getCharacterChatRole(profile).label : undefined
          const Icon = voiceOnly ? Mic : Bot
          const content = (
            <>
              <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground">
                {profile && !voiceOnly ? assistant.name.trim().slice(0, 1).toUpperCase() : <Icon size={14} />}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{assistant.name}</span>
                {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
              </span>
            </>
          )
          const chat = latestChats.get(assistant.id)
          // Coder works with the full toolset (files, shell, web, the PC), which lives in Cowork.
          const coder = profile && isCoderCharacter(profile)
          return (
            <SidebarMenuItem key={assistant.id} data-testid={`sidebar-assistant-${assistant.id}`}>
              {coder ? (
                <SidebarMenuButton asChild size="lg" className="h-auto min-h-11 py-1.5" isActive={pathname === route.cowork}>
                  <Link to={route.cowork} activeProps={{ 'aria-current': 'page' }}>
                    {content}
                  </Link>
                </SidebarMenuButton>
              ) : chat ? (
                <SidebarMenuButton asChild size="lg" className="h-auto min-h-11 py-1.5" isActive={pathname === `/threads/${chat.id}`}>
                  <Link to="/threads/$threadId" params={{ threadId: chat.id }} activeProps={{ 'aria-current': 'page' }}>
                    {content}
                  </Link>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton type="button" size="lg" className="h-auto min-h-11 cursor-pointer py-1.5" isActive={pathname === route.home && selectedId === assistant.id} aria-pressed={pathname === route.home && selectedId === assistant.id} aria-busy={openingId === assistant.id} disabled={loadingThreads || Boolean(openingId)} onClick={() => void openNewChat(assistant.id)}>
                  {content}
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
