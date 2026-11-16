import { execFile, spawn } from 'node:child_process'
import { closeSync, constants, createReadStream, existsSync, openSync, readdirSync, readFileSync, realpathSync, write, type ReadStream } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * Puerto serie en Windows, macOS y Linux SIN módulos nativos (ADR 0016).
 * - Linux/macOS: se abre el dispositivo y se configura con `stty` sobre ese mismo descriptor (su stdin),
 *   así la configuración se aplica al puerto abierto en ambos sistemas (`stty -F` es solo de GNU).
 * - Windows: `mode COMn:` fija velocidad y líneas, y se abre `\\.\COMn`.
 * Las lecturas son bloqueantes en el pool de libuv: el lanzador sube UV_THREADPOOL_SIZE.
 */

export interface PortInfo {
  /** Ruta para abrirlo: /dev/serial/by-id/…, /dev/cu.…, COM5 */
  path: string
  /** Texto legible (fabricante/modelo si se conoce). */
  label: string
  vid: string | null
  pid: string | null
}

/** Puentes USB-serie y placas habituales en nodos LoRa y receptores GNSS. */
export const KNOWN_VIDS = new Set(['303a', '10c4', '1a86', '0403', '239a', '2e8a', '1546', '067b', '1915', '2886'])

const run = (cmd: string, args: string[], timeout = 8000): Promise<string> =>
  new Promise((ok) => execFile(cmd, args, { timeout, windowsHide: true }, (err, out) => ok(err ? '' : String(out))))

export async function listPorts(platform = process.platform): Promise<PortInfo[]> {
  if (platform === 'win32') {
    const ps = "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' } | ForEach-Object { $_.Name + '|' + $_.PNPDeviceID }"
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps])
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name = '', id = ''] = line.split('|')
        const com = /\((COM\d+)\)/.exec(name)?.[1] ?? ''
        const vid = /VID_([0-9A-F]{4})/i.exec(id)?.[1]?.toLowerCase() ?? null
        const pid = /PID_([0-9A-F]{4})/i.exec(id)?.[1]?.toLowerCase() ?? null
        return { path: com, label: name.replace(/\s*\(COM\d+\)/, ''), vid, pid }
      })
      .filter((p) => p.path)
  }
  if (platform === 'darwin') {
    return readdirSync('/dev')
      .filter((f) => /^cu\.(usbmodem|usbserial|SLAB_USBtoUART|wchusbserial)/.test(f))
      .map((f) => ({ path: `/dev/${f}`, label: f.slice(3), vid: null, pid: null }))
  }
  // Linux: nombres estables de /dev/serial/by-id y su VID/PID en sysfs.
  const out: PortInfo[] = []
  const byId = '/dev/serial/by-id'
  const seen = new Set<string>()
  if (existsSync(byId)) {
    for (const f of readdirSync(byId)) {
      const path = join(byId, f)
      const real = safeReal(path)
      seen.add(real)
      out.push({ path, label: f.replace(/^usb-/, '').replace(/-if\d+.*$/, '').replace(/_/g, ' '), ...usbIds(real) })
    }
  }
  for (const f of existsSync('/dev') ? readdirSync('/dev') : []) {
    if (!/^tty(ACM|USB)\d+$/.test(f) || seen.has(`/dev/${f}`)) continue
    out.push({ path: `/dev/${f}`, label: f, ...usbIds(`/dev/${f}`) })
  }
  return out
}

function safeReal(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

function usbIds(dev: string): { vid: string | null; pid: string | null } {
  try {
    let dir = realpathSync(`/sys/class/tty/${basename(dev)}/device`)
    for (let i = 0; i < 5; i++) {
      const v = join(dir, 'idVendor')
      if (existsSync(v)) return { vid: readFileSync(v, 'utf8').trim(), pid: readFileSync(join(dir, 'idProduct'), 'utf8').trim() }
      dir = join(dir, '..')
    }
  } catch {
    // sin sysfs (o no es USB)
  }
  return { vid: null, pid: null }
}

export interface SerialPort {
  readonly path: string
  readonly stream: ReadStream
  write(data: Uint8Array): Promise<void>
  close(): void
}

/** Abre y configura el puerto (8N1, sin control de flujo, DTR activo). */
export async function openPort(path: string, baud: number, platform = process.platform): Promise<SerialPort> {
  let devPath = path
  if (platform === 'win32') {
    if (!/^COM\d{1,3}$/i.test(path)) throw new Error('Puerto no válido')
    const r = await new Promise<{ ok: boolean; out: string }>((ok) =>
      execFile('mode', [`${path}:`, `BAUD=${baud}`, 'PARITY=n', 'DATA=8', 'STOP=1', 'to=off', 'xon=off', 'odsr=off', 'octs=off', 'dtr=on', 'rts=off', 'idsr=off'], { windowsHide: true, timeout: 8000 }, (err, out) =>
        ok({ ok: !err, out: String(out) }),
      ),
    )
    if (!r.ok) throw new Error(`No se pudo configurar ${path} (¿en uso por otro programa?)`)
    devPath = `\\\\.\\${path}`
  }
  const flags = platform === 'win32' ? 'r+' : constants.O_RDWR | constants.O_NOCTTY
  const fd = openSync(devPath, flags)
  if (platform !== 'win32') {
    // stty actúa sobre su entrada estándar: el mismo descriptor que tenemos abierto.
    const ok = await new Promise<boolean>((res) => {
      const child = spawn('stty', [String(baud), 'raw', '-echo', '-hupcl', 'cs8', '-cstopb', '-parenb', 'clocal', '-crtscts'], { stdio: [fd, 'ignore', 'ignore'] })
      child.on('error', () => res(false))
      child.on('close', (code) => res(code === 0))
    })
    if (!ok) {
      closeSync(fd)
      throw new Error(`stty falló en ${path}`)
    }
  }
  const stream = createReadStream('', { fd, autoClose: false, highWaterMark: 1024 })
  let closed = false
  return {
    path,
    stream,
    write: (data) =>
      new Promise((ok, ko) => {
        if (closed) return ko(new Error('Puerto cerrado'))
        write(fd, data, (err) => (err ? ko(err) : ok()))
      }),
    close() {
      if (closed) return
      closed = true
      stream.destroy()
      try {
        closeSync(fd)
      } catch {
        // ya cerrado (dispositivo retirado)
      }
    },
  }
}
