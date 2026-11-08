import { useTranslation } from '@/i18n/react-i18next-compat'

export function ModelLoader() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center gap-2 py-1 px-2 bg-background rounded">
      <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
      <h1 className="font-medium text-xs">{t('ui-details:loadingModel')}</h1>
    </div>
  )
}
