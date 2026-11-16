# AGENTS.md — Guía para agentes de IA (Claude, OpenAI Codex, Gemini y otros)

Este fichero es para **agentes LLM que trabajan en nombre de una persona**: instalar Survival OS en una Raspberry Pi
o en un Linux, preparar la versión portable en Windows, macOS o Linux, y configurarlo todo (idioma, país, descargas)
**en lenguaje natural**. Claude Code lo lee a través de `CLAUDE.md`, Gemini CLI a través de `GEMINI.md`, y Codex y
otros directamente.

La persona puede no saber nada técnico. **Guíala paso a paso, pregunta lo que necesites y explica lo que vas a hacer
antes de hacerlo.** Contesta en su idioma.

---

## 1. Qué es Survival OS (en una frase)

Un centro de conocimiento, mapas y comunicación **sin Internet**:

- mapas de cualquier país con rutas;
- Wikipedia y otros libros, y 66 manuales en PDF;
- 41 protocolos de emergencia;
- asistente de IA local;
- radio LoRa y bóveda cifrada;
- en español, inglés, francés e italiano.

Funciona de tres formas:

- **Raspberry Pi 5** (o Linux con systemd): un terminal dedicado; en la Pi, a pantalla completa (quiosco).
- **Portable:** una carpeta que se abre en Windows, macOS o Linux, sin instalar nada.
- **Android:** un APK para tablets y móviles (Android 10 o posterior).

Más contexto para humanos: [README.md](README.md).

---

## 2. Primero: averigua qué quiere y dónde

Pregunta solo lo que no sepas. Con estas respuestas eliges el camino:

| Pregunta | Para qué |
|---|---|
| ¿Dónde lo quieres? **(a)** en este ordenador · **(b)** en una Raspberry Pi o en otro Linux de tu red · **(c)** en una tablet o un móvil Android | Elegir la sección 4, la 5 o la 6 |
| (b) ¿La Pi ya tiene **Raspberry Pi OS de 64 bits con escritorio** instalado y conectado a la red? | Si no, sigue la sección 5.1 |
| (b) ¿Cuál es su **IP** (o nombre, p. ej. `raspberrypi.local`) y su **usuario**? | Acceso SSH |
| ¿En qué **idioma** la quieres? (es, en, fr, it) | Ajustes por defecto |
| ¿En qué **país** estás o vas a usarla? | Mapas y contenidos por defecto |
| ¿Quieres **descargarlo todo** ahora? (puede ocupar 40–60 GB y tardar horas) | Descargas |

Ejecuta todo **desde la raíz de este repositorio**. Empieza siempre con:

```sh
npm run express -- doctor
```

`doctor` dice qué falta en este ordenador (Node 24.15 o posterior, dependencias, cliente SSH…). Si falta Node,
indica a la persona cómo instalarlo (<https://nodejs.org>, versión LTS 24 o posterior) y espera.

---

## 3. Reglas de seguridad (obligatorias)

- **Contraseñas:** nunca las escribas en ficheros, en commits ni en la memoria del agente. Si la persona te da la
  contraseña de la Pi, úsala solo para el paso que la necesite y no la repitas. Es preferible la **clave SSH** de la
  sección 5.2, que evita volver a pedirla.
- **Confirma antes de cambiar un sistema:** instalar en la Pi, reiniciarla o lanzar descargas grandes. Di qué se va a
  hacer y espera un «sí». `express pi` sin `--yes` solo describe lo que haría.
- **No reformatees discos** ni toques particiones. Para grabar la tarjeta de la Pi, guía a la persona con Raspberry
  Pi Imager (sección 5.1); no lo hagas tú.
- **No abras puertos** ni expongas la app a Internet. Survival OS escucha solo en el propio equipo. Para los móviles de
  la red local ya existen el punto de acceso de la Pi y «Compartir en la red local» de la portable.
- **Repositorio público:** no subas IPs, MACs, identificadores de nodos LoRa, contraseñas ni rutas personales.
- **Desarrollo:** si además vas a modificar el código, lee `CLAUDE.md` (reglas del proyecto) y
  `SURVIVAL_OS_RPI5_CLAUDE.md` §13 y §15 antes de cambiar nada.

---

## 4. Camino A — Versión portable en ESTE ordenador (Windows, macOS, Linux)

Es lo más fácil: no instala nada en el sistema.

```sh
npm run express -- portable                       # genera la portable de este sistema, la copia a ~/Survival OS y la abre
npm run express -- portable --dest "D:\Survival OS"   # otra carpeta, p. ej. una memoria USB
npm run express -- portable --install             # además la instala en el equipo con acceso directo (sin administrador)
npm run express -- portable --no-open             # solo prepararla
```

- La primera compilación tarda unos minutos.
- Si la carpeta de destino ya existe, se actualiza **sin tocar** `data/` (mapas, documentos, descargas).
- Se abre en una ventana propia con la **bienvenida**: idioma, país y «Descargarlo todo».

**Configurar sin tocar la pantalla** (opcional), con la app abierta:

```sh
npm run express -- defaults --dest "<carpeta>" --lang fr --country fra     # idioma y país por defecto
npm run express -- status   --url http://127.0.0.1:47800                   # estado
npm run express -- download --url http://127.0.0.1:47800                   # ver el plan de «Descargarlo todo»
npm run express -- download --url http://127.0.0.1:47800 --yes             # lanzarlo (tras confirmar con la persona)
```

`47800` es el puerto habitual de la portable. Si estaba ocupado, el puerto real está en `<carpeta>/data/run.json`.

**Actualizaciones:** la portable se actualiza sola desde GitHub (modo «Automática»): descarga la versión nueva, la
verifica y la aplica **al cerrar** Survival OS. Si no arranca, vuelve sola a la anterior. Para comprobarlo o
instalar ya:

```sh
npm run express -- update --url http://127.0.0.1:47800 --check         # estado y «Buscar ahora»
npm run express -- update --url http://127.0.0.1:47800 --yes           # instalar ya (tras confirmar con la persona)
```

Avisos que puedes dar:

- **macOS:** la primera vez puede bloquearla porque no está firmada. Clic derecho → Abrir → Abrir.
- **Linux:** si se ejecuta desde un USB montado sin permiso de ejecución, cópiala al disco.

---

## 5. Camino B — Raspberry Pi 5 (o Linux con systemd) por SSH

### 5.1 Si la Pi aún no tiene sistema

Guía a la persona; esto no se puede hacer desde aquí:

1. Descargar **Raspberry Pi Imager**: <https://www.raspberrypi.com/software/>.
2. Elegir **Raspberry Pi 5** → **Raspberry Pi OS (64-bit)** con escritorio → la tarjeta microSD (128 GB o más).
3. En «Editar ajustes»:
   - **nombre de equipo** (p. ej. `survival`);
   - **usuario y contraseña** (que los apunte);
   - **Wi-Fi** con su país;
   - en «Servicios», **activar SSH** con contraseña.
4. Grabar, poner la tarjeta en la Pi y encenderla. Esperar 2–3 minutos.

### 5.2 Acceso por SSH

- **IP:** prueba primero el nombre de equipo (`survival.local`). Si no responde, la persona puede verla:
  - en la Pi: icono de red → «Información»;
  - en el router: lista de dispositivos.
- **Clave SSH, una sola vez:**

  ```sh
  npm run express -- ssh-setup --host <IP> --user <usuario>
  ```

  Crea la clave `~/.ssh/survival_os_ed25519` e indica **un comando que la persona debe ejecutar ella misma**: pide la
  contraseña de la Pi una vez.

  - **Claude Code:** pídele que lo ejecute con el prefijo `!` en el chat.
  - **Codex y Gemini:** pídele que lo ejecute en su terminal.

  Después vuelve a lanzar `ssh-setup` hasta que diga «listo».

- **Si la persona solo quiere darte la contraseña:** úsala únicamente para copiar la clave, y solo si existe una
  herramienta no interactiva: `sshpass` en Linux/macOS, `plink -pw` de PuTTY en Windows. Después olvídala y sigue con
  la clave.

### 5.3 Instalar (o actualizar)

```sh
npm run express -- pi --host <IP> --user <usuario>               # comprueba y describe (no cambia nada)
npm run express -- pi --host <IP> --user <usuario> --yes         # compila, copia, instala y verifica
npm run express -- pi --host <IP> --user <usuario> --yes --reboot   # y reinicia para arrancar en modo quiosco
```

**Qué comprueba antes de instalar:**

- acceso SSH;
- arquitectura arm64 o x64 y systemd;
- `sudo` sin contraseña (Raspberry Pi OS lo trae así para el primer usuario).

**Qué hace al instalar:**

- compila y empaqueta (`release/survival-os-X.Y.Z.tar.gz`);
- lo copia junto con `install-system.sh`, verifica su SHA-256 e instala en `/opt/survival-os`;
- comprueba que responde (`/api/health`).

Los datos y la configuración existentes **se conservan**; también se conserva la versión anterior.

**En otro Linux** (Debian o Ubuntu con systemd, x64 o arm64): añade `--no-kiosk`; el modo quiosco usa labwc, el
escritorio de Raspberry Pi OS. La app queda en `http://127.0.0.1:3000` en ese equipo. Para usarla desde otros
ordenadores, la portable suele ser mejor opción.

**Códigos de salida:**

| Código | Significado | Qué hacer |
|---|---|---|
| 0 | Bien | — |
| 1 | Error | Leer el mensaje |
| 2 | Uso incorrecto | Revisar los argumentos |
| 3 | Falta acceso SSH | Volver a la sección 5.2 |
| 4 | Falta sudo sin contraseña | `express` imprime el arreglo, que la persona ejecuta en la Pi |

### 5.4 Configurar y descargar

```sh
npm run express -- defaults --host <IP> --user <usuario> --lang es --country esp
npm run express -- status   --host <IP> --user <usuario>
npm run express -- download --host <IP> --user <usuario>          # muestra el plan (qué, cuánto ocupa, qué no cabe)
npm run express -- download --host <IP> --user <usuario> --yes    # lanza «Descargarlo todo» (confirmar antes)
```

- **Idioma y país por defecto:** se guardan en `/etc/survival-os/defaults.json` y la pantalla los aplica si nadie eligió
  otros. Códigos de país: tres letras (`esp`, `fra`, `ita`, `usa`, `mex`…), en `content/countries.json`.
- **Actualizaciones (ADR 0021):** en la Pi vienen en «Solo avisar»: la pantalla avisa y se instala con un toque. Desde
  aquí:

  ```sh
  npm run express -- update --host <IP> --user <usuario> --check               # estado y «Buscar ahora»
  npm run express -- update --host <IP> --user <usuario> --yes                 # instalar (confirmar antes)
  npm run express -- update --host <IP> --user <usuario> --mode auto           # automática: de 02:00 a 06:00, bóveda cerrada
  ```

  - Elegir `--mode auto` es un cambio de sistema: solo si la persona lo pide.
  - Una Pi con una versión anterior a la 0.10.0 todavía no sabe actualizarse sola: actualízala una vez con
    `express pi … --yes`.
- **«Descargarlo todo»:** descarga lo de su idioma y país (biblioteca, manuales, mapas y rutas del país, todos los
  modelos del asistente y los juegos), ajustado al espacio libre. Puede tardar horas; el equipo se puede usar
  mientras, y si se corta, continúa donde se quedó.

---

## 6. Camino C — Tablet o móvil Android (APK)

Lo que se necesita:

- **El dispositivo:** Android 10 o posterior, de 64 bits (casi todos desde 2019).
- **Espacio:** el que se quiera descargar (40–60 GB para todo); una microSD sirve.
- **Memoria:** con 3–4 GB de RAM, el asistente usa el modelo ligero; se elige solo.

### 6.1 Conseguir el APK

- **Publicado:** `survival-os-X.Y.Z-android-arm64.apk` (y su `.sha256`) en las Releases del repositorio.
- **Desde el código** (necesita JDK 17+, Android SDK, NDK y Go; instalarlos ocupa unos 7 GB):

  ```sh
  npm run build && npm run release:android      # → release/survival-os-X.Y.Z-android-arm64.apk
  ```

  La primera vez descarga y prepara los binarios nativos (`android/scripts/natives.mjs`) y crea la clave de firma
  en `.data/android-keystore.jks`. **Avisa a la persona de que la guarde:** sin ella no se puede actualizar la app ya
  instalada.

### 6.2 Instalarlo

- **Por cable (recomendado si hay `adb`):**
  1. La persona activa la *Depuración USB*: Ajustes → Información del teléfono → pulsar 7 veces «Número de
     compilación» → Opciones de desarrollador → Depuración USB.
  2. Conecta el cable y acepta el aviso en la tablet.
  3. Instala con:

     ```sh
     adb install -r release/survival-os-X.Y.Z-android-arm64.apk
     ```

- **Sin ordenador:** copiar el APK a la tablet (USB, microSD, descarga) y abrirlo. Android pedirá permitir
  «instalar apps desconocidas» para el gestor de archivos o el navegador.

### 6.3 Primer arranque (lo hace la persona en la pantalla)

1. **Dónde guardar los datos.** Recomienda «Memoria interna (carpeta SurvivalOS)» o la microSD: se conserva si se
   desinstala la app. Pide «Acceso a todos los archivos»: activarlo y volver atrás.
2. **Permisos:**
   - notificaciones;
   - ubicación (para el GNSS de la tablet);
   - batería sin restricciones (para que siga con la pantalla apagada).
3. **La bienvenida,** como en las demás versiones: idioma, país y «Descargarlo todo». El idioma y el país de la tablet
   ya vienen propuestos.

**Avisos que puedes dar:**

- **Realme, Xiaomi, Huawei, Oppo…:** activar además «Inicio automático» y «Actividad en segundo plano» en los ajustes
  de la app; si no, el sistema puede cerrarla con la pantalla apagada.
- **Radio LoRa o GPS USB:** con un cable OTG. Al conectarlo, Android pregunta si abrir Survival OS: marcar «siempre».
- **Tablet sin GPS** (muchas versiones solo Wi-Fi): la posición necesita un GPS USB o un nodo LoRa con GPS.
- **Actualizar:** instalar el APK nuevo encima (los datos se conservan), o desde Mantenimiento con el APK y su
  `.sha256` en una memoria USB.

La API local de la sección 7 **no** se puede usar desde fuera en Android: exige un token por arranque que solo
conoce la app (en Android, cualquier app puede conectarse a 127.0.0.1). Configura desde la pantalla.

---

## 7. API local (para tareas que `express` no cubre)

Solo responde en el propio equipo (`127.0.0.1`). En una Pi, úsala por SSH con `curl`. Las escrituras exigen la
cabecera `x-survival-action: 1`.

| Método y ruta | Qué hace |
|---|---|
| `GET /api/health` | Estado de los servicios |
| `GET /api/content` | Catálogo y estado de cada contenido |
| `GET /api/content/plan?mode=all\|recommended&lang=es&country=esp` | Plan de «Descargarlo todo» (ordenado y ajustado al espacio) |
| `POST /api/admin/content` `{"action":"install","items":[…]}` | Descargar contenidos; `"remove"` para quitarlos |
| `GET /api/content/countries` | Países con su tamaño estimado de mapa y rutas |
| `GET /api/admin/<tarea>` | Estado y registro de una tarea (`content`, `usb-scan`, `backup`, `update`…) |
| `GET /api/settings/defaults` | Idioma y país por defecto del equipo |
| `GET /api/update` | Actualizaciones: versión instalada y última, estado y modo |
| `POST /api/admin/update-online` `{"action":"check"\|"install"}` | Buscar ahora / descargar e instalar la versión nueva |
| `POST /api/update/settings` `{"mode":"auto"\|"notify"\|"off"}` | Modo de actualización |

- **Contenidos sueltos:** usan su id del catálogo (`content/catalog.json`), por ejemplo `wikipedia`, `wikipedia-fr`,
  `asistente`, `juegos`.
- **Mapas y rutas de un país:** `mapa-pais:<código>` y `rutas-pais:<código>`.
- **España:** `mapa-espana`, `mapa-canarias`, `rutas-espana`, `rutas-canarias`.

---

## 8. Problemas frecuentes

| Síntoma | Causa probable y solución |
|---|---|
| `ssh: connect to host … timed out` | IP incorrecta, Pi apagada o SSH desactivado (Configuración de Raspberry Pi → Interfaces → SSH) |
| `Permission denied (publickey,password)` | Falta copiar la clave (sección 5.2) |
| `express pi` sale con 4 | El usuario no tiene `sudo` sin contraseña: el arreglo aparece en pantalla |
| Pantalla de la Pi sin la app tras instalar | Reiniciar la Pi (`--reboot`); el quiosco arranca con la sesión gráfica |
| La descarga no empieza | Sin Internet en el equipo, o ya hay otra en curso: `status` lo dice |
| Mensajes «no disponible» en el panel de sistema | Normal en lo que no se puede medir (Probe honesto); no es un error |
| Android: la app se cierra con la pantalla apagada | Batería sin restricciones e «Inicio automático» en los ajustes de la app (sección 6.3) |
| Android: «GNSS: sin receptor» | Falta el permiso de ubicación (Mantenimiento → Android) o la tablet no tiene GPS |

**Registros:**

- **Pi:** `journalctl -u survival-web -u survival-library --since -10min` (por SSH).
- **Portable:** carpeta `data/logs/`.
- **Android:** carpeta `logs/` dentro de la carpeta de datos (p. ej. `SurvivalOS/logs/`); con `adb`, `adb logcat -s SurvivalOS`.

---

## 9. Cómo presentar el resultado a la persona

Al terminar, di en pocas líneas y en su idioma:

- dónde quedó instalado y cómo abrirlo;
- qué se está descargando y cuánto ocupará;
- qué tiene que hacer ella, si queda algo: reiniciar, elegir algo en la pantalla, conectar la radio…

No pegues registros largos.
