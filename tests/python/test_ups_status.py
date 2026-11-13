"""Pruebas de scripts/ups-status.py (funciones puras: sin I²C ni GPIO).
Uso: python tests/python/test_ups_status.py   (sale con código 0 si todo pasa)
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.argv.append("--selftest")
spec = importlib.util.spec_from_file_location("ups_status", os.path.join(ROOT, "scripts", "ups-status.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

fails = []


def check(name, cond):
    print(("OK   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


# VCELL: 12 bits altos × 1,25 mV. 0xCE40 >> 4 = 3300 → 4,125 V
check("VCELL 0xCE40 = 4,125 V", m.decode_vcell(0xCE40) == 4.125)
check("VCELL ignora los 4 bits bajos", m.decode_vcell(0xCE4F) == 4.125)
# SOC: byte alto en %, byte bajo en 1/256 %. 0x5780 = 87,5 %
check("SOC 0x5780 = 87,5 %", m.decode_soc(0x5780) == 87.5)
check("SOC 0x6400 = 100 %", m.decode_soc(0x6400) == 100.0)

b, err = m.battery_from_raw(0xCE40, 0x5780)
check("batería válida", err is None and b == {"percent": 87.5, "voltageV": 4.125})
b, err = m.battery_from_raw(0xCE40, 0x6580)
check("SOC 101,5 % se recorta a 100", err is None and b["percent"] == 100.0)
b, err = m.battery_from_raw(0x0000, 0x5780)
check("tensión 0 V: no se informa", b is None and "tensión" in err)
b, err = m.battery_from_raw(0xFFFF, 0x5780)
check("tensión 5,1 V: no se informa", b is None and "tensión" in err)
b, err = m.battery_from_raw(0xCE40, 0xFF00)
check("SOC 255 %: no se informa", b is None and "carga" in err)

check("red presente (alto con ambas resistencias)", m.mains_from_reads(1, 1) == (True, None))
check("sin red (bajo con ambas resistencias)", m.mains_from_reads(0, 0) == (False, None))
v, err = m.mains_from_reads(0, 1)
check("pin al aire: no se informa", v is None and "al aire" in err)
v, err = m.mains_from_reads(1, 0)
check("lecturas contradictorias: no se informa", v is None and err)
v, err = m.mains_from_reads(None, 1)
check("sin lectura: no se informa", v is None and err)

check("gpioget 1.x: '1'", m.parse_gpioget("1\n") == 1)
check("gpioget 1.x: '0'", m.parse_gpioget("0\n") == 0)
check("gpioget 2.x: active", m.parse_gpioget('"6"=active\n') == 1)
check("gpioget 2.x: inactive", m.parse_gpioget('"6"=inactive\n') == 0)
check("gpioget basura", m.parse_gpioget("error") is None)

print(f"\n{len(fails)} fallo(s)")
sys.exit(1 if fails else 0)
