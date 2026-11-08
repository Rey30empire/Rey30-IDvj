import { markExplicitChatSkill, parseSkillCommand, resolveSkillCommand } from '@/lib/skillCommands'
import { invokeSkill, listSkills, storeScope } from '@/lib/skillStore'

/** Explicit chat invocation reads instructions only; it never executes bundled scripts. */
export async function expandChatSkill(text: string): Promise<string> {
  const command = parseSkillCommand(text)
  if (!command?.explicit) return text
  const skill = resolveSkillCommand(await listSkills(storeScope), command)
  if (!skill) throw new Error(`Skill no disponible para invocación: ${command.name}`)
  const body = await invokeSkill(storeScope, skill.name, command.args)
  return markExplicitChatSkill(skill.name, body)
}
