import { Button } from '@/components/ui/button'
import { PLUMA_ACCENTS, PLUMA_EMOTIONS, usePlumaVoiceStyle, type PlumaAccent, type PlumaEmotion } from '@/lib/characters/pluma-voice-style'

const field = 'w-full cursor-pointer rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground'

/**
 * How Pluma speaks with her cloned voice: mood, accent, speed and pitch. The
 * mood and accent shape what she says from her next answer; speed and pitch
 * change the audio itself.
 */
export function PlumaVoiceStyleControls() {
  const style = usePlumaVoiceStyle()
  const pitch = style.pitch === 0 ? 'normal' : `${style.pitch > 0 ? '+' : ''}${style.pitch} semitonos`
  return <div data-testid="pluma-voice-style" className="space-y-2 border-t pt-2">
    <p className="text-sm font-medium">Forma de hablar</p>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      Ánimo
      <select aria-label="Ánimo de Pluma" className={field} value={style.emotion} onChange={event => style.set({ emotion: event.target.value as PlumaEmotion })}>
        {Object.entries(PLUMA_EMOTIONS).map(([id, emotion]) => <option key={id} value={id}>{emotion.label}</option>)}
      </select>
    </label>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      Acento
      <select aria-label="Acento de Pluma" className={field} value={style.accent} onChange={event => style.set({ accent: event.target.value as PlumaAccent })}>
        {Object.entries(PLUMA_ACCENTS).map(([id, accent]) => <option key={id} value={id}>{accent.label}</option>)}
      </select>
    </label>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      Velocidad · {style.speed.toFixed(2)}×
      <input aria-label="Velocidad de Pluma" type="range" min={0.7} max={1.4} step={0.05} value={style.speed} onChange={event => style.set({ speed: Number(event.target.value) })} />
    </label>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      Tono · {pitch}
      <input aria-label="Tono de Pluma" type="range" min={-4} max={4} step={0.5} value={style.pitch} onChange={event => style.set({ pitch: Number(event.target.value) })} />
    </label>
    <p className="text-xs text-muted-foreground">El ánimo y el acento cambian cómo habla: sus palabras, expresiones y ritmo, desde su próxima respuesta. La voz sigue siendo tu muestra, porque el motor de voz actual no cambia la pronunciación. Con otra velocidad o tono, cada frase tarda un poco más en empezar.</p>
    <Button type="button" size="sm" variant="ghost" onClick={() => style.reset()}>Volver a lo normal</Button>
  </div>
}
