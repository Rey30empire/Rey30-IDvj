import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { validateMCPConfigJson, type MCPConfigJson } from '@/lib/mcpConfigValidation'
import CodeEditor from '@uiw/react-textarea-code-editor'
import '@uiw/react-textarea-code-editor/dist.css'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface EditJsonMCPserverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverName: string | null // null means editing all servers
  initialData: MCPConfigJson
  onSave: (data: MCPConfigJson) => void | Promise<void>
}

export default function EditJsonMCPserver({
  open,
  onOpenChange,
  serverName,
  initialData,
  onSave,
}: EditJsonMCPserverProps) {
  const { t } = useTranslation()
  const [jsonContent, setJsonContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Initialize the editor with the provided data
  useEffect(() => {
    if (open && initialData) {
      try {
        setJsonContent(JSON.stringify(initialData, null, 2))
        setError(null)
      } catch {
        setError(t('mcp-servers:editJson.errorParse'))
      }
    }
  }, [open, initialData, t])

  const handlePaste = () => {
    // Clear any existing errors when pasting
    setError(null)
  }

  const handleSave = async () => {
    let parsedData: MCPConfigJson
    try {
      parsedData = validateMCPConfigJson(JSON.parse(jsonContent), serverName ? 'server' : 'all')
    } catch {
      setError(t('mcp-servers:editJson.errorFormat'))
      return
    }
    setSaving(true)
    try {
      await onSave(parsedData)
      onOpenChange(false)
      setError(null)
    } catch {
      setError(t('integrations:saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogContent
        onInteractOutside={(e) => {
          e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {serverName
              ? t('mcp-servers:editJson.title', { serverName })
              : t('mcp-servers:editJson.titleAll')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="border  rounded-md overflow-hidden!">
            <style>{`
              .w-tc-editor textarea {
                word-break: break-all !important;
                overflow-wrap: anywhere !important;
                white-space: pre-wrap !important;
              }
              .w-tc-editor .token.string {
                word-break: break-all !important;
                overflow-wrap: anywhere !important;
              }
            `}</style>
            <CodeEditor
              value={jsonContent}
              language="json"
              placeholder={t('mcp-servers:editJson.placeholder')}
              onChange={(e) => setJsonContent(e.target.value)}
              onPaste={handlePaste}
              style={{
                backgroundColor: 'transparent',
                wordBreak: 'break-all',
                overflowWrap: 'anywhere',
                whiteSpace: 'pre-wrap',
              }}
              className="w-full text-sm! overflow-hidden break-all! font-mono!"
            />
          </div>
          {error && <div role="alert" className="text-destructive text-sm">{error}</div>}
        </div>

        <DialogFooter>
          <Button size="sm" onClick={handleSave} disabled={saving}>{t('mcp-servers:editJson.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
