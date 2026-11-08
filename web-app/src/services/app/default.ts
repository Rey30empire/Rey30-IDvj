/**
 * Default App Service - Generic implementation with minimal returns
 */

import type { AppService, FactoryResetOptions, LogEntry } from './types'

export class DefaultAppService implements AppService {
  async factoryReset(options?: FactoryResetOptions): Promise<void> {
    void options
    throw new Error('El restablecimiento de fábrica está deshabilitado. Usa la recuperación de preferencias.')
  }

  async readLogs(): Promise<LogEntry[]> {
    return []
  }

  parseLogLine(line: string): LogEntry {
    return {
      timestamp: Date.now(),
      level: 'info',
      target: 'default',
      message: line ?? '',
    }
  }

  async getRey30DataFolder(): Promise<string | undefined> {
    return undefined
  }

  async relocateRey30DataFolder(path: string): Promise<void> {
    console.log('relocateRey30DataFolder called with path:', path)
    // No-op - not implemented in default service
  }

  async getServerStatus(): Promise<boolean> {
    return false
  }

  async setServerRunInBackground(enabled: boolean): Promise<void> {
    // No-op - tray/background behavior only exists in the desktop app
    void enabled
  }

  async readYaml<T = unknown>(path: string): Promise<T> {
    console.log('readYaml called with path:', path)
    throw new Error('readYaml not implemented in default app service')
  }
}
