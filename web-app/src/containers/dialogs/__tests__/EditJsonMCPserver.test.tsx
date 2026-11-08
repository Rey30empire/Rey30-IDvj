import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
vi.mock('@/i18n/react-i18next-compat', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})
vi.mock('@uiw/react-textarea-code-editor', () => ({
  default: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea aria-label="JSON" {...props} />,
}))
import EditJsonMCPserver from '../EditJsonMCPserver'

describe('MCP JSON editor saves', () => {
  const save = vi.fn()
  const close = vi.fn()
  beforeEach(() => { save.mockReset(); close.mockReset() })
  const renderEditor = () => render(<EditJsonMCPserver open onOpenChange={close} serverName={null} initialData={{ existing: { command: 'node', args: [], env: {} } }} onSave={save} />)

  it.each(['[]', 'null', '42', '{"mcpServers":[]}'])('keeps existing configuration for %s', async (payload) => {
    renderEditor()
    fireEvent.change(screen.getByRole('textbox', { name: 'JSON' }), { target: { value: payload } })
    fireEvent.click(screen.getByText('mcp-servers:editJson.save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('mcp-servers:editJson.errorFormat')
    expect(save).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('waits for persistence before closing and reports a rejected write without closing', async () => {
    let rejectWrite!: (error: Error) => void
    save.mockImplementation(() => new Promise((_resolve, reject) => { rejectWrite = reject }))
    renderEditor()
    fireEvent.click(screen.getByText('mcp-servers:editJson.save'))
    expect(screen.getByText('mcp-servers:editJson.save')).toBeDisabled()
    expect(close).not.toHaveBeenCalled()
    await act(async () => rejectWrite(new Error('disk full')))
    expect(await screen.findByRole('alert')).toHaveTextContent('integrations:saveFailed')
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByText('mcp-servers:editJson.save')).not.toBeDisabled()
  })

  it('closes after a valid configuration is saved', async () => {
    save.mockResolvedValue(undefined)
    renderEditor()
    fireEvent.click(screen.getByText('mcp-servers:editJson.save'))
    await waitFor(() => expect(close).toHaveBeenCalledWith(false))
    expect(save).toHaveBeenCalledWith({ existing: { command: 'node', args: [], env: {} } })
  })
})
