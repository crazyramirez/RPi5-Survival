"""Pruebas de las tareas `update-online` / `update-auto` de scripts/admin-job.py (ADR 0021) sin tocar el sistema.

Verifica:
  1. Solo se instala una descarga del directorio de root cuyo SHA-256 coincide con el del manifiesto firmado.
  2. Se instala con el install-system.sh de la release NUEVA (extraído del tarball), no con el instalado.
  3. Éxito y fallo quedan anotados en state.json (lastInstall) y la descarga se borra tras instalar.
  4. update-auto: con «notify» nunca instala; con «auto» solo en la ventana nocturna y con la bóveda cerrada;
     una versión que ya falló no se reintenta sola.
Uso: python tests/python/test_admin_job_update.py   (sale con código 0 si todo pasa)
"""
import hashlib
import importlib.util
import io
import json
import os
import sys
import tarfile
import tempfile
import time
import types

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if "fcntl" not in sys.modules:
    try:
        import fcntl  # noqa: F401
    except ImportError:  # Windows: candados simulados
        f = types.ModuleType("fcntl")
        f.LOCK_EX, f.LOCK_NB = 2, 4
        f.flock = lambda *_a: None
        sys.modules["fcntl"] = f


def load(tmp):
    spec = importlib.util.spec_from_file_location("admin_job_upd", os.path.join(ROOT, "scripts", "admin-job.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.ADMIN = os.path.join(tmp, "admin")
    m.JOB = "update-online"
    m.UPDATE_DIR = os.path.join(tmp, "upd")
    m.UPDATE_SETTINGS = os.path.join(tmp, "update-settings.json")
    m.VAULT_MAPPER = os.path.join(tmp, "mapper-survival-vault")
    os.makedirs(m.ADMIN, exist_ok=True)
    os.makedirs(os.path.join(m.UPDATE_DIR, "downloads"), exist_ok=True)
    return m


def make_release(m, version, installer=b"#!/bin/bash\necho nuevo\n"):
    name = f"survival-os-{version}.tar.gz"
    path = os.path.join(m.UPDATE_DIR, "downloads", name)
    with tarfile.open(path, "w:gz") as t:
        for rel, data in ((f"survival-os-{version}/VERSION", f"{version}\n".encode()), (f"survival-os-{version}/scripts/install-system.sh", installer)):
            info = tarfile.TarInfo(rel)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    with open(path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    return path, sha, name


def write_state(m, st):
    with open(os.path.join(m.UPDATE_DIR, "state.json"), "w", encoding="utf-8") as f:
        json.dump(st, f)


def check(cond, msg):
    if not cond:
        print("FALLO:", msg)
        sys.exit(1)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        m = load(tmp)
        calls = []
        seen_installer = []

        def fake_run(args, check=True, redact=()):
            calls.append(list(args))
            if args[0] == "bash":
                with open(args[1], "rb") as f:
                    seen_installer.append(f.read())
                if os.environ.get("_FAIL_INSTALL") == "1":
                    raise m.JobError("falló (código 1)")
            return 0
        m.run = fake_run

        # 1-3. Instalación correcta con el instalador de la release nueva.
        path, sha, name = make_release(m, "1.2.3", b"#!/bin/bash\necho instalador-1.2.3\n")
        write_state(m, {"status": "available", "latest": {"version": "1.2.3"}, "download": {"version": "1.2.3", "name": name, "sha256": sha}})
        m.install_downloaded(m.update_state())
        bash = [c for c in calls if c[0] == "bash"]
        check(len(bash) == 1 and bash[0][2] == path, f"debe ejecutar bash <instalador> <tarball>: {bash}")
        check(seen_installer == [b"#!/bin/bash\necho instalador-1.2.3\n"], "debe usar el install-system.sh de la release nueva")
        check(not os.path.exists(bash[0][1]), "el instalador temporal debe borrarse")
        st = m.update_state()
        check(st["lastInstall"]["ok"] is True and st["installed"] == "1.2.3" and st["download"] is None, f"estado tras instalar: {st}")
        check(st["status"] == "up-to-date", "tras instalar ya no hay nada disponible")
        check(os.listdir(os.path.join(m.UPDATE_DIR, "downloads")) == [], "la descarga se borra tras instalar")

        # 1. Hash que no coincide, nombre raro o ruta fuera: nunca se instala.
        calls.clear()
        path, sha, name = make_release(m, "1.2.4")
        for bad in ({"version": "1.2.4", "name": name, "sha256": "0" * 64},
                    {"version": "1.2.4", "name": "../../etc/passwd", "sha256": sha},
                    {"version": "9.9.9", "name": name, "sha256": sha},
                    {}):
            try:
                m.install_downloaded({"download": bad})
                check(False, f"debió rechazar {bad}")
            except m.JobError:
                pass
        check(not [c for c in calls if c[0] == "bash"], "nada rechazado llega a ejecutarse")

        # Tarball sin instalador: error claro, sin ejecutar nada.
        bogus = os.path.join(m.UPDATE_DIR, "downloads", "survival-os-1.2.5.tar.gz")
        with tarfile.open(bogus, "w:gz") as t:
            info = tarfile.TarInfo("survival-os-1.2.5/VERSION")
            info.size = 6
            t.addfile(info, io.BytesIO(b"1.2.5\n"))
        with open(bogus, "rb") as f:
            bsha = hashlib.sha256(f.read()).hexdigest()
        try:
            m.install_downloaded({"download": {"version": "1.2.5", "name": "survival-os-1.2.5.tar.gz", "sha256": bsha}})
            check(False, "debió fallar sin install-system.sh")
        except m.JobError as e:
            check("install-system.sh" in str(e), str(e))
        check(m.update_state()["lastInstall"]["ok"] is False, "el fallo queda anotado")

        # 4. update-auto.
        m.JOB = "update-auto"
        m.update_engine = lambda *a, **k: 0
        path, sha, name = make_release(m, "2.0.0")
        base_state = {"status": "available", "latest": {"version": "2.0.0"}, "download": {"version": "2.0.0", "name": name, "sha256": sha}}
        night = time.struct_time((2026, 11, 16, 3, 0, 0, 0, 320, -1))
        day = time.struct_time((2026, 11, 16, 14, 0, 0, 0, 320, -1))

        calls.clear()
        write_state(m, dict(base_state))
        m.job_update_auto({})  # sin ajustes → «notify» en la Pi
        check(not [c for c in calls if c[0] == "bash"], "con «notify» nunca instala")

        with open(m.UPDATE_SETTINGS, "w") as f:
            json.dump({"mode": "auto"}, f)
        real_localtime = time.localtime
        try:
            time.localtime = lambda *a: day
            write_state(m, dict(base_state))
            m.job_update_auto({})
            check(not [c for c in calls if c[0] == "bash"], "de día no instala")
            check(m.update_state()["deferred"]["reason"] == "window", "aplazada por la ventana")

            time.localtime = lambda *a: night
            open(m.VAULT_MAPPER, "w").close()
            m.job_update_auto({})
            check(not [c for c in calls if c[0] == "bash"], "con la bóveda abierta no instala")
            check(m.update_state()["deferred"]["reason"] == "vault", "aplazada por la bóveda")
            os.remove(m.VAULT_MAPPER)

            st = dict(base_state)
            st["lastInstall"] = {"version": "2.0.0", "ok": False}
            write_state(m, st)
            m.job_update_auto({})
            check(not [c for c in calls if c[0] == "bash"], "una versión que falló no se reintenta sola")

            write_state(m, dict(base_state))
            m.job_update_auto({})
            check(len([c for c in calls if c[0] == "bash"]) == 1, "de noche, bóveda cerrada y modo auto: instala")
        finally:
            time.localtime = real_localtime

        # update-online: acción desconocida.
        try:
            m.job_update_online({"action": "rm"})
            check(False, "acción no válida")
        except m.JobError:
            pass
    print("TODO OK")


if __name__ == "__main__":
    main()
