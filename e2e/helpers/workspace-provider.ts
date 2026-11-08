import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'

export type WorkspaceToolStep = {
  name: 'ls' | 'read' | 'write' | 'edit'
  args: Record<string, unknown> & { path: string }
  verify: (result: string) => void
}

type Message = { role?: string; tool_call_id?: string; content?: unknown }
type RequestBody = {
  model?: string
  stream?: boolean
  tools?: { function?: { name?: string } }[]
  messages?: Message[]
}

async function readRequest(request: IncomingMessage): Promise<RequestBody> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    assert(bytes <= 1024 * 1024, 'Workspace SSE request is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function startWorkspaceProvider(
  model: string,
  prompt: string,
  reply: string,
  steps: WorkspaceToolStep[],
) {
  const requests: { method: string; path: string; accepted: boolean }[] = []
  const errors: string[] = []
  const verifiedTools: string[] = []
  const forbiddenTools = new Set(process.platform === 'win32' ? ['shell', 'bash', 'monitor'] : [])
  let completions = 0
  const callId = (index: number) => `call_workspace_${index}`
  const server = createServer(async (request, response) => {
    const observed = { method: request.method ?? '', path: request.url ?? '', accepted: false }
    requests.push(observed)
    try {
      if (observed.method === 'GET' && observed.path === '/v1/models') {
        observed.accepted = true
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model', owned_by: 'workspace-fixture' }] }))
        return
      }

      assert.equal(`${observed.method} ${observed.path}`, 'POST /v1/chat/completions')
      const body = await readRequest(request)
      assert.equal(body.model, model, 'Unexpected provider model id')
      assert.equal(body.stream, true, 'The workspace run must request SSE')
      const index = completions
      assert(index <= steps.length, 'Unexpected extra model request')
      const messages = body.messages ?? []
      assert(messages.some(message => message.role === 'user' && (JSON.stringify(message.content) ?? '').includes(prompt)), 'Workspace prompt did not reach the fixture')
      const toolResults = messages.filter(message => message.role === 'tool')
      assert.deepEqual(toolResults.map(message => message.tool_call_id), steps.slice(0, index).map((_, i) => callId(i)))
      if (index > 0) {
        const previous = steps[index - 1]
        const result = toolResults[index - 1].content
        previous.verify(typeof result === 'string' ? result : JSON.stringify(result) ?? '')
        verifiedTools.push(previous.name)
      }

      const next = steps[index]
      const advertised = (body.tools ?? []).flatMap(tool => tool.function?.name ?? [])
      assert(!advertised.some(name => forbiddenTools.has(name)), 'A Windows folder run advertised terminal or monitor tools')
      if (next) assert(advertised.includes(next.name), `Tool ${next.name} was not advertised`)
      const chunk = (delta: Record<string, unknown>, finishReason: string | null) => `data: ${JSON.stringify({
        id: `chatcmpl-workspace-${index}`, object: 'chat.completion.chunk', created: 1, model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`
      observed.accepted = true
      completions += 1
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
      if (next) {
        response.write(chunk({ role: 'assistant', tool_calls: [{
          index: 0, id: callId(index), type: 'function', function: { name: next.name, arguments: JSON.stringify(next.args) },
        }] }, null))
        response.write(chunk({}, 'tool_calls'))
      } else {
        response.write(chunk({ role: 'assistant', content: reply }, null))
        response.write(chunk({}, 'stop'))
      }
      response.end('data: [DONE]\n\n')
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
      if (response.headersSent) {
        response.end()
        return
      }
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: errors.at(-1) } }))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, requests, errors, verifiedTools,
    get completions() { return completions },
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections()
      server.close(error => error ? reject(error) : resolve())
    }),
  }
}
