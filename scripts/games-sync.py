#!/usr/bin/env python3
"""Survivelia OS — copia offline de Viseni Games (ADR 0012). La lanza la tarea `games` (admin-job.py, root).

Uso: games-sync.py sync | remove

Qué se descarga (solo de GAMES_BASE, URL fija; nada llega de la web del usuario):
  - El portal: lista de sw.js (const FILES = [[ruta-url, sha256[:16]], …]) que genera el propio sitio.
  - Juegos, media y capturas: offline-manifest.json ({path, size, sha256} de cada archivo).
Cada archivo se verifica con su hash. Los que no cambian se enlazan (hardlink) desde la copia actual,
así que volver a descargar solo baja lo nuevo. La copia nueva se monta aparte y sustituye a la actual de
golpe (enlace simbólico `current`): si algo falla a medias, la copia anterior sigue intacta.
Estado para la interfaz en /var/lib/survival-os/games/state.json.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

GAMES_BASE = "https://games.viseni.com/"
ROOT = os.environ.get("GAMES_ROOT", "/var/lib/survival-os/games")
USER_AGENT = "SurvivalOS-games/1.0 (+offline copy)"
WORKERS = 6
RETRIES = 3
MAX_FILES = 20000
MAX_TOTAL = 6 * 1024**3
MAX_FILE = 1024**3
MAX_SHELL_FILE = 64 * 1024**2
FREE_MARGIN = 512 * 1024**2
INDEX = ".survival-index.json"
# Páginas de reserva de la SPA que sw.js no lista: se bajan si existen (sin hash publicado).
OPTIONAL = ("200.html", "404.html")

SEGMENT_RE = re.compile(r"^[^/\\\x00-\x1f]{1,200}$")


class SyncError(Exception):
    pass


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


# ------------------------------------------------------------------ funciones puras (tests/python)

def safe_rel(rel: object) -> str | None:
    """Ruta relativa segura (sin '..', sin absolutas, sin ocultos) o None."""
    if not isinstance(rel, str) or not rel or len(rel) > 400 or rel.startswith("/"):
        return None
    parts = rel.split("/")
    if len(parts) > 20:
        return None
    for p in parts:
        if not SEGMENT_RE.match(p) or p in (".", "..") or p.startswith("."):
            return None
    return rel


def url_for(rel: str) -> str:
    return GAMES_BASE + "/".join(urllib.parse.quote(p, safe="") for p in rel.split("/"))


def parse_sw(source: str) -> list[dict]:
    """Archivos del portal desde sw.js → [{path, hash16}]. Las rutas vienen codificadas por segmento."""
    m = re.search(r"^const FILES = (\[.*\])\s*$", source, re.M)
    if not m:
        raise SyncError("sw.js sin lista de archivos (const FILES)")
    out = []
    for item in json.loads(m.group(1)):
        if not (isinstance(item, list) and len(item) == 2 and isinstance(item[0], str) and isinstance(item[1], str)):
            raise SyncError("sw.js: entrada no válida")
        rel = safe_rel("/".join(urllib.parse.unquote(p) for p in item[0].split("/")))
        if rel is None or not re.fullmatch(r"[0-9a-f]{16}", item[1]):
            raise SyncError(f"sw.js: ruta o hash no válidos ({item[0][:80]})")
        out.append({"path": rel, "hash16": item[1], "size": None})
    return out


def parse_manifest(data: object) -> tuple[list[dict], list[dict], str | None]:
    """offline-manifest.json → ([{path, size, sha256}], external, generatedAt)."""
    if not isinstance(data, dict) or data.get("format") != "viseni-offline/1" or not isinstance(data.get("files"), list):
        raise SyncError("offline-manifest.json con formato desconocido")
    files = []
    for f in data["files"]:
        rel = safe_rel(f.get("path")) if isinstance(f, dict) else None
        size, sha = (f.get("size"), f.get("sha256")) if isinstance(f, dict) else (None, None)
        if rel is None or not isinstance(size, int) or size < 0 or size > MAX_FILE or not (isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{64}", sha)):
            raise SyncError(f"offline-manifest.json: entrada no válida ({str(f)[:80]})")
        files.append({"path": rel, "size": size, "sha256": sha})
    external = [e for e in data.get("external") or [] if isinstance(e, dict) and isinstance(e.get("file"), str) and isinstance(e.get("url"), str)]
    gen = data.get("generatedAt") if isinstance(data.get("generatedAt"), str) else None
    return files, external[:200], gen


def merge_entries(shell: list[dict], assets: list[dict]) -> list[dict]:
    """Une portal y juegos; el manifiesto (hash completo) manda si una ruta aparece en ambos."""
    by = {e["path"]: e for e in shell}
    for e in assets:
        by[e["path"]] = e
    entries = sorted(by.values(), key=lambda e: e["path"])
    if len(entries) > MAX_FILES:
        raise SyncError(f"demasiados archivos ({len(entries)})")
    if sum(e["size"] or 0 for e in entries) > MAX_TOTAL:
        raise SyncError("la copia supera el tamaño máximo permitido")
    folded = {}
    for e in entries:  # dos rutas que solo difieren en mayúsculas romperían en sistemas de ficheros sin distinción
        k = e["path"].casefold()
        if k in folded:
            raise SyncError(f"rutas duplicadas: {folded[k]} / {e['path']}")
        folded[k] = e["path"]
    return entries


def game_slugs(entries: list[dict]) -> list[str]:
    """Juegos presentes en la lista: carpetas games/<slug>/ con su index.html."""
    return sorted({e["path"].split("/")[1] for e in entries if re.fullmatch(r"games/[^/]+/index\.html", e["path"])})


def matches(entry: dict, sha256_hex: str) -> bool:
    if entry.get("sha256"):
        return sha256_hex == entry["sha256"]
    return sha256_hex[:16] == entry["hash16"]


def incomplete_games(failed: list[str]) -> list[str]:
    return sorted({p.split("/")[1] for p in failed if p.startswith("games/") and p.count("/") >= 2})


# ------------------------------------------------------------------ red y disco

def fetch(url: str, limit: int) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise SyncError(f"respuesta demasiado grande: {url}")
    return data


def download(entry: dict, dest: str) -> str:
    """Descarga a dest verificando el hash; devuelve el sha256 completo."""
    limit = entry["size"] if entry.get("size") is not None else MAX_SHELL_FILE
    last = None
    for attempt in range(1, RETRIES + 1):
        tmp = f"{dest}.part"
        try:
            h = hashlib.sha256()
            n = 0
            req = urllib.request.Request(url_for(entry["path"]), headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as out:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    n += len(chunk)
                    if n > limit:
                        raise SyncError("más grande de lo publicado")
                    h.update(chunk)
                    out.write(chunk)
            digest = h.hexdigest()
            if not matches(entry, digest):
                raise SyncError("hash distinto del publicado")
            os.chmod(tmp, 0o644)
            os.replace(tmp, dest)
            return digest
        except (OSError, urllib.error.URLError, SyncError) as e:
            last = e
            if os.path.exists(tmp):
                os.unlink(tmp)
            time.sleep(2 * attempt)
    raise SyncError(str(last))


def file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def current_index() -> tuple[str | None, dict]:
    cur = os.path.join(ROOT, "current")
    if not os.path.islink(cur):
        return None, {}
    real = os.path.realpath(cur)
    try:
        with open(os.path.join(real, INDEX), encoding="utf-8") as f:
            idx = json.load(f)
        return real, idx if isinstance(idx, dict) else {}
    except (OSError, ValueError):
        return real, {}


def place(staging: str, rel: str) -> str:
    dest = os.path.join(staging, *rel.split("/"))
    if not os.path.realpath(dest).startswith(os.path.realpath(staging) + os.sep):
        raise SyncError(f"ruta fuera de la copia: {rel}")
    os.makedirs(os.path.dirname(dest), mode=0o755, exist_ok=True)
    return dest


def write_state(state: dict) -> None:
    tmp = os.path.join(ROOT, "state.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    os.chmod(tmp, 0o644)
    os.replace(tmp, os.path.join(ROOT, "state.json"))


def sync() -> None:
    os.makedirs(os.path.join(ROOT, "releases"), mode=0o755, exist_ok=True)
    os.chmod(ROOT, 0o755)
    log(f"Leyendo la lista de archivos de {GAMES_BASE}")
    try:
        shell = parse_sw(fetch(GAMES_BASE + "sw.js", 8 * 1024**2).decode("utf-8"))
        manifest = json.loads(fetch(GAMES_BASE + "offline-manifest.json", 32 * 1024**2).decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SyncError(f"la web respondió {e.code} ({e.url}): ¿falta subir offline-manifest.json?") from None
    except (urllib.error.URLError, OSError) as e:
        raise SyncError(f"sin conexión con {GAMES_BASE} ({e})") from None
    assets, external, generated = parse_manifest(manifest)
    entries = merge_entries(shell, assets)
    # Un manifiesto sin juegos (p. ej. generado antes de que el servidor tuviera las builds) no sustituye
    # a una copia que sí los tiene: se rechaza entero.
    if not game_slugs(entries):
        raise SyncError("el offline-manifest.json de la web no incluye ningún juego: no se toca la copia actual")
    cur_dir, cur_idx = current_index()

    reuse, todo = [], []
    for e in entries:
        old = cur_idx.get(e["path"])
        if cur_dir and isinstance(old, str) and matches(e, old) and os.path.isfile(os.path.join(cur_dir, *e["path"].split("/"))):
            reuse.append((e, old))
        else:
            todo.append(e)
    need = sum(e["size"] or 0 for e in todo)
    free = shutil.disk_usage(ROOT).free
    if need + FREE_MARGIN > free:
        raise SyncError(f"espacio insuficiente: hacen falta {need / 1024**2:.0f} MB y quedan {free / 1024**2:.0f} MB")
    log(f"{len(entries)} archivos: {len(reuse)} sin cambios, {len(todo)} por descargar ({need / 1024**2:.0f} MB)")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    staging = os.path.join(ROOT, "releases", f".staging-{stamp}")
    shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging, mode=0o755)
    index: dict[str, str] = {}
    try:
        for e, digest in reuse:
            os.link(os.path.join(cur_dir, *e["path"].split("/")), place(staging, e["path"]))
            index[e["path"]] = digest

        failed: list[str] = []
        done = 0
        got = 0
        last_log = time.monotonic()
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(download, e, place(staging, e["path"])): e for e in todo}
            for fut in as_completed(futures):
                e = futures[fut]
                done += 1
                try:
                    index[e["path"]] = fut.result()
                    got += e["size"] or 0
                except SyncError as err:
                    failed.append(e["path"])
                    log(f"FALLO {e['path']}: {err}")
                if time.monotonic() - last_log > 5 or done == len(todo):
                    log(f"{done}/{len(todo)} archivos · {got / 1024**2:.0f} de {need / 1024**2:.0f} MB")
                    last_log = time.monotonic()

        for rel in OPTIONAL:
            if rel in index:
                continue
            try:
                data = fetch(url_for(rel), MAX_SHELL_FILE)
                dest = place(staging, rel)
                with open(dest, "wb") as f:
                    f.write(data)
                os.chmod(dest, 0o644)
                index[rel] = hashlib.sha256(data).hexdigest()
            except (urllib.error.URLError, OSError, SyncError):
                pass

        if "index.html" not in index:
            raise SyncError("no se pudo descargar la portada del portal (index.html)")
        with open(os.path.join(staging, INDEX), "w", encoding="utf-8") as f:
            json.dump(index, f)
        release = os.path.join(ROOT, "releases", stamp)
        os.rename(staging, release)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    link_tmp = os.path.join(ROOT, f".current-{stamp}")
    os.symlink(os.path.join("releases", stamp), link_tmp)
    os.replace(link_tmp, os.path.join(ROOT, "current"))
    for name in os.listdir(os.path.join(ROOT, "releases")):
        if name != stamp:
            shutil.rmtree(os.path.join(ROOT, "releases", name), ignore_errors=True)

    total = sum(os.path.getsize(os.path.join(release, *p.split("/"))) for p in index)
    games = game_slugs([{"path": p} for p in index])
    write_state({
        "installedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": GAMES_BASE,
        "manifestGeneratedAt": generated,
        "files": len(index),
        "bytes": total,
        "games": games,
        "failed": sorted(failed)[:500],
        "incompleteGames": incomplete_games(failed),
        "external": external,
    })
    if failed:
        log(f"AVISO: {len(failed)} archivo(s) no se pudieron verificar; juegos incompletos: {', '.join(incomplete_games(failed)) or '—'}")
    log(f"Copia instalada: {len(index)} archivos, {total / 1024**3:.2f} GB, {len(games)} juegos")


def remove() -> None:
    for name in ("current", "state.json"):
        p = os.path.join(ROOT, name)
        if os.path.islink(p) or os.path.isfile(p):
            os.unlink(p)
    shutil.rmtree(os.path.join(ROOT, "releases"), ignore_errors=True)
    log("Copia de los juegos eliminada")


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if action == "sync":
            sync()
        elif action == "remove":
            remove()
        else:
            print("uso: games-sync.py sync|remove", file=sys.stderr)
            return 2
    except SyncError as e:
        log(f"ERROR: {e}")
        return 1
    return 0


if __name__ == "__main__" and "--selftest" not in sys.argv:
    sys.exit(main())
