import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageItem } from './MessageItem'
import type { UIMessage } from 'ai'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({}),
}))

describe('what a turn shows besides its messages', () => {
  const pendingWrite: UIMessage = {
    id: 'm1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-write',
        toolCallId: 'c1',
        state: 'input-available',
        input: { path: '/proj/report.html' },
      } as never,
    ],
  } as UIMessage

  /// Every kind of progress now reports itself where it happens: a tool call on
  /// its own card, a subagent on the chip beside the composer. What is left
  /// here is the model-load and prompt-reading progress, which has nowhere
  /// else to go.
  it('leaves a pending tool call to its own card', () => {
    render(
      <MessageItem
        message={pendingWrite}
        isFirstMessage={false}
        isLastMessage={true}
        status="streaming"
      />
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders a system note on its own, with no message chrome', () => {
    render(
      <MessageItem
        message={
          {
            id: 'sys-1',
            role: 'system',
            parts: [
              {
                type: 'text',
                text: "Subagent 'researcher' (c1) finished. Its full answer is in /tmp/subagents/r.md",
              },
            ],
          } as UIMessage
        }
        isFirstMessage={false}
        isLastMessage={true}
        status="ready"
      />
    )
    expect(screen.getByText(/finished/)).toBeInTheDocument()
    // No copy/remember/regenerate: nobody said it, so there is nothing to act on.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps library replies as inert text even when they contain image and citation markup', () => {
    const text = '![texto](https://image.invalid/pasaje) [[cite:https://citation.invalid/pasaje]]'
    const { container } = render(
      <MessageItem
        message={{ id: 'local-text', role: 'assistant', parts: [{ type: 'text', text }] }}
        isFirstMessage={true}
        isLastMessage={true}
        status="streaming"
        privateLibrary
      />
    )
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(container.querySelector('img, a, iframe')).toBeNull()
  })
})
