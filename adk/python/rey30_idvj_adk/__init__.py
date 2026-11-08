"""The Rey30 IDvj ADK for Python.

One long-lived ``rey30-idvj cli agent rpc`` runtime, many addressable sessions, and the
host tools your own process runs - with no Node and no third-party packages.

    from rey30_idvj_adk import Rey30Runtime

    with Rey30Runtime.start() as runtime:
        session = runtime.create_session(model="gpt-4o-mini", ephemeral=True)
        turn = session.prompt("Summarise this table in one line.")
        for event in turn:
            if event["type"] == "token":
                print(event["text"], end="", flush=True)
        print(turn.result().stop_reason)

See ``README.md`` for host tools, images and process ownership.
"""

from ._generated import EVENT_TAGS, PROTOCOL_VERSION
from .errors import Rey30RpcError, Rey30RuntimeError
from .install import (
    MANIFEST_URL,
    PLATFORM_KEYS,
    InstalledRuntime,
    Rey30InstallError,
    bin_name,
    find_runtime,
    install_runtime,
    platform_key,
    runtime_root,
)
from .runtime import CLIENT_NAME, CLIENT_VERSION, Rey30Runtime
from .session import HostTool, HostToolCall, Rey30Session, Rey30Turn, TurnResult

__version__ = CLIENT_VERSION

__all__ = [
    "CLIENT_NAME",
    "CLIENT_VERSION",
    "EVENT_TAGS",
    "MANIFEST_URL",
    "PLATFORM_KEYS",
    "PROTOCOL_VERSION",
    "HostTool",
    "HostToolCall",
    "InstalledRuntime",
    "Rey30InstallError",
    "Rey30RpcError",
    "Rey30Runtime",
    "Rey30RuntimeError",
    "Rey30Session",
    "Rey30Turn",
    "TurnResult",
    "__version__",
    "bin_name",
    "find_runtime",
    "install_runtime",
    "platform_key",
    "runtime_root",
]
