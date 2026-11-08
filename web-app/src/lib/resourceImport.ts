import { invoke } from '@tauri-apps/api/core'

export type ImportKind = 'skill' | 'agent' | 'instruction' | 'mcp'
export type ImportCandidate = {
  id: string
  kind: ImportKind
  name: string
  description: string
  source: string
  sourcePath: string
  preview: string
  warnings: string[]
  conflict: boolean
  importable: boolean
}
export type ImportPlan = {
  id: string
  candidates: ImportCandidate[]
  warnings: string[]
}
export type ImportResult = {
  installed: { id: string; kind: ImportKind; name: string; path: string }[]
  errors: string[]
  warnings: string[]
}
export type GitHubStatus = {
  available: boolean
  authenticated: boolean
  login?: string
  message?: string
}
export type GitHubLogin = {
  id: string
  status: 'pending' | 'complete' | 'error' | 'cancelled'
  code?: string
  url?: string
  message?: string
}
export type GitHubRepository = {
  fullName: string
  description: string
  private: boolean
  defaultBranch: string
}
export type GitHubRepositoryPage = {
  repos: GitHubRepository[]
  page: number
  hasMore: boolean
}

export const RESOURCE_IMPORT_EVENT = 'rey30:resources-imported'

export const scanResources = (options: { projectPath?: string; path?: string } = {}) =>
  invoke<ImportPlan>('import_resources_scan', options)
export const commitResources = (planId: string, candidateIds: string[]) =>
  invoke<ImportResult>('import_resources_commit', { planId, candidateIds })
export const githubStatus = () =>
  invoke<GitHubStatus>('import_resources_github_status')
export const githubLogin = () =>
  invoke<GitHubLogin>('import_resources_github_login')
export const githubPoll = (sessionId: string) =>
  invoke<GitHubLogin>('import_resources_github_poll', { sessionId })
export const githubCancel = (sessionId: string) =>
  invoke<void>('import_resources_github_cancel', { sessionId })
export const githubRepos = (page = 1) =>
  invoke<GitHubRepositoryPage>('import_resources_github_repos', { page })
export const githubScan = (repository: string) =>
  invoke<ImportPlan>('import_resources_github_scan', { repository })
