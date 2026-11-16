/** Buscador de lugares sin conexión: índice construido a partir de los mapas PMTiles instalados. */

export interface PlaceHit {
  /** Nombre en el idioma de la interfaz si el mapa lo trae; si no, el nombre local. */
  name: string
  /** Nombre local (OSM `name`), cuando difiere de `name`. */
  localName: string | null
  /** Clase de Protomaps: locality, neighbourhood, macrohood. */
  kind: string
  /** Detalle: city, town, village, hamlet, suburb, isolated_dwelling… */
  detail: string
  lat: number
  lon: number
  /** Fichero de mapa del que sale el lugar. */
  map: string
  /** Distancia al punto de referencia de la búsqueda (centro del mapa), si se dio. */
  distanceM: number | null
}

export interface PlacesStatus {
  /** none: sin mapas; building: preparando el índice; ready: listo; error: no se pudo construir. */
  state: 'none' | 'building' | 'ready' | 'error'
  /** Lugares en el índice en uso. */
  count: number
  /** Mapas indexados. */
  maps: string[]
  /** 0–1 mientras se construye; null en otro caso. */
  progress: number | null
  builtAt: string | null
  error: string | null
}

export interface PlaceSearch {
  status: PlacesStatus
  hits: PlaceHit[]
}
