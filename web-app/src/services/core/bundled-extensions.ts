import type { BaseExtension } from '@rey30-idvj/core'
import type { ExtensionManifest } from '@/lib/extension'

type ExtensionCtor = new (
  url: string,
  name: string,
  productName?: string,
  active?: boolean,
  description?: string,
  version?: string
) => BaseExtension

type BundledEntry = {
  load: () => Promise<{ default: ExtensionCtor }>
  name: string
  productName: string
  version: string
  description: string
  // Runs on mobile (no native plugin dependencies). Desktop-only otherwise.
  mobile?: boolean
}

// Lazily imported so the extension bundles are NOT part of the service-hub
// bootstrap graph; they load only when extensions are enumerated (after the
// hub is ready), matching the pre-bundling load order.
const ENTRIES: BundledEntry[] = [
  {
    load: () => import('@rey30-idvj/assistant-extension'),
    name: '@rey30-idvj/assistant-extension',
    productName: 'Asistente Rey30 IDvj',
    version: '1.0.2',
    description:
      'Asistente predeterminado para conversar con tus modelos instalados.',
  },
  {
    load: () => import('@rey30-idvj/conversational-extension'),
    name: '@rey30-idvj/conversational-extension',
    productName: 'Conversaciones',
    version: '1.0.0',
    description: 'Conserva conversaciones y su estado en tus archivos locales.',
    mobile: true,
  },
  {
    load: () => import('@rey30-idvj/download-extension'),
    name: '@rey30-idvj/download-extension',
    productName: 'Gestor de descargas',
    version: '1.0.0',
    description: 'Descarga y gestiona archivos y modelos en Rey30 IDvj.',
  },
  {
    load: () => import('@rey30-idvj/llamacpp-extension'),
    name: '@rey30-idvj/llamacpp-extension',
    productName: 'Motor de inferencia llama.cpp',
    version: '1.0.1',
    description: 'Permite utilizar la API de chat de llama.cpp.',
  },
  {
    load: () => import('@rey30-idvj/rag-extension'),
    name: '@rey30-idvj/rag-extension',
    productName: 'Herramientas de documentos',
    version: '0.1.0',
    description:
      'Prepara documentos y recupera fragmentos mediante búsqueda vectorial.',
  },
  {
    load: () => import('@rey30-idvj/vector-db-extension'),
    name: '@rey30-idvj/vector-db-extension',
    productName: 'Base de datos vectorial',
    version: '0.1.0',
    description: 'Búsqueda vectorial con sqlite-vec o búsqueda lineal cuando no está disponible.',
  },
]

// The MLX extension depends on @rey30-idvj/tauri-plugin-mlx-api, which only exists
// on macOS. IS_MACOS is a build-time constant, so this import() is dead-code
// eliminated on other platforms and never enters the bundle graph.
if (IS_MACOS) {
  ENTRIES.push({
    load: () => import('@rey30-idvj/mlx-extension'),
    name: '@rey30-idvj/mlx-extension',
    productName: 'Motor de inferencia MLX',
    version: '1.0.0',
    description: 'Permite utilizar MLX-Swift en Mac con Apple Silicon.',
  })
}

export async function getBundledExtensions(
  opts: { mobile?: boolean } = {}
): Promise<ExtensionManifest[]> {
  const active = ENTRIES.filter((e) => (opts.mobile ? e.mobile : true))
  return Promise.all(
    active.map(async ({ load, name, productName, description, version }) => {
      const { default: Ctor } = await load()
      return {
        name,
        productName,
        url: 'built-in',
        active: true,
        description,
        version,
        extensionInstance: new Ctor(
          'built-in',
          name,
          productName,
          true,
          description,
          version
        ),
      }
    })
  )
}
