#!/usr/bin/env python3
"""Survivelia OS — receptor GNSS USB de cualquier fabricante para gpsd (Raspberry Pi / Linux con systemd).

gpsd solo se engancha solo (hotplug) a unos pocos chips (u-blox, PL2303, CP210x…). Este sondeo, lanzado por udev al
conectar un puerto ttyACM*/ttyUSB* (survival-gps-probe@<tty>.service), escucha el puerto sin escribir nada y, si
recibe frases NMEA válidas, se lo pasa a gpsd con `gpsdctl add`. Puede haber varios receptores a la vez: el servicio
de navegación usa el mejor (fijación, error estimado, HDOP).

No toca los puertos de la malla (MESH_SERIAL), de las placas ESP32 (ESP32_PORTS y Espressif 303a) ni los que ya tiene
abiertos otro proceso.

    gps-usb-probe.py /dev/ttyUSB0 [--no-wait]
"""
from __future__ import annotations

import json
import os
import re
import select
import shutil
import socket
import subprocess
import sys
import termios
import time

ENV_FILES = ("/etc/survival-os/mesh.env", "/etc/survival-os/survival-os.env")
BAUDS = (9600, 4800, 38400, 115200)
LISTEN_S = 2.5
GPSD = ("127.0.0.1", 2947)
SPEED = {4800: termios.B4800, 9600: termios.B9600, 19200: termios.B19200, 38400: termios.B38400, 57600: termios.B57600, 115200: termios.B115200}


def log(msg: str) -> None:
    print(msg, flush=True)


def real(p: str) -> str:
    try:
        return os.path.realpath(p)
    except OSError:
        return p


def env_values() -> dict[str, str]:
    out: dict[str, str] = {}
    for path in ENV_FILES:
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*['\"]?([^'\"#]*)['\"]?", line)
                    if m:
                        out[m.group(1)] = m.group(2).strip()
        except OSError:
            pass
    return out


def usb_vendor(dev: str) -> str | None:
    try:
        d = os.path.realpath(f"/sys/class/tty/{os.path.basename(dev)}/device")
        for _ in range(5):
            v = os.path.join(d, "idVendor")
            if os.path.exists(v):
                with open(v, encoding="ascii") as f:
                    return f.read().strip().lower()
            d = os.path.dirname(d)
    except OSError:
        pass
    return None


def open_elsewhere(dev: str) -> bool:
    """¿Lo tiene abierto otro proceso? (la malla, la pasarela ESP32, gpsd…)."""
    target = real(dev)
    for pid in os.listdir("/proc"):
        if not pid.isdigit() or int(pid) == os.getpid():
            continue
        fd_dir = f"/proc/{pid}/fd"
        try:
            for fd in os.listdir(fd_dir):
                try:
                    if os.readlink(f"{fd_dir}/{fd}") == target:
                        return True
                except OSError:
                    continue
        except OSError:
            continue
    return False


def gpsd_devices() -> list[str] | None:
    """Dispositivos que gpsd usa ya; None si gpsd no responde."""
    try:
        with socket.create_connection(GPSD, timeout=2) as s:
            s.settimeout(2)
            s.sendall(b'?WATCH={"enable":false};?DEVICES;\n')
            buf = b""
            end = time.monotonic() + 3
            while time.monotonic() < end:
                chunk = s.recv(4096)
                if not chunk:
                    break
                buf += chunk
                for line in buf.split(b"\n"):
                    try:
                        msg = json.loads(line)
                    except ValueError:
                        continue
                    if msg.get("class") == "DEVICES":
                        return [real(d.get("path", "")) for d in msg.get("devices", []) if d.get("path")]
    except OSError:
        return None
    return []


def checksum_ok(line: str) -> bool:
    m = re.match(r"^\$([^*]+)\*([0-9A-Fa-f]{2})$", line.strip())
    if not m:
        return False
    x = 0
    for ch in m.group(1):
        x ^= ord(ch)
    return x == int(m.group(2), 16)


def looks_like_nmea(text: str) -> bool:
    return sum(1 for l in re.split(r"\r?\n", text) if l.startswith("$") and checksum_ok(l)) >= 2


def listen(dev: str, baud: int) -> str:
    fd = os.open(dev, os.O_RDONLY | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        attr = termios.tcgetattr(fd)
        attr[0] = 0  # iflag
        attr[1] = 0  # oflag
        attr[2] = (termios.CS8 | termios.CREAD | termios.CLOCAL) & ~termios.HUPCL  # cflag
        attr[3] = 0  # lflag
        attr[4] = attr[5] = SPEED[baud]
        termios.tcsetattr(fd, termios.TCSANOW, attr)
        termios.tcflush(fd, termios.TCIFLUSH)
        data = b""
        end = time.monotonic() + LISTEN_S
        while time.monotonic() < end and len(data) < 16384:
            r, _, _ = select.select([fd], [], [], max(0.0, end - time.monotonic()))
            if r:
                try:
                    chunk = os.read(fd, 1024)
                except BlockingIOError:
                    continue
                if not chunk:
                    break
                data += chunk
        return data.decode("latin-1")
    finally:
        os.close(fd)


def aid(dev: str) -> None:
    """Ayuda sin Internet al receptor si es un u-blox (gnss-aid.py): fija en segundos en vez de minutos."""
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gnss-aid.py")
    try:
        r = subprocess.run([sys.executable, "-I", script, "inject", dev], capture_output=True, text=True, timeout=40, check=False)
        out = (r.stdout or r.stderr).strip()
        if out:
            log(out)
    except (OSError, subprocess.SubprocessError) as e:
        log(f"{dev}: sin ayuda u-blox ({e})")


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1 or not re.match(r"^/dev/tty(ACM|USB)\d{1,3}$", args[0]):
        log("uso: gps-usb-probe.py /dev/ttyACMn|/dev/ttyUSBn")
        return 2
    dev = args[0]
    # Deja que gpsd (su propio hotplug), la malla y la pasarela ESP32 reclamen antes sus puertos.
    if "--no-wait" not in sys.argv:
        time.sleep(4)
    if not os.path.exists(dev):
        return 0
    env = env_values()
    reserved = {real(p) for p in [env.get("MESH_SERIAL", "")] + env.get("ESP32_PORTS", "").split(",") if p.strip()}
    if real(dev) in reserved:
        log(f"{dev}: reservado para la malla o una placa ESP32")
        return 0
    if usb_vendor(dev) == "303a":
        log(f"{dev}: placa ESP32 (Espressif)")
        return 0
    known = gpsd_devices()
    if known is None:
        log("gpsd no responde: nada que hacer")
        return 0
    if real(dev) in known:
        log(f"{dev}: gpsd ya lo usa")
        aid(dev)
        return 0
    if open_elsewhere(dev):
        log(f"{dev}: en uso por otro servicio")
        return 0
    for baud in BAUDS:
        try:
            text = listen(dev, baud)
        except OSError as e:
            log(f"{dev}: no se pudo abrir ({e})")
            return 0
        if looks_like_nmea(text):
            gpsdctl = shutil.which("gpsdctl") or "/usr/sbin/gpsdctl"
            r = subprocess.run([gpsdctl, "add", dev], capture_output=True, text=True, timeout=15, check=False)
            if r.returncode != 0:
                log(f"{dev}: NMEA a {baud} baudios, pero gpsdctl falló: {(r.stderr or r.stdout).strip()}")
                return 1
            log(f"{dev}: receptor GNSS (NMEA a {baud} baudios) añadido a gpsd")
            time.sleep(1)
            aid(dev)
            return 0
    log(f"{dev}: sin NMEA (no es un receptor GNSS)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
