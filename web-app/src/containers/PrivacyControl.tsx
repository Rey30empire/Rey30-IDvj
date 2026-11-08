import { useEffect } from 'react'
import { usePrivacyMode, type PrivacyMode } from '@/hooks/usePrivacyMode'
import { Label } from '@/components/ui/label'

const privacyModeLabels: Record<PrivacyMode, string> = {
  'standard': 'Normal',
  'local-only': 'Solo local',
  'cloud-review': 'Nube con revisión',
}
export default function PrivacyControl() {
  const { mode, loaded, saving, error, load, setMode } = usePrivacyMode()
  useEffect(() => {
    if (!loaded && !error) void load().catch(() => {})
  }, [load, loaded, error])
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <Label htmlFor="privacy-mode-control" className="text-xs">
        Privacidad del chat
      </Label>
      <select
        id="privacy-mode-control"
        aria-label="Privacidad del chat"
        value={loaded ? mode : ''}
        disabled={!loaded || saving}
        className="rounded-md border bg-background text-foreground text-xs px-2 py-1.5 max-w-full focus-visible:outline-2 focus-visible:outline-ring"
        onChange={(event) => {
          void setMode(event.target.value as PrivacyMode).catch(() => {})
        }}
      >
        {!loaded && <option value="">Comprobando política…</option>}
        {Object.entries(privacyModeLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {error && (
        <div role="alert" className="text-xs text-destructive max-w-sm">
          {error}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              void load().catch(() => {})
            }}
          >
            Volver a leer
          </button>
        </div>
      )}
    </div>
  )
}
