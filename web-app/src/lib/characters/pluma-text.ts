import { speechText } from './audio'

const fencedCode = /^ {0,3}(?<fence>`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)[\s\S]*?(?:^ {0,3}\k<fence>[ \t]*\r?$|(?![\s\S]))/gm
const protectedMarkup = new RegExp([
  fencedCode.source,
  '^(?: {4}|\\t)[^\\r\\n]*',
  '(?<ticks>`+)[^\\r\\n]*?\\k<ticks>',
  '(?<=\\])\\((?:[^()\\r\\n]|\\([^()\\r\\n]*\\))*\\)',
  'https?://[^\\s<>()]+',
  '\\\\\\*',
  '^ {0,3}(?:\\*[ \\t]*){3,}(?=\\r?$)',
  '^ {0,3}\\*(?=[ \\t]+\\*{0,3}[^*\\s])',
  '(?<=\\d)[ \\t]*\\*[ \\t]*(?=\\d)',
].join('|'), 'gmu')

function cleanProse(text: string, previous = '', next = '') {
  const prefix = /\S/.test(previous) ? '\0' : ''
  const suffix = /\S/.test(next) ? '\0' : ''
  const clean = (prefix + text + suffix)
    .replace(/\.{4,}|…{2,}/g, '…')
    .replace(/([¿¡?!,;:])\1+/g, '$1')
    .replace(/(?<=\S)[ \t]+([,;!?])/g, '$1')
    .replace(/([¿¡])[ \t]+/g, '$1')
    .replace(/(^|[ \t]+)\*+(?=[ \t]|$)/gm, '')
  return clean.slice(prefix.length, suffix ? -1 : undefined)
}

export function normalizePlumaDisplayText(text: string) {
  let end = 0
  const parts: string[] = []
  for (const match of text.matchAll(protectedMarkup)) {
    parts.push(cleanProse(text.slice(end, match.index), text[end - 1], match[0][0]), match[0])
    end = match.index + match[0].length
  }
  parts.push(cleanProse(text.slice(end), text[end - 1]))
  return parts.join('')
}

export function normalizePlumaSpeech(text: string) {
  const prose = text
    .replace(fencedCode, ' Bloque de código omitido. ')
    .replace(/^[ \t]*(?:(?:[-*_][ \t]*){3,})\r?$/gm, '')
    .replace(/^[ \t]*(?:[*+-]|>)[ \t]+/gm, '')
    .replace(/\\(?=[*_`~])/g, '')
  return speechText(normalizePlumaDisplayText(prose)).replace(/[ \t]+/g, ' ').trim()
}
