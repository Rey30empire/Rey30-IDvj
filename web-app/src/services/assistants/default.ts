/**
 * Default Assistants Service - Web implementation
 */

import { ExtensionManager } from '@/lib/extension'
import { Assistant, AssistantExtension, ExtensionTypeEnum } from '@rey30-idvj/core'
import type { AssistantsService } from './types'

export class DefaultAssistantsService implements AssistantsService {
  async getAssistants(): Promise<Assistant[] | null> {
    const extension = ExtensionManager.getInstance().get<AssistantExtension>(
      ExtensionTypeEnum.Assistant
    )

    if (!extension) {
      console.warn('AssistantExtension not found')
      return null
    }

    return extension.getAssistants()
  }

  async createAssistant(assistant: Assistant): Promise<void> {
    const extension = ExtensionManager.getInstance().get<AssistantExtension>(ExtensionTypeEnum.Assistant)
    if (!extension) throw new Error('El servicio de asistentes no está disponible. Espera a que termine de iniciarse.')
    await extension.createAssistant(assistant)
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    await ExtensionManager.getInstance()
      .get<AssistantExtension>(ExtensionTypeEnum.Assistant)
      ?.deleteAssistant(assistant)
  }
}
