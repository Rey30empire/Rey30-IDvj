import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import HeaderPage from '../HeaderPage'
import { useThreads } from '@/hooks/useThreads'
import { usePrompt } from '@/hooks/usePrompt'

const h = vi.hoisted(() => ({ open: true, sidebar: vi.fn() }))
vi.mock('@/hooks/useLeftPanel', () => ({
  useLeftPanel: () => ({ open: h.open, setLeftPanel: h.sidebar }),
}))
vi.mock('@/containers/DownloadManegement', () => ({
  DownloadManagement: () => null,
}))

const ownedThread = (id: string, updated: number): Thread => ({
  id,
  title: `Chat propio ${id}`,
  updated,
  model: { id: 'metadata-only', provider: 'qa-not-started' },
  assistants: [],
})

async function mountAt(entries: string[]) {
  const root = createRootRoute({ component: Outlet })
  const routes = [
    '/',
    '/threads/$threadId',
    '/cowork',
    '/settings/general',
    '/hub/',
    '/hub/$modelId',
    '/project/$projectId',
    '/artifacts',
  ].map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      component: () => (
        <HeaderPage>
          <h1>Página de prueba</h1>
        </HeaderPage>
      ),
    })
  )
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: entries }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { name: 'Página de prueba' })
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  h.open = true
  useThreads.setState({ threads: {}, currentThreadId: undefined })
  usePrompt.setState({
    prompt: 'BORRADOR PROPIO SIN ENVIAR',
    draftPrompt: 'OTRO BORRADOR PROPIO',
  })
})

afterEach(() => vi.restoreAllMocks())

describe('Volver en el encabezado compartido con historial real de TanStack', () => {
  it.each([
    '/settings/general',
    '/hub/',
    '/hub/owned-model',
    '/project/owned-project',
    '/artifacts',
  ])(
    'muestra el botón accesible en %s sin alterar controles ni contenido',
    async (pathname) => {
      await mountAt([pathname])
      const button = screen.getByRole('button', { name: 'Volver' })
      expect(button).toBeVisible()
      expect(button).toHaveTextContent('Volver')
      expect(button).toHaveClass('relative', 'z-50')
      button.focus()
      expect(button).toHaveFocus()
      expect(screen.getByRole('heading')).toHaveTextContent('Página de prueba')
    }
  )

  it.each(['/', '/threads/owned-thread', '/cowork'])(
    'no añade una flecha de página secundaria en la ruta de conversación %s',
    async (pathname) => {
      await mountAt([pathname])
      expect(screen.queryByRole('button', { name: 'Volver' })).toBeNull()
    }
  )

  it('regresa a la entrada interna anterior exacta y conserva hilo, modelo y borradores', async () => {
    const thread = ownedThread('owned-thread', 10)
    useThreads.setState({
      threads: { [thread.id]: thread },
      currentThreadId: thread.id,
    })
    const router = await mountAt([
      '/threads/owned-thread?draft=owned#message-owned',
      '/settings/general',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/threads/owned-thread')
    )
    expect(router.state.location.search).toEqual({ draft: 'owned' })
    expect(router.state.location.hash).toBe('message-owned')
    expect(useThreads.getState().threads).toEqual({ [thread.id]: thread })
    expect(useThreads.getState().currentThreadId).toBe(thread.id)
    expect(usePrompt.getState()).toMatchObject({
      prompt: 'BORRADOR PROPIO SIN ENVIAR',
      draftPrompt: 'OTRO BORRADOR PROPIO',
    })
  })

  it('respeta el historial entre Hub y Ajustes antes de usar cualquier fallback de chat', async () => {
    useThreads.setState({
      threads: { latest: ownedThread('latest', 99) },
      currentThreadId: 'latest',
    })
    const router = await mountAt(['/settings/general', '/hub/'])
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/general')
    )
    expect(screen.getByRole('button', { name: 'Volver' })).toBeVisible()
  })

  it('sin historial prioriza el hilo actual existente y reemplaza la página secundaria', async () => {
    const current = ownedThread('current', 1)
    const recent = ownedThread('recent', 99)
    useThreads.setState({
      threads: { current, recent },
      currentThreadId: 'current',
    })
    const router = await mountAt(['/settings/general'])
    expect(router.history.canGoBack()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/threads/current')
    )
    expect(router.history.canGoBack()).toBe(false)
    expect(useThreads.getState().threads).toEqual({ current, recent })
  })

  it('ignora un hilo eliminado y vuelve al chat existente más reciente', async () => {
    const older = ownedThread('older', 5)
    const latest = ownedThread('latest', 10)
    useThreads.setState({
      threads: { older, latest },
      currentThreadId: 'deleted-owned',
    })
    const router = await mountAt(['/hub/'])
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/threads/latest')
    )
    expect(Object.keys(useThreads.getState().threads)).toEqual([
      'older',
      'latest',
    ])
  })

  it('en acceso directo sin chats vuelve a Inicio sin crear una conversación ni borrar el borrador', async () => {
    const router = await mountAt(['/hub/'])
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(router.history.canGoBack()).toBe(false)
    expect(useThreads.getState().threads).toEqual({})
    expect(usePrompt.getState().prompt).toBe('BORRADOR PROPIO SIN ENVIAR')
    expect(screen.queryByRole('button', { name: 'Volver' })).toBeNull()
  })

  it('mantiene la posición disponible junto al control de barra lateral cuando está contraída', async () => {
    h.open = false
    await mountAt(['/settings/general'])
    expect(screen.getByRole('button', { name: 'Volver' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(h.sidebar).toHaveBeenCalledWith(true)
  })
})
