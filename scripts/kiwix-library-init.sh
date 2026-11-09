#!/usr/bin/env bash
# Crea un library.xml vacío si no existe (kiwix-serve no arranca sin biblioteca).
set -eu
LIB=/var/lib/survival-os/library/zim/library.xml
mkdir -p "$(dirname "$LIB")"
[ -s "$LIB" ] || printf '<?xml version="1.0" encoding="UTF-8" ?>\n<library version="20110515">\n</library>\n' > "$LIB"
