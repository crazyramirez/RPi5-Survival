#!/usr/bin/env bash
# Asistente local (LLM): compila llama.cpp (commit fijado) y descarga un modelo del catálogo cerrado,
# verificado con SHA-256. Lo invoca admin-job.py (tarea llm-install) como root.
#   llm-install.sh <id-modelo>      instala/activa
#   llm-install.sh --remove <id>    borra el modelo (y desactiva el asistente si era el activo)
#   llm-install.sh --disable        desactiva el asistente (conserva los modelos)
set -euo pipefail
LLAMA_COMMIT=7d7f028
LLM=/var/lib/survival-os/llm
RUNTIME=/opt/survival-os/runtime
info() { echo "==> $*"; }

# id  fichero  repo  sha256  bytes
CATALOG='
qwen3-4b      Qwen3-4B-Instruct-2507-Q4_0.gguf   unsloth/Qwen3-4B-Instruct-2507-GGUF   e0ba675d86ab277c61701c6793659b2ae801d95e3be791464c321e6fbf613be2 2375773280
gemma3-4b     gemma-3-4b-it-Q4_K_M.gguf          ggml-org/gemma-3-4b-it-GGUF           882e8d2db44dc554fb0ea5077cb7e4bc49e7342a1f0da57901c0802ea21a0863 2489757856
llama3.2-3b   Llama-3.2-3B-Instruct-Q4_0.gguf    bartowski/Llama-3.2-3B-Instruct-GGUF  4d491003bf6b470e4d04233824c5c939b76d6c81974ba17a3ff207343e1d8e85 1921909280
'
lookup() { echo "$CATALOG" | awk -v id="$1" '$1==id'; }

install -d -o survival -g survival -m 0750 "$LLM" "$LLM/models"

if [ "${1:-}" = "--disable" ]; then
  rm -f "$LLM/active"
  systemctl disable --now survival-llm.service >/dev/null 2>&1 || true
  info "Asistente desactivado"
  exit 0
fi
if [ "${1:-}" = "--remove" ]; then
  row=$(lookup "${2:-}"); [ -n "$row" ] || { echo "Modelo desconocido" >&2; exit 1; }
  file=$(echo "$row" | awk '{print $2}')
  if [ "$(cat "$LLM/active" 2>/dev/null)" = "$file" ]; then rm -f "$LLM/active"; systemctl disable --now survival-llm.service >/dev/null 2>&1 || true; fi
  rm -f "$LLM/models/$file" "$LLM/models/$file.part"
  info "Borrado $file"
  exit 0
fi

row=$(lookup "${1:-}"); [ -n "$row" ] || { echo "Modelo desconocido: ${1:-}" >&2; exit 1; }
read -r _id file repo sha bytes <<< "$row"

# --- llama.cpp (compilado en la propia Pi: GGML_NATIVE aprovecha las extensiones de la Cortex-A76)
LDIR="$RUNTIME/llama.cpp-$LLAMA_COMMIT"
if [ ! -x "$LDIR/llama-server" ]; then
  dpkg -s cmake >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends cmake build-essential git >/dev/null
  SRC="$LLM/src/llama.cpp"
  if [ ! -d "$SRC/.git" ]; then
    rm -rf "$SRC"; mkdir -p "$LLM/src"
    git clone -q https://github.com/ggml-org/llama.cpp.git "$SRC"
  fi
  git -C "$SRC" fetch -q --depth 50 origin || true
  git -C "$SRC" checkout -q "$LLAMA_COMMIT"
  info "Compilando llama.cpp $LLAMA_COMMIT (unos minutos)"
  cmake -S "$SRC" -B "$SRC/build" -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF -DGGML_NATIVE=ON -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF >/dev/null
  cmake --build "$SRC/build" -j4 --target llama-server >/dev/null
  install -d "$LDIR"
  cp -a "$SRC"/build/bin/llama-server "$SRC"/build/bin/*.so* "$LDIR/" 2>/dev/null || cp -a "$SRC/build/bin/llama-server" "$LDIR/"
  chown -R root:root "$LDIR"
fi
ln -sfn "$LDIR" "$RUNTIME/llama"
info "llama-server listo ($LLAMA_COMMIT)"

# --- Modelo
dest="$LLM/models/$file"
if [ ! -f "$dest" ]; then
  avail=$(df -B1 --output=avail "$LLM" | tail -1)
  [ "$bytes" -lt $((avail - 2*1024*1024*1024)) ] || { echo "Espacio insuficiente" >&2; exit 1; }
  info "Descargando $file ($((bytes / 1024 / 1024)) MiB) de Hugging Face"
  sudo -u survival curl -fL --proto '=https' --retry 3 -C - -o "$dest.part" "https://huggingface.co/$repo/resolve/main/$file"
  info "Verificando SHA-256"
  [ "$(sha256sum "$dest.part" | cut -d' ' -f1)" = "$sha" ] || { rm -f "$dest.part"; echo "SHA-256 incorrecto" >&2; exit 1; }
  mv "$dest.part" "$dest"
fi
echo "$file" > "$LLM/active"
chown -R survival:survival "$LLM/models" "$LLM/active"
systemctl enable survival-llm.service >/dev/null 2>&1
systemctl restart survival-llm.service
info "Asistente activo con $file"
