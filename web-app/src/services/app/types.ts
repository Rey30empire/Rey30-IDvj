/**
 * App Service Types
 */

export interface LogEntry {
  timestamp: string | number
  level: 'info' | 'warn' | 'error' | 'debug'
  target: string
  message: string
}

export interface FactoryResetOptions {
  keepAppData: boolean
  keepModelsAndConfigs: boolean
  clearWebData?: boolean
}

export interface AppService {
  factoryReset(options?: FactoryResetOptions): Promise<void>
  readLogs(): Promise<LogEntry[]>
  parseLogLine(line: string): LogEntry
  getRey30DataFolder(): Promise<string | undefined>
  relocateRey30DataFolder(path: string): Promise<void>
  getServerStatus(): Promise<boolean>
  setServerRunInBackground(enabled: boolean): Promise<void>
  readYaml<T = unknown>(path: string): Promise<T>
}
