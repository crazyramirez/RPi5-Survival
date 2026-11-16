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
      // Icono de la ventana y de la barra de tareas (ADR 0019; generado con scripts/build-icons.mjs).
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '16x16 32x32 48x48 64x64' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icon-192.png' },
        { rel: 'apple-touch-icon', href: '/icon-192.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
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
    // Juegos offline (ADR 0012): otro origen a propósito; el navegador del kiosco lo carga en un iframe.
    gamesUrl: 'http://127.0.0.1:8790/',
    gamesDir: '/var/lib/survival-os/games',
    vaultSocket: '/run/survival-os/vault.sock',
    public: {
      version: pkg.version,
      // Versión portable (ADR 0014): la fija el lanzador con NUXT_PUBLIC_PORTABLE=true.
      portable: false,
      // App Android (ADR 0020): la fija la app nativa con NUXT_PUBLIC_ANDROID=true (además de portable).
      android: false,
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
