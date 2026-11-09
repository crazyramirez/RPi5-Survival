# library (127.0.0.1:8782)

Protocolos de emergencia (`content/protocols/*.md` con front matter obligatorio: id, title, category,
reviewed, sources), índice SQLite FTS5 (`node:sqlite`, sin acentos) de documentos propios en
`/var/lib/survival-os/library/docs` (md, txt, html; PDF con `pdftotext`), favoritos y pasarela de búsqueda
a kiwix-serve. Renderizador Markdown propio que escapa todo el HTML.

API: `GET /status`, `GET /books`, `GET /search?q=`, `GET /protocols[/:id]`, `GET /docs[/:id[/raw]]`,
`POST /reindex`, `GET /favorites`, `PUT|DELETE /favorites/:id`.
