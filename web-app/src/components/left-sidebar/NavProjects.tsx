import {
  FolderEditIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useThreadManagement } from "@/hooks/useThreadManagement"
import { Link, useNavigate } from "@tanstack/react-router"


import { useState } from "react"
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { ThreadFolder } from "@/services/projects/types"
import AddProjectDialog from "@/containers/dialogs/AddProjectDialog"
import { DeleteProjectDialog } from "@/containers/dialogs/DeleteProjectDialog"
import { useProjectDialog } from '@/hooks/useProjectDialog'
import { useCoworkFolderPicker } from '@/hooks/useCoworkFolderPicker'
import { isCoworkEnabled } from '@/lib/version'
import { route } from '@/constants/routes'

function ProjectItem({
  item,
  isMobile,
  onEdit,
  onDelete,
  openWorkspace,
  workspaceBusy,
}: {
  item: ThreadFolder
  isMobile: boolean
  onEdit: (project: ThreadFolder) => void
  onDelete: (project: ThreadFolder) => void
  openWorkspace?: (folder: string) => void
  workspaceBusy: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const workspace = item.workspaceFolder
  const label = <><FolderIcon className="text-foreground/70" size={16} aria-hidden="true" /><span>{item.name}</span></>
  return (
    <SidebarMenuItem>
      {workspace && openWorkspace ? (
        <SidebarMenuButton type="button" title={workspace} disabled={workspaceBusy} onClick={() => openWorkspace(workspace)}>
          {label}
        </SidebarMenuButton>
      ) : (
        <SidebarMenuButton asChild>
          <Link to={route.projectDetail} params={{ projectId: item.id }}>{label}</Link>
        </SidebarMenuButton>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover className="hover:bg-sidebar-foreground/8">
            <MoreHorizontal aria-hidden="true" />
            <span className="sr-only">{t('common:projects.options')}</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuItem onSelect={() => {
            navigate({ to: '/project/$projectId', params: { projectId: item.id } })
          }}>
            <FolderOpenIcon className="text-muted-foreground" />
            <span>{t('common:projects.view')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEdit(item)}>
            <FolderEditIcon className="text-muted-foreground" />
            <span>{t('ui-details:editProject')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(item)}>
            <Trash2 />
            <span>{t('ui-details:deleteProject')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

export function NavProjects() {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const { folders, addFolder, updateFolder, openWorkspaceProject } = useThreadManagement()
  const { open: createDialogOpen, setOpen: setCreateDialogOpen } = useProjectDialog()
  const folderPicker = useCoworkFolderPicker(async (folder) => {
    await openWorkspaceProject(folder)
    await navigate({ to: route.cowork })
  })
  const canOpenFolder = folderPicker.available && isCoworkEnabled()

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<ThreadFolder | null>(null)

  const handleEdit = (project: ThreadFolder) => {
    setSelectedProject(project)
    setEditDialogOpen(true)
  }

  const handleDelete = (project: ThreadFolder) => {
    setSelectedProject(project)
    setDeleteDialogOpen(true)
  }

  const handleSaveEdit = async (name: string, assistantId?: string) => {
    if (selectedProject) {
      await updateFolder(selectedProject.id, name, assistantId)
      setEditDialogOpen(false)
      setSelectedProject(null)
    }
  }

  const handleCreate = async (name: string, assistantId?: string) => {
    const project = await addFolder(name, assistantId)
    setCreateDialogOpen(false)
    await navigate({ to: route.projectDetail, params: { projectId: project.id } })
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>{t('common:projects.sidebarTitle')}</SidebarGroupLabel>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarGroupAction type="button" aria-label={t('common:projects.addProject')} className="top-2 size-8 cursor-pointer">
              <Plus aria-hidden="true" />
            </SidebarGroupAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="start" className="min-w-56 max-w-[calc(100vw-2rem)]">
            <DropdownMenuItem className="cursor-pointer" onSelect={() => setCreateDialogOpen(true)}>
              <FolderPlus aria-hidden="true" />
              {t('common:projects.createFromScratch')}
            </DropdownMenuItem>
            {canOpenFolder && <DropdownMenuItem className="cursor-pointer" disabled={folderPicker.picking} onSelect={() => void folderPicker.openFolder()}>
              <FolderOpenIcon aria-hidden="true" />
              {t('common:projects.loadExisting')}
            </DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        <SidebarMenu>
          {folders.map((item) => (
            <ProjectItem
              key={item.id}
              item={item}
              isMobile={isMobile}
              onEdit={handleEdit}
              onDelete={handleDelete}
              openWorkspace={canOpenFolder ? folder => void folderPicker.openFolder(folder) : undefined}
              workspaceBusy={folderPicker.picking}
            />
          ))}
        </SidebarMenu>
      </SidebarGroup>

      <AddProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        editingKey={null}
        onSave={handleCreate}
      />

      <AddProjectDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        editingKey={selectedProject?.id ?? null}
        initialData={selectedProject ?? undefined}
        onSave={handleSaveEdit}
      />

      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        projectId={selectedProject?.id}
        projectName={selectedProject?.name}
      />
    </>
  )
}
