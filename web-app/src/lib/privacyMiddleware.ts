import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai'
import {
  assertPrivacyFactoryParameters,
  assertPrivacyProvider,
  ensurePrivacyMode,
  getPrivacyModeSnapshot,
} from './privacyPolicy'
import { privacyHash, redactPrivacyPayload } from './privacyPayload'
import {
  privacyAbort,
  requestPrivacyReview,
  type PrivacyReviewContext,
} from './privacyReview'
import { cancelAllPrivacyReviews } from './privacyReview'
import { usePrivacyMode } from '@/hooks/usePrivacyMode'

type ModelV3 = Parameters<typeof wrapLanguageModel>[0]['model']
type CallOptions = Parameters<
  NonNullable<LanguageModelMiddleware['transformParams']>
>[0]['params']
export type PrivacyModelContext = {
  provider: string
  model: string
  endpoint: string
  nativeEngine: boolean
  parameters: Record<string, unknown>
}
const TICKET_HEADER = 'x-rey30-privacy-review'
type Ticket = {
  origin: string
  basePath: string
  model: string
  expires: number
  wireHash?: string
  attempts: number
}
const tickets = new Map<string, Ticket>()
type ActiveRequest = { controller: AbortController; finish: () => void }
const activeRequests = new Set<ActiveRequest>()
const byParams = new WeakMap<object, ActiveRequest>()
let subscribed = false
function ensurePolicySubscription(): void {
  if (subscribed) return
  subscribed = true
  usePrivacyMode.subscribe((state, previous) => {
    if (
      state.mode !== previous.mode ||
      (state.saving && !previous.saving) ||
      (!state.loaded && previous.loaded) ||
      (state.error && !previous.error)
    ) {
      cancelAllPrivacyReviews()
      for (const request of [...activeRequests]) {
        request.controller.abort(privacyAbort())
        request.finish()
      }
    }
  })
}
function startRequest(original?: AbortSignal): ActiveRequest {
  const controller = new AbortController()
  const abort = () => controller.abort(privacyAbort())
  const request = {
    controller,
    finish: () => {
      original?.removeEventListener('abort', abort)
      activeRequests.delete(request)
    },
  }
  original?.addEventListener('abort', abort, { once: true })
  if (original?.aborted) abort()
  activeRequests.add(request)
  return request
}
function endpointLabel(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return 'Dirección configurada del proveedor'
  }
}
function ticketFrom(params: CallOptions): string | undefined {
  return (
    new Headers(params.headers as HeadersInit | undefined).get(TICKET_HEADER) ??
    undefined
  )
}
function release(params: CallOptions): void {
  const ticket = ticketFrom(params)
  if (ticket) tickets.delete(ticket)
  byParams.get(params)?.finish()
  byParams.delete(params)
}
function assertNoProviderTools(value: unknown, depth = 0): void {
  if (depth > 40)
    throw new Error(
      'Las opciones del proveedor superan la profundidad admitida.'
    )
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const enabled =
      child !== false &&
      child !== null &&
      child !== undefined &&
      child !== '' &&
      !(Array.isArray(child) && child.length === 0)
    if (
      enabled &&
      /tools?|web.?search|grounding|retrieval|connector|remote.?mcp/i.test(key)
    )
      throw new Error(
        'Las herramientas y conectores del proveedor están desactivados en los modos protegidos.'
      )
    assertNoProviderTools(child, depth + 1)
  }
}

export function createPrivacyMiddleware(
  context: PrivacyModelContext
): LanguageModelMiddleware {
  ensurePolicySubscription()
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params, type }) => {
      const mode = await ensurePrivacyMode()
      assertPrivacyProvider(mode, context.nativeEngine)
      assertPrivacyFactoryParameters(
        mode,
        context.parameters,
        context.nativeEngine
      )
      if (mode !== 'standard' && params.tools?.length)
        throw new Error(
          'Las herramientas están desactivadas en los modos protegidos. Inicia un envío sin MCP, web, RAG ni subagentes.'
        )
      if (mode !== 'standard') assertNoProviderTools(params.providerOptions)
      if (params.abortSignal?.aborted) throw privacyAbort()
      const active = startRequest(params.abortSignal)
      try {
        if (mode !== 'cloud-review' || context.nativeEngine) {
          const next = { ...params, abortSignal: active.controller.signal }
          byParams.set(next, active)
          return next
        }
        const prepared = redactPrivacyPayload(params)
        const reviewContext: PrivacyReviewContext = {
          provider: context.provider,
          model: context.model,
          endpoint: endpointLabel(context.endpoint),
          operation: type,
        }
        const approved = await requestPrivacyReview(
          reviewContext,
          prepared.payload,
          prepared.redactions,
          active.controller.signal
        )
        if (
          active.controller.signal.aborted ||
          (await ensurePrivacyMode()) !== mode
        )
          throw privacyAbort()
        if (
          (await privacyHash({
            context: reviewContext,
            payload: approved.payload,
          })) !== approved.hash
        )
          throw new Error('El contenido aprobado cambió; no se enviará.')
        const token = crypto.randomUUID()
        const url = new URL(context.endpoint)
        tickets.set(token, {
          origin: url.origin,
          basePath: url.pathname.replace(/\/$/, ''),
          model: context.model,
          expires: Date.now() + 5 * 60_000,
          attempts: 0,
        })
        const headers = new Headers(params.headers as HeadersInit | undefined)
        headers.set(TICKET_HEADER, token)
        const next = {
          ...(approved.payload as Omit<CallOptions, 'headers' | 'abortSignal'>),
          headers: Object.fromEntries(headers.entries()),
          abortSignal: active.controller.signal,
        }
        byParams.set(next, active)
        return next
      } catch (error) {
        active.finish()
        throw error
      }
    },
    wrapGenerate: async ({ doGenerate, params }) => {
      try {
        return await doGenerate()
      } finally {
        release(params)
      }
    },
    wrapStream: async ({ doStream, params }) => {
      try {
        const result = await doStream()
        const reader = result.stream.getReader()
        return {
          ...result,
          stream: new ReadableStream({
            pull: async (controller) => {
              try {
                const item = await reader.read()
                if (item.done) {
                  release(params)
                  controller.close()
                } else controller.enqueue(item.value)
              } catch (error) {
                release(params)
                controller.error(error)
              }
            },
            cancel: async (reason) => {
              release(params)
              await reader.cancel(reason)
            },
          }),
        }
      } catch (error) {
        release(params)
        throw error
      }
    },
  }
}
export function wrapModelWithPrivacy(
  model: ModelV3,
  context: PrivacyModelContext
): ModelV3 {
  return wrapLanguageModel({
    model,
    middleware: createPrivacyMiddleware(context),
  })
}

/** This guard runs at the network boundary, including provider key-rotation retries. */
export function withPrivacyRemoteGuard(
  fetchImpl: typeof globalThis.fetch
): typeof globalThis.fetch {
  return async (input, init) => {
    const mode = await ensurePrivacyMode()
    assertPrivacyProvider(mode, false)
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    const token = headers.get(TICKET_HEADER)
    headers.delete(TICKET_HEADER)
    if (mode === 'cloud-review' || token) {
      const ticket = token ? tickets.get(token) : undefined
      if (
        mode !== 'cloud-review' ||
        !ticket ||
        ticket.expires < Date.now() ||
        ticket.attempts >= 10
      )
        throw privacyAbort()
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      )
      if (
        url.origin !== ticket.origin ||
        !(
          url.pathname === ticket.basePath ||
          url.pathname.startsWith(`${ticket.basePath}/`)
        ) ||
        typeof init?.body !== 'string'
      )
        throw new Error(
          'El destino o cuerpo de la petición no coincide con la revisión; no se enviará.'
        )
      const body: unknown = JSON.parse(init.body)
      if (
        body &&
        typeof body === 'object' &&
        'model' in body &&
        typeof body.model === 'string' &&
        body.model !== ticket.model
      )
        throw new Error(
          'El modelo cambió después de la revisión; no se enviará.'
        )
      const wireHash = await privacyHash({ url: url.href, body: init.body })
      if (ticket.wireHash && ticket.wireHash !== wireHash)
        throw new Error(
          'El contenido cambió después de la revisión; no se enviará.'
        )
      ticket.wireHash = wireHash
      ticket.attempts++
      if (
        init.signal?.aborted ||
        (await ensurePrivacyMode()) !== 'cloud-review' ||
        getPrivacyModeSnapshot() !== 'cloud-review'
      )
        throw privacyAbort()
    } else if (getPrivacyModeSnapshot() !== 'standard') {
      throw privacyAbort()
    }
    const options: RequestInit & { maxRedirections?: number } = {
      ...init,
      headers,
    }
    if (mode !== 'standard') {
      options.redirect = 'error'
      options.maxRedirections = 0
    }
    return fetchImpl(input, options)
  }
}
