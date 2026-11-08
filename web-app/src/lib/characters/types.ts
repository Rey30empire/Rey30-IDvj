export type CharacterId = string
export type OriginalCharacterId = 'kairo' | 'beto' | 'tino' | 'milo' | 'roco' | 'nara' | 'centinela' | 'verso' | 'fullstack' | 'literatura'
export type CharacterMode = 'charla' | 'trabajo' | 'serio'
export type CharacterChannel = 'chat' | 'voice'
export type Intensity = 0 | 1 | 2 | 3
export type ResponseLength = 'breve' | 'equilibrada' | 'detallada'
export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'surprised' | 'focused' | 'error' | 'celebrating'
export type AvatarGesture = 'blink' | 'nod' | 'head-tilt' | 'wave' | 'fist-raise' | 'hands' | 'eyebrow' | 'wink' | 'ears' | 'tail' | 'pigtails' | 'bow'

export type CharacterSettings = {
  mode: CharacterMode
  humor: Intensity
  energy: Intensity
  profanity: Intensity
  flirtation: Intensity
  responseLength: ResponseLength
  userNickname: string
}
export type CharacterVoice = {
  provider: 'native-local'
  enabled: boolean
  plumaDirect?: boolean
  plumaClone?: boolean
  voiceURI: string | null
  lang: string
  rate: number
  pitch: number
  volume: number
  localOnly: boolean
}
export type CharacterAvatar = {
  enabled: boolean
  primary: string
  secondary: string
  accent: string
  skin: string
  hair: string
  motion: Intensity
  gestures: AvatarGesture[]
}
export type CharacterModelBinding = { providerId: string; modelId: string }
export type CharacterProfile = {
  id: CharacterId
  baseId: OriginalCharacterId
  name: string
  description: string
  biography: string
  instructions: string
  traits: string[]
  motivations: string[]
  speech: { style: string; rhythm: string }
  mannerisms: { greeting: string; explain: string; disagree: string; correct: string; celebrate: string; seriousSupport: string }
  examples: { situation: string; response: string }[]
  settings: CharacterSettings
  voice: CharacterVoice
  avatar: CharacterAvatar
  modelBinding: CharacterModelBinding | null
}
export type MemoryEntry = { enabled: boolean; notes: string }
export type CharacterMemory = {
  individual: MemoryEntry
  shared: MemoryEntry & { projectId?: string }
}
export type CharacterData = {
  schema: 1
  enabled: boolean
  activeCharacterId: CharacterId
  profiles: CharacterProfile[]
  individualMemory: Record<CharacterId, MemoryEntry>
  sharedMemory: Record<string, MemoryEntry>
}
export type CharacterContext = {
  system: string
  effectiveSettings: CharacterSettings
  modeOverride: CharacterMode | null
  warnings: string[]
}
