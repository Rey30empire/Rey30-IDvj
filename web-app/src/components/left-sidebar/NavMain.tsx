import { useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { MessageCircleIcon, type MessageCircleIconHandle } from '@/components/animated-icon/message-circle'
import { PlatformMetaKey } from '@/containers/PlatformMetaKey'
import { SearchDialog } from '@/containers/dialogs/SearchDialog'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useSearchDialog } from '@/hooks/useSearchDialog'
import { useAgentMode } from '@/hooks/useAgentMode'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { route } from '@/constants/routes'
import { PlatformShortcuts, ShortcutAction } from '@/lib/shortcuts'

export function NavMain() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { open: searchOpen, setOpen: setSearchOpen } = useSearchDialog()
  const chatIcon = useRef<MessageCircleIconHandle>(null)

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            type="button"
            data-testid="new-chat-button"
            onMouseEnter={() => chatIcon.current?.startAnimation()}
            onMouseLeave={() => chatIcon.current?.stopAnimation()}
            onClick={() => {
              useAgentMode.getState().removeThread(TEMPORARY_CHAT_ID)
              void navigate({ to: route.home })
            }}
          >
            <MessageCircleIcon ref={chatIcon} className="text-foreground/70" size={16} />
            <span>{t('common:newChat')}</span>
            <KbdGroup className="ml-auto scale-90 gap-0">
              <Kbd className="bg-transparent size-3"><PlatformMetaKey /></Kbd>
              <Kbd className="bg-transparent size-3 uppercase">{PlatformShortcuts[ShortcutAction.NEW_CHAT].key}</Kbd>
            </KbdGroup>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}
