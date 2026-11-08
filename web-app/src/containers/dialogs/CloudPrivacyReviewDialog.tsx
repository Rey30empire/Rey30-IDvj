import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  approvePrivacyReview,
  cancelPrivacyReview,
  hidePrivacyReviewText,
  usePrivacyReview,
} from '@/lib/privacyReview'

export default function CloudPrivacyReviewDialog() {
  const { current, pending } = usePrivacyReview()
  const [hide, setHide] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setHide('')
    setError(null)
  }, [current?.id])
  return (
    <Dialog
      open={Boolean(current)}
      onOpenChange={(open) => {
        if (!open && current) cancelPrivacyReview(current.id)
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisar antes de enviar a la nube</DialogTitle>
          <DialogDescription>
            El texto visible se enviará al proveedor. La detección automática
            puede omitir datos sensibles o marcar datos que no lo sean. Revisa
            el contenido completo; no garantiza anonimato.
          </DialogDescription>
        </DialogHeader>
        {current && (
          <>
            <p className="text-sm break-words">
              {current.context.provider} · {current.context.model} ·{' '}
              {current.context.endpoint}
            </p>
            <p className="text-sm text-muted-foreground">
              Incluye sistema, historial y opciones de la petición SDK. No
              muestra cabeceras ni claves de conexión; las cabeceras
              personalizadas y credenciales configuradas siguen enviándose al
              proveedor. Coincidencias ocultadas: {current.redactions}.
              Pendientes: {pending}.
            </p>
            <pre
              tabIndex={0}
              aria-label="Contenido que se enviará"
              className="max-h-[38svh] overflow-auto whitespace-pre-wrap break-all rounded-md border p-3 text-xs select-text"
            >
              {JSON.stringify(current.payload, null, 2)}
            </pre>
            <div className="flex flex-col gap-2">
              <Label htmlFor="privacy-hide-text">
            Texto adicional que quieres ocultar
              </Label>
              <div className="flex gap-2 flex-wrap">
                <Input
                  id="privacy-hide-text"
                  value={hide}
                  maxLength={512}
                  autoComplete="off"
                  onChange={(event) => setHide(event.target.value)}
                  className="flex-1 min-w-32"
                />
                <Button
                  variant="outline"
                  disabled={!hide || current.updating}
                  onClick={() => {
                    setError(null)
                    void hidePrivacyReviewText(current.id, hide)
                      .then(() => setHide(''))
                      .catch(() =>
                        setError(
                          'No se pudo ocultar el texto; revisa de nuevo la petición.'
                        )
                      )
                  }}
                >
                  Ocultar texto
                </Button>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => cancelPrivacyReview(current.id)}
              >
                Cancelar envío
              </Button>
              <Button
                disabled={current.updating || Boolean(hide)}
                onClick={() => {
                  try {
                    approvePrivacyReview(current.id, current.hash)
                  } catch {
                    setError(
                      'La petición cambió; vuelve a revisarla antes de enviarla.'
                    )
                  }
                }}
              >
                Enviar esta petición
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
