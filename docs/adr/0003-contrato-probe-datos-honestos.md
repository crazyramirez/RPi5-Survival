# ADR 0003 — Contrato `Probe<T>`: ningún dato sin medida

- **Estado:** aceptada (2026-11-08)
- **Contexto:** la especificación exige no inventar batería, coordenadas, temperatura ni sensores, y mostrar el estado real.
- **Decisión:** toda lectura se expresa como `Probe<T>` = `{state:'ok', value, at}` | `{state:'unavailable', reason}` | `{state:'error', reason}` (`packages/shared-types`). Los recolectores devuelven `unavailable` cuando falta hardware o herramienta; `safeProbe` convierte excepciones en `error`. La UI muestra el motivo (`ProbeNote`).
- **Reglas concretas:**
  - Batería: solo `ok` si el kernel expone `/sys/class/power_supply/*` tipo `Battery` con `capacity`.
  - GNSS: `unavailable` hasta integrar gpsd con receptor identificado (Fase 4).
  - Hora: `ntp` solo si `timedatectl` dice sincronizado; `rtc` solo con pila RTC (BATT_V ≥ 1 V); si no, `unverified`.
  - Red: `local`/`offline` por interfaces con IPv4; jamás se sondea Internet.
  - En no-Linux (PC de desarrollo) casi todo es `unavailable` — nunca datos simulados.
- **Consecuencias:** los motivos de `unavailable` vienen en español desde `device-api`; para traducir la UI completa habrá que pasar a códigos de motivo (pendiente, no bloquea).
