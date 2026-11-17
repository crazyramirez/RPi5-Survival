#!/usr/bin/env python3
"""Survivelia OS — ayuda sin Internet a receptores u-blox conectados a gpsd (A-GPS local; Pi / Linux con systemd).

Un u-blox de llave USB no tiene pila: al desenchufarlo olvida hora, posición y efemérides, y vuelve a arrancar en frío
(minutos con cielo abierto). Este script:

    gnss-aid.py inject /dev/ttyACM1   al conectarlo (lo llama gps-usb-probe.py): le envía la última posición, la hora
                                      (solo si el reloj está sincronizado) y, si aún valen, las efemérides e
                                      ionosfera/UTC guardadas → fija en segundos.
    gnss-aid.py save                  cada 20 min (survival-gnss-aid.timer): con fijación 3D, pide al receptor sus
                                      efemérides (AID-EPH) e ionosfera/UTC (AID-HUI) y las guarda, junto con la posición.

Todo pasa por gpsd: se escribe con su socket de control (`&<dispositivo>=<hex>`) y se lee en modo raw. Solo a
receptores que responden como u-blox (MON-VER). Mismo formato de datos que serial-hub (services/serial-hub/src/aid.ts).
"""
from __future__ import annotations

import json
import os
import socket
import struct
import subprocess
import sys
import time

GPSD = ("127.0.0.1", 2947)
CONTROL = "/run/gpsd.sock"
DIR = os.environ.get("GNSS_AID_DIR", "/var/lib/survival-os/gnss-aid")
TIMESYNC = "/run/survival-os/timesync.json"
EPH_MAX_AGE_S = 4 * 3600
HUI_MAX_AGE_S = 7 * 24 * 3600
MIN_TRUSTED_CLOCK = 1767225600  # 2026-01-01 UTC
GPS_EPOCH = 315964800
GPS_LEAP_S = 18


def log(msg: str) -> None:
    print(msg, flush=True)


# ------------------------------------------------------------------ UBX

def ubx(cls: int, mid: int, payload: bytes = b"") -> bytes:
    body = bytes([cls, mid]) + struct.pack("<H", len(payload)) + payload
    a = b = 0
    for x in body:
        a = (a + x) & 0xFF
        b = (b + a) & 0xFF
    return b"\xb5\x62" + body + bytes([a, b])


def scan(data: bytes) -> list[tuple[int, int, bytes]]:
    out = []
    i = 0
    while i + 8 <= len(data):
        if data[i] != 0xB5 or data[i + 1] != 0x62:
            i += 1
            continue
        ln = struct.unpack_from("<H", data, i + 4)[0]
        if ln > 1024 or i + 8 + ln > len(data):
            i += 2
            continue
        frame = data[i:i + 8 + ln]
        if ubx(frame[2], frame[3], frame[6:6 + ln]) == frame:
            out.append((frame[2], frame[3], frame[6:6 + ln]))
            i += 8 + ln
        else:
            i += 2
    return out


def aid_ini(pos: dict | None, t: float | None, tacc_ms: int = 10_000) -> bytes | None:
    if pos is None and t is None:
        return None
    p = bytearray(48)
    flags = 0
    if pos:
        struct.pack_into("<iiiI", p, 0, round(pos["lat"] * 1e7), round(pos["lon"] * 1e7), round(pos["alt"] * 100), min(0xFFFFFFFF, round(pos["acc"] * 100)))
        flags |= 0x01 | 0x20
    if t is not None:
        g = int((t - GPS_EPOCH + GPS_LEAP_S) * 1000)
        struct.pack_into("<HI", p, 18, g // 604_800_000, g % 604_800_000)
        struct.pack_into("<I", p, 28, tacc_ms)
        flags |= 0x02
    struct.pack_into("<I", p, 44, flags)
    return ubx(0x0B, 0x01, bytes(p))


# ------------------------------------------------------------------ gpsd

def control(dev: str, data: bytes) -> bool:
    """Envía bytes al receptor a través de gpsd (socket de control, solo root)."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(3)
            s.connect(CONTROL)
            s.sendall(f"&{dev}={data.hex()}\n".encode())
            return s.recv(64).startswith(b"OK")
    except OSError:
        return False


def collect(dev: str, send: list[bytes], seconds: float) -> list[tuple[int, int, bytes]]:
    """Escucha el receptor en crudo (raw) mientras se le envían `send` y devuelve las tramas UBX recibidas."""
    with socket.create_connection(GPSD, timeout=3) as s:
        s.sendall(('?WATCH={"enable":true,"raw":2,"device":"%s"}\n' % dev).encode())
        time.sleep(0.3)
        for m in send:
            control(dev, m)
            time.sleep(0.2)
        buf = b""
        end = time.monotonic() + seconds
        s.settimeout(0.5)
        while time.monotonic() < end and len(buf) < 200_000:
            try:
                chunk = s.recv(8192)
            except socket.timeout:
                continue
            if not chunk:
                break
            buf += chunk
    return scan(buf)


def is_ublox(dev: str) -> bool:
    return any(c == 0x0A and i == 0x04 for c, i, _ in collect(dev, [ubx(0x0A, 0x04)], 2.5))


def gpsd_status() -> tuple[list[str], dict[str, dict]]:
    """Dispositivos de gpsd y última TPV de cada uno (unos segundos de escucha)."""
    devices: list[str] = []
    tpv: dict[str, dict] = {}
    try:
        with socket.create_connection(GPSD, timeout=3) as s:
            s.sendall(b'?WATCH={"enable":true,"json":true}\n')
            s.settimeout(0.5)
            buf = b""
            end = time.monotonic() + 3
            while time.monotonic() < end:
                try:
                    buf += s.recv(8192)
                except socket.timeout:
                    continue
    except OSError:
        return [], {}
    for line in buf.split(b"\n"):
        try:
            m = json.loads(line)
        except ValueError:
            continue
        if m.get("class") == "DEVICES":
            devices = [d["path"] for d in m.get("devices", []) if d.get("path")]
        elif m.get("class") == "TPV" and m.get("device"):
            tpv[m["device"]] = m
    return devices, tpv


# ------------------------------------------------------------------ datos guardados

def load_meta() -> dict:
    try:
        with open(os.path.join(DIR, "aid.json"), encoding="utf-8") as f:
            m = json.load(f)
            return m if isinstance(m, dict) else {}
    except (OSError, ValueError):
        return {}


def write(name: str, data: bytes) -> None:
    os.makedirs(DIR, exist_ok=True)
    p = os.path.join(DIR, name)
    with open(p + ".tmp", "wb") as f:
        f.write(data)
    os.replace(p + ".tmp", p)


def read_frames(name: str) -> list[bytes]:
    try:
        with open(os.path.join(DIR, name), "rb") as f:
            return [ubx(c, i, p) for c, i, p in scan(f.read())]
    except OSError:
        return []


def clock_trusted() -> bool:
    """Hora fiable: NTP sincronizado o verificada por GNSS/LoRa (survival-timesync) en los últimos 7 días."""
    if time.time() < MIN_TRUSTED_CLOCK:
        return False
    try:
        r = subprocess.run(["timedatectl", "show", "-p", "NTPSynchronized", "--value"], capture_output=True, text=True, timeout=5, check=False)
        if r.stdout.strip() == "yes":
            return True
    except OSError:
        pass
    try:
        with open(TIMESYNC, encoding="utf-8") as f:
            st = json.load(f)
        at = st.get("verifiedAt")
        if isinstance(at, str):
            from datetime import datetime
            return time.time() - datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp() < 7 * 86400
    except (OSError, ValueError):
        pass
    return False


# ------------------------------------------------------------------ órdenes

def inject(dev: str) -> int:
    if not is_ublox(dev):
        log(f"{dev}: no es un u-blox (no se le envía nada)")
        return 0
    meta = load_meta()
    now = time.time()
    msgs: list[bytes] = []
    pos = None
    p = meta.get("position")
    if isinstance(p, dict) and isinstance(p.get("lat"), (int, float)) and isinstance(p.get("lon"), (int, float)):
        age_h = (now * 1000 - p.get("at", 0)) / 3_600_000
        acc = 5_000 if age_h < 1 else 50_000 if age_h < 24 else 300_000
        alt = p.get("alt")
        if not isinstance(alt, (int, float)):
            alt, acc = 0, max(acc, 10_000)
        pos = {"lat": p["lat"], "lon": p["lon"], "alt": alt, "acc": acc}
    trusted = clock_trusted()
    ini = aid_ini(pos, now if trusted else None)
    if ini:
        msgs.append(ini)
    if trusted:
        if meta.get("huiAt") and now * 1000 - meta["huiAt"] < HUI_MAX_AGE_S * 1000:
            msgs += read_frames("aid-hui.ubx")
        if meta.get("ephAt") and now * 1000 - meta["ephAt"] < EPH_MAX_AGE_S * 1000:
            msgs += read_frames("aid-eph.ubx")
    sent = 0
    for m in msgs:
        if control(dev, m):
            sent += 1
        time.sleep(0.03)
    log(f"{dev}: u-blox; ayuda enviada ({sent} mensajes; posición {'sí' if pos else 'no'}, hora {'sí' if trusted else 'no'})")
    return 0


def save() -> int:
    devices, tpv = gpsd_status()
    meta = load_meta()
    changed = False
    best = None
    for dev in devices:
        t = tpv.get(dev) or {}
        if (t.get("mode") or 0) >= 2 and isinstance(t.get("lat"), (int, float)):
            if best is None or (t.get("mode") or 0) > (best.get("mode") or 0):
                best = t
    if best:
        alt = best.get("altMSL", best.get("alt")) if (best.get("mode") or 0) >= 3 else None
        meta["position"] = {"lat": best["lat"], "lon": best["lon"], "alt": alt, "at": int(time.time() * 1000)}
        changed = True
    for dev in devices:
        if (tpv.get(dev, {}).get("mode") or 0) < 3 or not is_ublox(dev):
            continue
        frames = collect(dev, [ubx(0x0B, 0x02), ubx(0x0B, 0x31)], 6)
        eph = [ubx(c, i, p) for c, i, p in frames if c == 0x0B and i == 0x31 and len(p) == 104]
        hui = [ubx(c, i, p) for c, i, p in frames if c == 0x0B and i == 0x02 and len(p) == 72][-1:]
        now_ms = int(time.time() * 1000)
        if len(eph) >= 4:
            write("aid-eph.ubx", b"".join(eph))
            meta["ephAt"] = now_ms
            changed = True
        if hui:
            write("aid-hui.ubx", hui[0])
            meta["huiAt"] = now_ms
            changed = True
        log(f"{dev}: efemérides guardadas de {len(eph)} satélites")
        break  # basta con un receptor
    if changed:
        write("aid.json", json.dumps(meta).encode())
    return 0


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "save":
        return save()
    if len(sys.argv) == 3 and sys.argv[1] == "inject" and sys.argv[2].startswith("/dev/"):
        return inject(sys.argv[2])
    log("uso: gnss-aid.py save | inject /dev/ttyXXX")
    return 2


if __name__ == "__main__":
    sys.exit(main())
