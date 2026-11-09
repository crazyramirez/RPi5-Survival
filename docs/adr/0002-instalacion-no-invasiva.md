# ADR 0002 — Instalación de Fase 1 limitada a `~/survival-os`

- **Estado:** aceptada (2026-11-08)
- **Contexto:** la especificación prohíbe alterar arranque, servicios o paquetes sin validar la app y sin autorización. La Pi no tenía Node.
- **Decisión:** `scripts/install.sh` instala runtime Node (tarball oficial verificado con SHA-256) y releases dentro de `~/survival-os`, sin `sudo`. Las releases llevan `SHA256SUMS` interno y se activan con un enlace simbólico atómico (`current`). Se conservan 3.
- **Consecuencias:**
  - (+) Reversible con `rm -rf ~/survival-os`; rollback cambiando el enlace.
  - (+) La Pi no compila (build en PC): menos escritura en SD y sin toolchain en el equipo de campo.
  - (−) Corre como `pi`, no como usuario de servicio. Aceptado solo en Fase 1; Fase 2 migra a `/opt/survival-os` + usuario `survival` (ver `systemd/README.md`).
