#!/usr/bin/env python3
"""Survival OS — pasarela Meshtastic (malla LoRa) por USB serie.

API solo en loopback (127.0.0.1:8787, JSON):
  GET  /status            conexión, nodo propio, nº de nodos
  GET  /nodes             nodos conocidos (nombre, batería, SNR, saltos, última vez oído, posición si la hay)
  GET  /channels          canales (índice, nombre, papel) — NUNCA las claves
  GET  /messages?limit=N  mensajes de texto recibidos y enviados (SQLite local)
  POST /send              {"text": "...", "channel": 0, "to": "!a1b2c3d4"?}
  GET  /time              hora UTC estimada a partir de posiciones del canal PRIVADO (respaldo sin red)
  GET  /track             nodo cuya posición sigue el mapa ({"id": "!a1b2c3d4"} o {"id": null} = el propio)
  POST /track             {"id": "!a1b2c3d4" | null}
  POST /refresh           pide su posición al nodo seguido (canal PRIVADO; 1 por minuto). Sin esperar respuesta:
                          llega como cualquier posición recibida.

Reglas del proyecto: sin red (IPAddressDeny en la unidad), sin inventar datos (lo que el nodo no informa
sale como null), sin secretos en registros ni respuestas (claves de canal, admin y PKC no se exponen).
La librería `meshtastic` se importa en tiempo de ejecución: las funciones puras se prueban sin ella.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

VERSION = "0.4.0"
HOST = os.environ.get("MESH_HOST", "127.0.0.1")
PORT = int(os.environ.get("MESH_PORT", "8787") or 8787)
SERIAL = os.environ.get("MESH_SERIAL", "").strip()
DB_PATH = os.environ.get("MESH_DB", "/var/lib/survival-os/mesh/mesh.db")
RETRY_S = 10
HANDSHAKE_TIMEOUT_S = 30
MAX_TEXT_BYTES = 200  # Meshtastic admite ~228 B de carga útil; margen para cabeceras
MAX_MESSAGES = 2000
SEND_INTERVAL_S = 3.0
REFRESH_INTERVAL_S = 60.0  # ciclo de trabajo de 868 MHz: una petición de posición por minuto como mucho
NODE_ID_RE = re.compile(r"^![0-9a-f]{8}$")


def log(level: str, msg: str, **extra) -> None:
    rec = {"t": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), "level": level, "svc": "mesh", "msg": msg}
    rec.update(extra)
    print(json.dumps(rec, ensure_ascii=False), flush=True)


def iso(epoch) -> str | None:
    """Segundos Unix → ISO-8601 UTC. 0/None/valores absurdos (antes de 2020) → None: el nodo no lo sabe."""
    try:
        e = float(epoch)
    except (TypeError, ValueError):
        return None
    if e < 1577836800:  # 2020-01-01: un nodo sin hora válida informa 0 o fechas de 1970
        return None
    return datetime.fromtimestamp(e, timezone.utc).isoformat().replace("+00:00", "Z")


# ----------------------------------------------------------------------------- funciones puras

def precision_m(bits) -> int | None:
    """Error máximo (m) de una posición recortada a `bits` bits (precisión por canal de Meshtastic).
    1..31 bits: la posición es el centro de una celda de 2^(32-bits) · 1e-7 grados; el error es media celda.
    0 (no informado) o 32: posición completa → None (la precisión real del GPS no se conoce)."""
    if not isinstance(bits, int) or isinstance(bits, bool) or bits <= 0 or bits >= 32:
        return None
    return round(2 ** (32 - bits) * 1e-7 * 111_320 / 2)


def node_summary(n: dict, my_num: int | None) -> dict:
    """Entrada de `interface.nodes` → forma estable para la UI. Sin `macaddr` ni claves públicas."""
    user = n.get("user") or {}
    pos = n.get("position") or {}
    met = n.get("deviceMetrics") or {}
    lat, lon = pos.get("latitude"), pos.get("longitude")
    position = None
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and not (lat == 0 and lon == 0):
        position = {"lat": lat, "lon": lon, "alt": pos.get("altitude"), "at": iso(pos.get("time")),
                    "precisionM": precision_m(pos.get("precisionBits"))}
    level = met.get("batteryLevel")
    battery = None
    if isinstance(level, (int, float)):
        # Meshtastic usa 101 para «alimentación externa» (no es un porcentaje real).
        battery = {"level": None if level > 100 else int(level), "powered": level > 100, "voltage": met.get("voltage")}
    return {
        "id": user.get("id") or (f"!{n['num']:08x}" if isinstance(n.get("num"), int) else None),
        "num": n.get("num"),
        "longName": user.get("longName"),
        "shortName": user.get("shortName"),
        "hwModel": user.get("hwModel"),
        "role": user.get("role") or "CLIENT",
        "isMe": my_num is not None and n.get("num") == my_num,
        "lastHeard": iso(n.get("lastHeard")),
        "snr": n.get("snr"),
        "hopsAway": n.get("hopsAway"),
        "battery": battery,
        "channelUtilization": met.get("channelUtilization"),
        "position": position,
    }


def text_message(packet: dict) -> dict | None:
    """Paquete recibido → mensaje de texto, o None si no es TEXT_MESSAGE_APP."""
    dec = packet.get("decoded") or {}
    if dec.get("portnum") != "TEXT_MESSAGE_APP":
        return None
    text = dec.get("text")
    if not isinstance(text, str):
        return None
    hop_start, hop_limit = packet.get("hopStart"), packet.get("hopLimit")
    hops = hop_start - hop_limit if isinstance(hop_start, int) and isinstance(hop_limit, int) else None
    return {
        "packetId": packet.get("id"),
        "from": packet.get("fromId") or (f"!{packet['from']:08x}" if isinstance(packet.get("from"), int) else None),
        "to": packet.get("toId"),
        "channel": int(packet.get("channel") or 0),
        "text": text,
        "rxTime": iso(packet.get("rxTime")) or iso(time.time()),
        "snr": packet.get("rxSnr"),
        "rssi": packet.get("rxRssi"),
        "hops": hops,
    }


def validate_send(body: dict, channel_indexes: list[int]) -> tuple[str, int, str | None]:
    """Valida {"text","channel","to"}; lanza ValueError con un motivo legible."""
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Escribe un mensaje")
    text = text.strip()
    if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
        raise ValueError(f"Mensaje demasiado largo (máx. {MAX_TEXT_BYTES} bytes)")
    channel = body.get("channel", 0)
    if not isinstance(channel, int) or isinstance(channel, bool) or channel not in channel_indexes:
        raise ValueError("Canal no válido")
    to = body.get("to")
    if to is not None and (not isinstance(to, str) or not NODE_ID_RE.match(to)):
        raise ValueError("Destino no válido")
    return text, channel, to


# ----------------------------------------------------------------------------- hora por LoRa

# Una hora anterior a esto es imposible (el nodo no la sabe o miente): la release es posterior.
TIME_FLOOR = 1767225600  # 2026-01-01T00:00:00Z
TIME_AGREE_S = 10        # dos muestras deben coincidir con este margen
TIME_MAX_AGE_S = 2700    # 45 min: una posición cada 15 min en reposo → al menos dos muestras recientes
TIME_KEEP = 6


def time_sample(packet: dict, private_channels: set, mono_now: float) -> dict | None:
    """Posición recibida por un canal PRIVADO con hora → muestra {from, nodeTime, mono}.
    Meshtastic solo incluye la hora en la posición si el nodo la tiene de calidad (GPS o teléfono) y es la del envío.
    Los canales públicos se ignoran: cualquiera podría anunciar una hora falsa."""
    dec = packet.get("decoded") or {}
    if dec.get("portnum") != "POSITION_APP":
        return None
    if int(packet.get("channel") or 0) not in private_channels:
        return None
    t = (dec.get("position") or {}).get("time")
    if not isinstance(t, int) or isinstance(t, bool) or t < TIME_FLOOR:
        return None
    sender = packet.get("fromId") or (f"!{packet['from']:08x}" if isinstance(packet.get("from"), int) else None)
    return {"from": sender, "nodeTime": t, "mono": mono_now}


def estimate_time(samples: list, mono_now: float) -> dict | None:
    """Hora UTC actual estimada si las dos muestras más recientes (≤ 45 min) coinciden entre sí (± 10 s).
    Cada muestra se proyecta a «ahora» con el reloj monótono del proceso, inmune a cambios del reloj de pared."""
    recent = [x for x in samples if mono_now - x["mono"] <= TIME_MAX_AGE_S]
    if len(recent) < 2:
        return None
    a, b = recent[-2], recent[-1]
    ea = a["nodeTime"] + (mono_now - a["mono"])
    eb = b["nodeTime"] + (mono_now - b["mono"])
    if abs(ea - eb) > TIME_AGREE_S:
        return None
    return {"utc": round(eb, 1), "from": b["from"], "samples": 2, "spreadS": round(abs(ea - eb), 1),
            "newestAgeS": round(mono_now - b["mono"], 1)}


# ----------------------------------------------------------------------------- almacenamiento

class Store:
    def __init__(self, path: str):
        if path != ":memory:":
            os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS messages (
                  id INTEGER PRIMARY KEY,
                  packet_id INTEGER,
                  dir TEXT NOT NULL,
                  from_id TEXT, to_id TEXT,
                  channel INTEGER NOT NULL DEFAULT 0,
                  text TEXT NOT NULL,
                  at TEXT NOT NULL,
                  snr REAL, rssi INTEGER, hops INTEGER,
                  UNIQUE(packet_id, from_id)
                );
                """
            )

    def add(self, m: dict, direction: str) -> None:
        with self.lock:
            self.db.execute(
                "INSERT OR IGNORE INTO messages (packet_id, dir, from_id, to_id, channel, text, at, snr, rssi, hops)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (m.get("packetId"), direction, m.get("from"), m.get("to"), m.get("channel", 0), m["text"],
                 m.get("rxTime") or iso(time.time()), m.get("snr"), m.get("rssi"), m.get("hops")),
            )
            self.db.execute("DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ?)", (MAX_MESSAGES,))
            self.db.commit()

    def list(self, limit: int) -> list[dict]:
        with self.lock:
            rows = self.db.execute(
                "SELECT id, dir, from_id, to_id, channel, text, at, snr, rssi, hops FROM messages ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        keys = ("id", "direction", "from", "to", "channel", "text", "at", "snr", "rssi", "hops")
        return [dict(zip(keys, r)) for r in rows]


# ----------------------------------------------------------------------------- conexión con el nodo

STATE_DIR = os.path.dirname(DB_PATH) or "."
POSITIONS_PATH = os.environ.get("MESH_POSITIONS", os.path.join(STATE_DIR, "last-positions.json"))
TRACK_PATH = os.environ.get("MESH_TRACK", os.path.join(STATE_DIR, "track.json"))


def write_json(path: str, data) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def read_json(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def remember_position(cached: dict | None, current: dict | None) -> dict | None:
    """Última posición propia conocida. Solo se guarda si trae hora (sin hora no se puede decir su antigüedad)
    y solo sustituye a la guardada si es más reciente."""
    if not current or not current.get("at"):
        return cached
    if cached and cached.get("at") and cached["at"] >= current["at"]:
        return cached
    kept = {k: current.get(k) for k in ("lat", "lon", "alt", "at")}
    if current.get("precisionM") is not None:
        kept["precisionM"] = current["precisionM"]
    return kept


def validate_track(body: dict) -> str | None:
    """{"id": "!a1b2c3d4"} o {"id": null} (seguir al nodo propio); lanza ValueError si no es válido."""
    if "id" not in body:
        raise ValueError("Falta el nodo")
    node_id = body["id"]
    if node_id is None:
        return None
    if not isinstance(node_id, str) or not NODE_ID_RE.match(node_id):
        raise ValueError("Nodo no válido")
    return node_id


def with_cached(summary: dict, cached: dict | None) -> dict:
    """Resumen de nodo con su posición; si ahora no la informa, la última conocida marcada `cached`."""
    if not summary.get("position") and cached:
        return {**summary, "position": {**cached, "cached": True}}
    return summary


class Mesh:
    def __init__(self, store: Store):
        self.store = store
        # Última posición conocida por nodo (solo del propio y del seguido). Clave: id del nodo.
        raw = read_json(POSITIONS_PATH)
        self.positions: dict[str, dict] = {}
        if isinstance(raw, dict):
            for k, v in raw.items():
                if isinstance(k, str) and NODE_ID_RE.match(k) and isinstance(v, dict):
                    kept = remember_position(None, v)
                    if kept:
                        self.positions[k] = kept
        track = read_json(TRACK_PATH)
        tid = track.get("id") if isinstance(track, dict) else None
        self.track_id: str | None = tid if isinstance(tid, str) and NODE_ID_RE.match(tid) else None
        self.iface = None
        self.lock = threading.RLock()
        self.error: str | None = None
        self.connected_at: str | None = None
        self.last_packet_at: str | None = None
        self.last_send = 0.0
        self.time_samples: list[dict] = []
        self.last_refresh = -REFRESH_INTERVAL_S

    # Callbacks de pubsub (hilo de la librería)
    def on_receive(self, packet, interface=None):  # noqa: ARG002
        self.last_packet_at = iso(time.time())
        m = text_message(packet)
        if m:
            self.store.add(m, "in")
            log("info", "text_received", channel=m["channel"], bytes=len(m["text"].encode("utf-8")))
            return
        ts = time_sample(packet, self.private_channels(), time.monotonic())
        if ts:
            with self.lock:
                self.time_samples = (self.time_samples + [ts])[-TIME_KEEP:]

    def on_lost(self, interface=None):
        # Solo la interfaz vigente: un aviso tardío de una conexión anterior no debe cerrar la nueva.
        if interface is not None and self.iface is not None and interface is not self.iface:
            return
        log("warn", "connection_lost")
        self.error = "Conexión con el nodo perdida"
        self.close()

    def close(self):
        with self.lock:
            iface, self.iface = self.iface, None
            self.connected_at = None
        if iface is not None:
            try:
                iface.close()
            except Exception:  # noqa: BLE001
                pass

    def connect_loop(self):
        from pubsub import pub  # import tardío: solo en la Pi, con la librería instalada
        from meshtastic.serial_interface import SerialInterface

        pub.subscribe(self.on_receive, "meshtastic.receive")
        pub.subscribe(self.on_lost, "meshtastic.connection.lost")
        while True:
            if self.iface is None:
                if not SERIAL:
                    self.error = "Puerto no configurado (Mantenimiento → Malla Meshtastic)"
                elif not os.path.exists(SERIAL):
                    self.error = "Nodo no conectado por USB"
                else:
                    try:
                        # timeout: el handshake (config del nodo) no puede colgar el bucle (por defecto, 300 s).
                        iface = SerialInterface(devPath=SERIAL, timeout=HANDSHAKE_TIMEOUT_S)
                        with self.lock:
                            self.iface = iface
                            self.connected_at = iso(time.time())
                        self.error = None
                        log("info", "connected", port=SERIAL)
                    except Exception as err:  # noqa: BLE001
                        self.error = f"No se pudo abrir el nodo: {type(err).__name__}"
                        log("warn", "connect_failed", error=type(err).__name__)
            time.sleep(RETRY_S)

    # Lecturas (copias: la librería muta sus dicts desde otro hilo)
    def my_num(self):
        try:
            return self.iface.myInfo.my_node_num if self.iface and self.iface.myInfo else None
        except Exception:  # noqa: BLE001
            return None

    def nodes(self) -> list[dict]:
        with self.lock:
            raw = list((self.iface.nodes or {}).values()) if self.iface else []
            me = self.my_num()
        out = [node_summary(dict(n), me) for n in raw]
        for n in out:
            if n["isMe"] or (n["id"] and n["id"] == self.track_id):
                self.update_last_pos(n["id"], n["position"])
        out.sort(key=lambda n: (not n["isMe"], -(datetime.fromisoformat(n["lastHeard"].replace("Z", "+00:00")).timestamp() if n["lastHeard"] else 0)))
        return out

    def private_channels(self) -> set:
        """Índices de canal con clave propia (≥ 16 bytes). La clave por defecto (1 byte) es pública."""
        with self.lock:
            node = getattr(self.iface, "localNode", None) if self.iface else None
            chans = list(getattr(node, "channels", None) or [])
        out = set()
        for c in chans:
            if int(getattr(c, "role", 0)) == 0:
                continue
            psk = getattr(getattr(c, "settings", None), "psk", b"") or b""
            if len(psk) >= 16:
                out.add(int(c.index))
        return out

    def time_status(self) -> dict:
        with self.lock:
            samples = list(self.time_samples)
        now = time.monotonic()
        return {"privateChannel": bool(self.private_channels()), "samples": len(samples),
                "estimate": estimate_time(samples, now)}

    def channels(self) -> list[dict]:
        with self.lock:
            node = getattr(self.iface, "localNode", None) if self.iface else None
            chans = list(getattr(node, "channels", None) or [])
        roles = {0: "DISABLED", 1: "PRIMARY", 2: "SECONDARY"}
        out = []
        for c in chans:
            role = roles.get(int(getattr(c, "role", 0)), "DISABLED")
            if role == "DISABLED":
                continue
            name = getattr(getattr(c, "settings", None), "name", "") or ""
            out.append({"index": int(c.index), "name": name or None, "role": role})
        return out

    def status(self) -> dict:
        me = None
        tracked = None
        with self.lock:
            iface = self.iface
            if iface is not None:
                me_num = self.my_num()
                node = (iface.nodesByNum or {}).get(me_num) if me_num is not None else None
                meta = getattr(iface, "metadata", None)
                me = {
                    **(node_summary(dict(node), me_num) if node else {"id": None}),
                    "firmware": getattr(meta, "firmware_version", None) or None,
                }
                self.update_last_pos(me.get("id"), me.get("position"))
                # El nodo no informa posición ahora (p. ej. sin fijación): última conocida, marcada.
                me = with_cached(me, self.positions.get(me.get("id") or ""))
                if self.track_id and self.track_id != me.get("id"):
                    other = (iface.nodes or {}).get(self.track_id)
                    summ = (node_summary(dict(other), me_num) if other else
                            {"id": self.track_id, "longName": None, "shortName": None, "lastHeard": None, "position": None})
                    self.update_last_pos(self.track_id, summ.get("position"))
                    tracked = with_cached(summ, self.positions.get(self.track_id))
                else:
                    tracked = me
            count = len(iface.nodes or {}) if iface is not None else 0
        return {
            "version": VERSION,
            "connected": iface is not None,
            "transport": "usb" if SERIAL else None,
            "port": SERIAL or None,
            "connectedAt": self.connected_at,
            "lastPacketAt": self.last_packet_at,
            "error": None if iface is not None else self.error,
            "me": me,
            "trackId": self.track_id,
            "tracked": tracked,
            "nodeCount": count,
            "maxTextBytes": MAX_TEXT_BYTES,
        }

    def update_last_pos(self, node_id: str | None, pos: dict | None) -> None:
        if not node_id or not NODE_ID_RE.match(node_id):
            return
        old = self.positions.get(node_id)
        new = remember_position(old, pos)
        if new is old or new == old:
            return
        self.positions[node_id] = new
        # Solo se conservan las del nodo propio y el seguido: no se archiva la posición de terceros.
        me = self.my_num()
        keep = {self.track_id, f"!{me:08x}" if isinstance(me, int) else None}
        self.positions = {k: v for k, v in self.positions.items() if k in keep}
        try:
            write_json(POSITIONS_PATH, self.positions)
        except OSError as err:
            log("warn", "last_position_save_failed", error=type(err).__name__)

    def set_track(self, body: dict) -> dict:
        node_id = validate_track(body)
        with self.lock:
            self.track_id = node_id
            write_json(TRACK_PATH, {"id": node_id})
        log("info", "track_set", own=node_id is None)
        return {"id": node_id}

    def refresh(self) -> dict:
        """Pide al nodo seguido su posición actual (y con ella su hora). Solo por un canal privado: la petición
        lleva la posición de la base y no debe ir por el canal público. El nodo propio no se pide: su GPS
        actualiza solo (cada gps_update_interval)."""
        with self.lock:
            if self.iface is None:
                raise ConnectionError(self.error or "Nodo no conectado")
            me = self.my_num()
            me_id = f"!{me:08x}" if isinstance(me, int) else None
            target = self.track_id if self.track_id and self.track_id != me_id else None
            if target is None:
                return {"requested": None, "reason": "own"}
            private = sorted(self.private_channels())
            if not private:
                raise ValueError("Sin canal privado: no se pide la posición por el canal público")
            wait = REFRESH_INTERVAL_S - (time.monotonic() - self.last_refresh)
            if wait > 0:
                raise BlockingIOError(f"Espera {wait:.0f} s entre peticiones")
            from meshtastic.protobuf import mesh_pb2, portnums_pb2  # import tardío: solo en la Pi

            # Como `meshtastic --request-position`, pero sin waitForPosition (bloquea) ni el print de la librería
            # (escribiría coordenadas en el registro del sistema).
            self.iface.sendData(mesh_pb2.Position(), destinationId=target, portNum=portnums_pb2.PortNum.POSITION_APP,
                                wantAck=False, wantResponse=True, channelIndex=private[0])
            self.last_refresh = time.monotonic()
        log("info", "position_requested", channel=private[0])
        return {"requested": target}

    def send(self, body: dict) -> dict:
        with self.lock:
            if self.iface is None:
                raise ConnectionError(self.error or "Nodo no conectado")
            text, channel, to = validate_send(body, [c["index"] for c in self.channels()] or [0])
            wait = SEND_INTERVAL_S - (time.monotonic() - self.last_send)
            if wait > 0:
                raise BlockingIOError(f"Espera {wait:.0f} s entre mensajes")
            pkt = self.iface.sendText(text, destinationId=to or "^all", channelIndex=channel, wantAck=to is not None)
            self.last_send = time.monotonic()
            me = self.my_num()
        m = {
            "packetId": getattr(pkt, "id", None),
            "from": f"!{me:08x}" if isinstance(me, int) else None,
            "to": to or "^all",
            "channel": channel,
            "text": text,
            "rxTime": iso(time.time()),
        }
        self.store.add(m, "out")
        log("info", "text_sent", channel=channel, direct=to is not None, bytes=len(text.encode("utf-8")))
        return m


# ----------------------------------------------------------------------------- HTTP

def make_handler(mesh: Mesh, store: Store):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"survival-mesh/{VERSION}"

        def log_message(self, fmt, *args):  # sin registro por petición (privacidad)
            return

        def send_json(self, code: int, body) -> None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("cache-control", "no-store")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            u = urlparse(self.path)
            if u.path == "/status":
                return self.send_json(200, mesh.status())
            if u.path == "/nodes":
                return self.send_json(200, mesh.nodes())
            if u.path == "/channels":
                return self.send_json(200, mesh.channels())
            if u.path == "/track":
                return self.send_json(200, {"id": mesh.track_id})
            if u.path == "/time":
                return self.send_json(200, mesh.time_status())
            if u.path == "/messages":
                try:
                    limit = max(1, min(500, int((parse_qs(u.query).get("limit") or ["100"])[0])))
                except ValueError:
                    limit = 100
                return self.send_json(200, store.list(limit))
            return self.send_json(404, {"error": "not_found"})

        def do_POST(self):
            route = urlparse(self.path).path
            if route not in ("/send", "/track", "/refresh"):
                return self.send_json(404, {"error": "not_found"})
            if route == "/refresh":
                try:
                    return self.send_json(200, mesh.refresh())
                except ValueError as err:
                    return self.send_json(400, {"error": str(err)})
                except BlockingIOError as err:
                    return self.send_json(429, {"error": str(err)})
                except ConnectionError as err:
                    return self.send_json(503, {"error": str(err)})
                except Exception as err:  # noqa: BLE001
                    log("error", "refresh_failed", error=type(err).__name__)
                    return self.send_json(500, {"error": "No se pudo pedir la posición"})
            try:
                n = int(self.headers.get("content-length") or 0)
            except ValueError:
                n = 0
            if n <= 0 or n > 4096:
                return self.send_json(400, {"error": "Cuerpo vacío o demasiado grande"})
            try:
                body = json.loads(self.rfile.read(n))
                if not isinstance(body, dict):
                    raise ValueError
            except ValueError:
                return self.send_json(400, {"error": "JSON no válido"})
            if route == "/track":
                try:
                    return self.send_json(200, mesh.set_track(body))
                except ValueError as err:
                    return self.send_json(400, {"error": str(err)})
                except OSError:
                    return self.send_json(500, {"error": "No se pudo guardar"})
            try:
                return self.send_json(200, mesh.send(body))
            except ValueError as err:
                return self.send_json(400, {"error": str(err)})
            except BlockingIOError as err:
                return self.send_json(429, {"error": str(err)})
            except ConnectionError as err:
                return self.send_json(503, {"error": str(err)})
            except Exception as err:  # noqa: BLE001
                log("error", "send_failed", error=type(err).__name__)
                return self.send_json(500, {"error": "No se pudo enviar"})

    return Handler


def main() -> None:
    store = Store(DB_PATH)
    mesh = Mesh(store)
    threading.Thread(target=mesh.connect_loop, name="mesh-connect", daemon=True).start()
    httpd = ThreadingHTTPServer((HOST, PORT), make_handler(mesh, store))
    log("info", "listening", host=HOST, port=PORT, version=VERSION, serial=bool(SERIAL))
    try:
        httpd.serve_forever()
    finally:
        mesh.close()


if __name__ == "__main__" and "--selftest" not in sys.argv:
    main()
