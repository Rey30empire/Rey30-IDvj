import { invoke } from '@tauri-apps/api/core'
import type { ImportPlan } from '@/lib/resourceImport'

export const OPENCLAW_MCP_TEMPLATE = {
  name: 'io.rey30/openclaw-cli',
  version: '1',
} as const

export type CatalogServer = {
  name: string
  title: string
  description: string
  version: string
  transports: string[]
  packages: string[]
  status: string
}
export type CatalogPage = {
  servers: CatalogServer[]
  nextCursor: string | null
}
export type CatalogRequirement = {
  field: 'env' | 'headers'
  key: string
  description: string
  secret: boolean
  required: boolean
}
export type CatalogAlternative = {
  candidateId: string
  requirements: CatalogRequirement[]
  remote: boolean
}
export type CatalogReview = {
  server: CatalogServer
  plan: ImportPlan
  alternatives: CatalogAlternative[]
  parameters: {
    id: string
    label: string
    description: string
    required: boolean
    defaultValue: string
    choices: string[]
  }[]
}
export type CatalogCredentialValue = Pick<
  CatalogRequirement,
  'field' | 'key'
> & { value: string }

export const MCP_CATALOG_CATEGORIES = [
  'workspaces',
  'social',
  'commerce',
  'development',
  'data',
  'media',
  'other',
] as const
export type McpCatalogCategory = (typeof MCP_CATALOG_CATEGORIES)[number]

// The registry DTO has no category taxonomy. These are display suggestions,
// derived from published metadata; they never imply a verified capability.
export function mcpCatalogCategory(
  name: string,
  description = ''
): McpCatalogCategory {
  const text = `${name} ${description}`
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
  if (
    /\b(social|linkedin|youtube|facebook|instagram|reddit|tiktok|twitter|bluesky|mastodon)\b/.test(
      text
    )
  )
    return 'social'
  if (
    /\b(commerce|payments?|billing|invoices?|ecommerce|e-commerce|shopify|stripe|checkout|pagos|facturas)\b/.test(
      text
    )
  )
    return 'commerce'
  if (
    /\b(video|audio|music|images?|design|render|3d|media|multimedia|musica|imagenes)\b/.test(
      text
    )
  )
    return 'media'
  if (
    /\b(workspace|productivity|calendar|email|documents?|collaboration|notion|slack|calendario|documentos|productividad)\b|knowledge base|project management/.test(
      text
    )
  )
    return 'workspaces'
  if (
    /\b(github|gitlab|repository|repositories|code|developer|debug|compiler|development|codigo|desarrollo)\b/.test(
      text
    )
  )
    return 'development'
  if (
    /\b(database|sql|postgres|sqlite|mysql|search|analytics|data|vector|datos|busqueda)\b/.test(
      text
    )
  )
    return 'data'
  return 'other'
}

export function mcpCatalogMonogram(name: string): string {
  const words = name
    .trim()
    .split(/[\s/._-]+/u)
    .filter(Boolean)
  return (
    words.length > 1
      ? `${words[0][0]}${words.at(-1)![0]}`
      : words[0]?.slice(0, 2) || 'MC'
  ).toLocaleUpperCase()
}

export const listMcpCatalog = (search = '', cursor?: string) =>
  invoke<CatalogPage>('mcp_catalog_list', { search, cursor })
export const reviewMcpCatalog = (
  name: string,
  version: string,
  parameters: Record<string, string> = {}
) => invoke<CatalogReview>('mcp_catalog_review', { name, version, parameters })
export const configureMcpCatalog = (
  name: string,
  values: CatalogCredentialValue[]
) => invoke<void>('mcp_catalog_configure', { name, values })
