#!/usr/bin/env python3
"""Survivelia OS — dirección del desplazamiento del trackpad en el quiosco (labwc + libinput).

    kiosk-input.py status                       # publica el estado actual
    kiosk-input.py set natural|traditional      # lo cambia y recarga labwc

Lo ejecuta el agente del quiosco (scripts/kiosk.sh) como usuario de escritorio, nunca root. Edita solo el bloque
<libinput><device category="touchpad"><naturalScroll> de ~/.config/labwc/rc.xml (copia previa en
rc.xml.bak-survival-input la primera vez), recarga labwc con SIGHUP (lo mismo que `labwc --reconfigure`) y publica
el estado leído del propio fichero en /run/survival-os/kiosk/input.json para la interfaz (que no puede leer $HOME).
Volver atrás: `kiosk-input.py set traditional` o restaurar la copia.
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

RC = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "labwc", "rc.xml")
STATE_DIR = os.environ.get("SURVIVAL_KIOSK_STATE", "/run/survival-os/kiosk")
NS = "http://openbox.org/3.4/rc"
MODES = {"natural": "yes", "traditional": "no"}


def q(tag, ns):
    return f"{{{ns}}}{tag}" if ns else tag


def load():
    """Árbol de rc.xml (o uno vacío) y su espacio de nombres."""
    if os.path.exists(RC):
        tree = ET.parse(RC)
        root = tree.getroot()
        ns = root.tag[1:].split("}")[0] if root.tag.startswith("{") else ""
        return tree, ns
    root = ET.Element(q("labwc_config", NS))
    return ET.ElementTree(root), NS


def touchpad_device(root, ns, create):
    lib = root.find(q("libinput", ns))
    if lib is None:
        if not create:
            return None
        lib = ET.SubElement(root, q("libinput", ns))
    for dev in lib.findall(q("device", ns)):
        if dev.get("category") == "touchpad":
            return dev
    return ET.SubElement(lib, q("device", ns), {"category": "touchpad"}) if create else None


def current():
    """natural | traditional según rc.xml (sin nada configurado, libinput usa el tradicional)."""
    try:
        tree, ns = load()
    except ET.ParseError:
        return None
    dev = touchpad_device(tree.getroot(), ns, create=False)
    node = dev.find(q("naturalScroll", ns)) if dev is not None else None
    return "natural" if node is not None and (node.text or "").strip().lower() in ("yes", "true", "1") else "traditional"


def publish():
    os.makedirs(STATE_DIR, exist_ok=True)
    path = os.path.join(STATE_DIR, "input.json")
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"touchpadScroll": current(), "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")}, f)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def set_mode(mode):
    tree, ns = load()
    if ns:
        ET.register_namespace("", ns)
    dev = touchpad_device(tree.getroot(), ns, create=True)
    node = dev.find(q("naturalScroll", ns))
    if node is None:
        node = ET.SubElement(dev, q("naturalScroll", ns))
    node.text = MODES[mode]
    os.makedirs(os.path.dirname(RC), exist_ok=True)
    backup = f"{RC}.bak-survival-input"
    if os.path.exists(RC) and not os.path.exists(backup):
        shutil.copy2(RC, backup)
    ET.indent(tree, space="\t")
    tmp = f"{RC}.{os.getpid()}.tmp"
    tree.write(tmp, encoding="unicode", xml_declaration=True)
    os.replace(tmp, RC)
    # Recargar labwc de esta sesión (SIGHUP = `labwc --reconfigure`).
    try:
        out = subprocess.run(["pgrep", "-u", str(os.getuid()), "-x", "labwc"], capture_output=True, text=True).stdout.split()
    except (OSError, AttributeError):  # sin pgrep, o sin os.getuid (Windows, solo en pruebas)
        out = []
    for pid in out:
        try:
            os.kill(int(pid), signal.SIGHUP)
        except (ProcessLookupError, ValueError, PermissionError):
            pass


def main(argv):
    if argv[:1] == ["status"]:
        publish()
        return 0
    if len(argv) == 2 and argv[0] == "set" and argv[1] in MODES:
        set_mode(argv[1])
        publish()
        return 0
    print(__doc__.strip().splitlines()[2], file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
