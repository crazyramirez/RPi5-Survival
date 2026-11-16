# ADR 0019 — Memoria USB de Survival OS: integrada en Windows, macOS y Linux

- **Estado:** aceptada (2026-11-16) a petición del usuario («que en Windows, macOS y Linux, si la app está en un
  USB, tenga su icono, se vea integrada, sea muy fácil de ejecutar y se abra al conectar el USB»). Amplía el ADR 0014.
- **Contexto:**
  - Ningún sistema actual arranca un programa de una memoria USB por sí solo:
    - Windows lo bloquea desde Windows 7; de `autorun.inf` solo respeta el **icono** y el **nombre** de la unidad;
    - macOS no lo ha permitido nunca;
    - en Linux, GNOME **pregunta** antes de ejecutar `autorun.sh`.
  - El lanzador de Windows era un `.cmd`, con icono genérico, y la raíz mostraba `app/`, `runtime/`, tres lanzadores…
  - Retirar la memoria con la app abierta puede dañar el índice SQLite (ADR 0014).
- **Decisión:** dos niveles.
  - **Nivel 1 — la memoria por sí sola, sin tocar el equipo** (`portable/usb.mjs`, `decorate()`; lo aplica el
    lanzador en cada arranque, de forma idempotente, y «Preparar una memoria USB»):
    - **Icono y nombre de la unidad:**
      - Windows: `autorun.inf` con `icon=` y `label=`;
      - macOS: `.VolumeIcon.icns` y la marca de icono personalizado (`com.apple.FinderInfo`);
      - Linux: `.xdg-volume-info` y `.VolumeIcon.png`.
    - **Raíz limpia:** `app/`, `runtime/` y los ficheros de integración llevan el atributo «oculto». En FAT/exFAT
      ese bit lo comparten Windows y macOS, así que **nunca** se ocultan `Survival OS.exe` ni `Survival OS.app`:
      desaparecerían en el otro sistema. Linux ignora ese bit; allí oculta con `.hidden` lo de Windows y macOS.
    - **En una subcarpeta**, no en la raíz: icono de la carpeta en Windows (`desktop.ini`). Nunca se toca nada si
      la carpeta es la raíz de un disco **interno**.
    - **Windows: `Survival OS.exe`** (`portable/win/SurvivalOS.cs`, 19 KB):
      - lleva el icono (ICO multitamaño) y abre la app sin consola;
      - se compila al empaquetar con el `csc.exe` de .NET Framework 4, incluido en Windows 10/11, sin dependencias;
      - fuera de Windows no se compila: se usa `Abrir Survival OS.cmd`, sin «abrir al conectar».
    - **Linux:** `autorun.sh` → GNOME ofrece «Ejecutar» al conectar (siempre pregunta).
    - **Icono de la ventana:** favicon y manifest en la web (`scripts/build-icons.mjs`; mismo dibujo, `portable/icon.mjs`).
  - **Nivel 2 — «Abrir al conectar esta memoria»** (`portable/autoopen.mjs`):
    - Opcional, **una vez por equipo y con permiso explícito** (aviso la primera vez o Mantenimiento → Memoria USB).
      Por usuario, sin administrador; se quita con un clic.
    - **Vigilantes:**
      - Windows: `Survival OS.exe --watch`, copiado a `%LOCALAPPDATA%\Survival OS USB` y registrado en
        `HKCU\…\Run`; escucha eventos WMI `Win32_VolumeChangeEvent`; ~10 MB de memoria;
      - macOS: LaunchAgent con `StartOnMount` y `WatchPaths=/Volumes` → `usb-watch.sh check`;
      - Linux: autoarranque de la sesión → `usb-watch.sh watch` (comprueba los montajes cada 3 s, con `sh`).
    - **Seguridad:**
      - solo reacciona ante memorias **emparejadas**: identificador aleatorio de 128 bits en
        `<memoria>/.survival-os/volume-id`, anotado en `autoopen.conf`. Nunca ejecuta una memoria cualquiera;
      - **pregunta por defecto**; «abrir directamente» es opcional;
      - textos validados (una línea, ≤ 300 caracteres) y pasados como argumentos o variables, nunca interpolados en código.
    - **Acceso «Survival OS (USB)»** en el menú Inicio, Aplicaciones o menú de aplicaciones: abre la memoria si está conectada.
    - **Textos** de los avisos en el idioma de la interfaz; se actualizan al abrir la app.
    - **Vigilante al día:** se actualiza solo al arrancar desde la memoria emparejada.
  - **Expulsar la memoria USB** (Mantenimiento y Sistema):
    - no se puede expulsar mientras Node se ejecuta desde ella. El lanzador lanza un ayudante **fuera de la memoria**
      (PowerShell o `sh` en línea) y se cierra con la ventana;
    - el ayudante espera a que termine, la expulsa (Shell «Eject», `diskutil eject`, `gio mount -e`/`udisksctl`) y avisa
      «Ya puedes retirarla», o explica qué hacer si algo la retiene.
  - **Preparar una memoria USB** (tarea `usb-prepare`, `portable-admin.mjs`):
    - copia la app y **todos los sistemas que incluya esta carpeta** a la raíz de otra memoria, y opcionalmente los datos;
    - nunca sobrescribe los datos que ya tenga la memoria; la app se copia al lado (`.part`) y luego se cambia;
    - en FAT32 avisa y omite los ficheros de más de 4 GB (recomienda exFAT);
    - la integra (nivel 1), le da su identificador y la renombra a «SURVIVAL OS» si el sistema lo permite sin
      administrador (Windows `label`, macOS `diskutil rename`; Linux: `.xdg-volume-info`).
- **Consecuencias y límites:**
  - Sigue **sin firma de código**: SmartScreen y Gatekeeper avisan la primera vez (ADR 0014).
  - macOS puede pedir permiso de «volúmenes extraíbles» al vigilante. El icono de volumen en exFAT y el aviso con
    botón en algunos escritorios Linux están **pendientes de validar en equipos reales**.
  - En GNOME, con «abrir al conectar» activado, pueden aparecer dos avisos: el de `autorun.sh` y el del vigilante.
  - La ventana `--app` usa el favicon. La agrupación en la barra de tareas o el Dock sigue siendo la del navegador.
  - El nombre de la unidad en Linux no se cambia: exige root.
- **Validado el 2026-11-16 (Windows 11):**
  - compilación de `Survival OS.exe` con icono;
  - pruebas automáticas: integración, configuración, vigilante `sh` real y «Preparar» sobre carpetas temporales.
