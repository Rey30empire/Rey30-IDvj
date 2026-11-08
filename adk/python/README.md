# rey30-idvj-adk

Cliente Python del runtime de agentes de Rey30 IDvj. Requiere Python 3.11 o posterior y usa la biblioteca estándar para sesiones, eventos y herramientas del host.

## Instalación local

Desde la raíz del repositorio, dentro de un entorno virtual:

```powershell
python -m pip install -e ./adk/python
cargo build --locked --manifest-path src-tauri/rey30-idvj-cli/Cargo.toml --no-default-features --features cli --bin rey30-idvj
```

No hay paquete propio publicado en PyPI ni canal de descarga predeterminado. Pasa el ejecutable compilado a `Rey30Runtime.start(bin=...)`, pon `rey30-idvj` en PATH o configura `REY30_BIN`. El alias `JAN_BIN` se admite para compatibilidad.

`install_runtime(manifest_url=...)` acepta un manifiesto explícito o `REY30_AGENT_MANIFEST`. Verifica el SHA-256, extrae de forma segura y conserva generaciones inmutables en `REY30_AGENT_HOME` o en la caché de usuario. Sin canal configurado falla con un error claro. No descarga el ejecutable del proyecto base por defecto; esto es independiente de la instalación del modelo Jan 4B de escritorio.

## Quickstart

```python
from rey30_idvj_adk import Rey30Runtime

with Rey30Runtime.start() as runtime:
    session = runtime.create_session(model="gpt-4o-mini", ephemeral=True)
    turn = session.prompt("Summarise this table in one line.")

    for event in turn:                      # blocks until the turn ends
        if event["type"] == "token":
            print(event["text"], end="", flush=True)

    print(turn.result().stop_reason)
```

`prompt()` returns as soon as the turn starts; iterating the turn yields the
events while it runs, and `result()` blocks for the terminal record. Iterating
is optional - a host that only calls `result()` still gets it - but an undrained
turn keeps at most `max_buffered_events` (default 100000) *unread* events and
then drops its oldest, counting them on `turn.dropped`. The cap is the buffer,
not the turn: a reader that keeps up with a turn of any length loses nothing.

## Host tools

A host tool is declared with the schema the model sees, what it does, and the
handler that runs it here:

```python
from rey30_idvj_adk import HostTool, Rey30Runtime

def observe(args, call):
    return {"text": "the bench holds a red bin", "images": [frame_path]}

def move(args, call):
    arm.move(args["position"], abort=call.aborted)   # a threading.Event
    return {"text": f"moved to {args['position']}", "details": {"joints": 3}}

with Rey30Runtime.start() as runtime:
    session = runtime.create_session(
        model="gpt-4o-mini",
        builtins=False,                               # only the tools below
        permissions="host",                           # this process gates them itself
        tools=[
            HostTool(
                name="camera_observe",
                description="Look at the robot bench and describe what is there.",
                parameters={"type": "object", "properties": {}, "additionalProperties": False},
                capability="read",                    # never prompted, concurrent
                handler=observe,
            ),
            HostTool(
                name="robot_arm_move",
                description="Move the arm to a named position.",
                parameters={
                    "type": "object",
                    "properties": {"position": {"type": "string"}},
                    "required": ["position"],
                },
                capability="actuator",                 # prompted, sequential
                handler=move,
            ),
        ],
    )
```

What a handler answers with:

| Field | Meaning |
| --- | --- |
| `text` | Tool text, sent to the model. |
| `images` | A path, a data URL, `{data, mimeType}`, or `{url}`. A tool message cannot carry an image, so `text` stays on the tool message and the runtime leads the next user turn with the image parts. |
| `details` | Host-only data, echoed as `item/tool_details` and never sent to the model. |
| `error` / `isError` | The call failed; the message is the tool result the model sees. |

A raised exception is answered the same way, so a failed call never leaves the
turn parked. Each handler runs on its own thread, so the client's reader is
never held and two subagents may have calls in flight at once: serializing them
- one native call at a time, on a shared robot - is the host's decision through
its own queue. `call.aborted` is set when the runtime withdraws the request (an
interrupt, or the client going away), and a late answer is not written.

Requests from a delegated child arrive on the same session carrying `run_id`;
the answer is by `request_id` alone, so one path serves both.

`session.tools` and `session.tool_specs` are what the runtime advertises, read
back rather than assumed: the names there are the declared ones with their
`host__` prefix, because that is what the model calls. The `tool_request` a
handler runs for carries the bare name the host declared.

### Permissions

An `actuator` is gated: the runtime asks before the call reaches the handler,
unless the session declares that the gate is the host's own.

- `permissions="host"` - for a session whose host tools this process runs and
  gates itself, which is the usual case for an embedding host. No prompt is
  raised for those tools, so a turn never waits on an answer nobody will give.
- `permissions="jan"` (the default) - the runtime owns the gate. A call to an
  `actuator` raises `permission_request` on the turn's stream, naming the
  advertised tool (`host__robot_arm_move`) and its `capability`. Answer it with
  `session.respond_permission(request_id, "allow_once" | "allow_always" | "deny")`,
  from the code draining the turn:

```python
for event in turn:
    if event["type"] == "permission_request":
        session.respond_permission(event["request_id"], "allow_once")
```

An unanswered request parks the turn: nothing moves until it is answered, the
turn is interrupted, or the runtime is closed. A `read` tool is never prompted
for, in either mode.

With `builtins=False`, `subagents=True` still lets the model delegate: each
subagent is held to these host tools, and its calls arrive here with its
`run_id`. `system_prompt=` replaces Rey30 IDvj's whole system prompt with yours.

## Process ownership

```python
session.interrupt()               # the turn settles with stop_reason "interrupted"
session.set_model("...")          # between turns; refused mid-turn with -32001
session.fork()                    # a new session with this one's history and model
session.archive()                 # drop it from the runtime
runtime.close()                   # close stdin, then the process
runtime.close(force=True)         # skip the grace period and kill
```

`runtime.limits` is what the handshake advertised - `max_images`,
`max_image_bytes`, `max_message_image_bytes` and the accepted `mime_types` - so
a client that sends an image can check it before sending rather than discover
the cap by being rejected. `Rey30RpcError` is an answer (`code`, `retryable`), and
`Rey30RuntimeError` is the channel (spawn failure, protocol mismatch, exit), with
the runtime's own stderr attached.

A session's host tools follow it. `fork()` answers for the source's tools with
the same handlers (`fork(tools=[...])` replaces them, `fork(tools=[])` drops
them), and `resume_session(id)` returns the session this client already holds,
with its turns, listeners and handlers, rather than a second object for the
same id. A host tool's name is stripped of surrounding whitespace, as the
runtime does.

Listeners registered with `session.on(...)` run on the ADK's own dispatch
thread, in the order the runtime emitted the events, so a listener may call back
into the runtime - answering a permission request from one is the case that
matters - but it must not block for long: the dispatch thread is shared.

A listener that raises fails the runtime rather than being skipped: every open
turn settles with a `Rey30RuntimeError` naming what it raised, so a listener that
was answering permission requests cannot leave a turn parked behind it.

## Types

`rey30_idvj_adk/_generated.py` is generated from `protocol/rpc-schema.json` -
request params, the event union, and the method and event-tag literals - by the
same generator the JavaScript ADK uses:

```bash
node packages/adk/scripts/generate.mjs            # rewrite both ADKs' types
node packages/adk/scripts/generate.mjs --check    # fail on drift
```

The artifact covers request params and events, not responses; the suite pins the
responses it uses against a real runtime.

## Tests

The suite drives a real runtime against a stub provider on loopback - no
credentials, no network, no Node:

```bash
REY30_BIN=/path/to/rey30-idvj python3 -m unittest discover -s adk/python/tests -t adk/python
```

It is skipped, not failed, when `REY30_BIN` is unset.
