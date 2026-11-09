#!/usr/bin/env bash
# Survival OS — instala/quita la pasarela Meshtastic (survival-mesh). Lo ejecuta admin-job.py como root.
#   mesh-install.sh install <ruta /dev/serial/by-id/…>   venv con dependencias fijadas por hash + puerto + servicio
#   mesh-install.sh port <ruta /dev/serial/by-id/…>      solo cambia el puerto
#   mesh-install.sh remove                               para el servicio y borra el venv (conserva mensajes)
# Vuelta atrás: `mesh-install.sh remove`.
set -euo pipefail

PREFIX=/opt/survival-os
VENV="$PREFIX/runtime/mesh-venv"
REQ="$PREFIX/current/services/mesh/requirements.txt"
ENVF=/etc/survival-os/mesh.env
info() { echo "==> $*"; }

valid_port() {
  [[ "$1" =~ ^/dev/serial/by-id/[A-Za-z0-9_.:+-]+$ ]] || { echo "ERROR: puerto no válido: $1" >&2; exit 2; }
  [ -e "$1" ] || { echo "ERROR: el puerto no existe ahora mismo (¿nodo conectado?): $1" >&2; exit 2; }
}

write_env() {
  install -d -m 0755 /etc/survival-os
  umask 022
  printf 'MESH_SERIAL=%s\n' "$1" > "$ENVF.tmp" && mv "$ENVF.tmp" "$ENVF"
  info "Puerto del nodo: $1"
}

case "${1:-}" in
  install)
    valid_port "${2:-}"
    [ -f "$REQ" ] || { echo "ERROR: falta $REQ" >&2; exit 1; }
    info "Creando entorno Python en $VENV"
    rm -rf "$VENV.new"
    python3 -m venv "$VENV.new"
    "$VENV.new/bin/pip" install --quiet --disable-pip-version-check --no-cache-dir \
      --require-hashes --only-binary :all: -r "$REQ"
    "$VENV.new/bin/python" -I -c 'import meshtastic, pubsub, serial; print("meshtastic", meshtastic.__version__ if hasattr(meshtastic, "__version__") else "ok")'
    rm -rf "$VENV" && mv "$VENV.new" "$VENV"
    write_env "$2"
    systemctl daemon-reload
    systemctl enable survival-mesh.service >/dev/null
    systemctl restart survival-mesh.service survival-esp32-gateway.service
    info "Pasarela Meshtastic activa"
    ;;
  port)
    valid_port "${2:-}"
    write_env "$2"
    systemctl restart survival-esp32-gateway.service
    systemctl try-restart survival-mesh.service
    ;;
  remove)
    systemctl disable --now survival-mesh.service >/dev/null 2>&1 || true
    rm -rf "$VENV" "$VENV.new" "$ENVF"
    systemctl restart survival-esp32-gateway.service || true
    info "Pasarela Meshtastic quitada (los mensajes guardados siguen en /var/lib/survival-os/mesh)"
    ;;
  *)
    echo "uso: $0 install <puerto> | port <puerto> | remove" >&2
    exit 2
    ;;
esac
