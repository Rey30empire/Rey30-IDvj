import { beforeEach, describe, expect, it, vi } from 'vitest'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue({}) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
import { scanResources, commitResources, githubStatus, githubLogin, githubPoll, githubCancel, githubRepos, githubScan } from '../resourceImport'

describe('resource import native bridge', () => {
  beforeEach(() => invoke.mockClear())

  it('sends the scan source and the explicit reviewed selection to separate commands', async () => {
    await scanResources({ projectPath: 'C:/project', path: 'C:/copy' })
    expect(invoke).toHaveBeenLastCalledWith('import_resources_scan', { projectPath: 'C:/project', path: 'C:/copy' })
    await commitResources('plan-1', ['mcp-1'])
    expect(invoke).toHaveBeenLastCalledWith('import_resources_commit', { planId: 'plan-1', candidateIds: ['mcp-1'] })
  })

  it('uses the fixed GitHub login, pagination, cancellation and inspection contracts', async () => {
    await githubStatus()
    await githubLogin()
    await githubPoll('auth-1')
    await githubCancel('auth-1')
    await githubRepos(2)
    await githubScan('rey30/REA')
    expect(invoke.mock.calls).toEqual([
      ['import_resources_github_status'],
      ['import_resources_github_login'],
      ['import_resources_github_poll', { sessionId: 'auth-1' }],
      ['import_resources_github_cancel', { sessionId: 'auth-1' }],
      ['import_resources_github_repos', { page: 2 }],
      ['import_resources_github_scan', { repository: 'rey30/REA' }],
    ])
  })
})
