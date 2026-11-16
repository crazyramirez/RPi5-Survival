import { chmodSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { applyNmea, emptyNmea, toSky, toTpv, type NmeaState } from './nmea.ts'
import { log } from './mesh.ts'
import { openPort, type SerialPort } from './serial.ts'

/**
 * Receptor GNSS USB (NMEA) + servidor compatible con gpsd (ADR 0016): el servicio de navegación se
 * conecta como a gpsd y recibe DEVICES, TPV y SKY. Sin receptor, TPV no se emite (sin dato).
 */
export class Gps {
  private port: SerialPort | null = null
  private state: NmeaState = emptyNmea()
  private clients = new Set<Socket>()
  private server: Server | null = null
  path: string | null = null
  baud: number | null = null
  error: string | null = 'Sin receptor GNSS USB'

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
      sock.write(`${JSON.stringify({ class: 'VERSION', release: 'survival-serial-hub', proto_major: 3, proto_minor: 14 })}\n`)
      sock.write(`${JSON.stringify({ class: 'DEVICES', devices: this.path ? [{ class: 'DEVICE', path: this.path, activated: new Date().toISOString() }] : [] })}\n`)
      if (this.port && this.state.updatedAt) {
        sock.write(`${JSON.stringify(toTpv(this.state, this.path ?? ''))}\n`)
        sock.write(`${JSON.stringify(toSky(this.state, this.path ?? ''))}\n`)
      }
    })
  }

  private broadcast(msg: Record<string, unknown>): void {
    const line = `${JSON.stringify(msg)}\n`
    for (const c of this.clients) c.write(line)
  }

  async connect(path: string, baud: number): Promise<void> {
    this.close()
    const port = await openPort(path, baud)
    this.port = port
    this.path = path
    this.baud = baud
    this.state = emptyNmea()
    this.error = null
    let buf = ''
    let lastTpv = 0
    port.stream.setEncoding('latin1')
    port.stream.on('data', (raw: string | Buffer) => {
      const chunk = String(raw)
      buf += chunk
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      if (buf.length > 4096) buf = ''
      let changed = false
      for (const l of lines) if (applyNmea(this.state, l)) changed = true
      // Una TPV/SKY por segundo como mucho (los receptores emiten una ráfaga de frases por ciclo).
      if (changed && Date.now() - lastTpv > 900) {
        lastTpv = Date.now()
        this.broadcast(toTpv(this.state, path))
        this.broadcast(toSky(this.state, path))
      }
    })
    const lost = (): void => {
      if (this.port !== port) return
      log('warn', 'gps_lost', { port: path })
      this.error = 'Receptor GNSS desconectado'
      this.close()
    }
    port.stream.on('error', lost)
    port.stream.on('close', lost)
    this.broadcast({ class: 'DEVICE', path, activated: new Date().toISOString() })
    log('info', 'gps_connected', { port: path, baud })
  }

  close(): void {
    const p = this.port
    this.port = null
    if (p) {
      p.close()
      this.broadcast({ class: 'DEVICE', path: this.path, activated: 0 })
    }
  }

  get connected(): boolean {
    return this.port !== null
  }

  status(): Record<string, unknown> {
    return {
      connected: this.port !== null,
      port: this.path,
      baud: this.baud,
      error: this.port ? null : this.error,
      fix: this.port ? toTpv(this.state, this.path ?? '') : null,
      satellites: this.port ? { used: this.state.uSat, visible: this.state.nSat } : null,
      updatedAt: this.state.updatedAt ? new Date(this.state.updatedAt).toISOString() : null,
    }
  }
}
