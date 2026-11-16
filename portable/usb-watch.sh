#!/bin/sh
# Survivelia OS · «Abrir al conectar la memoria USB» en macOS y Linux (ADR 0019). Lo instala la aplicación
# (Mantenimiento → Memoria USB) en la carpeta del usuario; no necesita administrador.
#   usb-watch.sh check   macOS: launchd lo ejecuta en cada montaje (StartOnMount + WatchPaths=/Volumes)
#   usb-watch.sh watch   Linux: comprueba los montajes cada 3 s (autoarranque de la sesión)
#   usb-watch.sh seed    marca como vistas las memorias ya conectadas (no pregunta por ellas)
#   usb-watch.sh open    acceso «Survivelia OS (USB)»: abre la memoria emparejada que esté conectada
# Solo reacciona ante memorias EMPAREJADAS (identificador en <memoria>/.survival-os/volume-id).
DIR="$(cd "$(dirname "$0")" && pwd)"
CONF="$DIR/autoopen.conf"
SEEN="$DIR/seen"
OS="$(uname -s)"
TAB="$(printf '\t')"

conf() { sed -n "s/^$1=//p" "$CONF" 2>/dev/null | head -n 1; }
has_volumes() { grep -q '^volume=' "$CONF" 2>/dev/null; }

mounts() {
  # Pruebas automáticas: lista de montajes (uno por línea) en lugar de los del sistema.
  if [ -n "$SURVIVAL_WATCH_MOUNTS" ]; then printf '%s\n' "$SURVIVAL_WATCH_MOUNTS"; return; fi
  if [ "$OS" = Darwin ]; then
    for m in /Volumes/*; do [ -d "$m" ] && [ ! -L "$m" ] && printf '%s\n' "$m"; done
  else
    u="$(id -un)"
    for m in /media/"$u"/* /run/media/"$u"/* /media/* /mnt/*; do [ -d "$m" ] && printf '%s\n' "$m"; done
  fi
}

# Memorias emparejadas conectadas: «id<TAB>montaje<TAB>carpeta».
paired() {
  mounts | while IFS= read -r m; do
    f="$m/.survival-os/volume-id"
    [ -f "$f" ] || continue
    id="$(head -c 64 "$f" 2>/dev/null | tr -cd '0-9a-f')"
    [ ${#id} -eq 32 ] || continue
    rel="$(awk -F "$TAB" -v id="volume=$id" '$1 == id { print ($2 == "" ? "." : $2); exit }' "$CONF" 2>/dev/null)"
    [ -n "$rel" ] && printf '%s\t%s\t%s\n' "$id" "$m" "$rel"
  done
}

ask() { # ask "texto" → 0 si el usuario acepta
  title="$(conf msg.title)"; yes="$(conf msg.yes)"; no="$(conf msg.no)"
  [ -n "$title" ] || title="Survivelia OS"; [ -n "$yes" ] || yes="Abrir"; [ -n "$no" ] || no="Ahora no"
  if [ "$OS" = Darwin ]; then
    r="$(osascript -e 'on run argv' \
      -e 'set d to display dialog (item 1 of argv) with title (item 2 of argv) buttons {item 3 of argv, item 4 of argv} default button 2 giving up after 120 with icon (POSIX file (item 5 of argv))' \
      -e 'if gave up of d then return ""' -e 'return button returned of d' -e 'end run' \
      "$1" "$title" "$no" "$yes" "$DIR/icon.icns" 2>/dev/null)"
    [ "$r" = "$yes" ]
    return
  fi
  if command -v zenity >/dev/null 2>&1; then
    zenity --question --title="$title" --text="$1" --ok-label="$yes" --cancel-label="$no" --window-icon="$DIR/icon.png" --timeout=120 2>/dev/null
    return
  fi
  if command -v kdialog >/dev/null 2>&1; then
    kdialog --title "$title" --icon "$DIR/icon.png" --yes-label "$yes" --no-label "$no" --yesno "$1" 2>/dev/null
    return
  fi
  if command -v notify-send >/dev/null 2>&1 && notify-send --help 2>/dev/null | grep -q -- '--action'; then
    r="$(timeout 120 notify-send -i "$DIR/icon.png" -A "open=$yes" -w "$title" "$1" 2>/dev/null)"
    [ "$r" = open ]
    return
  fi
  return 1
}

info() { # info "texto"
  title="$(conf msg.title)"; [ -n "$title" ] || title="Survivelia OS"
  if [ "$OS" = Darwin ]; then
    osascript -e 'on run argv' -e 'display alert (item 1 of argv) message (item 2 of argv)' -e 'end run' "$title" "$1" >/dev/null 2>&1
  else
    ( zenity --info --title="$title" --text="$1" || kdialog --title "$title" --msgbox "$1" || notify-send -i "$DIR/icon.png" "$title" "$1" ) >/dev/null 2>&1
  fi
}

launch() { # launch montaje carpeta
  t="$1/$2"
  if [ "$SURVIVAL_WATCH_DRY" = 1 ]; then printf '%s\n' "$t" >> "$DIR/launched"; return; fi # pruebas
  if [ "$OS" = Darwin ]; then
    # Memorias preparadas con una versión anterior: «Survival OS.app».
    if [ -d "$t/Survivelia OS.app" ]; then open "$t/Survivelia OS.app"; else open "$t/Survival OS.app"; fi
  else
    ( cd "$t" && nohup sh ./abrir-survival-os.sh >/dev/null 2>&1 & )
  fi
}

act() { # act id montaje carpeta
  if [ "$(conf mode)" != open ]; then
    name="$(basename "$2")"
    text="$(conf msg.ask)"; [ -n "$text" ] || text="¿Abrir Survivelia OS?"
    # {name} → nombre de la unidad (sin interpretar nada del nombre como orden).
    text="$(printf '%s' "$text" | awk -v n="$name" '{ i = index($0, "{name}"); if (i) $0 = substr($0, 1, i - 1) n substr($0, i + 6); print }')"
    ask "$text" || return 0
  fi
  launch "$2" "$3"
}

check() {
  [ -f "$CONF" ] || return 0
  [ "$OS" = Darwin ] && sleep 1 # que el montaje termine
  now="$(paired)"
  old="$(cat "$SEEN" 2>/dev/null)"
  printf '%s\n' "$now" > "$SEEN.tmp" && mv "$SEEN.tmp" "$SEEN"
  printf '%s\n' "$now" | while IFS="$TAB" read -r id m rel; do
    [ -n "$id" ] || continue
    printf '%s\n' "$old" | grep -qF "$id$TAB$m$TAB" && continue
    act "$id" "$m" "$rel"
  done
}

case "$1" in
  check) check ;;
  seed) [ -f "$CONF" ] && paired > "$SEEN" ;;
  watch)
    [ "$OS" = Darwin ] && exit 0
    if [ -f "$DIR/watch.pid" ] && kill -0 "$(cat "$DIR/watch.pid" 2>/dev/null)" 2>/dev/null; then exit 0; fi
    echo $$ > "$DIR/watch.pid"
    [ -f "$CONF" ] && paired > "$SEEN"
    while [ -f "$CONF" ] && has_volumes; do
      check
      sleep 3
    done
    rm -f "$DIR/watch.pid"
    ;;
  open)
    first="$(paired | head -n 1)"
    if [ -n "$first" ]; then
      m="$(printf '%s' "$first" | cut -f 2)"; rel="$(printf '%s' "$first" | cut -f 3)"
      launch "$m" "$rel"
    else
      text="$(conf msg.connect)"; [ -n "$text" ] || text="Conecta la memoria USB de Survivelia OS."
      info "$text"
    fi
    ;;
  *) echo "uso: $0 check|watch|seed|open" >&2; exit 2 ;;
esac
