import { isDev } from './utils'
import { isPlatformTauri } from './platform/utils'

export const isNightly = VERSION.includes('-')
export const isBeta = VERSION.includes('beta')
export const isProd = !isNightly && !isBeta && !isDev()

/**
 * The workspace ships on Windows desktop and keeps the existing preview channels.
 * Read the bridge at runtime because a desktop build can also be opened in a browser.
 */
export const isCoworkEnabled = () =>
  (IS_WINDOWS && !isBeta && isPlatformTauri()) || (isNightly && !isBeta) || isDev()
