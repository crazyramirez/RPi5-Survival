"""Pruebas de las funciones puras de services/mesh/survival_mesh.py (sin la librería meshtastic ni hardware).

Verifica: resumen de nodos sin datos inventados (batería 101 = alimentación externa, posición 0,0 = sin
posición, fechas anteriores a 2020 = desconocidas), extracción de mensajes de texto, validación de envíos,
almacenamiento con deduplicación y tope, y que el resumen no expone la MAC.
Uso: python tests/python/test_survival_mesh.py   (sale con código 0 si todo pasa)
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.argv.append("--selftest")  # el módulo no arranca el servidor al importarse
spec = importlib.util.spec_from_file_location("survival_mesh", os.path.join(ROOT, "services", "mesh", "survival_mesh.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

fails = []


def check(name, cond):
    print(("OK   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


# --- node_summary
me = {
    "num": 439041101,
    "user": {"id": "!1a2b3c4d", "longName": "Nodo Bolsillo", "shortName": "bol1", "macaddr": "aa:bb:cc:dd:ee:01", "hwModel": "HELTEC_V4"},
    "position": {"latitude": 40.4167754, "longitude": -3.7037902, "altitude": 38, "time": 1794181268},
    "lastHeard": 1794181268,
    "deviceMetrics": {"batteryLevel": 55, "voltage": 3.763, "channelUtilization": 0.0},
}
s = m.node_summary(me, 439041101)
check("nodo propio marcado", s["isMe"] is True)
check("batería en %", s["battery"] == {"level": 55, "powered": False, "voltage": 3.763})
check("posición con fecha", s["position"]["lat"] == 40.4167754 and s["position"]["at"].startswith("2026-"))
check("sin MAC en el resumen", "macaddr" not in str(s) and "aa:bb" not in str(s))
check("rol por defecto CLIENT", s["role"] == "CLIENT")

other = {"num": 195936478, "user": {"id": "!0badc0de", "longName": "NODO-X", "role": "CLIENT_MUTE"}, "snr": -14.75,
         "lastHeard": 1794147398, "hopsAway": 3, "deviceMetrics": {"batteryLevel": 101}, "position": {"latitude": 0, "longitude": 0}}
o = m.node_summary(other, 439041101)
check("batería 101 = alimentación externa, sin %", o["battery"]["level"] is None and o["battery"]["powered"] is True)
check("posición 0,0 = sin posición", o["position"] is None)
check("saltos y SNR tal cual", o["hopsAway"] == 3 and o["snr"] == -14.75)
check("hora 1970 = desconocida", m.iso(0) is None and m.iso(86400) is None and m.iso("x") is None)
check("id derivado del número si falta user", m.node_summary({"num": 255}, None)["id"] == "!000000ff")

# --- text_message
pkt = {"id": 77, "fromId": "!0badc0de", "toId": "^all", "channel": 0, "rxTime": 1794181300, "rxSnr": -7.5, "rxRssi": -110,
       "hopStart": 3, "hopLimit": 1, "decoded": {"portnum": "TEXT_MESSAGE_APP", "text": "hola malla"}}
t = m.text_message(pkt)
check("mensaje de texto extraído", t["text"] == "hola malla" and t["from"] == "!0badc0de" and t["hops"] == 2)
check("otros portnum se ignoran", m.text_message({"decoded": {"portnum": "POSITION_APP"}}) is None)

# --- validate_send
check("envío válido", m.validate_send({"text": " hola ", "channel": 0}, [0, 1]) == ("hola", 0, None))
check("mensaje directo válido", m.validate_send({"text": "x", "channel": 1, "to": "!0badc0de"}, [0, 1])[2] == "!0badc0de")
for name, body in [("vacío", {"text": "  "}), ("demasiado largo", {"text": "ñ" * 150}), ("canal inexistente", {"text": "x", "channel": 5}),
                   ("canal booleano", {"text": "x", "channel": True}), ("destino raro", {"text": "x", "to": "all; rm"})]:
    try:
        m.validate_send(body, [0, 1])
        check(f"rechaza {name}", False)
    except ValueError:
        check(f"rechaza {name}", True)

# --- Store
st = m.Store(":memory:")
st.add(t, "in")
st.add(t, "in")  # mismo paquete repetido por la malla
check("deduplica por (paquete, origen)", len(st.list(10)) == 1)
m.MAX_MESSAGES = 3
for i in range(5):
    st.add({**t, "packetId": 1000 + i}, "in")
rows = st.list(10)
check("conserva solo los últimos N", len(rows) == 3 and rows[0]["text"] == "hola malla")

# --- remember_position
p1 = {"lat": 1.0, "lon": 2.0, "alt": None, "at": "2026-11-08T23:21:08Z"}
p0 = {"lat": 9.0, "lon": 9.0, "alt": None, "at": "2026-11-08T20:00:00Z"}
check("guarda posición con hora", m.remember_position(None, p1) == p1)
check("sin hora no se guarda", m.remember_position(None, {"lat": 1, "lon": 2, "at": None}) is None)
check("no sustituye por una más antigua", m.remember_position(p1, p0) == p1)
check("sin posición actual conserva la guardada", m.remember_position(p1, None) == p1)

# --- precisión por canal (bits → metros de error)
check("13 bits = unos 2,9 km de error", m.precision_m(13) == 2918)
check("19 bits = unos 46 m", m.precision_m(19) == 46)
check("32 bits o sin informar: completa (None)", m.precision_m(32) is None and m.precision_m(0) is None and m.precision_m(None) is None)
check("booleano no es precisión", m.precision_m(True) is None)
pp = m.node_summary({"num": 1, "position": {"latitude": 36.5, "longitude": -4.8, "precisionBits": 13}}, None)["position"]
check("el resumen lleva la precisión", pp["precisionM"] == 2918)

# --- nodo seguido
check("seguir un nodo válido", m.validate_track({"id": "!0badc0de"}) == "!0badc0de")
check("null = seguir al propio", m.validate_track({"id": None}) is None)
for name, body in [("sin id", {}), ("id raro", {"id": "../x"}), ("número", {"id": 5})]:
    try:
        m.validate_track(body)
        check(f"rechaza seguimiento {name}", False)
    except ValueError:
        check(f"rechaza seguimiento {name}", True)
check("posición guardada marcada cached", m.with_cached({"id": "!1", "position": None}, p1)["position"]["cached"] is True)
check("posición actual no se sustituye", m.with_cached({"id": "!1", "position": p0}, p1)["position"] == p0)

# --- Mesh.status con interfaz simulada: base por USB + nodo de bolsillo seguido por radio
import tempfile
from types import SimpleNamespace

tmp = tempfile.mkdtemp()
m.POSITIONS_PATH = os.path.join(tmp, "last-positions.json")
m.TRACK_PATH = os.path.join(tmp, "track.json")
base = {"num": 0x5E5E0001, "user": {"id": "!5e5e0001", "longName": "Survival Base", "shortName": "SVB"}}
pocket = {"num": 0x1A2B3C4D, "user": {"id": "!1a2b3c4d", "longName": "Bolsillo", "shortName": "bol1"}, "lastHeard": 1794181268,
          "position": {"latitude": 40.4167754, "longitude": -3.7037902, "time": 1794181268, "precisionBits": 32}}
third = {"num": 0x0BADC0DE, "user": {"id": "!0badc0de"}, "position": {"latitude": 37.0, "longitude": -4.0, "time": 1794181268}}
iface = SimpleNamespace(
    myInfo=SimpleNamespace(my_node_num=0x5E5E0001), metadata=SimpleNamespace(firmware_version="2.7.26"),
    nodesByNum={n["num"]: n for n in (base, pocket, third)}, nodes={n["user"]["id"]: n for n in (base, pocket, third)},
)
mesh = m.Mesh(m.Store(":memory:"))
mesh.iface = iface
st0 = mesh.status()
check("sin seguimiento: tracked = nodo propio", st0["trackId"] is None and st0["tracked"]["id"] == "!5e5e0001" and st0["tracked"]["position"] is None)
mesh.set_track({"id": "!1a2b3c4d"})
st1 = mesh.status()
check("seguido: posición del nodo de bolsillo", st1["tracked"]["id"] == "!1a2b3c4d" and st1["tracked"]["position"]["lat"] == 40.4167754)
check("el seguido no es el propio", st1["tracked"]["isMe"] is False and st1["me"]["id"] == "!5e5e0001")
check("seguimiento persistente", m.Mesh(m.Store(":memory:")).track_id == "!1a2b3c4d")
mesh.nodes()
check("no se archiva la posición de terceros", set(mesh.positions) == {"!1a2b3c4d"})
pocket.pop("position")
st2 = mesh.status()
check("sin posición nueva: la última conocida, marcada", st2["tracked"]["position"]["cached"] is True and st2["tracked"]["position"]["lat"] == 40.4167754)
mesh.set_track({"id": "!0000beef"})
st3 = mesh.status()
check("nodo seguido aún no oído: sin posición, sin inventar", st3["tracked"]["id"] == "!0000beef" and st3["tracked"]["position"] is None)

# --- pedir posición: nunca por el canal público, y el nodo propio no se pide
sent = []
iface.sendData = lambda *a, **k: sent.append(k)
mesh.set_track({"id": None})
check("nodo propio: no se transmite nada", mesh.refresh() == {"requested": None, "reason": "own"} and not sent)
mesh.set_track({"id": "!1a2b3c4d"})
try:
    mesh.refresh()
    check("sin canal privado: no se pide por el público", False)
except ValueError:
    check("sin canal privado: no se pide por el público", not sent)
mesh.iface = None
try:
    mesh.refresh()
    check("sin nodo conectado: error de conexión", False)
except ConnectionError:
    check("sin nodo conectado: error de conexión", True)
mesh.iface = iface

# --- hora por LoRa (solo canal privado, dos muestras coherentes)
pos_pkt = {"fromId": "!1a2b3c4d", "channel": 0, "decoded": {"portnum": "POSITION_APP", "position": {"latitude": 36.5, "time": 1794230800}}}
s1 = m.time_sample(pos_pkt, {0}, 1000.0)
check("muestra de hora del canal privado", s1 == {"from": "!1a2b3c4d", "nodeTime": 1794230800, "mono": 1000.0})
check("canal público: se ignora", m.time_sample({**pos_pkt, "channel": 1}, {0}, 1000.0) is None)
check("sin canal privado: nada", m.time_sample(pos_pkt, set(), 1000.0) is None)
check("hora absurda (antes de 2026): se ignora", m.time_sample({**pos_pkt, "decoded": {"portnum": "POSITION_APP", "position": {"time": 86400}}}, {0}, 1.0) is None)
check("posición sin hora: se ignora", m.time_sample({**pos_pkt, "decoded": {"portnum": "POSITION_APP", "position": {}}}, {0}, 1.0) is None)
check("otros paquetes: se ignoran", m.time_sample({"channel": 0, "decoded": {"portnum": "TEXT_MESSAGE_APP"}}, {0}, 1.0) is None)
s2 = {"from": "!1a2b3c4d", "nodeTime": 1794230800 + 900, "mono": 1900.0}
est = m.estimate_time([s1, s2], 1960.0)
check("dos muestras coherentes: hora proyectada a ahora", est and est["utc"] == 1794231760.0 and est["spreadS"] == 0.0 and est["newestAgeS"] == 60.0)
check("una sola muestra: no basta", m.estimate_time([s1], 1001.0) is None)
bad = {**s2, "nodeTime": s2["nodeTime"] + 60}
check("muestras que discrepan > 10 s: no se fía", m.estimate_time([s1, bad], 1960.0) is None)
check("muestras de hace más de 45 min: no valen", m.estimate_time([s1, s2], 1000.0 + 2701 + 900) is None)

print("TODO OK" if not fails else f"{len(fails)} FALLOS")
sys.exit(1 if fails else 0)
