import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { IconBook2, IconBrandGithub, IconChevronUp, IconFolderPlus, IconSettings, IconUser } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLocalProfile } from '@/hooks/useLocalProfile'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import LocalProfileDialog from '@/containers/dialogs/LocalProfileDialog'
import ImportResourcesDialog from '@/containers/dialogs/ImportResourcesDialog'
import { AppResourcesDialog } from '@/containers/dialogs/AppResourcesDialog'

export function SidebarProfile() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const profile = useLocalProfile((state) => state.profile)
  const [profileOpen, setProfileOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [importSource, setImportSource] = useState<'local' | 'github'>('local')
  const openResources = (source: 'local' | 'github') => {
    setImportSource(source)
    setImportOpen(true)
  }

  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid="profile-menu-trigger" variant="ghost" className="h-auto min-h-12 w-full justify-start gap-3 rounded-xl px-2 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground" aria-label={t('profile:openMenu', { name: profile.name })}>
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 font-studio text-sm font-medium text-foreground">{profile.initials}</span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium">{profile.name}</span>
            <span className="block text-xs text-muted-foreground">{t('profile:local')}</span>
          </span>
          <IconChevronUp size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-64 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="font-studio">Rey30 IDvj</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setProfileOpen(true)}><IconUser size={16} aria-hidden="true" />{t('profile:title')}</DropdownMenuItem>
        <DropdownMenuItem asChild><Link to={route.settings.general}><IconSettings size={16} aria-hidden="true" />{t('common:settings')}</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openResources('github')}><IconBrandGithub size={16} aria-hidden="true" />GitHub</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openResources('local')}><IconFolderPlus size={16} aria-hidden="true" />{t('integrations:title')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setHelpOpen(true)}><IconBook2 size={16} aria-hidden="true" />{t('profile:documentation')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <LocalProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    <AppResourcesDialog resource={helpOpen ? 'readme' : null} onClose={() => setHelpOpen(false)} />
    <ImportResourcesDialog open={importOpen} onOpenChange={setImportOpen} initialSource={importSource} onOpenMCP={() => navigate({ to: route.settings.mcp_servers })} />
  </>
}
