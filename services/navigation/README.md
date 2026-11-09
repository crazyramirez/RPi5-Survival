# navigation (127.0.0.1:8784)

Cliente de gpsd (`127.0.0.1:2947`, `?WATCH` JSON) con reconexión; waypoints (JSON, escritura atómica) y
tracks (metadatos JSON + puntos JSONL que sobreviven a cortes de luz); importación/exportación GPX 1.1.

- Rumbo solo con fijación y velocidad ≥ 1 m/s. Sin fijación no hay coordenadas.
- Grabación opt-in: 1 punto cada ≥ 10 s (`NAV_TRACK_INTERVAL`) y ≥ 10 m, descartando error > 50 m.
- `NAV_SIMULATE=1` solo fuera de producción; la UI lo rotula como SIMULADO.

API: `GET /status`, `GET|POST /waypoints` (`{here:true}` guarda la posición GNSS), `DELETE /waypoints/:id`,
`GET /waypoints.gpx`, `GET /tracks`, `POST /tracks/start|stop`, `GET /tracks/:id(.gpx|/points)`,
`DELETE /tracks/:id`, `POST /gpx/import`.
