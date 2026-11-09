"""Pruebas de scripts/time-sync.py (funciones puras: sin root, sin gpsd, sin malla).
Uso: python tests/python/test_time_sync.py   (sale con código 0 si todo pasa)
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.argv.append("--selftest")
spec = importlib.util.spec_from_file_location("time_sync", os.path.join(ROOT, "scripts", "time-sync.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

fails = []


def check(name, cond):
    print(("OK   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


NOW = 1794231000.0  # 2026-11-09
check("hora gpsd ISO", m.parse_gpsd_time("2026-11-09T13:26:46.000Z") == 1794230806.0)
check("hora gpsd basura o antigua: None", m.parse_gpsd_time("x") is None and m.parse_gpsd_time("2020-01-01T00:00:00Z") is None and m.parse_gpsd_time(None) is None)
check("GNSS: dos lecturas coherentes", m.gnss_estimate([(NOW, 10.0), (NOW + 1, 11.0)]) == NOW + 1)
check("GNSS: una lectura no basta", m.gnss_estimate([(NOW, 10.0)]) is None)
check("GNSS: lecturas incoherentes", m.gnss_estimate([(NOW, 10.0), (NOW + 30, 11.0)]) is None)

check("NTP sincronizado: no se toca", m.decide(True, NOW + 999, {"utc": NOW + 999}, NOW) == {"source": "ntp", "step": None})
d = m.decide(False, None, {"utc": NOW + 3600.0}, NOW)
check("LoRa con 1 h de diferencia: ajusta", d == {"source": "lora", "step": 3600.0, "deltaS": 3600.0})
d = m.decide(False, None, {"utc": NOW + 20.0}, NOW)
check("LoRa con 20 s: verifica sin mover el reloj", d["source"] == "lora" and d["step"] is None)
d = m.decide(False, NOW + 100.0, {"utc": NOW + 5000.0}, NOW)
check("GNSS tiene prioridad sobre LoRa", d["source"] == "gnss" and d["step"] == 100.0)
check("también atrasa si el reloj va adelantado", m.decide(False, None, {"utc": NOW - 7200.0}, NOW)["step"] == -7200.0)
check("sin fuentes: nada", m.decide(None, None, None, NOW) == {"source": None, "step": None})
check("hora LoRa absurda: se ignora", m.decide(False, None, {"utc": 1000.0}, NOW)["source"] is None)

print("TODO OK" if not fails else f"{len(fails)} FALLOS")
sys.exit(1 if fails else 0)
