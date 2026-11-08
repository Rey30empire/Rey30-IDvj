import { defineConfig, loadEnv, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import desktopConfig from '../src-tauri/tauri.conf.json'
import { resolveBuildPlatform } from './build-platform'
const host = process.env.TAURI_DEV_HOST

// Plugin to inject GA scripts in HTML
function injectGoogleAnalytics(gaMeasurementId?: string): Plugin {
  return {
    name: 'inject-google-analytics',
    transformIndexHtml(html) {
      // Only inject GA scripts if GA_MEASUREMENT_ID is set
      if (!gaMeasurementId) {
        // Remove placeholder if no GA ID
        return html.replace(/\s*<!-- INJECT_GOOGLE_ANALYTICS -->\n?/g, '')
      }

      const gaScripts = `<!-- Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){ dataLayer.push(arguments); }
      gtag('consent','default',{
        ad_storage:'denied',
        analytics_storage:'denied',
        ad_user_data:'denied',
        ad_personalization:'denied',
        wait_for_update:500
      });
      gtag('js', new Date());
      gtag('config', '${gaMeasurementId}', {
        debug_mode: (location.hostname === 'localhost'),
        send_page_view: false
      });
    </script>`

      return html.replace('<!-- INJECT_GOOGLE_ANALYTICS -->', gaScripts)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  const platform = resolveBuildPlatform({
    tauriPlatform: process.env.TAURI_ENV_PLATFORM,
    isTauri: process.env.IS_TAURI,
    hostPlatform: process.platform,
  })

  return {
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routeFileIgnorePattern: '.((test).ts)|test-page',
      }),
      react(),
      tailwindcss(),
      nodePolyfills({
        include: ['path'],
      }),
      injectGoogleAnalytics(env.GA_MEASUREMENT_ID),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@rey30-idvj/assistant-extension': path.resolve(__dirname, '../extensions/assistant-extension/dist/index.js'),
        '@rey30-idvj/conversational-extension': path.resolve(__dirname, '../extensions/conversational-extension/dist/index.js'),
        '@rey30-idvj/download-extension': path.resolve(__dirname, '../extensions/download-extension/dist/index.js'),
        '@rey30-idvj/llamacpp-extension': path.resolve(__dirname, '../extensions/llamacpp-extension/dist/index.js'),
        '@rey30-idvj/mlx-extension': path.resolve(__dirname, '../extensions/mlx-extension/dist/index.js'),
        '@rey30-idvj/rag-extension': path.resolve(__dirname, '../extensions/rag-extension/dist/index.js'),
        '@rey30-idvj/vector-db-extension': path.resolve(__dirname, '../extensions/vector-db-extension/dist/index.js'),
      },
    },
    optimizeDeps: {
      // Extensions are prebuilt, self-contained ESM dist bundles. Excluding them
      // stops Vite's dev dep-optimizer from crawling/re-bundling them mid-boot,
      // which otherwise invalidates the in-flight dynamic import of the service
      // hub and surfaces as "Importing a module script failed" on cold start.
      exclude: [
        '@rey30-idvj/assistant-extension',
        '@rey30-idvj/conversational-extension',
        '@rey30-idvj/download-extension',
        '@rey30-idvj/llamacpp-extension',
        '@rey30-idvj/mlx-extension',
        '@rey30-idvj/rag-extension',
        '@rey30-idvj/vector-db-extension',
      ],
    },
    define: {
      IS_TAURI: JSON.stringify(process.env.IS_TAURI),
      IS_DEV: JSON.stringify(process.env.IS_DEV),
      IS_WEB_APP: JSON.stringify(false),
      IS_MACOS: JSON.stringify(
        platform?.includes('darwin') ?? false
      ),
      IS_WINDOWS: JSON.stringify(
        platform?.includes('windows') ?? false
      ),
      IS_LINUX: JSON.stringify(
        platform?.includes('linux') ?? false
      ),
      IS_IOS: JSON.stringify(
        platform?.includes('ios') ?? false
      ),
      IS_ANDROID: JSON.stringify(
        platform?.includes('android') ?? false
      ),
      PLATFORM: JSON.stringify(platform),

      VERSION: JSON.stringify(desktopConfig.version),

      POSTHOG_KEY: JSON.stringify(env.POSTHOG_KEY),
      POSTHOG_HOST: JSON.stringify(env.POSTHOG_HOST),
      GA_MEASUREMENT_ID: JSON.stringify(env.GA_MEASUREMENT_ID),
      MODEL_CATALOG_URL: JSON.stringify(
        'https://raw.githubusercontent.com/janhq/model-catalog/main/model_catalog_v2.json'
      ),
      LATEST_DEFAULT_MODEL_URL: JSON.stringify(
        'https://raw.githubusercontent.com/janhq/model-catalog/main/latest_jan_model.json'
      ),
      AUTO_UPDATER_DISABLED: JSON.stringify(
        true
      ),
      APP_RELEASES_URL: JSON.stringify(''),
      UPDATE_CHECK_INTERVAL_MS: JSON.stringify(
        Number(env.UPDATE_CHECK_INTERVAL_MS) || 60 * 60 * 1000
      ),
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**'],
        usePolling: true
      },
    },
  }
})
