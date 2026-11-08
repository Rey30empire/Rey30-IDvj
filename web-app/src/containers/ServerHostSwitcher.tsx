import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { cn } from '@/lib/utils'
import { ChevronsUpDown } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'

const hostOptions = [
  { value: '127.0.0.1', label: '127.0.0.1' },
  { value: '0.0.0.0', label: '0.0.0.0' },
]

export function ServerHostSwitcher({
  isServerRunning,
}: {
  isServerRunning?: boolean
}) {
  const { serverHost, setServerHost } = useLocalApiServer()
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild
        className={cn(isServerRunning && 'opacity-50 pointer-events-none')}
      >
        <Button variant="outline" size="sm" className="w-full justify-between" title={t('ui-spanish:editServerHost')}>
          {serverHost}
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-24">
        {hostOptions.map((item) => (
          <DropdownMenuItem
            key={item.value}
            className={cn(
              'cursor-pointer my-0.5',
              serverHost === item.value && 'bg-seconday'
            )}
            onClick={() => setServerHost(item.value as '127.0.0.1' | '0.0.0.0')}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
