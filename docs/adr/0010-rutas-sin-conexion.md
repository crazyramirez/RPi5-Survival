# ADR 0010 — Rutas sin conexión con BRouter

- **Estado:** aceptada e implementada (2026-11-09), con autorización del usuario para instalar Java.
- **Decisión:**
  - **Motor:** [BRouter](https://github.com/abrensch/brouter) **1.7.10** (MIT). Release
    `brouter-1.7.10.zip`, con el SHA-256 publicado por GitHub fijado en `scripts/routing-install.sh`.
  - **Java:** `openjdk-17-jre-headless` de Debian. Las clases son de la versión 55 (Java 11 o superior).
  - **Datos:** cuadrículas OSM de 5°×5° de `brouter.de/brouter/segments4`, en `/var/lib/survival-os/routing/segments4`:
    - España peninsular y Baleares: `W10_N35`, `W10_N40`, `W5_N35`, `W5_N40`, `E0_N35`, `E0_N40` (≈ 420 MB);
    - Canarias: `W20_N25`, `W15_N25` (≈ 10 MB).

    brouter.de no publica checksums. Cada descarga se comprueba contra el `Content-Length` del servidor, y el SHA-256
    calculado al descargar queda en `manifest.json` para detectar cambios después.
  - **Servicio** `survival-routing`:
    - usuario `survival`, solo en `127.0.0.1:17777`, `IPAddressDeny=any`, datos de solo lectura;
    - 256 MiB de montón, `MemoryMax=400M`, un hilo y 60 s como máximo por cálculo;
    - no arranca si BRouter no está instalado (`Condition*`).
  - **API web:**
    - `GET /api/routing/status`;
    - `GET /api/routing/route?from=lat,lon&to=lat,lon&mode=foot|bike|car[&format=gpx]`.

    Los perfiles son `hiking-mountain`, `trekking` y `car-fast`. Distancia, tiempo y desnivel salen de las
    propiedades de BRouter; si falta alguno, la distancia se calcula de la geometría y el resto queda `null`.
  - **Interfaz:**
    - en Mapas, el botón «Ruta»: el origen es el GNSS, el nodo LoRa o el centro del mapa, y el destino es el centro
      del mapa o un punto guardado; muestra la línea, el resumen y la exportación a GPX;
    - en Mantenimiento, la tarjeta «Rutas sin conexión»: tarea root `routing` con instalar región y quitar datos.
  - **Vista pública del AP:** no incluye rutas (no están en la lista blanca de la pasarela).
- **Medido en la Pi (2026-11-09):**
  - a pie, 3,2 km: 0,1 s;
  - coche y bici, 20 km: 0,3 s;
  - coche Madrid → Sevilla, 531 km: 10,5 s;
  - Java ocupa unos 320 MB de RSS.
- **Limitaciones:**
  - sin indicaciones giro a giro ni voz;
  - el tiempo estimado es el del perfil de BRouter, no el del tráfico;
  - fuera de las cuadrículas instaladas responde «datafile … not found» y la pantalla lo muestra;
  - los datos OSM son una instantánea de la fecha de descarga y se actualizan desde Mantenimiento con red.
