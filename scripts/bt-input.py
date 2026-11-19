#!/usr/bin/env python3
"""Survivelia OS — teclados, ratones y mandos Bluetooth (BlueZ por D-Bus).

    bt-input.py status|scan|pair|connect|remove [MAC] --result <fichero.json>

- Pi / Linux con systemd: lo lanza admin-job.py (tarea `bluetooth`) como root.
- Portable en Linux: lo lanza la web sin privilegios (BlueZ permite hablar con org.bluez a cualquier usuario).

El estado se escribe en --result de forma atómica mientras la tarea sigue viva (la interfaz lo sondea cada segundo):
dispositivos encontrados durante la búsqueda y, al emparejar, la clave que hay que escribir en el teclado y cuántas
cifras lleva. Los errores salen como códigos fijos que traduce la interfaz. Registro legible por la interfaz en stdout.
Nunca se ejecuta un shell: solo D-Bus y, como root, /sys/class/rfkill.
"""
import json
import os
import re
import secrets
import signal
import sys
import time

MAC_RE = re.compile(r"^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")
ACTIONS = ("status", "scan", "pair", "connect", "remove")
SCAN_SECONDS = 40
PAIR_TIMEOUT = 90
FIND_SECONDS = 15
CONNECT_SECONDS = 15
AGENT_PATH = "/org/survivalos/btagent"
BLUEZ = "org.bluez"


def say(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def kind_of(props):
    """Tipo de dispositivo de entrada por Icon, Appearance (BLE) o Class (clásico)."""
    icon = str(props.get("Icon", ""))
    if icon == "input-keyboard":
        return "keyboard"
    if icon in ("input-mouse", "input-tablet"):
        return "pointer"
    if icon == "input-gaming":
        return "gamepad"
    appearance = int(props.get("Appearance", 0) or 0)
    if appearance == 0x03C1:
        return "keyboard"
    if appearance in (0x03C2, 0x03C5, 0x03C6):
        return "pointer"
    if appearance in (0x03C3, 0x03C4):
        return "gamepad"
    cls = int(props.get("Class", 0) or 0)
    if (cls >> 8) & 0x1F == 0x05:  # periférico
        minor = (cls >> 6) & 0x3
        if minor in (1, 3):  # teclado / teclado + puntero
            return "keyboard"
        if minor == 2:
            return "pointer"
        return "gamepad" if (cls >> 2) & 0xF in (1, 2) else "other-input"
    return "other"


def write_json(path, data):
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def main():
    args = sys.argv[1:]
    if "--result" not in args:
        sys.exit("falta --result")
    i = args.index("--result")
    result_path = args[i + 1] if i + 1 < len(args) else ""
    rest = args[:i] + args[i + 2:]
    action = rest[0] if rest else ""
    mac = (rest[1] if len(rest) > 1 else "").upper()
    if action not in ACTIONS:
        sys.exit("acción no válida")
    if action in ("pair", "connect", "remove") and not MAC_RE.match(mac):
        sys.exit("dirección no válida")
    if not result_path or "\x00" in result_path:
        sys.exit("resultado no válido")

    state = {
        "action": action,
        "phase": "starting",
        "target": mac or None,
        "passkey": None,
        "entered": None,
        "error": None,
        "adapter": {"present": False, "powered": False, "name": None},
        "devices": [],
        "paired": [],
        "scanEndsAt": None,
        "updatedAt": None,
    }

    def flush():
        state["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        try:
            write_json(result_path, state)
        except OSError as e:
            say(f"No se pudo escribir el resultado: {e}")

    def fail(code, detail=""):
        state["phase"] = "error"
        state["error"] = code
        flush()
        say(f"ERROR {code}{': ' + detail if detail else ''}")

    flush()
    try:
        import dbus
        import dbus.mainloop.glib
        import dbus.service
        from gi.repository import GLib
    except ImportError as e:
        fail("no-dbus", str(e))
        return 3

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    try:
        bus = dbus.SystemBus()
        manager = dbus.Interface(bus.get_object(BLUEZ, "/"), "org.freedesktop.DBus.ObjectManager")
        objects = manager.GetManagedObjects()
    except dbus.exceptions.DBusException as e:
        fail("no-service", e.get_dbus_name() or "")
        return 3

    adapter_path = next((p for p, ifs in objects.items() if "org.bluez.Adapter1" in ifs), None)
    if adapter_path is None:
        fail("no-adapter")
        return 3
    adapter_obj = bus.get_object(BLUEZ, adapter_path)
    adapter = dbus.Interface(adapter_obj, "org.bluez.Adapter1")
    adapter_props = dbus.Interface(adapter_obj, "org.freedesktop.DBus.Properties")
    loop = GLib.MainLoop()

    def read_adapter():
        p = adapter_props.GetAll("org.bluez.Adapter1")
        state["adapter"] = {"present": True, "powered": bool(p.get("Powered", False)), "name": str(p.get("Alias") or p.get("Name") or "") or None}

    def device_info(props):
        name = props.get("Name")
        return {
            "mac": str(props.get("Address", "")),
            "name": str(name) if name else None,
            "kind": kind_of(props),
            "rssi": int(props["RSSI"]) if "RSSI" in props else None,
            "paired": bool(props.get("Paired", False)),
            "connected": bool(props.get("Connected", False)),
            "trusted": bool(props.get("Trusted", False)),
        }

    def devices():
        out = []
        for path, ifs in manager.GetManagedObjects().items():
            props = ifs.get("org.bluez.Device1")
            if props is not None and str(props.get("Adapter", "")) == adapter_path:
                out.append((str(path), device_info(props)))
        return out

    order = {"keyboard": 0, "pointer": 1, "gamepad": 2, "other-input": 3, "other": 4}

    def refresh_lists():
        devs = [d for _, d in devices()]
        state["paired"] = sorted((d for d in devs if d["paired"]), key=lambda d: (order[d["kind"]], (d["name"] or d["mac"]).lower()))
        # Encontrados: sin emparejar y con nombre (los anónimos son balizas BLE), salvo que se anuncien como entrada.
        found = [d for d in devs if not d["paired"] and (d["name"] or d["kind"] != "other")]
        state["devices"] = sorted(found, key=lambda d: (order[d["kind"]], -(d["rssi"] if d["rssi"] is not None else -999)))

    def device_path(address):
        return next((p for p, d in devices() if d["mac"] == address), None)

    def power_on():
        read_adapter()
        if state["adapter"]["powered"]:
            return True
        # Como root: quitar el bloqueo por software (rfkill) antes de encender.
        if os.geteuid() == 0:
            base = "/sys/class/rfkill"
            for entry in os.listdir(base) if os.path.isdir(base) else []:
                try:
                    with open(f"{base}/{entry}/type", encoding="ascii") as f:
                        if f.read().strip() != "bluetooth":
                            continue
                    with open(f"{base}/{entry}/soft", "w", encoding="ascii") as f:
                        f.write("0")
                    say("Bluetooth desbloqueado (rfkill)")
                except OSError:
                    pass
        try:
            adapter_props.Set("org.bluez.Adapter1", "Powered", dbus.Boolean(True))
        except dbus.exceptions.DBusException as e:
            fail("blocked" if "Blocked" in (e.get_dbus_name() or "") or "rfkill" in str(e).lower() else "power", str(e))
            return False
        for _ in range(20):
            read_adapter()
            if state["adapter"]["powered"]:
                say("Bluetooth encendido")
                return True
            time.sleep(0.25)
        fail("power")
        return False

    # ------------------------------------------------------------ fin ordenado (SIGTERM = «parar» desde la interfaz)
    cleanup = []
    exit_code = [0]

    def finish(code=0):
        exit_code[0] = code
        for fn in reversed(cleanup):
            try:
                fn()
            except Exception:  # noqa: BLE001 — limpiar todo lo posible
                pass
        cleanup.clear()
        if loop.is_running():
            loop.quit()
        return False

    def on_term():
        if state["phase"] not in ("done", "error"):
            state["phase"] = "canceled"
            flush()
        say("Detenido")
        return finish(0)

    GLib.unix_signal_add(GLib.PRIORITY_HIGH, signal.SIGTERM, on_term)
    GLib.unix_signal_add(GLib.PRIORITY_HIGH, signal.SIGINT, on_term)

    # ------------------------------------------------------------ status
    read_adapter()
    refresh_lists()
    if action == "status":
        state["phase"] = "done"
        flush()
        say(f"Adaptador {'encendido' if state['adapter']['powered'] else 'apagado'}; {len(state['paired'])} emparejado(s)")
        return 0

    # ------------------------------------------------------------ remove
    if action == "remove":
        path = device_path(mac)
        if path is None:
            say("Ya no estaba emparejado")
        else:
            try:
                adapter.RemoveDevice(dbus.ObjectPath(path))
                say(f"Desvinculado {mac}")
            except dbus.exceptions.DBusException as e:
                fail("failed", str(e))
                return 1
        refresh_lists()
        state["phase"] = "done"
        flush()
        return 0

    if not power_on():
        return 1

    # ------------------------------------------------------------ scan
    if action == "scan":
        try:
            adapter.SetDiscoveryFilter({"Transport": dbus.String("auto"), "DuplicateData": dbus.Boolean(False)})
        except dbus.exceptions.DBusException:
            pass
        try:
            adapter.StartDiscovery()
        except dbus.exceptions.DBusException as e:
            if "InProgress" not in (e.get_dbus_name() or ""):
                fail("failed", str(e))
                return 1
        cleanup.append(lambda: adapter.StopDiscovery())
        state["phase"] = "scanning"
        state["scanEndsAt"] = int((time.time() + SCAN_SECONDS) * 1000)
        say("Buscando dispositivos…")
        seen = set()

        def tick():
            refresh_lists()
            for d in state["devices"]:
                if d["mac"] not in seen:
                    seen.add(d["mac"])
                    say(f"Encontrado: {d['name'] or d['mac']} ({d['kind']})")
            flush()
            return True

        def done():
            refresh_lists()
            state["phase"] = "done"
            flush()
            say(f"Búsqueda terminada: {len(state['devices'])} dispositivo(s)")
            return finish(0)

        tick()
        GLib.timeout_add(1000, tick)
        GLib.timeout_add_seconds(SCAN_SECONDS, done)
        loop.run()
        return exit_code[0]

    # ------------------------------------------------------------ connect (ya emparejado)
    def wait_connected(path, on_ok, on_fail):
        dev_props = dbus.Interface(bus.get_object(BLUEZ, path), "org.freedesktop.DBus.Properties")
        deadline = time.time() + CONNECT_SECONDS

        def check():
            try:
                if bool(dev_props.Get("org.bluez.Device1", "Connected")):
                    on_ok()
                    return False
            except dbus.exceptions.DBusException:
                pass
            if time.time() > deadline:
                on_fail()
                return False
            return True

        GLib.timeout_add(500, check)

    def connect_then_done(path):
        state["phase"] = "connecting"
        flush()
        dev = dbus.Interface(bus.get_object(BLUEZ, path), "org.bluez.Device1")
        # Muchos teclados se conectan solos al emparejar: un error de Connect no es definitivo, manda Connected.
        dev.Connect(reply_handler=lambda: None, error_handler=lambda e: say(f"Connect: {e.get_dbus_name()}"), timeout=CONNECT_SECONDS + 5)

        def ok():
            refresh_lists()
            state["phase"] = "done"
            flush()
            say("Conectado")
            finish(0)

        def ko():
            refresh_lists()
            # Emparejado y de confianza: se conectará solo en cuanto se pulse una tecla.
            state["phase"] = "done" if action == "pair" else "error"
            state["error"] = None if action == "pair" else "not-connected"
            flush()
            say("Emparejado; se conectará al pulsar una tecla" if action == "pair" else "No se pudo conectar")
            finish(0 if action == "pair" else 1)

        wait_connected(path, ok, ko)

    if action == "connect":
        path = device_path(mac)
        if path is None:
            fail("not-found")
            return 1
        connect_then_done(path)
        loop.run()
        return exit_code[0]

    # ------------------------------------------------------------ pair
    class Agent(dbus.service.Object):
        """Agente propio solo durante este emparejamiento: muestra la clave en la interfaz y acepta lo demás."""

        def show(self, phase, code, entered=None):
            state["phase"] = phase
            state["passkey"] = code
            state["entered"] = entered
            flush()

        @dbus.service.method("org.bluez.Agent1", in_signature="", out_signature="")
        def Release(self):
            pass

        @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="s")
        def RequestPinCode(self, device):
            pin = f"{secrets.randbelow(1_000_000):06d}"
            say("Teclado antiguo: escribe el PIN en el teclado y pulsa Intro")
            self.show("pin", pin)
            return pin

        @dbus.service.method("org.bluez.Agent1", in_signature="os", out_signature="")
        def DisplayPinCode(self, device, pincode):
            self.show("pin", str(pincode))

        @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="u")
        def RequestPasskey(self, device):
            passkey = secrets.randbelow(1_000_000)
            self.show("passkey", f"{passkey:06d}", 0)
            return dbus.UInt32(passkey)

        @dbus.service.method("org.bluez.Agent1", in_signature="ouq", out_signature="")
        def DisplayPasskey(self, device, passkey, entered):
            if state["passkey"] is None:
                say("Escribe la clave en el teclado y pulsa Intro")
            self.show("passkey", f"{int(passkey):06d}", int(entered))

        @dbus.service.method("org.bluez.Agent1", in_signature="ou", out_signature="")
        def RequestConfirmation(self, device, passkey):
            pass  # emparejamiento pedido por la persona desde la pantalla

        @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="")
        def RequestAuthorization(self, device):
            pass

        @dbus.service.method("org.bluez.Agent1", in_signature="os", out_signature="")
        def AuthorizeService(self, device, uuid):
            pass

        @dbus.service.method("org.bluez.Agent1", in_signature="", out_signature="")
        def Cancel(self):
            say("El teclado canceló el emparejamiento")

    agent = Agent(bus, AGENT_PATH)
    agent_manager = dbus.Interface(bus.get_object(BLUEZ, "/org/bluez"), "org.bluez.AgentManager1")
    try:
        agent_manager.RegisterAgent(AGENT_PATH, "KeyboardDisplay")
        cleanup.append(lambda: agent_manager.UnregisterAgent(AGENT_PATH))
    except dbus.exceptions.DBusException as e:
        fail("failed", str(e))
        return 1

    errors = {
        "org.bluez.Error.AuthenticationFailed": "auth-failed",
        "org.bluez.Error.AuthenticationRejected": "auth-failed",
        "org.bluez.Error.AuthenticationCanceled": "canceled-remote",
        "org.bluez.Error.AuthenticationTimeout": "timeout",
        "org.bluez.Error.ConnectionAttemptFailed": "unreachable",
        "org.bluez.Error.InProgress": "busy",
        "org.freedesktop.DBus.Error.NoReply": "timeout",
    }

    def start_pair(path):
        state["phase"] = "pairing"
        flush()
        say(f"Emparejando con {mac}…")
        dev = dbus.Interface(bus.get_object(BLUEZ, path), "org.bluez.Device1")
        dev_props = dbus.Interface(bus.get_object(BLUEZ, path), "org.freedesktop.DBus.Properties")

        def cancel_pairing():
            if state["phase"] not in ("done", "connecting"):
                dev.CancelPairing()

        cleanup.append(cancel_pairing)

        def paired():
            say("Emparejado")
            try:
                dev_props.Set("org.bluez.Device1", "Trusted", dbus.Boolean(True))  # se reconecta solo al encender
            except dbus.exceptions.DBusException as e:
                say(f"Trusted: {e.get_dbus_name()}")
            state["passkey"] = None
            state["entered"] = None
            connect_then_done(path)

        def pair_error(e):
            name = e.get_dbus_name() or ""
            if name == "org.bluez.Error.AlreadyExists":
                paired()
                return
            fail(errors.get(name, "failed"), name)
            finish(1)

        dev.Pair(reply_handler=paired, error_handler=pair_error, timeout=PAIR_TIMEOUT)

    path = device_path(mac)
    if path is not None:
        start_pair(path)
    else:
        # Ya no está en la lista (BlueZ olvida pronto lo que no se ve): buscarlo un momento.
        say("Buscando el dispositivo…")
        state["phase"] = "searching"
        flush()
        try:
            adapter.StartDiscovery()
        except dbus.exceptions.DBusException:
            pass
        deadline = time.time() + FIND_SECONDS

        def look():
            found = device_path(mac)
            if found is not None or time.time() > deadline:
                try:
                    adapter.StopDiscovery()
                except dbus.exceptions.DBusException:
                    pass
                if found is None:
                    fail("not-found")
                    finish(1)
                else:
                    start_pair(found)
                return False
            return True

        GLib.timeout_add(500, look)

    loop.run()
    return exit_code[0]


if __name__ == "__main__":
    sys.exit(main())
