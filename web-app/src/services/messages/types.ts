/**
 * Messages Service Types
 */

import { ThreadMessage } from '@rey30-idvj/core'

export interface MessagesService {
  fetchMessages(threadId: string): Promise<ThreadMessage[]>
  createMessage(message: ThreadMessage): Promise<ThreadMessage>
  modifyMessage(message: ThreadMessage): Promise<ThreadMessage>
  deleteMessage(threadId: string, messageId: string): Promise<void>
}
