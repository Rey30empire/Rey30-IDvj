import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { useAssistant } from '@/hooks/useAssistant'
import { useAvailableAssistants } from '@/hooks/useAvailableAssistants'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { CharacterEditorDialog } from '@/containers/characters/CharacterPanel'
import { assistantDisplayName, characterAssistantId } from '@/lib/characters/assistant-integration'
import { getCharacterChatRole } from '@/lib/characters/profiles'

import HeaderPage from '@/containers/HeaderPage'
import { IconCirclePlus, IconPencil, IconTrash } from '@tabler/icons-react'
import AddEditAssistant from '@/containers/dialogs/AddEditAssistant'
import { DeleteAssistantDialog } from '@/containers/dialogs'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import SettingsMenu from '@/containers/SettingsMenu'
import { cn } from '@/lib/utils'
import { Card, CardItem } from '@/containers/Card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronsUpDown } from 'lucide-react'
import { DropdownMenuSeparator } from '@radix-ui/react-dropdown-menu'

export const Route = createFileRoute('/settings/assistant')({
  component: AssistantContent,
})

export function AssistantContent() {
  const { t } = useTranslation()
  const { 
    assistants,
    addAssistant,
    updateAssistant,
    deleteAssistant,
    defaultAssistantId,
    setDefaultAssistant
  } = useAssistant()
  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const availableAssistants = useAvailableAssistants()
  const characterProfiles = useCharacterStore(state => state.profiles)
  const [editingCharacter, setEditingCharacter] = useState<string | null>(null)

  const handleDelete = (id: string) => {
    setDeletingId(id)
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = () => {
    if (deletingId) {
      deleteAssistant(deletingId)
      setDeleteConfirmOpen(false)
      setDeletingId(null)
    }
  }

  const handleSave = async (assistant: Assistant) => {
    if (editingKey) {
      await updateAssistant(assistant)
    } else {
      await addAssistant(assistant)
    }
    setOpen(false)
    setEditingKey(null)
  }

  const sortedAssistants = assistants.slice().sort((a, b) => a.created_at - b.created_at)
  const defaultAssistant = availableAssistants.find((a) => a.id === defaultAssistantId)

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className={cn("flex items-center justify-between w-full mr-2 pr-3", !IS_MACOS && "pr-30")}>
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
          <Button
            onClick={() => {
              setEditingKey(null)
              setOpen(true)
            }}
            size="sm"
            variant="outline"
            className="relative z-50"
          >
            <IconCirclePlus size={16} />
            {t('assistants:addAssistant')}
          </Button>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <div className="flex size-full">
          <SettingsMenu />
          <div className="flex flex-col gap-4 p-4 pt-4 w-full overflow-y-auto">
            {/* Default Assistant */}
            <Card>
              <CardItem
                title={t('assistants:defaultAssistantSection')}
                description={t('assistants:defaultAssistantDesc')}
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button data-testid="default-assistant-trigger" aria-label="Asistente predeterminado" variant="outline" size="sm" className="justify-between">
                        <span className={cn('truncate')}>
                          {defaultAssistant?.name ?? t('assistants:lastUsed')}
                        </span>
                        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 max-h-80">
                      <DropdownMenuItem
                        key="none"
                        className={cn(
                          'cursor-pointer my-0.5',
                          !defaultAssistantId && 'bg-secondary-foreground/8'
                        )}
                        onClick={() => setDefaultAssistant('')}
                      >
                        {t('assistants:lastUsed')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {availableAssistants.map((a) => (
                        <DropdownMenuItem
                          key={a.id}
                          className={cn(
                            'cursor-pointer my-0.5',
                            defaultAssistantId === a.id && 'bg-secondary-foreground/8'
                          )}
                          onClick={() => setDefaultAssistant(a.id)}
                        >
                          {a.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              <h1 className="text-foreground font-studio font-medium text-sm mt-4 mb-4">{t('assistants:allAssistants')}</h1>
              {characterProfiles.map(profile => <div data-testid="assistant-character-row" data-character-id={profile.id} key={profile.id} className="group my-1 flex items-center gap-3 rounded-lg bg-secondary/20 px-3 py-3 transition-colors hover:bg-secondary dark:hover:bg-secondary/20">
                <div aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-xs font-medium dark:bg-secondary/40">{profile.name.split(' ').slice(0, 2).map(part => part[0]).join('')}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate font-studio text-sm font-medium">{assistantDisplayName(profile.id, profile.name)}</span>{defaultAssistantId === characterAssistantId(profile.id) && <span className="shrink-0 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">{t('assistants:isDefault')}</span>}</div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{getCharacterChatRole(profile).label} · {getCharacterChatRole(profile).description}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{profile.modelBinding ? `${profile.modelBinding.providerId} · ${profile.modelBinding.modelId}` : 'Asignación automática de modelo local pequeño'}</p>
                </div>
                <Button variant="ghost" size="icon-xs" aria-label={`Editar ${profile.name}`} onClick={() => setEditingCharacter(profile.id)}><IconPencil className="size-4 text-muted-foreground" /></Button>
              </div>)}
              {sortedAssistants.map((assistant) => (
                <div
                  className="group flex items-center gap-3 px-3 py-3 rounded-lg my-1 bg-secondary/20 hover:bg-secondary dark:hover:bg-secondary/20 transition-colors"
                  key={assistant.id}
                >
                  <div className="size-9 shrink-0 flex items-center justify-center bg-secondary dark:bg-secondary/40 rounded-lg">
                    {assistant?.avatar && (
                      <AvatarEmoji
                        avatar={assistant?.avatar}
                        imageClassName="size-6 object-contain"
                        textClassName="text-2xl"
                      />
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-studio font-medium truncate">
                        {assistantDisplayName(assistant.id, assistant.name)}
                      </span>
                      {defaultAssistantId === assistant.id && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-muted-foreground bg-foreground/10 leading-none shrink-0">
                          {t('assistants:isDefault')}
                        </span>
                      )}
                    </div>
                    {assistant.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1 pr-12 mt-0.5">
                        {assistant.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title={t('assistants:editAssistant')}
                      onClick={() => {
                        setEditingKey(assistant.id)
                        setOpen(true)
                      }}
                    >
                      <IconPencil className="text-muted-foreground size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title={t('assistants:deleteAssistant')}
                      onClick={() => handleDelete(assistant.id)}
                    >
                      <IconTrash className="text-destructive size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          </div>
          <AddEditAssistant
            open={open}
            onOpenChange={setOpen}
            editingKey={editingKey}
            initialData={
              editingKey
                ? assistants.find((a) => a.id === editingKey)
                : undefined
            }
            onSave={handleSave}
          />
          <CharacterEditorDialog open={Boolean(editingCharacter)} characterId={editingCharacter ?? undefined} onOpenChange={next => { if (!next) setEditingCharacter(null) }} />
          <DeleteAssistantDialog
            open={deleteConfirmOpen}
            onOpenChange={setDeleteConfirmOpen}
            onConfirm={confirmDelete}
          />
        </div>
      </div>
    </div>
  )
}
