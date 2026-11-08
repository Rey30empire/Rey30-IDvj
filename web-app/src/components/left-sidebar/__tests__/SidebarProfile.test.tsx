import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SidebarProfile } from '../SidebarProfile'
import { DEFAULT_LOCAL_PROFILE, useLocalProfile } from '@/hooks/useLocalProfile'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a href={to} {...props}>{children}</a>,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/containers/dialogs/ImportResourcesDialog', () => ({ default: ({ open, initialSource }: { open: boolean; initialSource: string }) => open ? <div data-testid="import-source">{initialSource}</div> : null }))
vi.mock('@/containers/dialogs/AppResourcesDialog', () => ({ AppResourcesDialog: ({ resource }: { resource: string | null }) => resource ? <div>Local README</div> : null }))

beforeEach(() => {
  useLocalProfile.setState({ profile: { ...DEFAULT_LOCAL_PROFILE } })
})
const openMenu = () => fireEvent.keyDown(screen.getByTestId('profile-menu-trigger'), { key: 'Enter' })

it('opens the profile and exposes real settings and local documentation destinations', async () => {
  render(<SidebarProfile />)
  openMenu()
  expect(await screen.findByRole('menuitem', { name: 'common:settings' })).toHaveAttribute('href', '/settings/general')
  fireEvent.click(screen.getByRole('menuitem', { name: 'profile:title' }))
  expect(await screen.findByTestId('local-profile-dialog')).toBeInTheDocument()
})

it.each([['GitHub', 'github'], ['integrations:title', 'local']])('opens %s in the existing resource workflow without requiring profile sign-in', async (name, source) => {
  render(<SidebarProfile />)
  openMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name }))
  expect(await screen.findByTestId('import-source')).toHaveTextContent(source)
})

it('opens the documentation bundled with the app', async () => {
  render(<SidebarProfile />)
  openMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: 'profile:documentation' }))
  expect(await screen.findByText('Local README')).toBeInTheDocument()
})
