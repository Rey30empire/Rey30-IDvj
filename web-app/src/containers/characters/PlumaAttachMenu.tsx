import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { IconFolder, IconLoader2, IconPaperclip } from '@tabler/icons-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { Attachment } from '@/types/attachment'
import { choosePlumaReading, plumaDocumentAttachment, readPlumaDocument } from '@/lib/characters/pluma-reading'

const message = (cause: unknown) => cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'No se pudo leer el documento.'

/**
 * Pluma's «+»: a document (txt, md, pdf, docx, epub, html) or a whole folder
 * of them, read on this computer and sent whole with the message, so she can
 * comment or debate all of it. Images, audio and video stay out: her chat
 * only takes text.
 */
export function PlumaAttachMenu({ onAttach, disabled }: { onAttach: (attachment: Attachment) => void; disabled?: boolean }) {
  const [reading, setReading] = useState(false)
  const add = async (folder: boolean) => {
    try {
      const path = await choosePlumaReading(folder)
      if (!path) return
      setReading(true)
      const document = await readPlumaDocument(path)
      const attachment = plumaDocumentAttachment(path, document, folder)
      onAttach(attachment)
      if (document.cut) toast.warning(`«${document.title}» es muy largo: Pluma recibe las primeras ${document.text.length.toLocaleString('es')} letras.`)
    } catch (cause) {
      toast.error(message(cause))
    } finally {
      setReading(false)
    }
  }
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button data-testid="pluma-attach-menu" variant="secondary" size="icon-sm" className="mr-2 mb-1 rounded-full" disabled={disabled || reading} aria-label="Adjuntar un documento para Pluma">
        {reading ? <IconLoader2 size={18} className="animate-spin text-muted-foreground" /> : <PlusIcon size={18} className="text-muted-foreground" />}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuItem onSelect={() => void add(false)}>
        <IconPaperclip size={18} className="text-muted-foreground" />
        <span>Agregar documento (txt, md, pdf, docx, epub)</span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void add(true)}>
        <IconFolder size={18} className="text-muted-foreground" />
        <span>Agregar carpeta</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
