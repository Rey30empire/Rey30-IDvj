/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.REY30_DOCS_SITE_URL || 'http://localhost:3000',
  generateRobotsTxt: true,
  outDir: './out',
  exclude: [],
  robotsTxtOptions: {
    policies: [{ userAgent: '*', disallow: process.env.REY30_DOCS_SITE_URL ? [] : '/' }],
  },
}
