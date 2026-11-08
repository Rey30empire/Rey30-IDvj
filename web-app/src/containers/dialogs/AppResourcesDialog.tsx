import readme from '../../../../README.md?raw'
import license from '../../../../LICENSE?raw'
import cliGuide from '../../../../docs/src/pages/docs/desktop/cli.mdx?raw'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type AppResource = 'readme' | 'license' | 'support' | 'cli'

const resources: Record<AppResource, { title: string; content: string }> = {
  readme: { title: 'Rey30 IDvj · README', content: readme },
  license: { title: 'Rey30 IDvj · LICENSE', content: license },
  support: {
    title: 'Rey30 IDvj · Soporte local',
    content:
      'Para revisar un problema, abre los registros desde Ajustes → General → Registros. ' +
      'Conserva la versión de la aplicación, el modelo seleccionado y el mensaje de error. ' +
      'Esta distribución local no tiene un servicio de soporte externo configurado. ' +
      'No compartas claves de API ni conversaciones privadas al preparar un informe.',
  },
  cli: {
    title: 'Rey30 IDvj · CLI',
    content: cliGuide.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim(),
  },
}

export function AppResourcesDialog({
  resource,
  onClose,
}: {
  resource: AppResource | null
  onClose: () => void
}) {
  const item = resource ? resources[resource] : null
  if (!item) return null
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.title}</DialogTitle>
          <DialogDescription>Documentación incluida en esta distribución.</DialogDescription>
        </DialogHeader>
        <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans">
          {item.content}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
