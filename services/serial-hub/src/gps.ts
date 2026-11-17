import { chmodSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { applyNmea, emptyNmea, toSky, toTpv, type NmeaState } from './nmea.ts'
import { log } from './mesh.ts'
import { openPort, ANDROID_GNSS, type SerialPort } from './serial.ts'
import type { AidStore } from './aid.ts'
import { CLS_MON, ID_MON_VER, pollAidEph, pollAidHui, pollMonVer, UbxScanner, type UbxFrame } from './ubx.ts'

interface Receiver {
  port: SerialPort
  path: string
  baud: number
  state: NmeaState
  openedAt: number
  /** Confirmado como u-blox (respondió a MON-VER): se le envía ayuda y se guardan sus efemérides. */
  ublox: boolean
  /** Tramas UBX recibidas mientras se espera la respuesta a un sondeo. */
  collecting: UbxFrame[] | null
  timers: NodeJS.Timeout[]
}

/** Cada cuánto se guardan las efemérides de un u-blox con fijación 3D. */
const EPH_SAVE_MS = 20 * 60_000
/** Primer guardado tras la primera fijación 3D (da tiempo a que descargue las de varios satélites). */
const EPH_FIRST_SAVE_MS = 3 * 60_000

/**
 * Receptores GNSS (NMEA por USB, GNSS interno de Android…) + servidor compatible con gpsd (ADR 0016). Puede haber
 * varios a la vez, como en gpsd: cada uno emite su TPV y su SKY con su `device`, y el servicio de navegación usa el
 * mejor (services/navigation/src/gpsd.ts, pickReceiver). Sin receptor, TPV no se emite (sin dato).
 */
export class Gps {
  private receivers = new Map<string, Receiver>()
  private clients = new Set<Socket>()
  private server: Server | null = null
  /** Último error por ruta (desconexión, apertura fallida). */
  private errors = new Map<string, string>()
  private readonly aid: AidStore | null

  /** `aid`: ayuda sin Internet a receptores u-blox (posición, hora, efemérides guardadas). */
  constructor(aid: AidStore | null = null) {
    this.aid = aid
  }

  listen(port: number, host = '127.0.0.1'): void {
    this.server = this.createGpsd()
    this.server.listen(port, host, () => log('info', 'gpsd_listening', { host, port }))
  }

  /** Mismo protocolo por socket Unix (Android, ADR 0020): solo lo abre la propia app (permisos de fichero). */
  listenSocket(path: string): void {
    rmSync(path, { force: true })
    this.server = this.createGpsd()
    this.server.listen(path, () => {
      chmodSync(path, 0o600)
      log('info', 'gpsd_listening', { socket: path })
    })
  }

  private createGpsd(): Server {
    return createServer((sock) => {
      this.clients.add(sock)
      sock.on('close', () => this.clients.delete(sock))
      sock.on('error', () => this.clients.delete(sock))
      sock.on('data', () => undefined) // ?WATCH del cliente: siempre se emite en JSON
      const now = new Date().toISOString()
      sock.write(`${JSON.stringify({ class: 'VERSION', release: 'survival-serial-hub', proto_major: 3, proto_minor: 14 })}\n`)
      sock.write(`${JSON.stringify({ class: 'DEVICES', devices: [...this.receivers.keys()].map((path) => ({ class: 'DEVICE', path, activated: now })) })}\n`)
      for (const r of this.receivers.values()) {
        if (!r.state.updatedAt) continue
        sock.write(`${JSON.stringify(toTpv(r.state, r.path))}\n`)
        sock.write(`${JSON.stringify(toSky(r.state, r.path))}\n`)
      }
    })
  }

  private broadcast(msg: Record<string, unknown>): void {
    const line = `${JSON.stringify(msg)}\n`
    for (const c of this.clients) c.write(line)
  }

  /** Abre un receptor más (si ya estaba abierto en esa ruta, se reabre). */
  async connect(path: string, baud: number): Promise<void> {
    this.disconnect(path)
    let port: SerialPort
    try {
      port = await openPort(path, baud)
    } catch (err) {
      this.errors.set(path, `No se pudo abrir: ${err instanceof Error ? err.message : String(err)}`)
      throw err
    }
    const r: Receiver = { port, path, baud, state: emptyNmea(), openedAt: Date.now(), ublox: false, collecting: null, timers: [] }
    this.receivers.set(path, r)
    this.errors.delete(path)
    let buf = ''
    let lastTpv = 0
    const scanner = new UbxScanner()
    port.stream.on('data', (raw: string | Buffer) => {
      const bytes = typeof raw === 'string' ? Buffer.from(raw, 'latin1') : raw
      for (const f of scanner.push(bytes)) this.onUbx(r, f)
      buf += bytes.toString('latin1')
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      if (buf.length > 4096) buf = ''
      let changed = false
      for (const l of lines) if (applyNmea(r.state, l)) changed = true
      // Una TPV/SKY por segundo y receptor como mucho (los receptores emiten una ráfaga de frases por ciclo).
      if (changed && Date.now() - lastTpv > 900) {
        lastTpv = Date.now()
        this.onFix(r)
        this.broadcast(toTpv(r.state, path))
        this.broadcast(toSky(r.state, path))
      }
    })
    const lost = (): void => {
      if (this.receivers.get(path) !== r) return
      log('warn', 'gps_lost', { port: path })
      this.errors.set(path, 'Receptor GNSS desconectado')
      this.disconnect(path)
    }
    port.stream.on('error', lost)
    port.stream.on('close', lost)
    this.broadcast({ class: 'DEVICE', path, activated: new Date().toISOString() })
    log('info', 'gps_connected', { port: path, baud })
    // ¿Es un u-blox? Un sondeo MON-VER (8 bytes) que los demás receptores ignoran. El GNSS de Android no se toca.
    if (this.aid && path !== ANDROID_GNSS) r.timers.push(setTimeout(() => void port.write(pollMonVer()).catch(() => undefined), 500))
  }

  private onUbx(r: Receiver, f: UbxFrame): void {
    if (r.collecting) r.collecting.push(f)
    if (f.cls === CLS_MON && f.id === ID_MON_VER && !r.ublox) {
      r.ublox = true
      const sw = f.payload.subarray(0, 30).toString('latin1').replace(/\u0000.*$/s, '').trim()
      log('info', 'gps_ublox', { port: r.path, sw })
      void this.sendAid(r)
    }
  }

  /** Ayuda al arrancar: posición y hora, ionosfera/UTC y efemérides guardadas (si aún valen). */
  private async sendAid(r: Receiver): Promise<void> {
    if (!this.aid) return
    // Si ya tiene fijación no hace falta (p. ej. se reabrió el puerto con el receptor ya en marcha).
    if (r.state.mode >= 2) return
    const msgs = this.aid.messages()
    for (const m of msgs) {
      if (this.receivers.get(r.path) !== r) return
      await r.port.write(m).catch(() => undefined)
      await new Promise((ok) => setTimeout(ok, 30)) // sin saturar el búfer de entrada del receptor (9600 baudios)
    }
    if (msgs.length) log('info', 'gps_aided', { port: r.path, messages: msgs.length })
  }

  private onFix(r: Receiver): void {
    const st = r.state
    if (!this.aid || st.mode < 2 || st.lat === null || st.lon === null) return
    this.aid.savePosition(st.lat, st.lon, st.mode >= 3 ? st.altMSL : null)
    // Efemérides: primera vez a los 3 min de la primera 3D, luego cada 20 min.
    if (r.ublox && st.mode >= 3 && !r.timers.length) {
      const save = (): void => {
        r.timers.push(setTimeout(() => void this.saveEphemeris(r).finally(save), EPH_SAVE_MS))
      }
      r.timers.push(setTimeout(() => void this.saveEphemeris(r).finally(save), EPH_FIRST_SAVE_MS))
    }
  }

  /** Pide al receptor sus efemérides e ionosfera/UTC y las guarda (solo con fijación 3D: datos frescos). */
  private async saveEphemeris(r: Receiver): Promise<void> {
    if (!this.aid || this.receivers.get(r.path) !== r || r.state.mode < 3) return
    r.collecting = []
    await r.port.write(pollAidHui()).catch(() => undefined)
    await new Promise((ok) => setTimeout(ok, 300))
    await r.port.write(pollAidEph()).catch(() => undefined)
    await new Promise((ok) => setTimeout(ok, 5000)) // 32 respuestas de hasta 112 bytes a 9600 baudios ≈ 4 s
    const frames = r.collecting
    r.collecting = null
    const n = this.aid.saveFrames(frames)
    log('info', 'gps_ephemeris_saved', { port: r.path, satellites: n })
  }

  /** Cierra un receptor (o todos sin argumento). */
  disconnect(path?: string): void {
    for (const r of [...this.receivers.values()]) {
      if (path !== undefined && r.path !== path) continue
      this.receivers.delete(r.path)
      for (const t of r.timers) clearTimeout(t)
      r.port.close()
      this.broadcast({ class: 'DEVICE', path: r.path, activated: 0 })
    }
  }

  close(): void {
    this.disconnect()
  }

  has(path: string): boolean {
    return this.receivers.has(path)
  }

  /** Rutas abiertas ahora. */
  paths(): string[] {
    return [...this.receivers.keys()]
  }

  /** Tiempo sin frases NMEA válidas (desde la apertura si aún no llegó ninguna); null si no está abierto. */
  silentMs(path: string, now = Date.now()): number | null {
    const r = this.receivers.get(path)
    return r ? now - (r.state.updatedAt ?? r.openedAt) : null
  }

  get connected(): boolean {
    return this.receivers.size > 0
  }

  status(): Record<string, unknown> {
    const now = Date.now()
    const list = [...this.receivers.values()].map((r) => ({
      port: r.path,
      baud: r.baud,
      fix: toTpv(r.state, r.path, now),
      satellites: { used: r.state.uSat, visible: r.state.nSat },
      hdop: r.state.hdop,
      updatedAt: r.state.updatedAt ? new Date(r.state.updatedAt).toISOString() : null,
    }))
    const first = list[0] ?? null
    return {
      connected: list.length > 0,
      // Compatibilidad: primer receptor. La posición que se usa la elige el servicio de navegación (el mejor).
      port: first?.port ?? null,
      baud: first?.baud ?? null,
      error: list.length ? null : ([...this.errors.values()].at(-1) ?? 'Sin receptor GNSS USB'),
      fix: first?.fix ?? null,
      satellites: first?.satellites ?? null,
      updatedAt: first?.updatedAt ?? null,
      receivers: list,
    }
  }
}
