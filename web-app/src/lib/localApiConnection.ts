export function localApiConnection(port: number, prefix: string) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  const value = prefix.trim()
  if (value && !/^(?:\/[A-Za-z0-9._~-]+)*\/?$/.test(value)) return null
  if (value.split('/').some((part) => part === '.' || part === '..')) return null
  const path = value.replace(/\/$/, '')
  const origin = `http://127.0.0.1:${port}`
  return { origin, baseUrl: origin + path, modelsUrl: origin + path + '/models' }
}

export function newLocalApiKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return 'rey30_' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function clientConnectionJson(baseUrl: string, model: string, hasKey: boolean): string {
  return JSON.stringify({
    base_url: baseUrl,
    api_key: hasKey ? '<API_KEY>' : 'local',
    model,
  }, null, 2)
}
