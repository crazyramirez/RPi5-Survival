"""Pruebas de la tarea `ap` de scripts/admin-job.py sin tocar el sistema (todo simulado en un directorio temporal).

Verifica (revisión de rpi5-survival-81, 2026-11-09):
  1. La contraseña del AP NUNCA aparece en el registro de la tarea ni en ningún argv de los comandos.
  2. El perfil de NetworkManager se escribe como keyfile 0600 con la clave (no por nmcli … wifi-sec.psk).
  3. Cualquier excepción al encender (también OSError) revierte el AP y el cortafuegos.
Uso: python tests/python/test_admin_job_ap.py   (sale con código 0 si todo pasa)
"""
import importlib.util
import json
import os
import stat
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.modules.setdefault("fcntl", types.ModuleType("fcntl"))  # Windows no tiene fcntl; aquí no se usa


def load(tmp):
    spec = importlib.util.spec_from_file_location("admin_job", os.path.join(ROOT, "scripts", "admin-job.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.ADMIN = tmp
    m.JOB = "ap"
    m.DATA = tmp
    m.AP_ENV = os.path.join(tmp, "ap.env")
    m.AP_PREV = os.path.join(tmp, "ap-prev")
    m.AP_DNS = os.path.join(tmp, "dnsmasq-shared.d", "survival-ap.conf")
    m.AP_KEYFILE = os.path.join(tmp, "system-connections", "survival-ap.nmconnection")
    m.NFT = os.path.join(tmp, "nft")
    open(m.NFT, "w").close()  # «existe nft»
    calls = []
    state = {"active": False}

    def fake_run(args, check=True, redact=()):
        calls.append(list(args))
        line = " ".join(args)
        for s in redact:
            line = line.replace(s, "***")
        m.log("$ " + line)
        if args[:4] == ["nmcli", "con", "up", "survival-ap"]:
            state["active"] = True
        if args[:3] == ["nmcli", "con", "down"]:
            state["active"] = False
        return 0

    def fake_capture(args):
        calls.append(list(args))
        if args[:2] == ["nmcli", "-t"] and "--active" in args:
            return ("survival-ap:802-11-wireless\n" if state["active"] else "CasaWifi:802-11-wireless\n")
        return ""

    m.run = fake_run
    m.capture = fake_capture
    m.ap_active = lambda: state["active"]
    m.subprocess.run = lambda *a, **k: types.SimpleNamespace(returncode=1, stdout="")
    return m, calls, state


def check(cond, msg):
    if not cond:
        print("FALLO:", msg)
        sys.exit(1)
    print("ok  ", msg)


def main():
    # 1 y 2: encender sin fugas
    with tempfile.TemporaryDirectory() as tmp:
        m, calls, state = load(tmp)
        open(os.path.join(tmp, "ap.log"), "w").close()
        m.job_ap({"action": "on"})
        psk = m.ap_config()["AP_PSK"]
        log = open(os.path.join(tmp, "ap.log"), encoding="utf-8").read()
        check(state["active"], "el AP queda encendido")
        check(psk not in log, "la contraseña no aparece en el registro de la tarea")
        check(all(psk not in " ".join(c) for c in calls), "la contraseña no aparece en ningún argv")
        check(not any("wifi-sec.psk" in c for c in calls), "no se usa nmcli … wifi-sec.psk")
        kf = open(m.AP_KEYFILE, encoding="utf-8").read()
        check(f"psk={psk}" in kf and "key-mgmt=wpa-psk" in kf and "pairwise=ccmp" in kf, "keyfile con la clave y WPA2-CCMP")
        check("autoconnect=false" in kf, "el perfil nunca se enciende solo")
        if os.name == "posix":
            check(stat.S_IMODE(os.stat(m.AP_KEYFILE).st_mode) == 0o600, "keyfile en 0600")
        result = json.load(open(os.path.join(tmp, "ap.result.json"), encoding="utf-8"))
        check(result["active"] is True and result["password"] == psk, "el resultado para la pantalla trae SSID y contraseña")
        # 2b: contraseña nueva con el AP encendido → tampoco se filtra
        m.job_ap({"action": "password"})
        psk2 = m.ap_config()["AP_PSK"]
        log = open(os.path.join(tmp, "ap.log"), encoding="utf-8").read()
        check(psk2 != psk and psk2 not in log and all(psk2 not in " ".join(c) for c in calls), "la contraseña nueva tampoco se filtra")

    # 3: un fallo inesperado (OSError) revierte todo
    with tempfile.TemporaryDirectory() as tmp:
        m, calls, state = load(tmp)
        open(os.path.join(tmp, "ap.log"), "w").close()
        original = m.ap_firewall_up

        def boom():
            original()
            raise OSError("fallo simulado")

        m.ap_firewall_up = boom
        try:
            m.job_ap({"action": "on"})
            check(False, "debía fallar")
        except OSError:
            pass
        check(not state["active"], "tras el fallo el AP no queda encendido")
        check(any(c[-3:] == ["inet", m.NFT_TABLE] or (len(c) > 2 and c[1:3] == ["delete", "table"]) for c in calls), "el cortafuegos se retira")
        check(not os.path.exists(m.AP_DNS), "se retira la configuración DNS del portal")
        check(any(c[:3] == ["nmcli", "con", "up"] and c[3] == "CasaWifi" for c in calls), "se vuelve a la red de casa")
    print("TODO OK")


if __name__ == "__main__":
    main()
