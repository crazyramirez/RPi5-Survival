"""Pruebas de la tarea `bluetooth` (scripts/admin-job.py) y del motor scripts/bt-input.py, sin tocar el sistema.

Verifica:
  1. admin-job.py solo acepta las acciones conocidas y una MAC en mayúsculas; los argumentos van como lista fija
     (nunca shell) y el resultado anterior se borra antes de lanzar el motor.
  2. bt-input.py clasifica teclados, ratones y mandos por Icon, Appearance (BLE) y Class (clásico).
  3. bt-input.py rechaza acciones y direcciones no válidas antes de tocar D-Bus.
Uso: python tests/python/test_bluetooth.py   (sale con código 0 si todo pasa)
"""
import importlib.util
import os
import subprocess
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.modules.setdefault("fcntl", types.ModuleType("fcntl"))  # Windows no tiene fcntl; aquí no se usa


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, "scripts", file))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def check(cond, msg):
    if not cond:
        print(f"FALLO: {msg}")
        sys.exit(1)


def test_admin_job(tmp):
    m = load("admin_job", "admin-job.py")
    m.ADMIN = tmp
    m.JOB = "bluetooth"
    calls = []
    m.run = lambda args, check=True, redact=(): calls.append(list(args)) or 0
    result = f"{tmp}/bluetooth.result.json"  # mismo formato que admin-job.py

    open(result, "w").close()
    m.job_bluetooth({"action": "pair", "mac": "AA:BB:CC:DD:EE:0F"})
    check(not os.path.exists(result), "el resultado anterior debe borrarse antes de lanzar")
    check(calls[-1][:4] == ["/usr/bin/python3", "-I", f"{m.SCRIPTS}/bt-input.py", "pair"], f"argumentos: {calls[-1]}")
    check(calls[-1][4:] == ["AA:BB:CC:DD:EE:0F", "--result", result], f"argumentos: {calls[-1]}")

    m.job_bluetooth({"action": "scan", "mac": "ignorada"})
    check(calls[-1][3:] == ["scan", "--result", result], "scan no lleva MAC")

    for bad in ({"action": "rm -rf"}, {"action": "pair"}, {"action": "pair", "mac": "aa:bb:cc:dd:ee:ff"},
                {"action": "remove", "mac": "AA:BB:CC:DD:EE:FF; reboot"}, {"action": "connect", "mac": ["AA:BB:CC:DD:EE:FF"]}):
        n = len(calls)
        try:
            m.job_bluetooth(bad)
            check(False, f"debió rechazar {bad}")
        except m.JobError:
            pass
        check(len(calls) == n, f"no debe ejecutar nada con {bad}")
    check(m.LOCK_GROUPS.get("bluetooth") == "bluetooth", "grupo de bloqueo propio")
    check(m.JOBS.get("bluetooth") is m.job_bluetooth, "tarea registrada")


def test_kinds():
    bt = load("bt_input", "bt-input.py")
    k = bt.kind_of
    check(k({"Icon": "input-keyboard"}) == "keyboard", "Icon teclado")
    check(k({"Icon": "input-mouse"}) == "pointer", "Icon ratón")
    check(k({"Icon": "input-gaming"}) == "gamepad", "Icon mando")
    check(k({"Appearance": 0x03C1}) == "keyboard", "BLE teclado")
    check(k({"Appearance": 0x03C2}) == "pointer", "BLE ratón")
    check(k({"Class": 0x002540}) == "keyboard", "clásico teclado (0x2540)")
    check(k({"Class": 0x0005C0}) == "keyboard", "clásico teclado + puntero")
    check(k({"Class": 0x002580}) == "pointer", "clásico ratón")
    check(k({"Class": 0x240404}) == "other", "auriculares")
    check(k({"Icon": "audio-headset"}) == "other", "Icon audio")
    check(k({}) == "other", "sin datos")


def test_cli(tmp):
    script = os.path.join(ROOT, "scripts", "bt-input.py")
    out = os.path.join(tmp, "r.json")
    for args in (["borrar", "--result", out], ["pair", "aa:bb", "--result", out], ["scan"]):
        p = subprocess.run([sys.executable, script, *args], capture_output=True, text=True)
        check(p.returncode != 0, f"debió fallar: {args}")
        check(not os.path.exists(out), f"no debe escribir nada con {args}")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmp:
        test_admin_job(tmp)
        test_kinds()
        test_cli(tmp)
    print("TODO OK")
