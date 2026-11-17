import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo .mjs sin tipos (portable/, fuera del monorepo TypeScript)
import { DATA_EXCLUDE, PREFERRED_PORTS, browserArgs, browserCandidates, defaultInstallDir, llmFailure, nodePath, platformKey, serviceEnv } from '../../../portable/lib.mjs'

describe('portable: plataformas', () => {
  it('mapea sistema y arquitectura a la carpeta de runtime', () => {
    expect(platformKey('win32', 'x64')).toBe('win-x64')
    expect(platformKey('darwin', 'arm64')).toBe('darwin-arm64')
    expect(platformKey('darwin', 'x64')).toBe('darwin-x64')
    expect(platformKey('linux', 'arm64')).toBe('linux-arm64')
    expect(platformKey('linux', 'ia32')).toBeNull()
    expect(platformKey('freebsd', 'x64')).toBeNull()
  })
  it('ruta del ejecutable de Node', () => {
    expect(nodePath('/r', 'win-x64')).toMatch(/runtime[\\/]win-x64[\\/]node\.exe$/)
    expect(nodePath('/r', 'linux-x64')).toMatch(/runtime[\\/]linux-x64[\\/]node$/)
  })
})

describe('portable: navegador e instalación', () => {
  it('candidatos Chromium por sistema', () => {
    expect(browserCandidates('win32', { ProgramFiles: 'C:\\PF' }, 'C:\\Users\\u').some((p: string) => p.endsWith('msedge.exe'))).toBe(true)
    expect(browserCandidates('darwin', {}, '/Users/u')[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(browserCandidates('linux', {}, '/home/u')).toContain('chromium')
  })
  it('ventana de aplicación con perfil aislado y sin llavero', () => {
    const a = browserArgs('http://127.0.0.1:47800', '/d/browser')
    expect(a).toContain('--app=http://127.0.0.1:47800')
    expect(a).toContain('--user-data-dir=/d/browser')
    expect(a).toContain('--password-store=basic')
  })
  it('instalación por usuario, sin administrador', () => {
    expect(defaultInstallDir('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, '')).toMatch(/AppData[\\/]Local[\\/]Programs[\\/]Survivelia OS$/)
    expect(defaultInstallDir('darwin', {}, '/Users/u')).toMatch(/Users[\\/]u[\\/]Applications[\\/]Survivelia OS$/)
    // Instalación anterior con el nombre de antes: se sigue usando (no dos copias).
    expect(defaultInstallDir('darwin', {}, '/Users/u', (p: string) => /Survival OS$/.test(p))).toMatch(/Applications[\\/]Survival OS$/)
    expect(defaultInstallDir('linux', {}, '/home/u')).toMatch(/home[\\/]u[\\/]\.local[\\/]share[\\/]survival-os$/)
    expect(DATA_EXCLUDE.has('browser') && DATA_EXCLUDE.has('logs')).toBe(true)
  })
})

describe('portable: entorno de servicios', () => {
  const env = serviceEnv({ root: '/r', data: '/r/data', ports: PREFERRED_PORTS, platform: 'linux' })
  it('todo en loopback y modo portable', () => {
    for (const k of ['DEVICE_API_HOST', 'LIBRARY_HOST', 'NAV_HOST', 'NITRO_HOST']) {
      const all = { ...env.device, ...env.library, ...env.navigation, ...env.web }
      expect(all[k]).toBe('127.0.0.1')
    }
    expect(env.web.NUXT_PUBLIC_PORTABLE).toBe('true')
    expect(env.web.SURVIVAL_PORTABLE).toBe('1')
  })
  it('la web apunta a los puertos elegidos y los datos a data/', () => {
    expect(env.web.NUXT_DEVICE_API_URL).toBe(`http://127.0.0.1:${PREFERRED_PORTS.device}`)
    expect(env.web.NUXT_GAMES_URL).toBe(`http://127.0.0.1:${PREFERRED_PORTS.games}/`)
    expect(env.web.SURVIVAL_MAPS_DIR).toMatch(/data[\\/]maps$/)
    expect(env.library.LIBRARY_DATA_DIR).toMatch(/data[\\/]library$/)
    expect(env.games.GAMES_FRAME_ANCESTORS).toContain(`http://127.0.0.1:${PREFERRED_PORTS.web}`)
  })
  it('malla, GPS y pasarela ESP32 por serial-hub', () => {
    expect(env.web.NUXT_MESH_URL).toBe(`http://127.0.0.1:${PREFERRED_PORTS.mesh}`)
    expect(env.navigation.GPSD_PORT).toBe(String(PREFERRED_PORTS.gpsd))
    expect(env.web.NUXT_ESP32_URL).toBe(`http://127.0.0.1:${PREFERRED_PORTS.mesh}/esp32`)
  })
})

describe('portable: por qué no arranca el asistente', () => {
  it('falta una biblioteca del sistema (libgomp en un Linux recién instalado)', () => {
    const tail = 'build: 12428\n./llama-server: error while loading shared libraries: libgomp.so.1: cannot open shared object file: No such file or directory\n'
    expect(llmFailure({ code: 127, signal: null, tail })).toEqual({ reason: 'library', detail: './llama-server: error while loading shared libraries: libgomp.so.1: cannot open shared object file: No such file or directory' })
  })
  it('el sistema lo cierra por falta de memoria', () => {
    expect(llmFailure({ code: null, signal: 'SIGKILL', tail: 'load_tensors: loading model\n' }).reason).toBe('memory')
    expect(llmFailure({ code: 1, tail: 'ggml_aligned_malloc: failed to allocate 2300.00 MiB\n' }).reason).toBe('memory')
  })
  it('modelo dañado y caso general', () => {
    expect(llmFailure({ code: 1, tail: 'llama_model_load: error loading model: invalid magic\n' }).reason).toBe('model')
    expect(llmFailure({ code: 3, tail: '' })).toEqual({ reason: 'other', detail: 'code=3, signal=null' })
  })
})
