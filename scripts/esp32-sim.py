#!/usr/bin/env python3
"""Simulador de ESP32 para probar la pasarela sin hardware (solo pruebas/desarrollo).

Crea un pseudo-terminal y emite el protocolo v1 como lo haría el firmware de ejemplo.
Uso (en la Pi):
    python3 esp32-sim.py /tmp/esp32-sim  &        # crea el enlace /tmp/esp32-sim → /dev/pts/N
    ESP32_PORTS=/tmp/esp32-sim … (configurar la pasarela) ; matar el simulador = desconexión
Opciones: --garbage  intercala líneas inválidas para comprobar que se descartan.
"""
import json, os, pty, select, sys, time

link = sys.argv[1] if len(sys.argv) > 1 else "/tmp/esp32-sim"
garbage = "--garbage" in sys.argv
master, slave = pty.openpty()
name = os.ttyname(slave)
try:
    os.unlink(link)
except FileNotFoundError:
    pass
os.symlink(name, link)
os.chmod(name, 0o666)
print(f"simulador en {name} (enlace {link})", flush=True)

def send(msg_type, payload):
    line = json.dumps({"v": 1, "type": msg_type, "device": "sim-esp32", "ts": int(time.monotonic() * 1000), "payload": payload})
    os.write(master, (line + "\n").encode())

send("hello", {"firmware": "simulador 0.1", "chip": "SIM"})
start = time.monotonic()
last = 0.0
try:
    while True:
        r, _, _ = select.select([master], [], [], 0.5)
        if r:
            data = os.read(master, 1024)
            if b'"ping"' in data:
                send("ack", {"to": "ping"})
        now = time.monotonic()
        if now - last >= 2:
            last = now
            send("heartbeat", {"readings": [
                {"sensor": "sim_temp", "value": round(20 + (now - start) % 5, 1), "unit": "°C"},
                {"sensor": "uptime", "value": int(now - start), "unit": "s"},
            ]})
            if garbage:
                os.write(master, b"\x00\xff basura no JSON\n")
                os.write(master, (json.dumps({"v": 9, "type": "hello", "device": "x"}) + "\n").encode())
except KeyboardInterrupt:
    pass
finally:
    try:
        os.unlink(link)
    except FileNotFoundError:
        pass
