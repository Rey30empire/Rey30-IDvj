import DocSearch from './DocSearch'

const links = [
  ['Escritorio', '/docs/desktop/quickstart'],
  ['Agentes', '/docs/agent/quickstart'],
  ['Guías', '/docs'],
  ['Instalación', '/download'],
  ['Soporte', '/support'],
]

export default function Navbar({ noScroll: _noScroll }: { noScroll?: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b border-black/10 bg-white px-4 py-3 text-black">
      <div className="nextra-wrap-container flex flex-wrap items-center justify-between gap-4">
        <a href="/" className="text-xl font-bold">Rey30 IDvj</a>
        <nav aria-label="Documentación" className="flex flex-wrap items-center gap-4">
          {links.map(([name, href]) => <a key={href} href={href} className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">{name}</a>)}
          <DocSearch />
        </nav>
      </div>
    </header>
  )
}
