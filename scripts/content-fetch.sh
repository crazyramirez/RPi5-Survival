#!/usr/bin/env bash
# Descarga contenidos ZIM oficiales de Kiwix con verificación SHA-256 y los registra
# en la biblioteca local + manifiesto de procedencia (content-schema).
#
#   sudo content-fetch.sh basico | recomendado | completo | <nombre>:<variante> ...
#   sudo content-fetch.sh --list
#
# Presets (tamaños aproximados, catálogo 2026-10):
#   basico       ~0,3 GB  Wikipedia Médica (nopic), Wikiviajes, Wikilibros
#   recomendado  ~18 GB   basico + Wikipedia ES completa (nopic) + iFixit ES + Wikcionario
#   completo     ~42 GB   Wikipedia ES con imágenes (maxi) + Médica maxi + iFixit + Wikcionario + Wikiviajes/Wikilibros maxi
#
# Requiere red SOLO durante la descarga. Reanuda descargas interrumpidas (.part).
# Licencias: Wikimedia (CC BY-SA 4.0), iFixit (CC BY-NC-SA 3.0). Ver docs/content-sources.md.
set -euo pipefail

DATA=/var/lib/survival-os/library
ZIM_DIR="$DATA/zim"
LIB="$ZIM_DIR/library.xml"
MANIFEST="$DATA/manifest.json"
KIWIX_MANAGE=/opt/survival-os/runtime/kiwix-tools/kiwix-manage
CATALOG=https://library.kiwix.org/catalog/v2/entries
MARGIN=$((2 * 1024 * 1024 * 1024))
# Espejos oficiales de Kiwix por orden de preferencia (sobrescribible). El SHA-256 se toma SIEMPRE del maestro.
MIRRORS="${KIWIX_MIRRORS:-https://ftp.fau.de/kiwix https://mirror.accum.se/mirror/kiwix.org https://mirrors.dotsrc.org/kiwix https://download.kiwix.org}"
MASTER=https://download.kiwix.org

declare -A PRESETS=(
  [basico]="wikipedia_es_medicine:nopic wikivoyage_es_all:nopic wikibooks_es_all:nopic"
  [recomendado]="wikipedia_es_medicine:nopic wikivoyage_es_all:nopic wikibooks_es_all:nopic wikipedia_es_all:nopic ifixit_es_all: wiktionary_es_all:nopic"
  [completo]="wikipedia_es_all:maxi wikipedia_es_medicine:maxi ifixit_es_all: wiktionary_es_all:nopic wikivoyage_es_all:maxi wikibooks_es_all:maxi"
)

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[ "$(id -u)" -eq 0 ] || die "Ejecutar con sudo."
[ $# -gt 0 ] || die "Uso: content-fetch.sh basico|recomendado|completo|nombre:variante … (o --list)"
[ -x "$KIWIX_MANAGE" ] || die "kiwix-tools no instalado (ejecuta install-system.sh)"
install -d -o survival -g survival -m 0750 "$ZIM_DIR"
/opt/survival-os/current/scripts/kiwix-library-init.sh
chown survival:survival "$LIB"

if [ "$1" = "--list" ]; then
  for k in "${!PRESETS[@]}"; do echo "$k: ${PRESETS[$k]}"; done
  exit 0
fi

items=()
for a in "$@"; do
  if [ -n "${PRESETS[$a]:-}" ]; then read -r -a p <<< "${PRESETS[$a]}"; items+=("${p[@]}"); else items+=("$a"); fi
done

# Resuelve nombre:variante → "url tamaño fecha titulo" desde el catálogo OPDS oficial.
resolve() {
  local name="${1%%:*}" flavour="${1#*:}"
  curl -fsSL --max-time 60 "$CATALOG?name=$name&count=20" | python3 -c '
import sys, xml.etree.ElementTree as ET
want = sys.argv[1]
ns = {"a": "http://www.w3.org/2005/Atom"}
best = None
for e in ET.parse(sys.stdin).getroot().findall("a:entry", ns):
    if (e.findtext("a:flavour", "", ns) or "") != want:
        continue
    for l in e.findall("a:link", ns):
        if l.get("type") == "application/x-zim":
            row = (e.findtext("a:updated", "", ns), l.get("href", "").removesuffix(".meta4"), l.get("length", "0"), e.findtext("a:title", "", ns))
            if best is None or row[0] > best[0]:
                best = row
if best:
    print(best[1], best[2], best[0][:10], best[3].replace(" ", "_"))
' "$flavour"
}

for item in "${items[@]}"; do
  [[ "$item" == *:* ]] || item="$item:"
  info "Resolviendo $item"
  read -r url size updated title < <(resolve "$item") || true
  [ -n "${url:-}" ] || { echo "AVISO: $item no encontrado en el catálogo; se omite" >&2; continue; }
  file="$(basename "$url")"
  dest="$ZIM_DIR/$file"
  if [ -f "$dest" ]; then info "$file ya instalado"; continue; fi

  avail=$(df -B1 --output=avail "$ZIM_DIR" | tail -1)
  have=0; [ -f "$dest.part" ] && have=$(stat -c %s "$dest.part")
  if [ $((size - have + MARGIN)) -gt "$avail" ]; then
    echo "AVISO: sin espacio para $file ($((size / 1024 / 1024)) MiB, libres $((avail / 1024 / 1024)) MiB + margen 2 GiB); se omite" >&2
    continue
  fi

  rel="zim/${url#*/zim/}"
  info "Descargando $file ($((size / 1024 / 1024)) MiB)"
  done_dl=0
  for m in $MIRRORS; do
    info "  espejo $m"
    # Abandona un espejo si baja de 200 KB/s durante 30 s; -C - reanuda en el siguiente.
    if sudo -u survival curl -fL --proto '=https' --speed-limit 200000 --speed-time 30 --retry 2 -C - -o "$dest.part" "$m/$rel"; then
      done_dl=1; break
    fi
  done
  [ "$done_dl" -eq 1 ] || { echo "AVISO: no se pudo descargar $file de ningún espejo; se omite" >&2; continue; }
  expected=$(curl -fsSL "$MASTER/$rel.sha256" | awk '{print $1}')
  [ ${#expected} -eq 64 ] || die "No se pudo obtener el SHA-256 de $file"
  actual=$(sha256sum "$dest.part" | awk '{print $1}')
  [ "$expected" = "$actual" ] || { rm -f "$dest.part"; die "SHA-256 incorrecto para $file (borrado)"; }
  mv "$dest.part" "$dest"
  sudo -u survival "$KIWIX_MANAGE" "$LIB" add "$dest"

  # Retirar versiones anteriores y otras variantes (nopic/maxi/mini) del mismo libro.
  base="$(echo "$file" | sed -E 's/(_(maxi|nopic|mini))?_[0-9]{4}-[0-9]{2}\.zim$//')"
  for old in "$ZIM_DIR/${base}"_*.zim; do
    [ "$old" = "$dest" ] || [ ! -f "$old" ] && continue
    info "Retirando versión anterior $(basename "$old")"
    id=$(sudo -u survival "$KIWIX_MANAGE" "$LIB" show 2>/dev/null | awk -v p="$old" '/^id:/{id=$2} index($0,p){print id; exit}')
    [ -n "$id" ] && sudo -u survival "$KIWIX_MANAGE" "$LIB" remove "$id" || true
    rm -f "$old"
  done

  license="CC-BY-SA-4.0"; [[ "$file" == ifixit_* ]] && license="CC-BY-NC-SA-3.0"
  python3 - "$MANIFEST" "$file" "$title" "$updated" "$url" "$size" "$actual" "$license" <<'PY'
import json, os, sys, datetime
path, file, title, updated, url, size, sha, lic = sys.argv[1:]
m = {"schemaVersion": 1, "entries": []}
if os.path.exists(path):
    with open(path) as f: m = json.load(f)
base = file.rsplit("_", 1)[0]
m["entries"] = [e for e in m["entries"] if not e["path"].startswith(f"zim/{base}_")]
m["entries"].append({
    "id": file.removesuffix(".zim"), "kind": "zim", "title": title.replace("_", " "), "language": "es",
    "version": updated, "source": url, "retrievedAt": datetime.date.today().isoformat(),
    "license": lic, "sizeBytes": int(size), "sha256": sha, "path": f"zim/{file}",
})
tmp = path + ".tmp"
with open(tmp, "w") as f: json.dump(m, f, ensure_ascii=False, indent=2)
os.replace(tmp, path)
PY
  chown survival:survival "$MANIFEST"
  info "OK $file (sha256 verificado)"
done

systemctl try-restart survival-kiwix.service || true
info "Hecho. Biblioteca: $(grep -c '<book ' "$LIB" || true) libro(s)."
