# @rey30-idvj/adk

Cliente JavaScript y TypeScript del runtime de agentes de Rey30 IDvj. Requiere Node.js 20 o posterior. El runtime es un proceso separado; el cliente administra sesiones, eventos y herramientas del host por JSON-RPC.

## Uso desde este workspace

Instala las dependencias con `corepack yarn install` desde la raíz y compila el runtime:

```powershell
cargo build --locked --manifest-path src-tauri/rey30-idvj-cli/Cargo.toml --no-default-features --features cli --bin rey30-idvj
```

El paquete local se resuelve como `@rey30-idvj/adk`. No hay un paquete propio publicado en npm ni un canal de descarga predeterminado. Pasa la ruta del ejecutable a `Rey30Runtime.start({ bin })`, configura `REY30_BIN` o añade `rey30-idvj` a PATH.

`installRuntime({ manifestUrl })` requiere un manifiesto explícito o `REY30_AGENT_MANIFEST`. Comprueba el SHA-256 y crea generaciones de caché inmutables antes de devolver un ejecutable. No sustituye silenciosamente este runtime por el de otra distribución. La instalación del modelo de escritorio se conserva por separado.

## Quickstart

```js
import { Rey30Runtime } from '@rey30-idvj/adk'

const runtime = await Rey30Runtime.start()
const session = await runtime.createSession({ model: 'gpt-4o-mini', ephemeral: true })

const turn = await session.prompt('Summarise this table in one line.')

for await (const event of turn) {
  if (event.type === 'token') process.stdout.write(event.text)
}

const { stopReason } = await turn.result()
console.log(`\n${stopReason}`)

await runtime.close() // closes stdin, then the process
```

`prompt()` returns as soon as the turn starts; the events stream while it runs,
and `result()` resolves when the runtime closes the turn. Iterating is optional -
a host that only awaits `result()` still gets the terminal record - but an
undrained turn keeps at most `maxBufferedEvents` (default 100000) *unread*
events and then drops its oldest, counting them on `turn.dropped`. The cap is
the buffer, not the turn: a reader that keeps up with a turn of any length loses
nothing.

## Host tools

A host tool is declared with the schema the model sees, what it does, and the
handler that runs it here:

```js
const session = await runtime.createSession({
  model: 'gpt-4o-mini',
  builtins: false, // only the tools below, no shell/editor tools
  permissions: 'host', // this process runs and gates these tools itself
  tools: [
    {
      name: 'camera_observe',
      description: 'Look at the robot bench and describe what is there.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      capability: 'read', // never prompted, run concurrently, visible in Plan mode
      handler: async () => ({ text: 'the bench holds a red bin', images: [framePath] }),
    },
    {
      name: 'robot_arm_move',
      description: 'Move the arm to a named position.',
      parameters: {
        type: 'object',
        properties: { position: { type: 'string' } },
        required: ['position'],
      },
      capability: 'actuator', // prompted, sequential, withheld in Plan mode
      handler: async (args, call) => {
        await arm.move(args.position, { signal: call.signal })
        return { text: `moved to ${args.position}`, details: { joints: 3 } }
      },
    },
  ],
})
```

What a handler answers with:

| Field | Meaning |
| --- | --- |
| `text` | Tool text, sent to the model. |
| `images` | A path, a data URL, `{ data, mimeType }`, or `{ url }`. A tool message cannot carry an image, so `text` stays on the tool message and the runtime leads the next user turn with the image parts. |
| `details` | Host-only data, echoed as `item/tool_details` and never sent to the model. |
| `error` / `isError` | The call failed; the message is the tool result the model sees. |

A thrown error is answered the same way, so a failed call never leaves the turn
parked. The handler runs without holding the client's reader: two subagents may
have calls in flight at once, and serializing them - one native call at a time,
on a shared robot - is the host's decision through its own queue. `call.signal`
is aborted when the runtime withdraws the request (an interrupt, or the client
going away), and a late answer is not written.

Requests from a delegated child arrive on the same session, carrying
`run_id`; answer is by `request_id` alone, so one path serves both.

`session.tools` and `session.toolSpecs` are what the runtime advertises, read
back rather than assumed: the names there are the declared ones with their
`host__` prefix, because that is what the model calls. The `tool_request` a
handler runs for carries the bare name the host declared.

### Permissions

An `actuator` is gated: the runtime asks before the call reaches the handler,
unless the session declares that the gate is the host's own.

- `permissions: 'host'` - for a session whose host tools this process runs and
  gates itself, which is the usual case for an embedding host. No prompt is
  raised for those tools, so a turn never waits on an answer nobody will give.
- `permissions: 'rey30'` (the default) - the runtime owns the gate. A call to an
  `actuator` raises `permission_request` on the turn's stream, naming the
  advertised tool (`host__robot_arm_move`) and its `capability`. Answer it with
  `session.respondPermission(requestId, 'allow_once' | 'allow_always' | 'deny')`,
  from the code draining the turn:

```js
for await (const event of turn) {
  if (event.type === 'permission_request') {
    await session.respondPermission(event.request_id, 'allow_once')
  }
}
```

An unanswered request parks the turn: nothing moves until it is answered, the
turn is interrupted, or the runtime is closed. A `read` tool is never prompted
for, in either mode.

With `builtins: false`, `subagents: true` still lets the model delegate: each
subagent is held to these host tools, and its calls arrive here with its
`run_id`. `systemPrompt` replaces Rey30 IDvj's whole system prompt with yours.

## Process ownership

```js
await session.interrupt()      // the turn settles with stopReason 'interrupted'
await session.setModel('...')  // between turns; refused mid-turn with -32001
await session.fork()           // a new session with this one's history and model
await session.archive()        // drop it from the runtime
await runtime.close()          // close stdin, then the process
await runtime.close({ force: true }) // skip the grace period and kill
```

`runtime.limits` is what the handshake advertised - `max_images`,
`max_image_bytes`, `max_message_image_bytes` and the accepted `mime_types` - so
a client that sends an image can check it before sending rather than discover
the cap by being rejected. `Rey30RpcError` is an answer (`code`, `retryable`), and
`Rey30RuntimeError` is the channel (spawn failure, protocol mismatch, exit), with
the runtime's own stderr attached.

A session's host tools follow it. `fork()` answers for the source's tools with
the same handlers (`fork({ tools })` replaces them, `fork({ tools: [] })` drops
them), and `resumeSession(id)` returns the session this client already holds,
with its turns, listeners and handlers, rather than a second object for the
same id. A host tool's name is trimmed, as the runtime trims it.

Listeners registered with `session.on(...)` and `runtime.on(...)` run on the
client's reader. One that throws, or returns a promise that rejects, does not
crash your application: it fails the runtime. Every open turn and call settles
with a `Rey30RuntimeError` (its `cause` is what the listener raised) and the
process is stopped, so a listener that was answering permission requests cannot
leave a turn parked behind it.

## Types

`src/index.d.ts` is the public surface. `src/generated/rpc-types.d.ts` is
generated from `protocol/rpc-schema.json` - request params, the event union, and
the method and event-tag literals:

```bash
yarn workspace @rey30-idvj/adk generate        # rewrite the generated files
yarn workspace @rey30-idvj/adk check-types     # regenerate, diff, type-check
```

The artifact covers request params and events, not responses; `RpcResponses` in
`src/index.d.ts` declares those and the suite pins them against a real runtime.

## Tests

The suite drives a real runtime against a stub provider on loopback - no
credentials, no network:

```bash
REY30_BIN=/path/to/rey30-idvj yarn workspace @rey30-idvj/adk test
```

It is skipped, not failed, when `REY30_BIN` is unset.
