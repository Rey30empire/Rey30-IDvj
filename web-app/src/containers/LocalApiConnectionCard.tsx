import { useId, useState } from 'react'
import { Copy, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/containers/Card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAppState } from '@/hooks/useAppState'
import { clientConnectionJson, localApiConnection, newLocalApiKey } from '@/lib/localApiConnection'

export function LocalApiConnectionCard() {
  const { t } = useTranslation('api-connection')
  const { serverPort, apiPrefix, apiKey, setApiKey, serverHost, defaultModelLocalApiServer, lastServerModels } = useLocalApiServer()
  const status = useAppState((state) => state.serverStatus)
  const providers = useModelProvider((state) => state.providers)
  const [copied, setCopied] = useState('')
  const fieldId = useId()
  const connection = localApiConnection(serverPort, apiPrefix)
  const localModels = providers.filter((p) => ['llamacpp', 'mlx'].includes(p.provider)).flatMap((p) => p.models)
  const model = (status === 'running' ? lastServerModels[0]?.model : null)
    || defaultModelLocalApiServer?.model || (localModels.length === 1 ? localModels[0].id : '')
  const hasKey = Boolean(apiKey.trim())

  async function copy(value: string, name: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(name)
      toast.success(t('copied'))
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  function generateKey() {
    try { setApiKey(newLocalApiKey()) } catch { toast.error(t('keyFailed')) }
  }

  return <Card title={t('title')}>
    <div className="space-y-4" data-testid="local-api-connection">
      <p className="text-sm">{t('description')}</p>
      <p role="status" className="text-sm text-foreground">{t(status === 'running' ? 'running' : status === 'pending' ? 'starting' : 'stopped')}</p>
      {!connection ? <p role="alert" className="text-sm text-destructive">{t('invalidAddress')}</p> : <>
        <div className="space-y-1 text-sm">
          <label htmlFor={`${fieldId}-url`}>{t('baseUrl')}</label>
          <div className="flex flex-wrap gap-2">
            <Input id={`${fieldId}-url`} value={connection.baseUrl} readOnly className="min-w-40 flex-1 font-mono" />
            <Button size="sm" variant="outline" onClick={() => copy(connection.baseUrl, 'url')}><Copy size={14} />{t(copied === 'url' ? 'copied' : 'copyUrl')}</Button>
          </div>
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor={`${fieldId}-key`}>{t('key')}</label>
          <div className="flex flex-wrap items-center gap-2">
            <Input id={`${fieldId}-key`} type="password" readOnly value={apiKey} autoComplete="off" placeholder={t('noKey')} className="min-w-40 flex-1" />
            {hasKey ? <Button size="sm" variant="outline" onClick={() => copy(apiKey, 'key')}><Copy size={14} />{t(copied === 'key' ? 'copied' : 'copyKey')}</Button>
              : <Button size="sm" variant="outline" disabled={status !== 'stopped'} onClick={generateKey}><KeyRound size={14} />{t('generateKey')}</Button>}
          </div>
        </div>
        <p className="text-xs">{t(hasKey ? 'keyHelp' : 'noKeyHelp')}</p>
        <div className="space-y-1 text-sm">
          <label htmlFor={`${fieldId}-model`}>{t('model')}</label>
          <div className="flex flex-wrap gap-2">
            <Input id={`${fieldId}-model`} readOnly value={model} placeholder={t('chooseModel')} className="min-w-40 flex-1 font-mono" />
            <Button size="sm" variant="outline" disabled={!model} onClick={() => copy(model, 'model')}><Copy size={14} />{t('copyModel')}</Button>
          </div>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-foreground">{t('showConfig')}</summary>
          <pre className="my-2 overflow-auto whitespace-pre-wrap break-words rounded-md bg-secondary p-3 text-xs">{clientConnectionJson(connection.baseUrl, model, hasKey)}</pre>
          <Button size="sm" variant="outline" disabled={!model} onClick={() => copy(clientConnectionJson(connection.baseUrl, model, hasKey), 'config')}>{t('copyConfig')}</Button>
          <p className="mt-2 text-xs">{t('configHelp')}</p>
        </details>
      </>}
      <p className="text-xs">{t(serverHost === '0.0.0.0' ? 'lanHelp' : 'localHelp')}</p>
    </div>
  </Card>
}
