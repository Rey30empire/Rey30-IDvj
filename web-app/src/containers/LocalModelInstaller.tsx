import { Button } from '@/components/ui/button'
import { ImportLlamacppModelDialog } from '@/containers/dialogs/ImportLlamacppModelDialog'
import { useModelProvider } from '@/hooks/useModelProvider'

export default function LocalModelInstaller() {
  const provider = useModelProvider(state => state.providers.find(item => item.provider === 'llamacpp'))
  const trigger = <Button variant="outline" size="sm" className="shrink-0 ml-2" disabled={!provider} title={provider ? undefined : 'El proveedor local todavía no está disponible.'}>Instalar GGUF local</Button>
  return provider ? <ImportLlamacppModelDialog provider={provider} trigger={trigger} /> : trigger
}
