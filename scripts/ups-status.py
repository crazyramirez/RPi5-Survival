#!/usr/bin/env python3
"""Survival OS — estado de la UPS Geekworm X120x (X1200/X1201/X1202) (survival-ups.timer, cada 30 s).

Solo LEE: nunca escribe en el medidor ni toca el control de carga (GPIO16).
  - Red eléctrica: GPIO6 (BCM, pin 31). La UPS lo conduce activamente: alto = hay red, bajo = sin red o
    fallo del alimentador. Se lee dos veces, con pull-down y con pull-up: si el valor sigue a la resistencia,
    el pin está al aire (no hay UPS o no hace contacto) y NO se informa nada. La última lectura deja el pull-up,
    que es el estado de arranque del pin.
  - Batería: medidor MAX17040 en I²C-1, dirección 0x36 (requiere dtparam=i2c_arm=on). Registros big-endian:
    VCELL (0x02) = 12 bits altos × 1,25 mV; SOC (0x04) = byte alto en %, byte bajo en 1/256 %.
Estado en /run/survival-os/ups.json (lo lee device-api). Sin medida → null con motivo; nunca se estima.
Uso: ups-status.py [--print]
"""
from __future__ import annotations

import ctypes
import errno
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

STATUS_PATH = os.environ.get("UPS_STATUS", "/run/survival-os/ups.json")
I2C_DEV = os.environ.get("UPS_I2C_DEV", "/dev/i2c-1")
GAUGE_ADDR = 0x36
REG_VCELL = 0x02
REG_SOC = 0x04
PLD_CHIP = "pinctrl-rp1"  # cabecera de 40 pines de la Pi 5 (el número de gpiochip cambia entre núcleos)
PLD_LINE = 6
# Una celda Li-ion fuera de este margen no es una lectura creíble del MAX17040.
VCELL_MIN_V = 2.5
VCELL_MAX_V = 4.6
SOC_MAX = 110.0  # el modelo del medidor puede pasar algo de 100 % con la celda llena; más es basura

# --- I²C sin dependencias: ioctl I2C_RDWR (escritura del registro + lectura con repeated start) ---
I2C_RDWR = 0x0707
I2C_M_RD = 0x0001


class _I2cMsg(ctypes.Structure):
    _fields_ = [("addr", ctypes.c_uint16), ("flags", ctypes.c_uint16), ("len", ctypes.c_uint16),
                ("buf", ctypes.POINTER(ctypes.c_uint8))]


class _I2cRdwr(ctypes.Structure):
    _fields_ = [("msgs", ctypes.POINTER(_I2cMsg)), ("nmsgs", ctypes.c_uint32)]


def read_reg16(fd: int, addr: int, reg: int) -> int:
    import fcntl  # solo Linux; las pruebas de funciones puras corren también en Windows

    wbuf = (ctypes.c_uint8 * 1)(reg)
    rbuf = (ctypes.c_uint8 * 2)()
    msgs = (_I2cMsg * 2)(_I2cMsg(addr, 0, 1, wbuf), _I2cMsg(addr, I2C_M_RD, 2, rbuf))
    fcntl.ioctl(fd, I2C_RDWR, _I2cRdwr(msgs, 2))
    return (rbuf[0] << 8) | rbuf[1]


# --- Funciones puras (probadas en tests/python/test_ups_status.py) ---

def decode_vcell(raw: int) -> float:
    return round((raw >> 4) * 1.25 / 1000.0, 3)


def decode_soc(raw: int) -> float:
    return round(raw / 256.0, 1)


def battery_from_raw(vcell_raw: int, soc_raw: int) -> tuple[dict | None, str | None]:
    v = decode_vcell(vcell_raw)
    soc = decode_soc(soc_raw)
    if not (VCELL_MIN_V <= v <= VCELL_MAX_V):
        return None, f"Medidor de la UPS: tensión fuera de rango ({v} V)"
    if not (0.0 <= soc <= SOC_MAX):
        return None, f"Medidor de la UPS: carga fuera de rango ({soc} %)"
    return {"percent": min(soc, 100.0), "voltageV": v}, None


def mains_from_reads(with_pull_down: int | None, with_pull_up: int | None) -> tuple[bool | None, str | None]:
    """Red eléctrica a partir de dos lecturas del GPIO6 con resistencias opuestas."""
    if with_pull_down is None or with_pull_up is None:
        return None, "No se pudo leer el GPIO6 de la UPS"
    if with_pull_down == 0 and with_pull_up == 1:
        return None, "GPIO6 al aire: no hay UPS X120x o no hace contacto"
    if with_pull_down != with_pull_up:
        return None, "GPIO6 inestable durante la lectura"
    return with_pull_up == 1, None


def parse_gpioget(out: str) -> int | None:
    s = out.strip()
    if s in ("0", "1"):
        return int(s)
    # libgpiod 2.x: "6"=active / "6"=inactive
    if s.endswith("=active"):
        return 1
    if s.endswith("=inactive"):
        return 0
    return None


# --- Entrada/salida ---

def read_pld(bias: str) -> int | None:
    for cmd in (["gpioget", f"--bias={bias}", PLD_CHIP, str(PLD_LINE)],                # libgpiod 1.x
                ["gpioget", f"--bias={bias}", "-c", PLD_CHIP, str(PLD_LINE)]):        # libgpiod 2.x
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            return None
        if r.returncode == 0:
            return parse_gpioget(r.stdout)
    return None


def read_battery() -> tuple[dict | None, str | None]:
    if not os.path.exists(I2C_DEV):
        return None, "I²C desactivado: falta dtparam=i2c_arm=on en config.txt"
    try:
        fd = os.open(I2C_DEV, os.O_RDWR)
    except OSError as e:
        return None, f"No se pudo abrir {I2C_DEV} ({errno.errorcode.get(e.errno, e.errno)})"
    try:
        vcell = read_reg16(fd, GAUGE_ADDR, REG_VCELL)
        soc = read_reg16(fd, GAUGE_ADDR, REG_SOC)
    except OSError as e:
        if e.errno in (errno.ENXIO, errno.EREMOTEIO, errno.EIO, errno.ETIMEDOUT):
            return None, "Medidor de la UPS (I²C 0x36) sin respuesta"
        return None, f"Error leyendo el medidor de la UPS ({errno.errorcode.get(e.errno, e.errno)})"
    finally:
        os.close(fd)
    return battery_from_raw(vcell, soc)


def write_status(state: dict) -> None:
    d = os.path.dirname(STATUS_PATH)
    os.makedirs(d, exist_ok=True)
    tmp = f"{STATUS_PATH}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    os.chmod(tmp, 0o644)
    os.replace(tmp, STATUS_PATH)


def main() -> int:
    mains, mains_err = mains_from_reads(read_pld("pull-down"), read_pld("pull-up"))
    battery, battery_err = read_battery()
    state = {
        "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "mains": mains,
        "mainsError": mains_err,
        "battery": battery,
        "batteryError": battery_err,
    }
    if "--print" in sys.argv:
        print(json.dumps(state, ensure_ascii=False))
    else:
        write_status(state)
    return 0


if __name__ == "__main__" and "--selftest" not in sys.argv:
    sys.exit(main())
