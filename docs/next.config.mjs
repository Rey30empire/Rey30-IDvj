/** @type {import('next').NextConfig} */

import { fileURLToPath } from 'node:url'
import nextra from 'nextra'
import { remarkCodeHike } from '@code-hike/mdx'

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  defaultShowCopyCode: true,
  latex: true,
  mdxOptions: {
    remarkPlugins: [
      [
        remarkCodeHike,
        {
          theme: 'dark-plus',
          showCopyButton: true,
          skipLanguages: ['mermaid'],
        },
      ],
    ],
  },
})

const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  env: {
    REY30_DOCS_SITE_URL: process.env.REY30_DOCS_SITE_URL,
  },
  transpilePackages: ['@scalar', 'react-tweet'],
  images: {
    formats: ['image/webp'],
    unoptimized: true,
  },
}

export default withNextra(nextConfig)
