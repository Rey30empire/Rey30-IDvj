import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'

const h = vi.hoisted(() => ({ pick: vi.fn(), validate: vi.fn(), addProject: vi.fn(), getProjects: vi.fn(), openWorkspaceProject: vi.fn() }))
vi.mock('@/lib/version', () => ({ isCoworkEnabled: () => true }))
vi.mock('@/lib/platform/utils', async (original) => ({
  ...(await original<typeof import('@/lib/platform/utils')>()),
  isPlatformTauri: () => true,
}))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({
  core: () => ({ invoke: h.pick }),
  projects: () => ({ getProjects: h.getProjects, addProject: h.addProject, openWorkspaceProject: h.openWorkspaceProject }),
}) }))
vi.mock('@/lib/agentTools', () => ({ validateCoworkFolder: h.validate, stopAgentSessionMonitors: vi.fn() }))
vi.mock('@/lib/backendStorage', () => ({ backendStorage: {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
} }))
vi.mock('@/containers/dialogs/AddProjectDialog', () => ({ default: ({ open, onSave }: { open: boolean; onSave: (name: string) => void }) => open && <div role="dialog"><button type="button" onClick={() => onSave('Proyecto nuevo')}>Guardar proyecto de prueba</button></div> }))
vi.mock('@/containers/dialogs/DeleteProjectDialog', () => ({ DeleteProjectDialog: () => null }))
vi.mock('@/containers/dialogs/SearchDialog', () => ({ SearchDialog: () => null }))
vi.mock('@/containers/dialogs/SkillsManagerDialog', () => ({ default: () => null }))

import { NavMain } from '../NavMain'
import { NavProjects } from '../NavProjects'
import { NavCowork } from '../NavCowork'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useProjectDialog } from '@/hooks/useProjectDialog'
import { ensureCoworkEnabled } from '@/lib/coworkAccess'

const folder = 'C:\\QA\\Proyecto vacío'
const pickedFolder = 'C:\\QA\\Alias del proyecto'
let restoreScroll: () => void

async function mountSidebar() {
  const root = createRootRoute({ component: () => (
    <TranslationContext.Provider value={{ t: i18n.t, i18n }}>
      <SidebarProvider><Outlet /></SidebarProvider>
    </TranslationContext.Provider>
  ) })
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <><NavMain /><NavProjects /></> })
  const workspace = createRoute({
    getParentRoute: () => root,
    path: '/cowork',
    beforeLoad: () => ensureCoworkEnabled(),
    component: NavCowork,
  })
  const project = createRoute({ getParentRoute: () => root, path: '/project/$projectId', component: NavProjects })
  const router = createRouter({ routeTree: root.addChildren([home, workspace, project]), history: createMemoryHistory() })
  await router.load()
  await act(async () => { render(<RouterProvider router={router} />) })
  return router
}

beforeEach(async () => {
  vi.clearAllMocks()
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  restoreScroll = () => { scroll.mockRestore() }
  h.pick.mockResolvedValue(pickedFolder)
  h.validate.mockResolvedValue(folder)
  h.getProjects.mockResolvedValue([])
  h.addProject.mockImplementation(async (name: string) => {
    const project = { id: 'project-qa', name, updated_at: 0 }
    h.getProjects.mockResolvedValue([project])
    return project
  })
  h.openWorkspaceProject.mockImplementation(async (workspaceFolder: string) => {
    const project = { id: 'workspace-qa', name: 'Proyecto vacío', updated_at: 0, workspaceFolder }
    h.getProjects.mockResolvedValue([project])
    return project
  })
  useProjectDialog.getState().setOpen(false)
  i18n.changeLanguage('es')
  useCoworkSessions.setState({ sessions: [], currentId: null })
  await useCoworkSessions.persist.rehydrate()
})
afterEach(() => restoreScroll())

async function openProjectMenu() {
  const plus = await screen.findByRole('button', { name: 'Agregar proyecto' })
  fireEvent.keyDown(plus, { key: 'Enter' })
  return plus
}

it('persists the canonical project and reopens its workspace without another picker', async () => {
  const router = await mountSidebar()
  expect(screen.getByText('Proyecto')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Hub' })).not.toBeInTheDocument()
  await openProjectMenu()
  expect(screen.getByRole('menuitem', { name: 'Crear proyecto desde cero' })).toBeVisible()
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Cargar proyecto existente' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/cowork'))
  expect(h.pick).toHaveBeenCalledWith('open_dialog', { options: { directory: true, multiple: false } })
  expect(h.validate).toHaveBeenCalledWith(pickedFolder)
  expect(h.openWorkspaceProject).toHaveBeenCalledWith(folder)
  const row = await screen.findByTestId('workspace-folder-session')
  expect(row).toHaveTextContent('Proyecto vacío')
  expect(row).toHaveAttribute('title', folder)
  expect(useCoworkSessions.getState().sessions).toEqual([expect.objectContaining({ folder, turns: [], messages: [] })])

  await act(async () => { await router.navigate({ to: '/' }) })
  const savedProject = await screen.findByRole('button', { name: 'Proyecto vacío' })
  expect(savedProject).toHaveAttribute('title', folder)
  fireEvent.click(savedProject)
  await waitFor(() => expect(router.state.location.pathname).toBe('/cowork'))
  expect(h.pick).toHaveBeenCalledTimes(1)
  expect(h.validate).toHaveBeenLastCalledWith(folder)
  expect(useCoworkSessions.getState().sessions).toHaveLength(1)

  const reopen = screen.getByRole('button', { name: 'Abrir carpeta' })
  fireEvent.click(reopen)
  await waitFor(() => {
    expect(h.validate).toHaveBeenCalledTimes(3)
    expect(reopen).toBeEnabled()
  })
  expect(useCoworkSessions.getState().sessions).toHaveLength(1)
})

it('keeps Home and its controls available when the picker is cancelled', async () => {
  h.pick.mockResolvedValue(null)
  const router = await mountSidebar()
  const plus = await openProjectMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Cargar proyecto existente' }))
  await waitFor(() => expect(h.pick).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(plus).toBeEnabled())
  expect(router.state.location.pathname).toBe('/')
  expect(h.validate).not.toHaveBeenCalled()
  expect(useCoworkSessions.getState().sessions).toEqual([])
})

it('creates a project using the existing persisted project route', async () => {
  const router = await mountSidebar()
  await openProjectMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Crear proyecto desde cero' }))
  expect(await screen.findByRole('dialog')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar proyecto de prueba' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/project/project-qa'))
  expect(h.addProject).toHaveBeenCalledWith('Proyecto nuevo', undefined)
  expect(await screen.findByRole('link', { name: 'Proyecto nuevo' })).toBeVisible()
})
