/**
 * Contratos de datos entre servicios locales y la UI.
 *
 * Regla de oro: un valor solo existe si se ha medido. Cualquier dato no medido
 * se representa con `state: 'unavailable'` y un motivo legible; nunca con un
 * valor por defecto o estimado.
 */

export type ProbeOk<T> = {
  state: 'ok'
  value: T
  /** ISO 8601 del momento de la medida. */
  at: string
}

export type ProbeUnavailable = {
  state: 'unavailable'
  /** Motivo en español, apto para mostrar al usuario. */
  reason: string
}

export type ProbeError = {
  state: 'error'
  reason: string
}

export type Probe<T> = ProbeOk<T> | ProbeUnavailable | ProbeError

export interface PlatformInfo {
  os: string
  arch: string
  hostname: string
  kernel: string
  /** Modelo de placa leído de /proc/device-tree/model, si existe. */
  model: string | null
}

export interface CpuInfo {
  temperatureC: number | null
  load1: number
  load5: number
  load15: number
  cores: number
}

export interface FanInfo {
  rpm: number
  /** 0–255 */
  pwm: number | null
}

export interface MemoryInfo {
  totalBytes: number
  availableBytes: number
}

export interface MountUsage {
  mount: string
  totalBytes: number
  /** Bytes disponibles para usuarios no root. */
  availableBytes: number
}

export interface ThrottleFlags {
  raw: string
  underVoltageNow: boolean
  armFreqCappedNow: boolean
  throttledNow: boolean
  softTempLimitNow: boolean
  underVoltageOccurred: boolean
  armFreqCappedOccurred: boolean
  throttledOccurred: boolean
  softTempLimitOccurred: boolean
}

export interface PowerInfo {
  /** Tensión de entrada de 5 V medida por el PMIC (EXT5V_V). */
  inputVoltageV: number | null
  /** Corriente máxima negociada con la fuente (mA), según firmware. */
  supplyMaxCurrentMa: number | null
  throttle: ThrottleFlags | null
}

export interface RtcInfo {
  present: boolean
  /** Tensión de la pila RTC (BATT_V). < 1 V se interpreta como "sin pila". */
  batteryVoltageV: number | null
  hasBattery: boolean | null
}

export type TimeSource = 'ntp' | 'gnss' | 'lora' | 'rtc' | 'unverified'

export interface TimeInfo {
  source: TimeSource
  ntpSynchronized: boolean | null
  timezone: string | null
  /** Última comprobación por una fuente sin red (GNSS/LoRa, survival-timesync); null si no hay. */
  verifiedAt: string | null
  /** Nodo LoRa que dio la hora (canal privado), si la fuente es LoRa. */
  node: string | null
  /** Último ajuste del reloj por survival-timesync en este arranque. */
  lastStep: { at: string; source: 'gnss' | 'lora'; deltaS: number } | null
}

export type NetworkMode = 'offline' | 'local'

export interface NetworkInterface {
  name: string
  kind: 'wifi' | 'ethernet' | 'other'
  up: boolean
  ipv4: string[]
  /** Nombre de la conexión de NetworkManager (p. ej. SSID), si se conoce. */
  connection: string | null
}

export interface NetworkInfo {
  /**
   * 'local' = hay al menos una interfaz no loopback con IPv4.
   * No se comprueba Internet: el sistema no hace peticiones externas.
   */
  mode: NetworkMode
  interfaces: NetworkInterface[]
  /** Radio Wi-Fi (nmcli radio wifi); null si no se puede consultar. */
  wifiRadio: 'enabled' | 'disabled' | null
}

export interface DisplayOutput {
  name: string
  connected: boolean
  modes: string[]
}

export interface InputDeviceInfo {
  name: string
  vendorId: string
  productId: string
  kind: 'touchscreen' | 'keyboard' | 'pointer' | 'other'
}

export interface SerialInfo {
  /** Rutas /dev de puertos serie USB (ttyUSB*, ttyACM*). No implica que sean GPS. */
  usbPorts: string[]
}

export type GnssFix = 'none' | '2d' | '3d'

/** Herramientas del sistema necesarias para fases posteriores (instaladas o no). */
export interface SoftwareInfo {
  gpsd: boolean
  kiwixServe: boolean
  cryptsetup: boolean
}

/** Contadores de error del controlador SD desde el arranque (los publica el vigilante como root). */
export interface SdHealthInfo {
  commandTimeouts: number
  dataTimeouts: number
  requestTimeouts: number
  crcErrors: number
  /** Momento en que se leyeron los contadores. */
  readAt: string
}

export interface ServiceUnitState {
  unit: string
  /** active | inactive | failed | activating | not-found … (systemd ActiveState o 'not-found'). */
  active: string
  sub: string
}

export interface DeviceStatus {
  collectedAt: string
  platform: PlatformInfo
  uptime: Probe<{ seconds: number }>
  cpu: Probe<CpuInfo>
  fan: Probe<FanInfo>
  memory: Probe<MemoryInfo>
  storage: Probe<MountUsage[]>
  power: Probe<PowerInfo>
  /** Batería principal. Solo 'ok' con un medidor real (UPS/fuel gauge). */
  battery: Probe<{ percent: number }>
  rtc: Probe<RtcInfo>
  time: Probe<TimeInfo>
  network: Probe<NetworkInfo>
  display: Probe<DisplayOutput[]>
  input: Probe<InputDeviceInfo[]>
  serial: Probe<SerialInfo>
  software: Probe<SoftwareInfo>
  services: Probe<ServiceUnitState[]>
  sdHealth: Probe<SdHealthInfo>
}

export type ComponentState = 'ok' | 'degraded' | 'down'

export interface HealthReport {
  status: ComponentState
  version: string
  time: string
  components: Record<string, { state: ComponentState; detail?: string; latencyMs?: number }>
}

// ---------------------------------------------------------------- Biblioteca (Fase 3)

export interface ProtocolSummary {
  id: string
  title: string
  category: string
  /** Fecha de la última revisión (ISO). */
  reviewed: string
  sources: string
}

export interface ProtocolDetail extends ProtocolSummary {
  /** HTML generado por el renderizador seguro (solo etiquetas conocidas, todo escapado). */
  html: string
}

export type DocKind = 'md' | 'txt' | 'html' | 'pdf'

export interface DocSummary {
  id: number
  title: string
  kind: DocKind
  /** Ruta relativa al directorio de documentos. */
  path: string
  sizeBytes: number
  modifiedAt: string
  /** false si no se pudo extraer texto (p. ej. PDF sin pdftotext). */
  searchable: boolean
}

export interface ZimBook {
  /** Identificador de contenido de kiwix-serve (nombre del fichero sin .zim); es el que acepta la búsqueda. */
  id: string
  name: string
  title: string
  description: string
  language: string
  articleCount: number | null
  /** Variante del ZIM ("maxi", "nopic", "mini"…); vacío si el catálogo no la indica. */
  flavour: string
  /** Icono del libro servido por kiwix-serve (vía proxy /kiwix); null si no tiene. */
  icon: string | null
  /** URL relativa del lector de kiwix-serve (vía proxy /kiwix). */
  readerPath: string
}

export interface SearchHit {
  source: 'protocol' | 'doc' | 'zim' | 'history'
  title: string
  snippet: string
  /** Ruta interna de la UI o del lector Kiwix. */
  href: string
  bookTitle?: string
}

export interface SearchResults {
  query: string
  hits: SearchHit[]
  /** Estado por fuente: una fuente caída no anula las demás. */
  sources: Record<'protocols' | 'docs' | 'zim' | 'history', Probe<{ count: number }>>
}

export interface Favorite {
  id: string
  title: string
  href: string
  createdAt: string
}

export interface LibraryStatus {
  protocols: number
  docs: { count: number; searchable: number; lastIndexedAt: string | null }
  kiwix: Probe<{ books: number }>
  pdftotext: boolean
  docsDir: string
  zim: { installed: ZimInstalled[]; downloads: ZimDownload[] }
}

// ---------------------------------------------------------------- Navegación (Fase 4)

export interface NavFix {
  fix: GnssFix
  latitude: number | null
  longitude: number | null
  /** Altitud sobre el nivel del mar (m), si el receptor la da. */
  altitudeM: number | null
  speedMs: number | null
  /** Rumbo sobre el terreno (°). Solo con fijación y desplazamiento > umbral; si no, null. */
  courseDeg: number | null
  /** Error horizontal estimado (m) según el receptor, si lo informa. */
  horizontalErrorM: number | null
  satellitesUsed: number | null
  satellitesVisible: number | null
  /** Hora GNSS (ISO) del último dato. */
  time: string | null
  /** Antigüedad del último dato (s). */
  ageSeconds: number | null
}

export interface NavFallbackPosition {
  source: 'meshtastic'
  /** Id del nodo cuya posición es (el propio o el seguido por radio, p. ej. !1a2b3c4d). */
  nodeId: string | null
  /** Nombre del nodo según la malla; null si no lo ha anunciado. */
  nodeName: string | null
  /** true si la posición llega por radio desde otro nodo (el seguido), no del conectado por USB. */
  remote: boolean
  /** Error máximo (m) si el canal recorta la posición; null = completa. */
  precisionM: number | null
  latitude: number
  longitude: number
  altitudeM: number | null
  /** Hora de la posición según el nodo (ISO); null si el nodo no la informa. */
  time: string | null
  /** Antigüedad de la posición (s) respecto a la hora de la Pi; null si no hay hora. */
  ageSeconds: number | null
  /** true si el nodo no la informa ahora y es la última conocida (guardada por survival-mesh). */
  lastKnown: boolean
}

export interface NavStatus {
  gpsd: 'connected' | 'unreachable'
  /** Dispositivos que gpsd está usando (ruta /dev). */
  devices: string[]
  gnss: Probe<NavFix>
  /**
   * Posición de respaldo cuando no hay GNSS propio: la última que informó el nodo LoRa Meshtastic.
   * Baja frecuencia (minutos) y con su antigüedad: solo para mostrar, nunca para trazas ni waypoints «aquí».
   */
  fallback: Probe<NavFallbackPosition>
  recording: { trackId: string; points: number; startedAt: string; intervalSeconds: number } | null
  /** true solo en desarrollo con NAV_SIMULATE=1: la UI lo marca como SIMULADO. */
  simulated: boolean
}

export type WaypointKind = 'agua' | 'refugio' | 'hospital' | 'farmacia' | 'peligro' | 'personal'

export interface Waypoint {
  id: string
  name: string
  kind: WaypointKind
  latitude: number
  longitude: number
  note: string
  /** Origen: anotación del usuario, posición GNSS guardada o importación GPX (nunca "verificado"). */
  origin: 'usuario' | 'gnss' | 'gpx'
  createdAt: string
}

export interface TrackSummary {
  id: string
  name: string
  startedAt: string
  endedAt: string | null
  points: number
  distanceM: number
  origin: 'gnss' | 'gpx'
}

export interface TrackPoint {
  lat: number
  lon: number
  ele: number | null
  time: string | null
}

export interface MapPackage {
  file: string
  title: string
  sizeBytes: number
  /** Fecha de los datos OSM según el nombre del fichero (región-AAAAMMDD-zN.pmtiles). */
  dataDate: string | null
  maxZoom: number | null
}

// ---------------------------------------------------------------- Bóveda (Fase 5)

export interface VaultStatus {
  /** Existe el contenedor cifrado. */
  configured: boolean
  unlocked: boolean
  containerBytes: number | null
  /** Espacio libre dentro del volumen (solo desbloqueado). */
  freeBytes: number | null
  autoLockSeconds: number
  /** Momento (ISO) en que se bloqueará por inactividad, si está desbloqueada. */
  lockAt: string | null
  /** Espera obligatoria (s) antes del siguiente intento tras fallos. 0 = puede intentarlo. */
  retryAfterSeconds: number
  failedAttempts: number
  cryptsetup: boolean
}

export interface VaultFile {
  id: string
  name: string
  mime: string
  sizeBytes: number
  sha256: string
  tags: string[]
  /** Fecha de revisión/caducidad elegida por el usuario (AAAA-MM-DD) o null. */
  reviewDate: string | null
  addedAt: string
}

export interface RemovableFile {
  /** Ruta relativa dentro del medio extraíble. */
  path: string
  media: string
  sizeBytes: number
}

// ---------------------------------------------------------------- ESP32 (Fase 6)

export type Esp32MessageType = 'hello' | 'heartbeat' | 'reading' | 'event' | 'ack' | 'error'

export interface Esp32Reading {
  sensor: string
  value: number
  unit: string
  at: string
}

export interface Esp32Event {
  kind: string
  detail: string
  at: string
}

export interface Esp32Device {
  /** Identificador declarado por el firmware (o la ruta del puerto si aún no se ha presentado). */
  id: string
  port: string
  chip: string
  connected: boolean
  firmware: string | null
  lastSeen: string | null
  readings: Esp32Reading[]
  events: Esp32Event[]
  stats: { lines: number; invalid: number; dropped: number }
}

export interface Esp32Status {
  devices: Esp32Device[]
  /** Puertos serie USB vistos y por qué se usan o no. */
  ports: { path: string; vendorId: string | null; productId: string | null; chip: string; use: 'esp32' | 'gpsd' | 'meshtastic' | 'ignorado' }[]
}

// ---------------------------------------------------------------- Mantenimiento (tareas root vía systemd)

export type AdminJob =
  | 'usb-scan'
  | 'maps-import'
  | 'maps-delete'
  | 'docs-import'
  | 'content-fetch'
  | 'content-delete'
  | 'backup'
  | 'update'
  | 'gps-uart'
  | 'set-time'
  | 'time-sync'
  | 'wifi'
  | 'restart-app'
  | 'llm'
  | 'ap'
  | 'routing'
  | 'mesh'

/** Rutas sin conexión (BRouter, ADR 0010). */
export type RouteMode = 'foot' | 'bike' | 'car'

export interface RouteResult {
  mode: RouteMode
  /** Perfil BRouter usado (p. ej. hiking-mountain). */
  profile: string
  /** [lon, lat] o [lon, lat, altitud] de la ruta calculada. */
  coordinates: number[][]
  distanceM: number
  /** Tiempo estimado por el perfil de BRouter; null si no lo informa. */
  timeS: number | null
  /** Desnivel positivo acumulado (filtrado) en metros; null si no lo informa. */
  ascentM: number | null
}

export interface RoutingStatus {
  /** El servidor BRouter local responde. */
  available: boolean
  reason: string | null
  brouter: string | null
  /** Cuadrículas instaladas (nombre tipo W5_N40) con su tamaño y fecha de descarga. */
  segments: { name: string; bytes: number; mtime: string }[]
  downloadedAt: string | null
}

/** Estado del punto de acceso Wi-Fi local (resultado de la tarea `ap`, ADR 0009). */
export interface ApStatus {
  active: boolean
  ssid: string | null
  password: string | null
  /** URL de la vista pública para los móviles conectados. */
  url: string
  clients: number | null
  /** Regla nftables (sin salida a Internet ni acceso a otros puertos) cargada. */
  firewall: boolean
  /** Pasarela de la vista pública en marcha. */
  gateway: boolean
}

export interface AdminJobStatus {
  job: AdminJob
  /** Estado systemd de survival-admin@<tarea>.service. */
  state: 'inactive' | 'activating' | 'active' | 'deactivating' | 'failed' | 'unknown'
  /** success | exit-code | … (resultado de la última ejecución). */
  result: string | null
  startedAt: string | null
  finishedAt: string | null
  log: string[]
  /** Resultado estructurado (p. ej. usb-scan). */
  data: unknown
}

export interface UsbFile {
  media: string
  path: string
  sizeBytes: number
  kind: 'map' | 'doc' | 'release'
}

export interface UsbScan {
  media: { media: string; freeBytes: number }[]
  files: UsbFile[]
  scannedAt: string
}

export interface ZimInstalled {
  file: string
  sizeBytes: number
  title: string | null
  license: string | null
  version: string | null
}

export interface AssistantStatus {
  /** llama-server responde. */
  available: boolean
  /** Fichero del modelo cargado. */
  model: string | null
  busy: boolean
  /** Modelos descargados en el equipo. */
  installed: { file: string; sizeBytes: number }[]
  /** Fichero del modelo activo según la configuración (aunque el servidor aún esté cargando). */
  active: string | null
}

export interface AskSource {
  n: number
  title: string
  href: string
  source: 'protocol' | 'doc' | 'zim'
}

/** Consulta guardada en el historial del asistente (solo en el equipo, borrable). */
export interface AskHistoryEntry {
  id: number
  question: string
  answer: string
  sources: AskSource[]
  /** Fichero del modelo que respondió; null si no hizo falta el modelo (sin fuentes). */
  model: string | null
  createdAt: string
  ms: number
}

export interface AskHistory {
  /** El usuario puede desactivar el guardado ("No guardar historial"). */
  enabled: boolean
  /** Máximo de entradas conservadas: las más antiguas se borran solas. */
  limit: number
  items: AskHistoryEntry[]
}

export interface ZimDownload {
  file: string
  bytes: number
}

// ---------------------------------------------------------------- Malla Meshtastic (services/mesh, 127.0.0.1:8787)

export interface MeshBattery {
  /** Porcentaje; null si el nodo va con alimentación externa (Meshtastic informa 101). */
  level: number | null
  powered: boolean
  voltage: number | null
}

export interface MeshNode {
  id: string | null
  num: number | null
  longName: string | null
  shortName: string | null
  hwModel: string | null
  role: string
  isMe: boolean
  /** Última vez que el nodo propio lo oyó (hora del nodo); null si desconocida. */
  lastHeard: string | null
  snr: number | null
  hopsAway: number | null
  battery: MeshBattery | null
  channelUtilization: number | null
  position: {
    lat: number
    lon: number
    alt: number | null
    at: string | null
    /** Error máximo (m) si el canal recorta la posición; ausente/null = posición completa. */
    precisionM?: number | null
    /** true si es la última conocida (el nodo no la informa ahora). */
    cached?: boolean
  } | null
}

export interface MeshStatus {
  version: string
  connected: boolean
  transport: 'usb' | null
  port: string | null
  connectedAt: string | null
  lastPacketAt: string | null
  /** Motivo legible si no hay conexión. */
  error: string | null
  me: (Partial<MeshNode> & { firmware: string | null }) | null
  /** Nodo cuya posición sigue el mapa; null = el propio (el conectado por USB). */
  trackId: string | null
  /** Resumen del nodo seguido (el propio si trackId es null). */
  tracked: Partial<MeshNode> | null
  nodeCount: number
  maxTextBytes: number
}

export interface MeshChannel {
  index: number
  name: string | null
  role: 'PRIMARY' | 'SECONDARY'
}

export interface MeshMessage {
  id: number
  direction: 'in' | 'out'
  from: string | null
  to: string | null
  channel: number
  text: string
  at: string
  snr: number | null
  rssi: number | null
  hops: number | null
}

/** Resultado de la tarea `mesh` con action=scan. */
export interface MeshPortScan {
  ports: { path: string; device: string }[]
  configured: string | null
  installed: boolean
}
