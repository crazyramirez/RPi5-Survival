#!/usr/bin/env python3
"""Survival OS — tareas de administración lanzadas desde la interfaz.

Lo ejecuta systemd como root: `survival-admin@<tarea>.service` → admin-job.py <tarea>.
El usuario de servicio `survival` solo puede ARRANCAR estas unidades (regla polkit); los parámetros
llegan en /run/survival-os/admin/<tarea>.json (escrito por la web) y aquí se validan de forma estricta.
Registro legible por la UI en /run/survival-os/admin/<tarea>.log; resultado opcional en <tarea>.result.json.

Nunca se ejecuta un shell con datos del usuario: solo listas de argumentos fijas.
"""
import fcntl
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
import uuid as uuidlib

ADMIN = "/run/survival-os/admin"
APP = "/opt/survival-os/current"
SCRIPTS = f"{APP}/scripts"
DATA = "/var/lib/survival-os"
MEDIA = "/media"
# Tareas que no deben solaparse comparten grupo de bloqueo; grupos distintos pueden ir en paralelo
# (p. ej. instalar el asistente mientras se descarga la Wikipedia).
LOCK_GROUPS = {
    "content-fetch": "content", "content-delete": "content",
    "maps-import": "maps", "maps-delete": "maps",
    "docs-import": "docs",
    "backup": "system", "update": "system", "gps-uart": "system",
    "llm": "llm",
    "ap": "network", "wifi": "network",
    "routing": "routing",
    "mesh": "mesh",
}
SERIAL_BYID_RE = re.compile(r"^/dev/serial/by-id/[A-Za-z0-9_.:+-]{1,200}$")
LLM_MODELS = {"qwen3-4b", "gemma3-4b", "llama3.2-3b"}
PRESETS = {"basico", "recomendado", "completo"}
DOC_EXT = {".md", ".markdown", ".txt", ".html", ".htm", ".pdf"}
MEDIA_RE = re.compile(r"^[\w.-]{1,64}/[^/\x00]{1,128}$")
ZIM_RE = re.compile(r"^[a-z0-9_]+_\d{4}-\d{2}\.zim$")
MAP_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}\.pmtiles$")
RELEASE_RE = re.compile(r"^survival-os-\d+\.\d+\.\d+\.tar\.gz$")


class JobError(Exception):
    pass


def log(msg):
    with open(f"{ADMIN}/{JOB}.log", "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {msg}\n")


def run(args, check=True, redact=()):
    """Ejecuta sin shell; vuelca la salida al registro de la tarea. `redact`: valores que nunca se registran."""
    line = " ".join(os.path.basename(a) if i == 0 else a for i, a in enumerate(args))
    for secret in redact:
        if secret:
            line = line.replace(secret, "***")
    log("$ " + line)
    with open(f"{ADMIN}/{JOB}.log", "a", encoding="utf-8") as out:
        p = subprocess.run(args, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
    if check and p.returncode != 0:
        raise JobError(f"falló (código {p.returncode})")
    return p.returncode


def media_path(media, rel=""):
    """Ruta dentro de /media/<usuario>/<etiqueta> sin escapar por enlaces ni '..'."""
    if not isinstance(media, str) or not MEDIA_RE.match(media) or ".." in media.split("/"):
        raise JobError("medio no válido")
    root = os.path.realpath(os.path.join(MEDIA, media))
    if not root.startswith(MEDIA + "/") or not os.path.ismount(root):
        raise JobError("el medio no está montado")
    if rel:
        if not isinstance(rel, str) or rel.startswith("/") or "\x00" in rel or ".." in rel.split("/"):
            raise JobError("ruta no válida")
        full = os.path.realpath(os.path.join(root, rel))
        if os.path.commonpath([root, full]) != root:
            raise JobError("ruta fuera del medio")
        return full
    return root


def mounted_media():
    out = []
    for user in sorted(os.listdir(MEDIA)) if os.path.isdir(MEDIA) else []:
        base = os.path.join(MEDIA, user)
        if not os.path.isdir(base):
            continue
        for label in sorted(os.listdir(base)):
            p = os.path.join(base, label)
            if os.path.ismount(p):
                st = os.statvfs(p)
                out.append({"media": f"{user}/{label}", "freeBytes": st.f_bavail * st.f_frsize})
    return out


def classify(name):
    low = name.lower()
    if low.endswith(".pmtiles"):
        return "map"
    if RELEASE_RE.match(name):
        return "release"
    if os.path.splitext(low)[1] in DOC_EXT:
        return "doc"
    return None


# ------------------------------------------------------------------ tareas

def job_usb_scan(p):
    media = mounted_media()
    files = []
    for m in media:
        root = os.path.join(MEDIA, m["media"])
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            depth = dirpath[len(root):].count("/")
            dirnames[:] = [d for d in dirnames if not d.startswith(".") and depth < 4]
            for fn in filenames:
                kind = classify(fn)
                if not kind or fn.startswith("."):
                    continue
                full = os.path.join(dirpath, fn)
                if os.path.islink(full):
                    continue
                files.append({"media": m["media"], "path": os.path.relpath(full, root), "sizeBytes": os.path.getsize(full), "kind": kind})
                if len(files) >= 1000:
                    break
    result = {"media": media, "files": files, "scannedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    with open(f"{ADMIN}/{JOB}.result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    log(f"{len(media)} medio(s), {len(files)} fichero(s) utilizables")


def job_maps_import(p):
    src = media_path(p.get("media"), p.get("path"))
    if not MAP_RE.match(os.path.basename(src)) or not os.path.isfile(src):
        raise JobError("no es un fichero .pmtiles válido")
    run([f"{SCRIPTS}/maps-install.sh", src])


def job_maps_delete(p):
    name = p.get("file")
    if not isinstance(name, str) or not MAP_RE.match(name):
        raise JobError("nombre de mapa no válido")
    path = os.path.join(DATA, "maps", name)
    if not os.path.isfile(path):
        raise JobError("mapa no encontrado")
    os.remove(path)
    sums = os.path.join(DATA, "maps", "SHA256SUMS")
    if os.path.exists(sums):
        with open(sums) as f:
            keep = [l for l in f if not l.rstrip().endswith("  " + name)]
        with open(sums, "w") as f:
            f.writelines(keep)
    log(f"Borrado {name}")


def job_docs_import(p):
    items = p.get("items")
    if not isinstance(items, list) or not 0 < len(items) <= 200:
        raise JobError("lista de documentos no válida")
    dest = os.path.join(DATA, "library", "docs", "importados-" + time.strftime("%Y%m%d"))
    os.makedirs(dest, exist_ok=True)
    n = 0
    for it in items:
        src = media_path(it.get("media"), it.get("path"))
        if classify(os.path.basename(src)) != "doc" or not os.path.isfile(src):
            log(f"Omitido (tipo no admitido): {os.path.basename(src)}")
            continue
        if os.path.getsize(src) > 50 * 1024 * 1024:
            log(f"Omitido (> 50 MB): {os.path.basename(src)}")
            continue
        shutil.copyfile(src, os.path.join(dest, os.path.basename(src)))
        n += 1
    run(["chown", "-R", "survival:survival", os.path.join(DATA, "library", "docs")])
    log(f"Importados {n} documento(s) en {dest}. Pulsa «Reindexar» en Biblioteca.")


def job_content_fetch(p):
    preset = p.get("preset")
    if preset not in PRESETS:
        raise JobError("paquete de contenidos no válido")
    run([f"{SCRIPTS}/content-fetch.sh", preset])


def job_content_delete(p):
    name = p.get("file")
    if not isinstance(name, str) or not ZIM_RE.match(name):
        raise JobError("nombre de ZIM no válido")
    zim = os.path.join(DATA, "library", "zim", name)
    if not os.path.isfile(zim):
        raise JobError("ZIM no encontrado")
    lib = os.path.join(DATA, "library", "zim", "library.xml")
    show = subprocess.run(["sudo", "-u", "survival", "/opt/survival-os/runtime/kiwix-tools/kiwix-manage", lib, "show"], capture_output=True, text=True).stdout
    book_id = None
    cur = None
    for line in show.splitlines():
        m = re.match(r"\s*id:\s*(\S+)", line)
        if m:
            cur = m.group(1)
        if zim in line and cur:
            book_id = cur
            break
    if book_id:
        run(["sudo", "-u", "survival", "/opt/survival-os/runtime/kiwix-tools/kiwix-manage", lib, "remove", book_id])
    os.remove(zim)
    man = os.path.join(DATA, "library", "manifest.json")
    if os.path.exists(man):
        with open(man) as f:
            m = json.load(f)
        m["entries"] = [e for e in m.get("entries", []) if e.get("path") != f"zim/{name}"]
        with open(man + ".tmp", "w") as f:
            json.dump(m, f, ensure_ascii=False, indent=2)
        os.replace(man + ".tmp", man)
    log(f"Borrado {name}")


def job_backup(p):
    dest = media_path(p.get("media"))
    args = [f"{SCRIPTS}/backup.sh", dest]
    if p.get("withMaps") is True:
        args.append("--with-maps")
    if p.get("withZim") is True:
        args.append("--with-zim")
    run(args)


def job_update(p):
    src = media_path(p.get("media"), p.get("path"))
    if not RELEASE_RE.match(os.path.basename(src)) or not os.path.isfile(src):
        raise JobError("no es una release de Survival OS")
    if not os.path.isfile(src + ".sha256"):
        raise JobError("falta el fichero .sha256 junto a la release")
    run(["bash", f"{SCRIPTS}/install-system.sh", src])


def job_gps_uart(p):
    action = p.get("action")
    if action == "disable":
        run([f"{SCRIPTS}/gps-uart-setup.sh", "--undo"])
        return
    if action != "enable":
        raise JobError("acción no válida")
    baud = p.get("baud", 9600)
    if baud not in (4800, 9600, 19200, 38400, 57600, 115200):
        raise JobError("baudios no válidos")
    args = [f"{SCRIPTS}/gps-uart-setup.sh", "--baud", str(baud)]
    pps = p.get("pps")
    if pps is not None:
        if not isinstance(pps, int) or not 2 <= pps <= 27:
            raise JobError("GPIO PPS no válido")
        args += ["--pps", str(pps)]
    run(args)
    log("Reinicia el equipo para activar la UART.")


def job_set_time(p):
    iso = p.get("iso")
    if not isinstance(iso, str) or not re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$", iso):
        raise JobError("fecha no válida (AAAA-MM-DD HH:MM)")
    # Con NTP activo systemd rechaza set-time: se desactiva, se ajusta y se reactiva (corregirá cuando haya red).
    run(["timedatectl", "set-ntp", "false"])
    try:
        run(["timedatectl", "set-time", iso])
    finally:
        run(["timedatectl", "set-ntp", "true"], check=False)
    run(["fake-hwclock", "save"], check=False)


def job_time_sync(p):
    """Comprobar la hora ya (ADR 0011): la misma unidad que el temporizador, con su aislamiento."""
    run(["systemctl", "start", "survival-timesync.service"])
    try:
        with open("/run/survival-os/timesync.json", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        raise JobError("la comprobación no dejó resultado")
    write_result(data)
    log(f"Fuente: {data.get('source') or 'ninguna'}")


def job_llm(p):
    action = p.get("action")
    model = p.get("model")
    if action == "disable":
        run([f"{SCRIPTS}/llm-install.sh", "--disable"])
        return
    if model not in LLM_MODELS:
        raise JobError("modelo no válido")
    if action == "install":
        run([f"{SCRIPTS}/llm-install.sh", model])
    elif action == "remove":
        run([f"{SCRIPTS}/llm-install.sh", "--remove", model])
    else:
        raise JobError("acción no válida")


def job_restart_app(p):
    # La web se reinicia la última: esta tarea sigue viva porque la ejecuta systemd, no la web.
    units = ["survival-device-api", "survival-library", "survival-kiwix", "survival-navigation", "survival-esp32-gateway", "survival-web"]
    run(["systemctl", "restart"] + [u + ".service" for u in units], check=False)
    run(["systemctl", "try-restart", "survival-mesh.service"], check=False)
    # Chromium del kiosco: kiosk.sh lo relanza con la página de arranque, que espera a /api/health.
    run(["pkill", "-f", "class=survival-kiosk"], check=False)
    log("Aplicación reiniciada")


def job_wifi(p):
    state = p.get("state")
    if state not in ("on", "off"):
        raise JobError("estado no válido")
    run(["nmcli", "radio", "wifi", state])


# ------------------------------------------------------------------ punto de acceso (ADR 0009)
AP_CON = "survival-ap"
AP_IFACE = "wlan0"
AP_IP = "10.42.0.1"
AP_ENV = "/etc/survival-os/ap.env"
AP_PREV = f"{DATA}/ap-prev-connection"
AP_DNS = "/etc/NetworkManager/dnsmasq-shared.d/survival-ap.conf"
NFT = "/usr/sbin/nft"
NFT_TABLE = "survival_ap"
AP_KEYFILE = f"/etc/NetworkManager/system-connections/{AP_CON}.nmconnection"
SSID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,32}$")
PSK_RE = re.compile(r"^[a-z2-9]{12}$")
PSK_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # sin 0/o/1/l/i: se dicta y se teclea sin errores


def capture(args):
    """Salida de un comando fijo (sin shell); cadena vacía si falla."""
    try:
        return subprocess.run(args, capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def new_psk():
    return "".join(secrets.choice(PSK_ALPHABET) for _ in range(12))


def ap_config(regenerate_psk=False):
    """SSID y contraseña del AP en /etc/survival-os/ap.env (0600 root). Se generan la primera vez."""
    cfg = {}
    if os.path.exists(AP_ENV):
        with open(AP_ENV, encoding="utf-8") as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                if k in ("AP_SSID", "AP_PSK"):
                    cfg[k] = v
    changed = False
    if not SSID_RE.match(cfg.get("AP_SSID", "")):
        cfg["AP_SSID"] = "SurvivalOS-" + secrets.token_hex(2).upper()
        changed = True
    if regenerate_psk or not PSK_RE.match(cfg.get("AP_PSK", "")):
        cfg["AP_PSK"] = new_psk()
        changed = True
    if changed:
        fd = os.open(AP_ENV, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(f"AP_SSID={cfg['AP_SSID']}\nAP_PSK={cfg['AP_PSK']}\n")
        log("Credenciales del punto de acceso generadas")
    return cfg


def ap_keyfile(cfg):
    """Escribe el perfil de NetworkManager del AP (0600 root) y lo carga. WPA2-CCMP únicamente."""
    uuid = None
    if os.path.exists(AP_KEYFILE):
        with open(AP_KEYFILE, encoding="utf-8") as f:
            m = re.search(r"^uuid=([0-9a-f-]{36})$", f.read(), re.M)
            uuid = m.group(1) if m else None
    if not uuid:
        uuid = str(uuidlib.uuid4())
    body = (
        "[connection]\n"
        f"id={AP_CON}\nuuid={uuid}\ntype=wifi\ninterface-name={AP_IFACE}\n"
        "autoconnect=false\n\n"  # nunca se enciende solo: tras reiniciar vuelve la red de casa
        "[wifi]\nmode=ap\nband=bg\n"
        f"ssid={cfg['AP_SSID']}\n\n"
        "[wifi-security]\nkey-mgmt=wpa-psk\nproto=rsn\npairwise=ccmp\ngroup=ccmp\n"
        f"psk={cfg['AP_PSK']}\n\n"
        f"[ipv4]\nmethod=shared\naddress1={AP_IP}/24\n\n"
        "[ipv6]\nmethod=disabled\n"
    )
    os.makedirs(os.path.dirname(AP_KEYFILE), exist_ok=True)
    tmp = AP_KEYFILE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(body)
    os.replace(tmp, AP_KEYFILE)
    run(["nmcli", "con", "load", AP_KEYFILE])


def ap_active():
    return AP_CON in capture(["nmcli", "-t", "-f", "NAME", "con", "show", "--active"]).splitlines()


def ap_status():
    cfg = ap_config() if os.path.exists(AP_ENV) else {}
    active = ap_active()
    clients = None
    if active:
        clients = capture(["iw", "dev", AP_IFACE, "station", "dump"]).count("Station ")
    firewall = subprocess.run([NFT, "list", "table", "inet", NFT_TABLE], capture_output=True).returncode == 0 if os.path.exists(NFT) else False
    gateway = capture(["systemctl", "is-active", "survival-public.service"]).strip() == "active"
    return {
        "active": active,
        "ssid": cfg.get("AP_SSID"),
        "password": cfg.get("AP_PSK"),
        "url": f"http://{AP_IP}/",
        "clients": clients,
        "firewall": firewall,
        "gateway": gateway,
    }


def write_result(data):
    with open(f"{ADMIN}/{JOB}.result.json", "w", encoding="utf-8") as f:
        json.dump(data, f)


def ap_firewall_up():
    """Sin salida a Internet ni acceso a otros servicios desde el AP: solo DHCP, DNS y la vista pública.
    Se carga como fichero (`nft -f`): atómico y sin ambigüedades de argumentos."""
    run([NFT, "delete", "table", "inet", NFT_TABLE], check=False)
    ruleset = f"""table inet {NFT_TABLE} {{
  chain forward {{
    type filter hook forward priority -10; policy accept;
    iifname "{AP_IFACE}" drop
    oifname "{AP_IFACE}" drop
  }}
  chain input {{
    type filter hook input priority -10; policy accept;
    iifname "{AP_IFACE}" ct state established,related accept
    iifname "{AP_IFACE}" udp dport {{ 53, 67 }} accept
    iifname "{AP_IFACE}" tcp dport {{ 53, 80 }} accept
    iifname "{AP_IFACE}" drop
  }}
}}
"""
    path = f"{ADMIN}/ap.nft"
    with open(path, "w", encoding="utf-8") as f:
        f.write(ruleset)
    run([NFT, "-f", path])


def ap_off_steps():
    run(["systemctl", "stop", "survival-public.service"], check=False)
    if ap_active():
        run(["nmcli", "con", "down", AP_CON], check=False)
    if os.path.exists(NFT):
        run([NFT, "delete", "table", "inet", NFT_TABLE], check=False)
    if os.path.exists(AP_DNS):
        os.remove(AP_DNS)
    # Volver a la red de casa (devuelve el SSH/VNC por Wi-Fi).
    prev = ""
    if os.path.exists(AP_PREV):
        with open(AP_PREV, encoding="utf-8") as f:
            prev = f.read().strip()
    if prev and prev != AP_CON:
        run(["nmcli", "con", "up", prev], check=False)


def job_ap(p):
    action = p.get("action")
    if action not in ("on", "off", "status", "password"):
        raise JobError("acción no válida")
    if action == "status":
        write_result(ap_status())
        return
    if action == "off":
        ap_off_steps()
        log("Punto de acceso apagado")
        write_result(ap_status())
        return
    if not os.path.exists(NFT):
        raise JobError("falta nftables (/usr/sbin/nft): sin cortafuegos no se enciende el punto de acceso")
    cfg = ap_config(regenerate_psk=(action == "password"))
    if action == "password" and not ap_active():
        if os.path.exists(AP_KEYFILE):
            ap_keyfile(cfg)
        log("Contraseña nueva guardada (se usará al encender)")
        write_result(ap_status())
        return
    # Conexión Wi-Fi actual para restaurarla al apagar.
    if not ap_active():
        for line in capture(["nmcli", "-t", "-f", "NAME,TYPE", "con", "show", "--active"]).splitlines():
            name, _, kind = line.rpartition(":")
            if kind == "802-11-wireless" and name and name != AP_CON:
                with open(AP_PREV, "w", encoding="utf-8") as f:
                    f.write(name)
                break
    try:
        run(["nmcli", "radio", "wifi", "on"])
        os.makedirs(os.path.dirname(AP_DNS), exist_ok=True)
        with open(AP_DNS, "w", encoding="utf-8") as f:
            # Portal cautivo: cualquier nombre resuelve al equipo → la pasarela muestra Survival OS.
            f.write(f"address=/#/{AP_IP}\n")
        ap_keyfile(cfg)
        ap_firewall_up()  # antes de levantar la red: nunca hay AP sin cortafuegos
        run(["nmcli", "con", "up", AP_CON])
        run(["systemctl", "start", "survival-public.service"])
    except Exception:
        # Cualquier fallo (también OSError o errores inesperados): nada a medias.
        log("Fallo al encender: se revierte todo")
        ap_off_steps()
        raise
    log(f"Punto de acceso encendido: {cfg['AP_SSID']} → http://{AP_IP}/")
    write_result(ap_status())



def job_mesh(p):
    """Pasarela Meshtastic: listar puertos serie, instalar/cambiar puerto o quitar (scripts/mesh-install.sh)."""
    action = p.get("action")
    if action == "scan":
        ports = []
        base = "/dev/serial/by-id"
        for name in sorted(os.listdir(base)) if os.path.isdir(base) else []:
            path = f"{base}/{name}"
            if SERIAL_BYID_RE.match(path):
                ports.append({"path": path, "device": os.path.realpath(path)})
        env = {}
        if os.path.exists("/etc/survival-os/mesh.env"):
            with open("/etc/survival-os/mesh.env", encoding="utf-8") as f:
                for line in f:
                    k, _, v = line.strip().partition("=")
                    env[k] = v
        write_result({
            "ports": ports,
            "configured": env.get("MESH_SERIAL") or None,
            "installed": os.path.exists("/opt/survival-os/runtime/mesh-venv/bin/python"),
        })
        log(f"{len(ports)} puerto(s) serie encontrados")
        return
    if action == "remove":
        run([f"{SCRIPTS}/mesh-install.sh", "remove"])
        return
    port = p.get("port")
    if action not in ("install", "port") or not isinstance(port, str) or not SERIAL_BYID_RE.match(port):
        raise JobError("acción o puerto no válidos")
    if not os.path.exists(port):
        raise JobError("el puerto no existe ahora mismo: ¿está el nodo conectado por USB?")
    run([f"{SCRIPTS}/mesh-install.sh", action, port])

# ------------------------------------------------------------------ rutas sin conexión (ADR 0010)
ROUTING_REGIONS = {"espana", "canarias"}


def job_routing(p):
    action = p.get("action")
    if action == "remove":
        run(["bash", f"{SCRIPTS}/routing-install.sh", "remove"])
        return
    if action != "install":
        raise JobError("acción no válida")
    regions = p.get("regions")
    if not isinstance(regions, list) or not regions or any(r not in ROUTING_REGIONS for r in regions):
        raise JobError("regiones no válidas")
    run(["bash", f"{SCRIPTS}/routing-install.sh", "install"] + sorted(set(regions)))


JOBS = {
    "usb-scan": job_usb_scan,
    "maps-import": job_maps_import,
    "maps-delete": job_maps_delete,
    "docs-import": job_docs_import,
    "content-fetch": job_content_fetch,
    "content-delete": job_content_delete,
    "backup": job_backup,
    "update": job_update,
    "gps-uart": job_gps_uart,
    "set-time": job_set_time,
    "time-sync": job_time_sync,
    "wifi": job_wifi,
    "restart-app": job_restart_app,
    "llm": job_llm,
    "ap": job_ap,
    "routing": job_routing,
    "mesh": job_mesh,
}


if __name__ == "__main__":
    JOB = sys.argv[1] if len(sys.argv) > 1 else ""
    if JOB not in JOBS:
        sys.exit(f"tarea desconocida: {JOB!r}")
    os.makedirs(ADMIN, exist_ok=True)
    open(f"{ADMIN}/{JOB}.log", "w").close()
    os.chmod(f"{ADMIN}/{JOB}.log", 0o644)
    try:
        req = f"{ADMIN}/{JOB}.json"
        params = {}
        if os.path.exists(req):
            st = os.stat(req)
            if st.st_size > 64 * 1024:
                raise JobError("petición demasiado grande")
            with open(req, encoding="utf-8") as f:
                params = json.load(f)
            if not isinstance(params, dict):
                raise JobError("petición no válida")
        lock = None
        if JOB in LOCK_GROUPS:
            lock = open(f"{ADMIN}/.lock-{LOCK_GROUPS[JOB]}", "w")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise JobError("hay otra tarea de mantenimiento en curso")
        log(f"Inicio de «{JOB}»")
        JOBS[JOB](params)
        log("Terminado correctamente")
    except (JobError, json.JSONDecodeError, OSError, subprocess.SubprocessError) as e:
        log(f"ERROR: {e}")
        sys.exit(1)
    finally:
        for suffix in (".result.json",):
            path = f"{ADMIN}/{JOB}{suffix}"
            if os.path.exists(path):
                os.chmod(path, 0o644)
