import React, { Fragment } from 'react'
import { useConfig, DocsThemeConfig } from 'nextra-theme-docs'
import { useRouter } from 'next/router'
import Navbar from '@/components/Navbar'
import FooterMenu from '@/components/FooterMenu'

const siteUrl = process.env.REY30_DOCS_SITE_URL?.replace(/\/$/, '')
const config: DocsThemeConfig = {
  logo: <span className="text-lg font-semibold">Rey30 IDvj</span>,
  feedback: { content: null },
  editLink: { component: () => null },
  useNextSeoProps() {
    return { titleTemplate: '%s - Rey30 IDvj', noindex: !siteUrl, nofollow: !siteUrl }
  },
  navbar: { component: <Navbar /> },
  sidebar: { defaultMenuCollapseLevel: 1, autoCollapse: true },
  darkMode: false,
  toc: { backToTop: true },
  head: function useHead() {
    const { title, frontMatter } = useConfig()
    const { asPath } = useRouter()
    return <Fragment>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta httpEquiv="Content-Language" content="es" />
      <title>{frontMatter?.title || title || 'Rey30 IDvj'}</title>
      <meta name="description" content={frontMatter?.description || 'Guías locales de Rey30 IDvj, distribución mantenida por Reinier Tamayo.'} />
      {siteUrl && <link rel="canonical" href={siteUrl + asPath} />}
    </Fragment>
  },
  footer: { text: <FooterMenu /> },
  nextThemes: { defaultTheme: 'light', forcedTheme: 'light' },
}
export default config
