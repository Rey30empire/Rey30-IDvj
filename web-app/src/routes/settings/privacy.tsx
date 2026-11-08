import { createFileRoute } from '@tanstack/react-router'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAnalytic } from '@/hooks/useAnalytic'
import posthog from 'posthog-js'
import PrivacyControl from '@/containers/PrivacyControl'
import { usePrivacyMode } from '@/hooks/usePrivacyMode'

export const Route = createFileRoute('/settings/privacy')({
  component: Privacy,
})

function Privacy() {
  const { t } = useTranslation()
  const { setProductAnalytic, productAnalytic } = useAnalytic()
  const { mode, loaded, saving } = usePrivacyMode()

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <Card header={<h1 className="font-medium text-foreground text-base">Privacidad del chat y las peticiones de modelos</h1>}>
              <div className="space-y-3 p-3 text-sm">
                <PrivacyControl />
                <p><strong>Normal:</strong> utiliza los proveedores y herramientas configurados.</p>
                <p><strong>Solo local:</strong> permite únicamente los motores llama.cpp y MLX gestionados por esta aplicación, con sesión loopback válida. Un proveedor personalizado en localhost puede reenviar a la nube y se bloquea.</p>
                <p><strong>Nube con revisión:</strong> antes de cada petición remota muestra el contenido SDK con posibles correos, claves, teléfonos y rutas de usuario sustituidos. Puedes ocultar más texto o cancelar. La detección no encuentra todos los datos personales ni garantiza anonimato; el proveedor recibe el texto aprobado, el identificador del modelo y las credenciales configuradas.</p>
                <p>Los dos modos protegidos desactivan las herramientas del chat (MCP, web, RAG, shell y subagentes) y la telemetría del producto. Los adjuntos binarios no se envían a revisión de nube: extrae su texto o usa Solo local. Las opciones extra con texto no revisables se rechazan; puedes retirarlas o volver a Normal.</p>
                <p>Este control se aplica al chat y a las peticiones creadas por ModelFactory, incluidos títulos y compactación. No convierte toda la aplicación en un programa sin conexión ni protege llamadas a APIs externas realizadas fuera de ese flujo. Una nube procesa el contenido enviado según las condiciones de su proveedor.</p>
                <p>Se aplica a nuevos envíos. No retira datos ya enviados ni garantiza que un proveedor los borre. Cambiar el modo intenta cancelar las peticiones activas; no revierte acciones de herramientas o procesos que ya comenzaron.</p>
              </div>
            </Card>
            <Card
              header={
                <div className="flex items-center justify-between mb-4">
                  <h1 className="font-medium text-foreground text-base">
                    {t('settings:privacy.analytics')}
                  </h1>
                  <div className="flex items-center gap-2">
                    <Switch
                      aria-label="Permitir telemetría del producto"
                      checked={productAnalytic}
                      disabled={!loaded || saving || mode !== 'standard'}
                      onCheckedChange={(state) => {
                        if (!loaded || saving || mode !== 'standard') return
                        if (!state) {
                          posthog.opt_out_capturing()
                        }
                        setProductAnalytic(state)
                      }}
                    />
                  </div>
                </div>
              }
            >
              <CardItem
                title={t('settings:privacy.helpUsImprove')}
                description={<p>Esta preferencia controla la captura de eventos de uso del producto. No es una garantía de anonimato ni cambia las condiciones de un proveedor de modelos remoto.</p>}
                align="start"
              />
              <CardItem
                description={
                  <div className="text-foreground">
                    <p>La telemetría se mantiene desactivada mientras se utiliza un modo protegido. Volver a Normal no la activa automáticamente.</p>
                  </div>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
