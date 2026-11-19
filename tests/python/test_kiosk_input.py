"""Pruebas de scripts/kiosk-input.py (dirección del trackpad en labwc) sobre un rc.xml temporal.

Verifica:
  1. Sin bloque <libinput> el estado es «traditional» (lo que hace libinput por defecto).
  2. `set natural` añade <libinput><device category="touchpad"><naturalScroll>yes…, conserva el resto (la
     configuración del táctil), mantiene el espacio de nombres sin prefijos y deja una copia previa.
  3. `set traditional` lo vuelve a «no» sin duplicar bloques, y el estado publicado sigue al fichero.
  4. Órdenes no válidas salen con código 2 sin tocar nada.
Uso: python tests/python/test_kiosk_input.py   (sale con código 0 si todo pasa)
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(ROOT, "scripts", "kiosk-input.py")
PI_RC = """<?xml version="1.0"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
\t<touch deviceName="WaveShare WS170120" mapToOutput="HDMI-A-2" mouseEmulation="no"/>
</openbox_config>
"""


def check(cond, msg):
    if not cond:
        print(f"FALLO: {msg}")
        sys.exit(1)


def run(env, *args):
    return subprocess.run([sys.executable, SCRIPT, *args], env=env, capture_output=True, text=True)


def state(env):
    with open(os.path.join(env["SURVIVAL_KIOSK_STATE"], "input.json"), encoding="utf-8") as f:
        return json.load(f)["touchpadScroll"]


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmp:
        cfg = os.path.join(tmp, "config")
        rc = os.path.join(cfg, "labwc", "rc.xml")
        os.makedirs(os.path.dirname(rc))
        with open(rc, "w", encoding="utf-8") as f:
            f.write(PI_RC)
        env = {**os.environ, "XDG_CONFIG_HOME": cfg, "SURVIVAL_KIOSK_STATE": os.path.join(tmp, "state")}

        check(run(env, "status").returncode == 0, "status")
        check(state(env) == "traditional", "por defecto tradicional")

        check(run(env, "set", "natural").returncode == 0, "set natural")
        check(state(env) == "natural", "publicado natural")
        text = open(rc, encoding="utf-8").read()
        check('category="touchpad"' in text and "<naturalScroll>yes</naturalScroll>" in text, f"bloque libinput: {text}")
        check('deviceName="WaveShare WS170120"' in text and 'mapToOutput="HDMI-A-2"' in text, "conserva el táctil")
        check("ns0:" not in text and 'xmlns="http://openbox.org/3.4/rc"' in text, f"espacio de nombres: {text}")
        check(open(rc + ".bak-survival-input", encoding="utf-8").read() == PI_RC, "copia previa intacta")

        check(run(env, "set", "traditional").returncode == 0, "set traditional")
        text = open(rc, encoding="utf-8").read()
        check(state(env) == "traditional" and text.count("<naturalScroll>") == 1 and "<naturalScroll>no</naturalScroll>" in text, f"vuelta: {text}")
        check(text.count("<libinput>") == 1, "sin duplicar")

        before = open(rc, encoding="utf-8").read()
        for bad in (["set", "invertido"], ["borrar"], []):
            check(run(env, *bad).returncode == 2, f"debió rechazar {bad}")
        check(open(rc, encoding="utf-8").read() == before, "órdenes no válidas no tocan nada")
    print("TODO OK")
