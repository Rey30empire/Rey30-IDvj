import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expandChatSkill } from '../chatSkills'
import { invokeSkill, listSkills } from '../skillStore'
import { explicitChatSkillName, stripExplicitChatSkillMarker } from '../skillCommands'

vi.mock('../skillStore', () => ({
  storeScope: { kind: 'store' },
  listSkills: vi.fn(),
  invokeSkill: vi.fn(),
}))

describe('explicit skills in classic chat', () => {
  beforeEach(() => vi.clearAllMocks())

  it('leaves plain chat and unrelated slash commands untouched without reading files', async () => {
    expect(await expandChatSkill('Una pregunta normal')).toBe('Una pregunta normal')
    expect(await expandChatSkill('/help')).toBe('/help')
    expect(listSkills).not.toHaveBeenCalled()
    expect(invokeSkill).not.toHaveBeenCalled()
  })

  it('invokes the selected stored skill with its arguments', async () => {
    vi.mocked(listSkills).mockResolvedValue([{ name: 'review', description: '', user_invocable: true, model_invocable: true }])
    vi.mocked(invokeSkill).mockResolvedValue('Instrucciones guardadas y argumento src/app.ts')
    const expanded = await expandChatSkill('/skill:review src/app.ts')
    expect(explicitChatSkillName(expanded)).toBe('review')
    expect(stripExplicitChatSkillMarker(expanded)).toBe('Instrucciones guardadas y argumento src/app.ts')
    expect(invokeSkill).toHaveBeenCalledWith({ kind: 'store' }, 'review', 'src/app.ts')
  })

  it('does not interpret an arbitrary prefix as an explicit skill expansion', () => {
    const text = '<!-- rey30-explicit-skill:review -->sin salto ni delimitación'
    expect(explicitChatSkillName(text)).toBeNull()
    expect(stripExplicitChatSkillMarker(text)).toBe(text)
  })

  it('fails visibly on unknown or non-invocable skills without falling back to another command', async () => {
    vi.mocked(listSkills).mockResolvedValue([{ name: 'internal', description: '', user_invocable: false, model_invocable: true }])
    await expect(expandChatSkill('/skill:internal')).rejects.toThrow('no disponible')
    await expect(expandChatSkill('/skill:missing')).rejects.toThrow('no disponible')
    expect(invokeSkill).not.toHaveBeenCalled()
  })

  it('preserves persistence/read errors so the message is not sent without the requested skill', async () => {
    vi.mocked(listSkills).mockRejectedValue(new Error('read failed'))
    await expect(expandChatSkill('/skill:review')).rejects.toThrow('read failed')
  })
})
