/**
 * Assistants Service Types
 */

import { Assistant } from '@rey30-idvj/core'

export interface AssistantsService {
  getAssistants(): Promise<Assistant[] | null>
  createAssistant(assistant: Assistant): Promise<void>
  deleteAssistant(assistant: Assistant): Promise<void>
}
