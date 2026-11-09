import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Streamdown } from 'streamdown'
import type { Root } from 'hast'
import { blockRemoteImages, safeStreamdownPlugins } from '../markdownImages'

const tree = (src: unknown, alt?: string): Root => ({
  type: 'root',
  children: [{ type: 'element', tagName: 'img', properties: { src, alt } as never, children: [] }],
})
const rendered = (root: Root) => {
  blockRemoteImages()(root)
  return root.children[0] as { tagName: string; children: { value: string }[] }
}

describe('imágenes en el texto de un modelo', () => {
  it.each([
    'https://evil.example/x.png',
    'http://evil.example/x.png',
    'HTTPS://evil.example/x.png',
    '  https://evil.example/x.png',
    '//evil.example/x.png',
    '/x.png',
    './x.png',
    'x.png',
    'ftp://evil.example/x.png',
    'https://asset.localhost.evil.example/x.png',
    'http://asset.localhost@evil.example/x.png',
    'data:text/html,<script></script>',
  ])('bloquea %s', src => {
    expect(rendered(tree(src)).tagName).toBe('span')
  })

  it.each([
    'data:image/png;base64,iVBORw0KGgo=',
    'blob:http://tauri.localhost/1234',
    'asset://localhost/C%3A/foto.png',
    'http://asset.localhost/C%3A/foto.png',
    'https://asset.localhost/C%3A/foto.png',
  ])('deja pasar %s', src => {
    expect(rendered(tree(src)).tagName).toBe('img')
  })

  it('bloquea una imagen sin dirección válida', () => {
    expect(rendered(tree(undefined)).tagName).toBe('span')
    expect(rendered(tree(['https://evil.example'])).tagName).toBe('span')
  })

  it('nombra lo bloqueado con su texto alternativo', () => {
    expect(rendered(tree('https://evil.example/x.png', 'gráfico')).children[0].value).toBe('Imagen externa bloqueada: gráfico')
    expect(rendered(tree('https://evil.example/x.png')).children[0].value).toBe('Imagen externa bloqueada')
  })

  it('también cubre el HTML en bruto que Streamdown acepta en los razonamientos', async () => {
    const { container } = render(<Streamdown rehypePlugins={safeStreamdownPlugins}>{'<img src="https://evil.example/x.png" alt="crudo">\n\n![md](https://evil.example/y.png)'}</Streamdown>)
    await waitFor(() => expect(container.textContent).toContain('Imagen externa bloqueada: md'))
    expect(container.querySelector('img')).toBeNull()
  })
})
