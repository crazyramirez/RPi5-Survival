# esp32-gateway (127.0.0.1:8785)

Pasarela USB serie con placas ESP32. Protocolo **v1, JSON Lines, 115200 8N1**:

```json
{"v":1,"type":"hello","device":"cyd-1","ts":120,"payload":{"firmware":"survival-node 0.1.0","chip":"ESP32-S3"}}
{"v":1,"type":"heartbeat","device":"cyd-1","ts":10120,"payload":{"readings":[{"sensor":"chip_temp","value":41.5,"unit":"°C"}]}}
{"v":1,"type":"reading","device":"cyd-1","ts":10200,"payload":{"sensor":"temp_c","value":21.5,"unit":"°C"}}
{"v":1,"type":"event","device":"cyd-1","ts":10300,"payload":{"event":"button","id":"BOOT","action":"press"}}
```

Pi → ESP32: `{"v":1,"type":"ping"}` → `ack`. Límites: línea ≤ 2048 B, 50 mensajes/s, 32 sensores;
lo inválido se cuenta y se descarta. La desconexión (EIO) se detecta sin bloquear nada; reescaneo cada 5 s.

**Puertos** (ADR 0007): se reclaman solos los ESP32-S3 con USB nativo (`303a:*`). Placas con CH340/CP210x
(p. ej. JC2432W328): `ESP32_PORTS=/dev/serial/by-id/<id>` en `/etc/survival-os/survival-os.env`. Nunca se
abre un puerto que use gpsd.

Firmware de ejemplo (sin probar en hardware): `firmware/esp32-survival-node/`. Simulador:
`scripts/esp32-sim.py`. LoRa requiere un módulo SX126x/SX127x: un ESP32 solo no transmite LoRa.
