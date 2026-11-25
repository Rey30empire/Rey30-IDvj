import { MessagesSquare } from 'lucide-react'
import { debateAgents, usePlumaDebate } from '@/lib/characters/pluma-debate'

/**
 * The «/debate» suggestion shown over Pluma's chat box while «/» is being
 * typed. Tab or Enter (or a click) puts the command in the box.
 */
export function PlumaDebateCommand({ onChoose }: { onChoose: () => void }) {
  const agents = usePlumaDebate((state) => state.agents)
  const names = debateAgents({ agents }).map((agent) => agent.name).join(', ')
  return (
    <div
      role="listbox"
      aria-label="Comandos de Pluma"
      data-testid="pluma-debate-command"
      className="absolute bottom-full left-3 z-50 mb-1.5 w-[min(400px,calc(100%-1.5rem))] rounded-xl border border-border bg-popover p-1 shadow-popover"
    >
      <div
        role="option"
        aria-selected="true"
        className="flex cursor-pointer items-start gap-2 rounded-lg bg-primary/10 px-2 py-1.5 text-sm"
        // mousedown keeps the focus in the box
        onMouseDown={(event) => { event.preventDefault(); onChoose() }}
      >
        <MessagesSquare className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium">/debate</span>
            <span className="ml-auto text-[10px] text-muted-foreground">Tab o Intro</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Debate hablado sobre el documento o el texto que le des · {names}
          </div>
        </div>
      </div>
    </div>
  )
}
