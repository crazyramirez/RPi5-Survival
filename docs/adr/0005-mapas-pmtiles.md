# ADR 0005 — Mapas: PMTiles de Protomaps + MapLibre 6, todo local

- **Estado:** aceptada (2026-11-08)
- **Decisión:** un fichero `.pmtiles` por región, extraído en el PC con `pmtiles extract` del build diario
  de Protomaps (datos OSM, ODbL); España peninsular + Baleares a z15 = 3,4 GB, Canarias 63 MB. Servido por
  Nitro con peticiones Range (`/maps-data/<fichero>`). Estilo `@protomaps/basemaps` (claro/oscuro, etiquetas
  en español), glifos Noto Sans (OFL) y sprites empaquetados en `/map-assets`, y el *worker* de MapLibre
  servido localmente (`setWorkerUrl`).
- **Motivos:** un único fichero sin servidor de teselas; extracción legal y sin descarga masiva de teselas
  públicas; detalle de calle para todo el país en < 4 GB.
- **Consecuencias:** sin relieve/topografía ni ruteo (no prometidos). Actualizar = sustituir el fichero.
  El mapa libera WebGL al salir de la pantalla. Rotación e inclinación desactivadas (norte arriba).
