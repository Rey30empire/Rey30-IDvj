import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getAgentToolSchemas } = vi.hoisted(() => ({
  getAgentToolSchemas: vi.fn(),
}))
vi.mock('@/lib/agentTools', () => ({ getAgentToolSchemas }))

import {
  buildCoworkTools,
  coworkToolSignature,
  allowedToolNames,
  PLAN_DENIED_TOOLS,
  TODO_TOOL_NAME,
  ASK_TOOL_NAME,
  TASK_TOOL_NAME,
} from '../coworkTools'

const schema = (name: string) => ({
  type: 'function' as const,
  function: { name, description: name, parameters: { type: 'object' } },
})

const SEARCH = ['ls', 'find', 'grep']
const BASE = ['read', 'write', 'edit', 'shell', 'memory_write']
const ALL = [...BASE, ...SEARCH]

const opts = (over: Partial<Parameters<typeof buildCoworkTools>[0]> = {}) => ({
  planMode: false,
  webSearch: false,
  subagentNames: ['researcher'],
  allowSubagents: true,
  ...over,
})

describe('buildCoworkTools', () => {
  beforeEach(() => {
    getAgentToolSchemas.mockReset()
    getAgentToolSchemas.mockResolvedValue(ALL.map(schema))
  })

  it('keeps the existing compact tool set when shell is available', async () => {
    const tools = await buildCoworkTools(opts())
    for (const n of BASE) expect(tools[n]).toBeDefined()
    for (const n of SEARCH) expect(tools[n]).toBeUndefined()
    expect(tools[TODO_TOOL_NAME]).toBeDefined()
    expect(tools[ASK_TOOL_NAME]).toBeDefined()
    expect(tools[TASK_TOOL_NAME]).toBeDefined()
  })

  it('keeps file tools without shell or monitor on a shared Windows project', async () => {
    const restricted = opts({ allowProcesses: false })
    const tools = await buildCoworkTools(restricted)
    for (const name of ['read', 'write', 'edit', ...SEARCH]) {
      expect(tools[name]).toBeDefined()
    }
    expect(tools.shell).toBeUndefined()
    expect(tools.monitor).toBeUndefined()
    expect(coworkToolSignature(restricted, true)).not.toBe(coworkToolSignature(opts(), true))
    expect(allowedToolNames(['read', 'write', 'shell', 'monitor'], restricted)).toEqual(['read', 'write'])
  })

  it('uses native search when the sandbox has withheld shell', async () => {
    getAgentToolSchemas.mockResolvedValue(ALL.filter(name => name !== 'shell').map(schema))
    const tools = await buildCoworkTools(opts())
    for (const name of SEARCH) expect(tools[name]).toBeDefined()
    expect(tools.shell).toBeUndefined()
  })

  // Plan mode's guarantee is that nothing can mutate. Withholding is only half
  // of it (the dispatcher refuses too), but a leak here would advertise a tool
  // the run is about to refuse, which reads to the model as a broken tool.
  it('withholds every mutating tool in plan mode', async () => {
    const tools = await buildCoworkTools(opts({ planMode: true }))
    for (const denied of PLAN_DENIED_TOOLS) {
      expect(tools[denied]).toBeUndefined()
    }
    expect(tools.read).toBeDefined()
    expect(tools[TODO_TOOL_NAME]).toBeDefined()
    expect(tools[ASK_TOOL_NAME]).toBeDefined()
  })

  it('withholds task when subagents are not allowed', async () => {
    const tools = await buildCoworkTools(opts({ allowSubagents: false }))
    expect(tools[TASK_TOOL_NAME]).toBeUndefined()
  })

  it('names the saved subagents in the task description', async () => {
    const tools = await buildCoworkTools(
      opts({ subagentNames: ['researcher', 'reviewer'] })
    )
    expect(tools[TASK_TOOL_NAME].description).toContain('researcher, reviewer')
  })

  // The todo tool must keep the Rust name: the plan-mode addendum instructs the
  // model to call `todo` by name, so a rename silently breaks plan mode.
  it('keeps the Rust tool names', () => {
    expect(TODO_TOOL_NAME).toBe('todo')
    expect(ASK_TOOL_NAME).toBe('ask')
  })
})

describe('coworkToolSignature', () => {
  it('is stable across repeated calls with the same config', () => {
    expect(coworkToolSignature(opts(), true)).toBe(
      coworkToolSignature(opts(), true)
    )
  })

  it('changes when anything that alters the advertised set changes', () => {
    const base = coworkToolSignature(opts(), true)
    expect(coworkToolSignature(opts({ planMode: true }), true)).not.toBe(base)
    expect(coworkToolSignature(opts(), false)).not.toBe(base)
    expect(
      coworkToolSignature(opts({ subagentNames: ['other'] }), true)
    ).not.toBe(base)
  })

  // Subagent names only reach the prompt when task is advertised, so they must
  // not churn the signature (and discard the KV prefix) when it is not.
  it('ignores subagent names when subagents are off', () => {
    expect(coworkToolSignature(opts({ allowSubagents: false }), true)).toBe(
      coworkToolSignature(
        opts({ allowSubagents: false, subagentNames: ['x', 'y'] }),
        true
      )
    )
  })
})

describe('web tools', () => {
  beforeEach(() => {
    getAgentToolSchemas.mockReset()
    getAgentToolSchemas.mockResolvedValue(ALL.map(schema))
  })

  it('are withheld when web search is off', async () => {
    const tools = await buildCoworkTools(opts({ webSearch: false }))
    expect(tools.web_search).toBeUndefined()
    expect(tools.web_fetch).toBeUndefined()
  })

  it('are advertised when it is on', async () => {
    const tools = await buildCoworkTools(opts({ webSearch: true }))
    expect(tools.web_search).toBeDefined()
    expect(tools.web_fetch).toBeDefined()
  })

  // Research is most of what planning is, so unlike write/edit/shell these are
  // reads that plan mode keeps.
  it('survive plan mode', async () => {
    const tools = await buildCoworkTools(opts({ webSearch: true, planMode: true }))
    expect(tools.web_search).toBeDefined()
    expect(tools.shell).toBeUndefined()
  })

  // Advertising them changes the tool JSON, so a run that froze without them
  // must not silently pick them up.
  it('change the freeze signature', () => {
    expect(coworkToolSignature(opts({ webSearch: true }), true)).not.toBe(
      coworkToolSignature(opts({ webSearch: false }), true)
    )
  })
})

describe('allowedToolNames', () => {
  it('refuses the same set plan mode withholds', () => {
    const out = allowedToolNames([...ALL, TASK_TOOL_NAME], opts({ planMode: true }))
    expect(out).toEqual(['read', ...SEARCH])
  })

  it('refuses task past the subagent depth cap', () => {
    const out = allowedToolNames(['read', TASK_TOOL_NAME], opts({ allowSubagents: false }))
    expect(out).toEqual(['read'])
  })

  /// The flat schema: `{ subagents: [ {name, task, phase?, allowed_tools?} ] }`,
  /// with no system_prompt and no unknown-name failure (an unknown name is an
  /// ephemeral generalist). One optional per-subagent `phase` pipelines them.
  describe('the task schema is a flat subagents array with an optional phase', () => {
    type TaskSchema = {
      description: string
      inputSchema: {
        jsonSchema: {
          required?: string[]
          properties: {
            subagents: {
              items: {
                required?: string[]
                properties: Record<string, unknown>
              }
            }
          }
        }
      }
    }

    it('requires a subagents array with name+task, an optional phase, and no system_prompt', async () => {
      const { buildCoworkTools } = await import('../coworkTools')
      const tools = await buildCoworkTools({
        planMode: false,
        subagentNames: [],
        allowSubagents: true,
        webSearch: false,
      })
      const task = tools['task'] as unknown as TaskSchema
      const schema = task.inputSchema.jsonSchema
      expect(schema.required).toContain('subagents')
      const sub = schema.properties.subagents.items
      expect(sub.required).toEqual(['name', 'task'])
      expect(Object.keys(sub.properties)).toEqual([
        'name',
        'task',
        'phase',
        'allowed_tools',
      ])
      // The one-off vocabulary is gone entirely.
      const serialized = JSON.stringify(schema)
      expect(serialized).not.toContain('system_prompt')
      expect(serialized).not.toContain('subagent_name')
      expect(task.description).toContain('No saved subagents yet')
    })

    it('lists the saved definitions when there are any', async () => {
      const { buildCoworkTools } = await import('../coworkTools')
      const tools = await buildCoworkTools({
        planMode: false,
        subagentNames: ['reviewer'],
        allowSubagents: true,
        webSearch: false,
      })
      const task = tools['task'] as unknown as { description: string }
      expect(task.description).toContain('Saved subagents: reviewer.')
    })
  })
})
