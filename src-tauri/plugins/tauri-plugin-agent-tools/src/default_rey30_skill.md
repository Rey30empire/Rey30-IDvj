---
name: rey30-idvj
description: Use when onboarding users to Rey30 IDvj Agent or explaining project and global configuration, skills, memory, providers, and MCP servers.
---
# Rey30 IDvj Agent
When enabled, Rey30 IDvj lists this skill's name and purpose. The model loads its body with `skill_read`
only when the task needs it.


Run `rey30-idvj` in a folder. That CWD is the project root; `--project DIR` selects another root.

## Project files

Rey30 IDvj reads one non-empty instructions file per folder, from the project root and its ancestors. The
nearest file wins. `AGENTS.md` is the default and what `/init` writes; a legacy `JAN.md` still loads
and wins over `AGENTS.md` in the same folder. It is the only file Rey30 IDvj keeps in the project; commit it
to share instructions.
Everything else is per-user state under `~/.rey30-idvj/`, created on first use.

## User files

```text
~/.rey30-idvj/
|-- config.toml              # CLI provider configuration and credentials
|-- MEMORY.md                # generated index: user notes + projects with memory
|-- memory/                  # user-wide notes (`user:<name>`), every project
|-- skills/                  # user-wide skills, every project (project skills shadow them)
`-- projects/
    `-- <name>-<hash>/       # one per project directory (git worktrees share it)
        |-- project.json     # which directory this store belongs to
        |-- agent.toml       # model, provider, budget, tools, skills
        |-- MEMORY.md        # generated index of this project's notes
        |-- memory/          # durable project facts
        |-- skills/
        |   `-- <name>/
        |       `-- SKILL.md # procedure, plus optional scripts/templates
        |-- plugins/
        |-- threads/         # saved conversations
        `-- subagents/       # reusable agent definitions
```

`agent.toml` has `[agent]`, `[provider]`, `[budget]`, `[tools]`, and `[skills]` sections, plus
`[subagents.<name>] model = ...` to choose the model a subagent runs on.

Built-in subagents `explore` (read-only: `read`/`ls`/`find`/`grep`, no shell) and `research` run on
the cheap `smol` role (`smol_model` in `config.toml`, else the session's model); `review` and
`debug` run on the session's model. A dispatch picks one with `agent: "<name>"`. A subagent's
`model` is a model id, `smol` or `inherit`. Change it in `/settings > subagents`; set
the cheap model with `/settings > smol_model`.
A simple skill can be `skills/<name>.md`. Skill precedence is project > user (`~/.rey30-idvj/skills`) >
built-in `rey30-idvj`. Plugin skills are always named `<plugin>:<name>`. `/skills` lists each skill's scope
and marks shadowed ones, and `skill_write` with `scope: "user"` writes a user skill. Symlinked
skill folders are followed. Run `rey30-idvj cli agent status --project .` to scaffold
the store. A project that still has a `.rey30-idvj/` folder from an older Rey30 IDvj is moved into
`~/.rey30-idvj/projects/` automatically the next time Rey30 IDvj starts in it.
`memory_cross_project = false` in `config.toml` hides other projects' memory from the agent.

Rey30 IDvj Desktop stores its settings and shared MCP configuration under the platform support folder:

```text
<support-folder>/Rey30 IDvj/
|-- settings.json             # Desktop settings, including an optional data_folder
`-- data/                     # default REY30_DATA_FOLDER
    |-- mcp_config.json       # shared MCP server definitions
    `-- agent-workspace/      # Desktop-global agent store
        |-- skills/
        |-- memory/
        `-- threads/
```

Default `<support-folder>`:

```text
macOS:   ~/Library/Application Support
Linux:   $XDG_DATA_HOME, or ~/.local/share
Windows: %APPDATA%
```

`REY30_DATA_FOLDER` overrides the `data/` location. Otherwise Rey30 IDvj uses
`settings.json`'s `data_folder`, then `<support-folder>/Rey30 IDvj/data`.
Add MCP servers in Desktop at `Settings > MCP Servers`; Rey30 IDvj writes
`<REY30_DATA_FOLDER>/mcp_config.json`.
