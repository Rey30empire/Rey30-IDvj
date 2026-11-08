type BuildPlatformOptions = {
  tauriPlatform?: string
  isTauri?: string
  hostPlatform: string
}

export function resolveBuildPlatform({ tauriPlatform, isTauri, hostPlatform }: BuildPlatformOptions): string | undefined {
  if (tauriPlatform?.trim()) return tauriPlatform.trim()
  if (isTauri !== 'true') return undefined
  if (hostPlatform === 'win32') return 'windows'
  if (hostPlatform === 'darwin' || hostPlatform === 'linux') return hostPlatform
  return undefined
}
