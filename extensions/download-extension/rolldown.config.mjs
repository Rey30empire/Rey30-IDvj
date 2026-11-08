import { defineConfig } from 'rolldown'
import settingJson from './settings.json' with { type: 'json' }

export default defineConfig({
  input: 'src/index.ts',
  output: {
    format: 'esm',
    file: 'dist/index.js',
  },
  platform: 'browser',
  transform: {
    define: {
      SETTINGS: JSON.stringify(settingJson),
    },
  },
})
