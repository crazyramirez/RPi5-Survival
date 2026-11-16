import { readFileSync } from 'node:fs'
import type { ReadStream } from 'node:fs'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { applyLine, classifyLine, describePorts, Esp32Hub, MAX_DEVICES, newDevice, parseEsp32Ports, PING_LINE } from '../src/esp32.ts'
import { RateLimiter } from '../src/esp32-protocol.ts'
import type { PortInfo, SerialPort } from '../src/serial.ts'

// Identificadores ficticios: puertos COM de ejemplo y nombres de placa inventados.
const line = (o: Record<string, unknown>): string => JSON.stringify({ v: 1, device: 'sensor-a', ...o })
const info = (path: string, vid: string | null = '303a', pid: string | null = '1001'): PortInfo => ({ path, label: `Placa de prueba (${path})`, vid, pid })
const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Puerto serie falso: `reply` decide qué contesta la «placa» a lo que se le escribe. */
function fakePort(path: string, reply: (written: string) => string[] = () => []) {
  const stream = new PassThrough()
  const written: string[] = []
  let closed = false
  const port: SerialPort = {
    path,
    stream: stream as unknown as ReadStream,
    write: async (data) => {
      if (closed) throw new Error('Puerto cerrado')
      const s = Buffer.from(data).toString('utf8')
      written.push(s)
      for (const out of reply(s)) setImmediate(() => !closed && stream.write(`${out}\r\n`))
    },
    close() {
      closed = true
      stream.destroy()
    },
  }
  return { port, stream, written, isClosed: () => closed }
}

/** Placa ESP32 con el firmware de ejemplo: responde «ack» al ping. */
const esp32Board = (path: string) => fakePort(path, (w) => (w === PING_LINE ? [line({ type: 'ack', payload: { to: 'ping' } })] : []))

function hubWith(ports: Record<string, ReturnType<typeof fakePort>>) {
  const opened: string[] = []
  const hub = new Esp32Hub({
    platform: 'win32',
    open: async (path, baud) => {
      expect(baud).toBe(115200)
      const p = ports[path]
      if (!p) throw new Error('No se pudo configurar el puerto')
      opened.push(path)
      return p.port
    },
  })
  return { hub, opened }
}

describe('copia del protocolo', () => {
  it('es idéntica a la de services/esp32-gateway (una sola fuente de verdad)', () => {
    const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(read('../src/esp32-protocol.ts')).toBe(read('../../esp32-gateway/src/protocol.ts'))
  })
})

describe('classifyLine', () => {
  it('protocolo v1, registro de Meshtastic o nada', () => {
    expect(classifyLine(line({ type: 'hello', payload: { firmware: 'demo 0.1' } }))).toBe('esp32')
    expect(classifyLine('\u001b[34mDEBUG \u001b[0m| 14:24:32 139 [Router] Routing sniffing')).toBe('meshtastic')
    expect(classifyLine('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47')).toBeNull()
    expect(classifyLine('ets Jun  8 2016 00:22:57')).toBeNull()
    expect(classifyLine('{"v":2,"type":"hello","device":"x"}')).toBeNull()
  })
})

describe('applyLine (misma lógica que la pasarela de la Pi)', () => {
  const at = new Date('2026-11-16T10:00:00Z')
  it('hello, lecturas, latido y eventos', () => {
    const dev = newDevice('COM7', 'ESP32 (USB nativo)')
    expect(dev.id).toBe('COM7')
    const rl = new RateLimiter(50)
    applyLine(dev, rl, line({ type: 'hello', payload: { firmware: 'survival-node 0.1.0', chip: 'ESP32-S3' } }), at)
    applyLine(dev, rl, line({ type: 'reading', payload: { sensor: 'temp_c', value: 21.5, unit: '°C' } }), at)
    applyLine(dev, rl, line({ type: 'heartbeat', payload: { readings: [{ sensor: 'temp_c', value: 22 }, { sensor: 'heap', value: 1000, unit: 'B' }] } }), at)
    applyLine(dev, rl, line({ type: 'event', payload: { event: 'button', id: 'BOOT' } }), at)
    applyLine(dev, rl, line({ type: 'error', payload: { msg: 'sensor ausente' } }), at)
    expect(dev).toMatchObject({ id: 'sensor-a', firmware: 'survival-node 0.1.0', chip: 'ESP32-S3', lastSeen: at.toISOString() })
    expect(dev.readings).toEqual([
      { sensor: 'temp_c', value: 22, unit: '', at: at.toISOString() },
      { sensor: 'heap', value: 1000, unit: 'B', at: at.toISOString() },
    ])
    expect(dev.events.map((e) => e.kind)).toEqual(['error', 'button'])
    expect(dev.stats).toEqual({ lines: 5, invalid: 0, dropped: 0 })
  })
  it('cuenta lo inválido y lo que supera el ritmo; avisa si es Meshtastic', () => {
    const dev = newDevice('COM7', 'x')
    const rl = new RateLimiter(2)
    expect(applyLine(dev, rl, 'basura', at)).toBe(false)
    expect(applyLine(dev, rl, 'INFO  | ??:??:?? 3 [Main] Booted', at)).toBe(true)
    expect(applyLine(dev, rl, line({ type: 'ack' }), at)).toBe(false)
    expect(dev.stats).toEqual({ lines: 3, invalid: 2, dropped: 1 })
    expect(dev.lastSeen).toBeNull() // nada válido aceptado: sin dato
  })
})

describe('describePorts', () => {
  it('GPS, malla, Meshtastic soltado, ESP32 e ignorado', () => {
    const list = [info('COM3', '1546', '01a8'), info('COM4', '10c4', 'ea60'), info('COM5'), info('COM6'), { path: '/dev/cu.usbmodem101', label: 'usbmodem101', vid: null, pid: null }]
    const key = (p: string): string => p.toUpperCase()
    const out = describePorts(list, { gps: 'com3', mesh: 'COM4', esp32: new Set(['COM6']), meshtastic: new Set(['COM5']) }, key)
    expect(out.map((p) => [p.path, p.chip, p.use])).toEqual([
      ['COM3', 'u-blox 8', 'gpsd'],
      ['COM4', 'CP210x', 'meshtastic'],
      ['COM5', 'ESP32 (USB nativo)', 'meshtastic'],
      ['COM6', 'ESP32 (USB nativo)', 'esp32'],
      ['/dev/cu.usbmodem101', 'usbmodem101', 'ignorado'],
    ])
    expect(out[0]).toMatchObject({ vendorId: '1546', productId: '01a8' })
  })
})

describe('parseEsp32Ports (/config)', () => {
  const isPort = (s: string): boolean => /^COM\d{1,3}$/i.test(s)
  const key = (p: string): string => p.toUpperCase()
  it('valida, quita duplicados y vacía con null', () => {
    expect(parseEsp32Ports(['COM6', 'com6', 'COM7'], isPort, [null, null], key)).toEqual(['COM6', 'COM7'])
    expect(parseEsp32Ports(null, isPort, [], key)).toEqual([])
    expect(() => parseEsp32Ports('COM6', isPort, [], key)).toThrow(/no válida/)
    expect(() => parseEsp32Ports(['/etc/passwd'], isPort, [], key)).toThrow(/Puerto no válido/)
    expect(() => parseEsp32Ports(Array.from({ length: MAX_DEVICES + 1 }, (_, i) => `COM${i + 1}`), isPort, [], key)).toThrow()
  })
  it('un puerto de la malla o del GPS no puede ser ESP32', () => {
    expect(() => parseEsp32Ports(['COM4'], isPort, ['com4', null], key)).toThrow(/malla o al GPS/)
  })
})

describe('Esp32Hub: detección y conexión', () => {
  it('sin placas: lista vacía, nada inventado', async () => {
    const { hub } = hubWith({})
    await hub.reconcile([], { mesh: null, gps: null, manual: [] })
    expect(hub.status()).toEqual({ devices: [], ports: [] })
    expect(await hub.ping('sensor-a')).toBe(false)
  })

  it('un puerto que responde al ping con el protocolo v1 se queda como ESP32 sin reabrirlo', async () => {
    const board = esp32Board('COM6')
    const { hub, opened } = hubWith({ COM6: board })
    const list = [info('COM6')]
    await hub.reconcile(list, { mesh: null, gps: null, manual: [] })
    expect(await hub.probe(list[0]!, 300)).toBe('esp32')
    expect(opened).toEqual(['COM6'])
    expect(board.written[0]).toBe(PING_LINE)
    const st = hub.status()
    expect(st.devices).toHaveLength(1)
    expect(st.devices[0]).toMatchObject({ id: 'sensor-a', port: 'COM6', connected: true })
    expect(st.ports[0]?.use).toBe('esp32')
    expect(hub.busy().has('COM6')).toBe(true)
    // Lo que llega después se aplica a la placa ya abierta.
    board.stream.write(`${line({ type: 'reading', payload: { sensor: 'temp_c', value: 19.25, unit: '°C' } })}\n`)
    await tick()
    expect(hub.status().devices[0]?.readings[0]).toMatchObject({ sensor: 'temp_c', value: 19.25 })
    expect(await hub.ping('sensor-a')).toBe(true)
    expect(board.written.at(-1)).toBe(PING_LINE)
    expect(hub.shouldProbe('COM6')).toBe(false)
  })

  it('un nodo Meshtastic se suelta y no se vuelve a sondear mientras siga conectado', async () => {
    const node = fakePort('COM5', () => ['\u001b[34mDEBUG \u001b[0m| 14:24:32 139 [Router] Routing sniffing'])
    const { hub } = hubWith({ COM5: node })
    const list = [info('COM5')]
    expect(await hub.probe(list[0]!, 300)).toBe('meshtastic')
    expect(node.isClosed()).toBe(true)
    expect(hub.isMeshtastic('COM5')).toBe(true)
    expect(hub.shouldProbe('COM5')).toBe(false)
    await hub.reconcile(list, { mesh: null, gps: null, manual: [] })
    expect(hub.status()).toMatchObject({ devices: [], ports: [{ path: 'COM5', use: 'meshtastic' }] })
    // Desenchufado: queda libre para volver a evaluarse.
    await hub.reconcile([], { mesh: null, gps: null, manual: [] })
    expect(hub.isMeshtastic('COM5')).toBe(false)
  })

  it('una placa ya reclamada que empieza a escribir el registro de Meshtastic se suelta', async () => {
    const board = esp32Board('COM6')
    const { hub } = hubWith({ COM6: board })
    await hub.probe(info('COM6'), 300)
    board.stream.write('INFO  | ??:??:?? 3 [Main] Booted\n')
    await tick()
    expect(board.isClosed()).toBe(true)
    expect(hub.status().devices).toEqual([])
    expect(hub.isMeshtastic('COM6')).toBe(true)
  })

  it('un puerto mudo se cierra y no se vuelve a abrir hasta pasado un rato', async () => {
    const quiet = fakePort('COM8')
    const { hub } = hubWith({ COM8: quiet })
    const t0 = 1_000_000
    expect(await hub.probe(info('COM8'), 100, t0)).toBeNull()
    expect(quiet.isClosed()).toBe(true)
    expect(hub.shouldProbe('COM8', t0 + 60_000)).toBe(false)
    expect(hub.shouldProbe('COM8', t0 + 600_000)).toBe(true)
    expect(hub.status().devices).toEqual([])
  })

  it('puerto manual: se abre sin sondeo; al desenchufarlo se muestra desconectado y luego desaparece', async () => {
    const board = esp32Board('COM9')
    const { hub } = hubWith({ COM9: board })
    const list = [info('COM9', '1a86', '7523')]
    const t0 = 2_000_000
    await hub.reconcile(list, { mesh: null, gps: null, manual: ['com9'] }, t0)
    await tick()
    expect(hub.status().devices[0]).toMatchObject({ id: 'sensor-a', chip: 'CH340', connected: true })
    await hub.reconcile([], { mesh: null, gps: null, manual: ['COM9'] }, t0 + 15_000)
    expect(board.isClosed()).toBe(true)
    expect(hub.status().devices[0]).toMatchObject({ connected: false })
    await hub.reconcile([], { mesh: null, gps: null, manual: ['COM9'] }, t0 + 15_000 + 120_000)
    expect(hub.status().devices).toEqual([])
  })

  it('un puerto asignado a la malla o al GPS se cierra y nunca se abre como ESP32', async () => {
    const board = esp32Board('COM6')
    const { hub, opened } = hubWith({ COM6: board })
    const list = [info('COM6')]
    await hub.probe(list[0]!, 300)
    hub.release(['com6'])
    expect(board.isClosed()).toBe(true)
    expect(hub.status().devices).toEqual([])
    await hub.reconcile(list, { mesh: 'COM6', gps: null, manual: ['COM6'] })
    expect(opened).toEqual(['COM6']) // solo el sondeo inicial
    expect(hub.status().ports[0]?.use).toBe('meshtastic')
  })

  it('una placa caída con el puerto presente se retira para volver a evaluarla', async () => {
    const board = esp32Board('COM6')
    const { hub } = hubWith({ COM6: board })
    const list = [info('COM6')]
    await hub.probe(list[0]!, 300)
    board.stream.emit('error', new Error('EIO'))
    await tick()
    expect(hub.status().devices[0]?.connected).toBe(false)
    await hub.reconcile(list, { mesh: null, gps: null, manual: [] })
    expect(hub.status().devices).toEqual([])
    expect(hub.shouldProbe('COM6')).toBe(true)
  })

  it(`no abre más de ${MAX_DEVICES} placas`, async () => {
    const boards = Object.fromEntries(Array.from({ length: MAX_DEVICES + 1 }, (_, i) => [`COM${i + 10}`, esp32Board(`COM${i + 10}`)]))
    const { hub } = hubWith(boards)
    for (const path of Object.keys(boards)) if (hub.shouldProbe(path)) await hub.probe(info(path), 300)
    expect(hub.status().devices).toHaveLength(MAX_DEVICES)
  })
})
