import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// El trazado de Nitro omitía a veces estree-walker 2 (anidado en @vue/compiler-core) y el servidor
// no arrancaba en la Pi. Se añade como punto de partida explícito el fichero que lo requiere.
const vueCompilerCore = join(dirname(createRequire(import.meta.url).resolve('@vue/compiler-core')), 'dist', 'compiler-core.cjs.prod.js')

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',

  // SPA servida por Nitro en localhost: sin renderizado en servidor (menos CPU en la Pi).
  ssr: false,

  // Sin telemetría ni devtools: nada sale del equipo.
  telemetry: false,
  devtools: { enabled: false },

  // Tipografías empaquetadas localmente (sin Google Fonts / CDN).
  css: [
    '@fontsource/atkinson-hyperlegible/400.css',
    '@fontsource/atkinson-hyperlegible/700.css',
    '@fontsource/jetbrains-mono/400.css',
    '@fontsource/jetbrains-mono/600.css',
    '~/assets/css/main.css',
  ],

  app: {
    head: {
      title: 'Survival OS',
      // translate="no": evita la burbuja de Google Translate de Chromium (intentaría usar la red).
      htmlAttrs: { lang: 'es', translate: 'no' },
      meta: [
        { name: 'google', content: 'notranslate' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' },
        { name: 'color-scheme', content: 'dark' },
        { name: 'theme-color', content: '#0f1412' },
        { name: 'robots', content: 'noindex' },
      ],
    },
    pageTransition: false,
    layoutTransition: false,
  },

  runtimeConfig: {
    // Solo servidor. Sobrescribible con NUXT_DEVICE_API_URL.
    deviceApiUrl: 'http://127.0.0.1:8781',
    libraryUrl: 'http://127.0.0.1:8782',
    // Sin sufijo: la ruta /kiwix/... se reenvía tal cual (kiwix-serve usa --urlRootLocation=/kiwix).
    kiwixUrl: 'http://127.0.0.1:8783',
    navigationUrl: 'http://127.0.0.1:8784',
    esp32Url: 'http://127.0.0.1:8785',
    meshUrl: 'http://127.0.0.1:8787',
    vaultSocket: '/run/survival-os/vault.sock',
    public: {
      version: pkg.version,
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  vite: {
    build: { sourcemap: false },
  },

  nitro: {
    preset: 'node-server',
    externals: { traceInclude: [vueCompilerCore] },
  },
})
