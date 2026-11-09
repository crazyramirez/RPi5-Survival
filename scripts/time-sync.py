#!/usr/bin/env python3
"""Survival OS — hora de respaldo sin red (survival-timesync.timer, cada minuto, como root).

La Pi no tiene pila de reloj: sin Internet arranca con la hora guardada al apagarse (fake-hwclock). Orden de fuentes:
  1. NTP (systemd-timesyncd) sincronizado → no se toca nada.
  2. GNSS por gpsd (cualquier receptor: GPIO o USB) con fijación 2D/3D y dos lecturas coherentes.
  3. LoRa: posiciones del canal PRIVADO de Meshtastic (survival-mesh /time), dos muestras coherentes.
  4. Ninguna → se conserva el reloj y la interfaz lo muestra como «no verificada».
Solo se ajusta si la diferencia supera MIN_STEP_S. Estado en /run/survival-os/timesync.json (la lee device-api).
Uso: time-sync.py [--dry-run]
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

MESH_URL = os.environ.get("MESH_URL", "http://127.0.0.1:8787")
GPSD = ("127.0.0.1", 2947)
STATUS_PATH = os.environ.get("TIMESYNC_STATUS", "/run/survival-os/timesync.json")
MIN_STEP_S = 60
TIME_FLOOR = 1767225600  # 2026-01-01: nada anterior es creíble (la release es posterior)
GNSS_AGREE_S = 3


def log(msg: str, **extra) -> None:
    rec = {"t": datetime.now(timezone.utc).isoformat(timespec="seconds"), "svc": "timesync", "msg": msg}
    rec.update(extra)
    print(json.dumps(rec, ensure_ascii=False), flush=True)


def iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ----------------------------------------------------------------------------- funciones puras

def parse_gpsd_time(value) -> float | None:
    """«2026-11-09T13:26:46.000Z» → epoch; None si falta o es anterior a TIME_FLOOR."""
    if not isinstance(value, str):
        return None
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None
    return t if t >= TIME_FLOOR else None


def gnss_estimate(readings: list) -> float | None:
    """readings: [(epoch_gps, mono)] de TPV con fijación. Dos lecturas proyectadas a la última deben coincidir."""
    if len(readings) < 2:
        return None
    (ta, ma), (tb, mb) = readings[-2], readings[-1]
    if abs((ta + (mb - ma)) - tb) > GNSS_AGREE_S:
        return None
    return tb


def decide(ntp: bool | None, gnss: float | None, lora: dict | None, now: float) -> dict:
    """Elige la fuente y si hay que mover el reloj. `gnss` y `lora["utc"]` son la hora UTC «ahora»."""
    if ntp:
        return {"source": "ntp", "step": None}
    for source, est in (("gnss", gnss), ("lora", (lora or {}).get("utc"))):
        if isinstance(est, (int, float)) and est >= TIME_FLOOR:
            delta = est - now
            return {"source": source, "step": round(delta, 1) if abs(delta) > MIN_STEP_S else None, "deltaS": round(delta, 1)}
    return {"source": None, "step": None}


# ----------------------------------------------------------------------------- fuentes

def ntp_synchronized() -> bool | None:
    try:
        r = subprocess.run(["timedatectl", "show", "-p", "NTPSynchronized", "--value"], capture_output=True, text=True, timeout=5)
        return r.stdout.strip() == "yes" if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def gnss_time(timeout_s: float = 4.0) -> float | None:
    """Hora de gpsd ahora (o None): necesita fijación 2D/3D. Sin gpsd o sin receptor, None en milisegundos."""
    readings = []
    try:
        with socket.create_connection(GPSD, timeout=1.5) as sock:
            sock.sendall(b'?WATCH={"enable":true,"json":true}\n')
            sock.settimeout(timeout_s)
            buf = b""
            end = time.monotonic() + timeout_s
            while time.monotonic() < end and len(readings) < 2:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    try:
                        msg = json.loads(line)
                    except ValueError:
                        continue
                    if msg.get("class") == "TPV" and int(msg.get("mode") or 0) >= 2:
                        t = parse_gpsd_time(msg.get("time"))
                        if t is not None:
                            readings.append((t, time.monotonic()))
    except OSError:
        return None
    est = gnss_estimate(readings)
    return est + (time.monotonic() - readings[-1][1]) if est is not None else None


LORA_INFO: dict = {}


def lora_time() -> dict | None:
    """Hora estimada por survival-mesh; deja en LORA_INFO el motivo si no la hay (para la interfaz)."""
    LORA_INFO.clear()
    try:
        t0 = time.monotonic()
        with urllib.request.urlopen(f"{MESH_URL}/time", timeout=3) as r:
            data = json.load(r)
    except (OSError, ValueError):
        LORA_INFO["reason"] = "mesh"
        return None
    data = data if isinstance(data, dict) else {}
    LORA_INFO["samples"] = data.get("samples") if isinstance(data.get("samples"), int) else None
    if not data.get("privateChannel"):
        LORA_INFO["reason"] = "noPrivate"
        return None
    est = data.get("estimate")
    if not isinstance(est, dict) or not isinstance(est.get("utc"), (int, float)):
        LORA_INFO["reason"] = "samples"
        return None
    # Compensar la mitad del tiempo de la petición (milisegundos, pero gratis).
    return {**est, "utc": est["utc"] + (time.monotonic() - t0) / 2}


# ----------------------------------------------------------------------------- principal

def write_status(status: dict) -> None:
    tmp = STATUS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(status, f)
    os.chmod(tmp, 0o644)
    os.replace(tmp, STATUS_PATH)


def previous_status() -> dict:
    try:
        with open(STATUS_PATH, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def main() -> int:
    dry = "--dry-run" in sys.argv
    ntp = ntp_synchronized()
    gnss = None if ntp else gnss_time()
    lora = None if ntp or gnss is not None else lora_time()
    now = time.time()
    d = decide(ntp, gnss, lora, now)
    prev = previous_status()
    status = {
        "checkedAt": iso(now),
        "ntpSynchronized": ntp,
        "source": d["source"],
        "node": (lora or {}).get("from") if d["source"] == "lora" else None,
        # Última verificación por una fuente sin red (GNSS/LoRa) y último ajuste (se conservan entre pasadas).
        "verifiedAt": prev.get("verifiedAt"),
        "verifiedBy": prev.get("verifiedBy"),
        "lastStep": prev.get("lastStep"),
        # Sin fuente: por qué (mesh = servicio de malla caído; noPrivate = sin canal privado; samples = faltan
        # dos posiciones coincidentes del canal privado). Lo muestra el botón «Comprobar hora ahora».
        "loraReason": LORA_INFO.get("reason") if d["source"] is None else None,
        "loraSamples": LORA_INFO.get("samples"),
        "gnss": gnss is not None,
    }
    if d["source"] in ("gnss", "lora"):
        if d["step"] is not None and not dry:
            target = now + d["step"]
            time.clock_settime(time.CLOCK_REALTIME, target)
            subprocess.run(["fake-hwclock", "save"], check=False, timeout=10)
            status["lastStep"] = {"at": iso(target), "source": d["source"], "deltaS": d["step"], "node": status["node"]}
            log("clock_set", source=d["source"], delta_s=d["step"], node=status["node"])
            now = time.time()
            status["checkedAt"] = iso(now)
        status["verifiedAt"] = iso(now)
        status["verifiedBy"] = d["source"]
    if dry:
        print(json.dumps({"decision": d, "status": status, "lora": lora}, ensure_ascii=False))
        return 0
    try:
        write_status(status)
    except OSError as err:
        log("status_write_failed", error=type(err).__name__)
    return 0


if __name__ == "__main__" and "--selftest" not in sys.argv:
    sys.exit(main())
