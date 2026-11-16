"""Pruebas de scripts/games-sync.py (funciones puras: sin red ni disco).
Uso: python tests/python/test_games_sync.py   (sale con código 0 si todo pasa)
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.argv.append("--selftest")
spec = importlib.util.spec_from_file_location("games_sync", os.path.join(ROOT, "scripts", "games-sync.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

fails = []


def check(name, cond):
    print(("OK   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


def raises(fn):
    try:
        fn()
    except m.SyncError:
        return True
    return False


SHA = "a" * 64
check("ruta normal", m.safe_rel("games/alone/assets/Mapa 1.glb") == "games/alone/assets/Mapa 1.glb")
check("acentos permitidos", m.safe_rel("media/luigi/canción.mp3") is not None)
for bad in ["/etc/passwd", "../x", "games/../../etc", "games//x", "games/.git/config", "a\\b", "a/\x00", "", None, 5, "x/" * 30]:
    check(f"ruta rechazada: {bad!r}"[:60], m.safe_rel(bad) is None)

check("URL codificada por segmento", m.url_for("media/luigi pizza/ñ#1.png") == "https://games.viseni.com/media/luigi%20pizza/%C3%B1%231.png")

SW = '// Generated\nconst VERSION = "abc"\nconst FILES = [["index.html","0123456789abcdef"],["game/alone/index.html","fedcba9876543210"],["_nuxt/a%20b.js","0000000000000000"]]\n\nself.addEventListener("x", () => {})\n'
sw = m.parse_sw(SW)
check("sw.js: 3 archivos", len(sw) == 3)
check("sw.js: ruta decodificada", sw[2]["path"] == "_nuxt/a b.js" and sw[2]["hash16"] == "0" * 16)
check("sw.js sin FILES: error", raises(lambda: m.parse_sw("const VERSION = 1")))
check("sw.js con ruta peligrosa: error", raises(lambda: m.parse_sw('const FILES = [["..%2F..%2Fetc%2Fpasswd","0123456789abcdef"]]\n')))
check("sw.js con hash corto: error", raises(lambda: m.parse_sw('const FILES = [["index.html","012"]]\n')))

MAN = {"format": "viseni-offline/1", "generatedAt": "2026-11-13T10:00:00Z",
       "files": [{"path": "games/alone/index.html", "size": 10, "sha256": SHA}],
       "external": [{"file": "games/robert/index.html", "url": "https://cdn.babylonjs.com/babylon.js"}, "basura"]}
files, ext, gen = m.parse_manifest(MAN)
check("manifiesto válido", files == [{"path": "games/alone/index.html", "size": 10, "sha256": SHA}] and gen == "2026-11-13T10:00:00Z")
check("externos: solo entradas válidas", ext == [{"file": "games/robert/index.html", "url": "https://cdn.babylonjs.com/babylon.js"}])
check("formato desconocido: error", raises(lambda: m.parse_manifest({"files": []})))
check("hash corto: error", raises(lambda: m.parse_manifest({**MAN, "files": [{"path": "a", "size": 1, "sha256": "ab"}]})))
check("tamaño negativo: error", raises(lambda: m.parse_manifest({**MAN, "files": [{"path": "a", "size": -1, "sha256": SHA}]})))
check("ruta absoluta: error", raises(lambda: m.parse_manifest({**MAN, "files": [{"path": "/etc/x", "size": 1, "sha256": SHA}]})))

shell = [{"path": "index.html", "hash16": "0" * 16, "size": None}, {"path": "games/alone/index.html", "hash16": "1" * 16, "size": None}]
assets = [{"path": "games/alone/index.html", "size": 10, "sha256": SHA}]
merged = m.merge_entries(shell, assets)
check("unión: el manifiesto manda", len(merged) == 2 and merged[0]["path"] == "games/alone/index.html" and merged[0]["sha256"] == SHA)
check("rutas que solo difieren en mayúsculas: error", raises(lambda: m.merge_entries([], [{"path": "A.png", "size": 1, "sha256": SHA}, {"path": "a.png", "size": 1, "sha256": SHA}])))
check("demasiado grande: error", raises(lambda: m.merge_entries([], [{"path": f"f{i}", "size": m.MAX_FILE, "sha256": SHA} for i in range(7)])))

check("verifica hash completo", m.matches({"sha256": SHA}, SHA) and not m.matches({"sha256": SHA}, "b" * 64))
check("verifica hash corto de sw.js", m.matches({"hash16": "a" * 16}, SHA) and not m.matches({"hash16": "b" * 16}, SHA))
check("juegos presentes", m.game_slugs([{"path": "games/alone/index.html"}, {"path": "games/alone/a/index.html"}, {"path": "media/x/index.html"}, {"path": "games/taki/index.html"}]) == ["alone", "taki"])
check("sin juegos: lista vacía", m.game_slugs([{"path": "media/alone/cover.webp"}, {"path": "index.html"}]) == [])
check("juegos incompletos", m.incomplete_games(["games/alone/a.glb", "games/alone/b.glb", "games/taki/x", "media/y.png", "games/z"]) == ["alone", "taki"])

print(f"\n{len(fails)} fallo(s)")
sys.exit(1 if fails else 0)
