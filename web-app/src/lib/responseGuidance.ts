import skill from '../../../resources/rey30-skills/original/rey30-redaccion-e-intencion/SKILL.md?raw'

export const responseGuidance = skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
