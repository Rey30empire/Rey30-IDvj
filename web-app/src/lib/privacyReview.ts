import { create } from 'zustand'
import {
  hidePrivacyText,
  privacyHash,
  type PrivacyJson,
} from './privacyPayload'

export type PrivacyReviewContext = {
  provider: string
  model: string
  endpoint: string
  operation: 'stream' | 'generate'
}
export type PrivacyReviewView = {
  id: string
  context: PrivacyReviewContext
  payload: PrivacyJson
  hash: string
  redactions: number
  updating: boolean
}
type Pending = {
  view: PrivacyReviewView
  signal?: AbortSignal
  resolve: (value: { payload: PrivacyJson; hash: string }) => void
  reject: (error: Error) => void
  abort: () => void
}
const queue: Pending[] = []
export const usePrivacyReview = create<{
  current: PrivacyReviewView | null
  pending: number
}>(() => ({ current: null, pending: 0 }))
function publish(): void {
  usePrivacyReview.setState({
    current: queue[0]?.view ?? null,
    pending: queue.length,
  })
}
export function privacyAbort(): Error {
  return new DOMException('Envío cancelado por privacidad.', 'AbortError')
}
function remove(id: string, error?: Error): void {
  const index = queue.findIndex((entry) => entry.view.id === id)
  if (index < 0) return
  const [entry] = queue.splice(index, 1)
  entry.signal?.removeEventListener('abort', entry.abort)
  if (error) entry.reject(error)
  publish()
}
export async function requestPrivacyReview(
  context: PrivacyReviewContext,
  payload: PrivacyJson,
  redactions: number,
  signal?: AbortSignal
): Promise<{ payload: PrivacyJson; hash: string }> {
  if (signal?.aborted) throw privacyAbort()
  if (queue.length >= 10)
    throw new Error(
      'Hay demasiadas peticiones esperando revisión de privacidad.'
    )
  const snapshot = JSON.parse(JSON.stringify(payload)) as PrivacyJson
  const contextSnapshot = { ...context }
  const hash = await privacyHash({
    context: contextSnapshot,
    payload: snapshot,
  })
  if (signal?.aborted) throw privacyAbort()
  if (queue.length >= 10)
    throw new Error(
      'Hay demasiadas peticiones esperando revisión de privacidad.'
    )
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const entry: Pending = {
      view: {
        id,
        context: contextSnapshot,
        payload: snapshot,
        hash,
        redactions,
        updating: false,
      },
      signal,
      resolve,
      reject,
      abort: () => remove(id, privacyAbort()),
    }
    queue.push(entry)
    signal?.addEventListener('abort', entry.abort, { once: true })
    publish()
  })
}
export function cancelPrivacyReview(id: string): void {
  remove(id, privacyAbort())
}
export function cancelAllPrivacyReviews(): void {
  for (const entry of [...queue]) cancelPrivacyReview(entry.view.id)
}
export async function hidePrivacyReviewText(
  id: string,
  text: string
): Promise<void> {
  const entry = queue[0]
  if (!entry || entry.view.id !== id || entry.view.updating)
    throw new Error('La revisión cambió; vuelve a comprobar el contenido.')
  entry.view = { ...entry.view, updating: true }
  publish()
  try {
    const payload = hidePrivacyText(entry.view.payload, text)
    const hash = await privacyHash({ context: entry.view.context, payload })
    if (queue[0] !== entry) throw privacyAbort()
    entry.view = { ...entry.view, payload, hash, updating: false }
    publish()
  } catch (error) {
    if (queue[0] === entry) {
      entry.view = { ...entry.view, updating: false }
      publish()
    }
    throw error
  }
}
export function approvePrivacyReview(id: string, hash: string): void {
  const entry = queue[0]
  if (
    !entry ||
    entry.view.id !== id ||
    entry.view.hash !== hash ||
    entry.view.updating
  )
    throw new Error('La petición cambió; revísala de nuevo antes de enviar.')
  if (entry.signal?.aborted) {
    remove(id, privacyAbort())
    return
  }
  const result = {
    payload: JSON.parse(JSON.stringify(entry.view.payload)) as PrivacyJson,
    hash: entry.view.hash,
  }
  remove(id)
  entry.resolve(result)
}
