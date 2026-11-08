import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useState } from 'react'
import { toast } from 'sonner'
import { IconLoader2, IconCheck } from '@tabler/icons-react'
import { ExtensionManager } from '@/lib/extension'

type ImportMlxModelDialogProps = {
  provider: ModelProvider
  trigger?: React.ReactNode
  onSuccess?: (importedModelName?: string) => void
}

export const ImportMlxModelDialog = ({
  provider,
  trigger,
  onSuccess,
}: ImportMlxModelDialogProps) => {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const [open, setOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [modelName, setModelName] = useState('')

  const handleFileSelect = async () => {
    const result = await serviceHub.dialog().open({
      multiple: false,
      directory: true,
    })

    if (result && typeof result === 'string') {
      setSelectedPath(result)

      // Extract model name from path
      const pathParts = result.split(/[\\/]/)
      const nameFromPath = pathParts[pathParts.length - 1] || 'mlx-model'
      const sanitizedName = nameFromPath
        .replace(/\s/g, '-')
        //eslint-disable-next-line
        .replace(/[^a-zA-Z0-9/_.\-]/g, '')
      setModelName(sanitizedName)
    }
  }

  const handleImport = async () => {
    if (!selectedPath) {
      toast.error(t('ui-dialogs:mlx.selectFolderRequired'))
      return
    }

    if (!modelName) {
      toast.error(t('ui-dialogs:mlx.nameRequired'))
      return
    }

    // Validate model name - only allow alphanumeric, underscore, hyphen, and dot
    //eslint-disable-next-line
    if (!/^[a-zA-Z0-9/_.\-]+$/.test(modelName)) {
      toast.error(t('ui-dialogs:mlx.invalidName'))
      return
    }

    // Check if model already exists
    const modelExists = provider.models.some((model) => model.id === modelName)

    if (modelExists) {
      toast.error(t('ui-dialogs:shared.modelExists'), {
        description: t('ui-dialogs:shared.alreadyImported', {
          name: modelName,
        }),
      })
      return
    }

    setImporting(true)

    try {
      console.log('[MLX Import] Starting import:', { modelName, selectedPath })

      // Get the MLX engine and call its import method
      const engine = ExtensionManager.getInstance().getEngine('mlx')
      if (!engine) {
        throw new Error(t('ui-dialogs:mlx.engineMissing'))
      }

      console.log('[MLX Import] Calling engine.import()...')
      await engine.import(modelName, {
        modelPath: selectedPath,
      })
      console.log('[MLX Import] Import completed')

      toast.success(t('ui-dialogs:shared.importSuccess'), {
        description: t('ui-dialogs:shared.imported', { name: modelName }),
      })

      // Reset form and close dialog
      setSelectedPath(null)
      setModelName('')
      setOpen(false)
      onSuccess?.(modelName)
    } catch (error) {
      console.error('[MLX Import] Import model error:', error)
      toast.error(t('ui-dialogs:shared.importFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setImporting(false)
    }
  }

  const resetForm = () => {
    setSelectedPath(null)
    setModelName('')
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!importing) {
      setOpen(newOpen)
      if (!newOpen) {
        resetForm()
      }
    }
  }

  const displayPath = selectedPath
    ? selectedPath.split(/[\\/]/).pop() || selectedPath
    : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        onInteractOutside={(e) => {
          e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('ui-dialogs:mlx.title')}
          </DialogTitle>
          <DialogDescription>
            {t('ui-dialogs:mlx.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Model Name Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('ui-dialogs:mlx.name')}
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={t('ui-dialogs:mlx.namePlaceholder')}
              className="w-full px-3 py-2 bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <p className="text-xs text-muted-foreground">
              {t('ui-dialogs:mlx.allowedName')}
            </p>
          </div>

          {/* File Selection Area */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{t('ui-dialogs:mlx.folder')}</h3>
              <span className="text-xs bg-secondary px-2 py-1 rounded-sm">
                {t('ui-dialogs:shared.required')}
              </span>
            </div>

            {displayPath ? (
              <div className="bg-accent/10 border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <IconCheck size={16} className="text-accent" />
                    <span className="text-sm font-medium">{displayPath}</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleFileSelect}
                    disabled={importing}
                  >
                    {t('ui-dialogs:shared.change')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="link"
                onClick={handleFileSelect}
                disabled={importing}
                className="w-full h-12 border border-dashed text-muted-foreground"
              >
                {t('ui-dialogs:mlx.selectFolder')}
              </Button>
            )}
          </div>

          {/* Preview */}
          {modelName && (
            <div className="rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  {t('ui-dialogs:shared.savedAs')}
                </span>
              </div>
              <p className="text-sm font-mono mt-1">mlx/models/{modelName}/</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-4 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={importing}
          >
            {t('ui-dialogs:shared.cancel')}
          </Button>
          <Button
            onClick={handleImport}
            size="sm"
            disabled={importing || !selectedPath || !modelName}
          >
            {importing && <IconLoader2 className="mr-2 size-4 animate-spin" />}
            {importing
              ? t('ui-dialogs:shared.importing')
              : t('ui-dialogs:shared.importModel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
