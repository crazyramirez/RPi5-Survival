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

export interface BatteryInfo {
  /** Carga 0–100 % medida por el medidor (fuel gauge). */
  percent: number
  /** Tensión de la celda (V), si el medidor la da. */
  voltageV: number | null
}

export interface MainsInfo {
  /** true = hay red eléctrica en la entrada de la UPS; false = funcionando con batería. */
  present: boolean
}

export interface RtcInfo {
  present: boolean
  /** Tensión de la pila RTC (BATT_V). < 1 V se interpreta como "sin pila". */
  batteryVoltageV: number | null
  hasBattery: boolean | null
}

/** `device`: reloj del propio dispositivo (Android: lo mantiene el sistema con su batería y la hora de red/operador). */
export type TimeSource = 'ntp' | 'gnss' | 'lora' | 'rtc' | 'device' | 'unverified'

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
  battery: Probe<BatteryInfo>
  /** Red eléctrica en la entrada de la UPS (survival-ups, GPIO6 de la X120x). */
  mains: Probe<MainsInfo>
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
  /** Traducción: idioma de la ficha revisada de la que procede (p. ej. 'es'). Ausente en el original. */
  translatedFrom?: string
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
  source: 'protocol' | 'doc' | 'zim' | 'history' | 'note'
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
  sources: Record<'protocols' | 'docs' | 'zim' | 'history' | 'notes', Probe<{ count: number }>>
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
  /** Tiene clave de recuperación (segundo keyslot). null = sin bóveda o sin medida. */
  recoveryKey: boolean | null
  /** Bytes de bóvedas descartadas que siguen en disco (cifradas) hasta borrarlas a mano. */
  discardedBytes: number
}

/** Respuesta de /setup y /recovery-key: la clave se muestra UNA vez y no se guarda en ningún sitio. */
export interface VaultRecoveryKeyResult extends VaultStatus {
  /** Clave en claro, formato XXXX-XXXX-… (8 grupos de 4, base32 de Crockford). */
  newRecoveryKey: string
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
  | 'content'
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
  | 'games'
  /** Solo portable (ADR 0019): copiar Survivelia OS a otra memoria USB e integrarla en el sistema. */
  | 'usb-prepare'
  /** Actualizaciones desde GitHub (ADR 0021): «Buscar ahora» / «Instalar» (action: check | install). */
  | 'update-online'
  /** Lo que lanza el temporizador (Pi) o el planificador de la web (portable) según el modo. */
  | 'update-auto'

/** Juegos offline: copia local de Viseni Games (ADR 0012, scripts/games-sync.py). */
export interface GamesStatus {
  /** Hay copia instalada y el servidor local de juegos responde. */
  available: boolean
  installed: boolean
  reason: string | null
  /** URL del portal servido en loopback (otro origen que la web). */
  url: string
  installedAt: string | null
  /** Fecha del offline-manifest.json de la web cuando se descargó. */
  manifestGeneratedAt: string | null
  files: number
  bytes: number
  games: string[]
  /** Juegos con algún archivo que no se pudo verificar (pueden fallar). */
  incompleteGames: string[]
  failedFiles: number
  /** Recursos externos (CDN, fuentes) que el sitio declara y que no funcionarán sin Internet. */
  external: { file: string; url: string }[]
}

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

// ---------------------------------------------------------------- Actualizaciones desde GitHub (ADR 0021)

/** auto = comprueba, descarga y aplica en un momento seguro · notify = solo avisa · off = nunca se conecta sola. */
export type UpdateMode = 'auto' | 'notify' | 'off'

/** system = Pi/Linux con systemd · portable = carpeta portable · android = app · dev = sin instalación (no se ofrece). */
export type UpdateKind = 'system' | 'portable' | 'android' | 'dev'

/**
 * Resultado de la última comprobación (update-engine.mjs):
 * up-to-date · available · newer-installed (desarrollo) · no-asset (no hay para este sistema) · needs-step (minFrom).
 */
export type UpdateCheckStatus = 'up-to-date' | 'available' | 'newer-installed' | 'no-asset' | 'needs-step'

export interface UpdateStatus {
  kind: UpdateKind
  /** Se puede actualizar desde GitHub en este equipo (si no, `reason`). */
  supported: boolean
  reason: string | null
  installed: string
  mode: UpdateMode
  /** Momentos de la última comprobación (intento) y de la última que llegó a GitHub. */
  checkedAt: string | null
  okAt: string | null
  /** Error de la última comprobación: offline | no-release | http | signature | invalid | download | … */
  error: { code: string; message: string } | null
  status: UpdateCheckStatus | null
  latest: { version: string; date: string; minFrom: string; notes: string | null } | null
  /** Fichero de esta plataforma en la última versión. */
  asset: { name: string; size: number } | null
  /** Ya descargada y verificada (lista para instalar). */
  downloaded: string | null
  /** Portable: versión preparada en .update/, se aplica al cerrar (o con «Reiniciar y aplicar»). */
  prepared: string | null
  /** Pi en Automática: instalación aplazada (window = fuera de 02:00–06:00, vault = bóveda abierta, busy). */
  deferred: { version: string; reason: 'window' | 'vault' | 'busy' } | null
  lastInstall: { version: string | null; ok: boolean; message: string | null; at: string } | null
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
  source: 'protocol' | 'doc' | 'zim' | 'note'
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

/** Versión portable (ADR 0014): /api/portable/status. */
export interface PortableStatus {
  /** Carpeta desde la que se ejecuta (USB, disco o instalada). */
  root: string
  /** Carpeta de datos del usuario (mapas, documentos, ZIM…). */
  data: string
  platform: string
  arch: string
  freeBytes: number | null
  /** Plan de «Instalar en este equipo»; null si el instalador no está disponible. */
  install: {
    dest: string
    /** Ya se ejecuta desde la carpeta instalada. */
    installedHere: boolean
    /** Hay una instalación previa: se actualiza conservando sus datos. */
    update: boolean
    bytes: number
    copiesData: boolean
    supported: boolean
  } | null
  installJob: { state: 'idle' | 'running' | 'done' | 'failed'; message: string | null; dest: string | null; shortcuts: string[] }
  /** «Compartir en la red local»: vista pública de solo lectura en la IP privada del equipo. */
  share: { on: boolean; url: string | null; error: string | null }
}

/** App Android (ADR 0020): estado que da la parte nativa de la app. */
export interface AndroidStatus {
  version: string
  abi: string
  /** Fabricante y modelo (p. ej. «realme RMP2105»). */
  model: string
  android: string
  dataDir: string | null
  /** La carpeta de datos es la privada de la app: Android la borra al desinstalar. */
  dataDeletedOnUninstall: boolean
  freeBytes: number | null
  permissions: {
    location: boolean
    /** La tablet tiene receptor GNSS. */
    gnssHardware: boolean
    notifications: boolean
    /** «Acceso a todos los archivos» (memorias USB, microSD, carpeta SurvivalOS). */
    allFiles: boolean
    /** Sin restricciones de batería (descargas y radio con la pantalla apagada). */
    battery: boolean
    /** Puede abrir el instalador (actualizar desde un APK). */
    installApps: boolean
  }
  /** Pantalla fijada (modo quiosco de Android). */
  kiosk: boolean
}

/** Acciones de la app Android que la interfaz puede pedir (lista cerrada). */
export type AndroidAction =
  | 'permission-location'
  | 'permission-notifications'
  | 'permission-files'
  | 'permission-battery'
  | 'permission-install'
  | 'app-settings'
  | 'storage'
  | 'kiosk'

/** Memoria USB de Survivelia OS (versión portable, ADR 0019). */
export interface PortableUsbStatus {
  /** Dónde se ejecuta: memoria USB o disco externo (removable) o disco interno. */
  volume: {
    removable: boolean
    /** Punto de montaje (E:\, /Volumes/X, /media/u/X). */
    mount: string | null
    label: string | null
    /** fat32 | exfat | ntfs | apfs | hfs | ext | … */
    fs: string | null
    /** Survivelia OS está en la raíz de la memoria (preparada con «Preparar memoria USB»). */
    volumeRoot: boolean
    /** Identificador de la memoria (para «abrir al conectar»); null si aún no tiene. */
    id: string | null
  }
  /** «Abrir al conectar esta memoria» en ESTE equipo. */
  autoOpen: {
    supported: boolean
    reason: string | null
    /** Hay alguna memoria emparejada en este equipo (vigilante instalado). */
    enabled: boolean
    /** Esta memoria está emparejada. */
    paired: boolean
    mode: 'ask' | 'open'
    /** El usuario dijo «No, gracias» en este equipo. */
    dismissed: boolean
  }
  /** Memorias y discos externos conectados donde se puede preparar Survivelia OS. */
  media: {
    media: string
    label: string
    fs: string | null
    freeBytes: number
    totalBytes: number
    /** Ya tiene Survivelia OS (se actualizará conservando sus datos). */
    hasSurvival: boolean
  }[]
  /** Lo que se copiará al preparar una memoria. */
  prepare: {
    appBytes: number
    dataBytes: number
    /** Ficheros de datos de más de 4 GB (no caben en FAT32). */
    bigData: { file: string; bytes: number }[]
    runtimes: string[]
    allPlatforms: boolean
  }
  platform: string
}

/** Catálogo de descargas (ADR 0015): un elemento tal como lo ve la interfaz. */
export interface ContentCatalogItem {
  id: string
  kind: 'zim' | 'maps' | 'routing' | 'llm' | 'doc' | 'games'
  group: string
  /** es | en | mul. Español por defecto; inglés solo si no hay equivalente en español. */
  lang: string
  /** 1 imprescindible, 2 recomendado, 3 extra (se desmarca primero si falta espacio). */
  priority: 1 | 2 | 3
  default: boolean
  approxBytes: number
  license: string
  title: string
  description: string
  /** Id del contenido en español que ya cubre este (no se marca por defecto). */
  equivalentOf: string | null
  variants: { flavour: string; approxBytes: number; label: string }[] | null
}

export interface ContentItemStatus {
  id: string
  state: 'installed' | 'missing' | 'downloading' | 'verifying' | 'failed'
  file: string | null
  bytes: number | null
  version: string | null
  done: number | null
  total: number | null
  error: string | null
  /** Solo asistente: modelo activo. */
  active?: boolean
}

export interface ContentOverview {
  platform: string
  portable: boolean
  catalogUpdated: string
  groups: { id: string; title: string }[]
  catalog: ContentCatalogItem[]
  items: ContentItemStatus[]
  freeBytes: number | null
  /** Memoria total del equipo: «Descargarlo todo» omite los modelos del asistente que no caben (ADR 0020). */
  ramBytes: number | null
  /** Asistente de primera puesta en marcha. */
  setup: { state: 'pending' | 'completed' | 'skipped'; at: string | null }
}

export type * from './notes.ts'
export type * from './places.ts'
