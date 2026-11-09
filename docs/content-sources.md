# Fuentes de contenido y licencias

## Incluido en la release

| Recurso | Origen | Licencia |
|---|---|---|
| Atkinson Hyperlegible, JetBrains Mono | `@fontsource/*` | SIL OFL 1.1 |
| Iconos | `@lucide/vue` | ISC |
| Glifos de mapa Noto Sans + sprites | protomaps/basemaps-assets | OFL 1.1 (fuentes) · BSD-3 (sprites) |
| Estilo de mapa | `@protomaps/basemaps` 5.x | BSD-3-Clause |
| MapLibre GL JS 6, PMTiles 4 | npm | BSD-3-Clause |
| Protocolos de emergencia (`content/protocols`) | Resúmenes propios redactados con IA a partir de ERC 2021, OMS, CDC y EAWAG/SODIS (citados en cada protocolo) | Uso interno; **pendientes de revisión sanitaria** |

## Descargable en el equipo (`content-fetch.sh`)

Catálogo oficial de Kiwix (download.kiwix.org), verificado con SHA-256 y registrado en
`/var/lib/survival-os/library/manifest.json` (origen, fecha, licencia, tamaño, hash).

| Preset | Contenido (catálogo 2026-10) | Tamaño | Licencia |
|---|---|---|---|
| basico | Wikipedia Médica ES (nopic), Wikiviajes ES, Wikilibros ES | ~0,3 GB | CC BY-SA 4.0 |
| recomendado | + Wikipedia ES completa (nopic, 13,3 GB), iFixit ES (3,7 GB), Wikcionario ES | ~18 GB | CC BY-SA 4.0 · iFixit CC BY-NC-SA 3.0 |
| completo | Wikipedia ES con imágenes (36,5 GB) y variantes maxi | ~42 GB | ídem |

## Mapas (preparados en el PC)

```sh
pmtiles extract https://build.protomaps.com/20261108.pmtiles espana-20261108-z15.pmtiles --bbox=-9.5,35.9,4.4,43.9 --maxzoom=15
pmtiles extract https://build.protomaps.com/20261108.pmtiles canarias-20261108-z15.pmtiles --bbox=-18.3,27.5,-13.3,29.5 --maxzoom=15
```

| Fichero | Tamaño | SHA-256 |
|---|---|---|
| espana-20261108-z15.pmtiles | 3,4 GB | `e360ac7bd4e688c61e54d4f89859cc09acebe3e0d642f7a2ab6ebdc333425c7a` |
| canarias-20261108-z15.pmtiles | 63 MB | `dd8057ff0cd790755881818aca62f1a761395cbe1573753b2d78f1d2231277a2` |

Datos © colaboradores de OpenStreetMap (ODbL 1.0); teselas Protomaps. La atribución se muestra en el mapa.
No se descargan teselas de servidores públicos de forma masiva: se extrae un único archivo por región.

## Rutas sin conexión (ADR 0010)

- **Motor:** BRouter 1.7.10 (MIT), https://github.com/abrensch/brouter. Release fijada por SHA-256.
- **Datos:** cuadrículas `segments4` de https://brouter.de/brouter/segments4/, derivadas de OpenStreetMap
  (© colaboradores de OpenStreetMap, ODbL). Se descargan desde Mantenimiento y quedan en
  `/var/lib/survival-os/routing`.
