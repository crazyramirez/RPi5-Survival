# ADR 0016 — Portable igual de completa que la Pi: LoRa, GPS, bóveda, batería, hora, juegos y red local

- **Estado:** aceptada (2026-11-16) a petición del usuario: «la versión portable debe tener LoRa, GPS, asistente,
  descargas… igual de completa». Amplía el ADR 0014; el asistente y las descargas se resolvieron en el ADR 0015.
- **Principio:** nada se marca «solo en la Pi» sin una razón técnica real. Lo que no existe en un PC (el UPS
  X1202, el kiosco HDMI) se sustituye por su equivalente en el equipo anfitrión.
- **Decisión:**
  - **LoRa (Meshtastic) y GPS: `services/serial-hub`.** Node sin dependencias ni módulos nativos.
    - **Puerto serie en Windows, macOS y Linux:**
      - Linux y macOS: se abre el dispositivo y se configura con `stty` sobre ese mismo descriptor (stdin), así sirve
        en GNU y en BSD;
      - Windows: `mode COMn:` y `\\.\COMn`, con DTR activo y RTS desactivado.
      - Las lecturas usan el pool de libuv: el lanzador sube `UV_THREADPOOL_SIZE` a 8.
    - **Meshtastic:**
      - códec protobuf mínimo y tramas `0x94 0xC3`;
      - números de campo verificados contra `meshtastic/protobufs` (master, 2026-11-16);
      - modelos de hardware y roles generados desde los `.proto`.
      - **Misma API y mismas reglas que `survival_mesh.py`:**
        - sin claves en respuestas ni en registros;
        - hora solo del canal privado, con dos muestras que coincidan;
        - última posición solo del nodo propio y del seguido;
        - 3 s entre mensajes y 60 s entre peticiones de posición.
      - La interfaz de la malla no cambia.
    - **GNSS USB:**
      - lee NMEA (GGA, RMC, GSA, GSV) con checksum;
      - emite TPV, SKY y DEVICES por un **servidor compatible con gpsd**, así que el servicio de navegación no cambia;
      - sin inventar: no deriva el error horizontal del HDOP.
    - **Detección automática** en puertos USB-serie conocidos (por VID):
      - primero solo escucha NMEA, sin enviar nada;
      - después hace el intercambio Meshtastic, que no transmite por radio;
      - la elección manual (tarea `mesh` → `/config`) siempre manda.
  - **Bóveda portable:** `services/vault/src/portable-server.ts` y `crypto-store.ts`.
    - Sin LUKS: no existe en Windows ni en macOS, ni sin root.
    - **Clave maestra:**
      - aleatoria de 256 bits;
      - un keyslot por secreto, cifrado con AES-256-GCM bajo una KEK derivada con **Argon2id de 256 MiB**
        (`crypto.argon2` de Node 24), con la misma memoria que la Pi.
      - Recuperar y regenerar la clave equivale a añadir y quitar keyslots, con la misma semántica que el ADR 0013.
    - **Documentos:**
      - cifrados por bloques de 64 KiB;
      - la AAD lleva id, número de bloque y marca de último bloque, así que se detectan bloques manipulados,
        reordenados o un fichero truncado;
      - el índice (nombres y etiquetas) también va cifrado.
    - **Misma API que la de la Pi**, por *named pipe* en Windows o socket Unix: la web no cambia.
    - Importa desde unidades extraíbles del anfitrión.
  - **Batería y hora del anfitrión** (`device-api`):
    - **Windows:** `SystemInformation.PowerStatus` para batería y cargador, y `w32tm /query /status` con el indicador
      de salto, que no depende del idioma, para la hora NTP.
    - **macOS:** `pmset -g batt`. La hora sale como «sin verificar», porque comprobarla exige administrador.
    - **Linux sin UPS:** el adaptador de corriente del kernel.
    - **En la Pi no cambia el orden:** sysfs, luego `ups.json`, y la red eléctrica sigue saliendo del GPIO6.
  - **Juegos:** `scripts/games-sync.mjs`, portado por la sesión del ADR 0012.
    - En Windows usa una unión de directorio, que no requiere administrador.
    - En exFAT/FAT, si no puede hacer hardlink, copia.
    - El servidor de juegos arranca en cuanto hay una copia.
  - **«Compartir en la red local»,** el equivalente del punto de acceso Wi-Fi:
    - la pasarela pública de **solo lectura** (`public-gateway.mjs`) escucha en la IPv4 privada del equipo, en el
      puerto 47880, y descarta adaptadores virtuales;
    - nunca se activa al arrancar;
    - el portal cautivo incluye el puerto si no es el 80.
- **Consecuencias y límites:**
  - **Bóveda portable frente a LUKS:**
    - en disco se ven el número de documentos y su tamaño aproximado;
    - el cifrado es por fichero, no de volumen;
    - un PIN sigue sin resistir un ataque offline (ADR 0013).
  - **Puerto serie:** probado contra el nodo **Heltec V4 real** en Linux (la Pi). La versión Node dio **lo mismo
    que la de Python**: 24 nodos, mismos modelos y roles, canales «Survival» y «LongFast», firmware 2.7.26.
    **No probado en Windows ni en macOS** por falta de hardware: el código existe, pero falta verificarlo con un
    nodo y un GPS conectados.
  - **Ubicación del sistema operativo:** no se usa. Sin Internet, Windows y macOS solo saben dónde están con un GPS,
    que ya cubren el GPS USB y el GNSS del nodo LoRa.
  - **Pasarela ESP32 (sensores JSON Lines):** en la portable va dentro de `serial-hub` (`/esp32/*`, misma API que
    `services/esp32-gateway`, que sigue siendo la de la Pi). Detección por contenido en los tres sistemas: un puerto
    libre que responde al ping con el protocolo v1 es una placa; si escribe el registro de Meshtastic se suelta.
    Asignación manual con `esp32: [puerto…]` en `/config`. **Sin probar con una placa real.**
  - **Mantenimiento igual que en la Pi (2026-11-16):** mismas secciones, pestañas y tareas.
    - **USB y copias** (`scripts/portable-admin.mjs`, el equivalente de `admin-job.py`):
      - medios externos: en Windows, unidades extraíbles y discos USB; en macOS, `/Volumes`; en Linux,
        `/media`, `/run/media` y `/mnt`;
      - importar mapas (PMTiles v3) y documentos (la biblioteca se reindexa sola);
      - copia de seguridad con la bóveda cifrada, `SHA256SUMS` verificado y `RESTAURAR.txt`.
    - **Actualizar** desde un zip `survival-os-X.Y.Z-portable*.zip` con su `.sha256`:
      - se verifica y se prepara en `.update/`;
      - el lanzador se cierra y `apply-update.mjs`, con una copia temporal de Node (Windows no deja sustituir un
        `node.exe` en uso), cambia `app/`, `runtime/` y los lanzadores; nunca toca `data/`;
      - reabre Survival OS y guarda la versión anterior en `.previous`;
      - si falla, restaura la anterior.
    - **Reiniciar la aplicación:** el lanzador relanza los servicios.
    - **GPS:** por USB (elegir puerto y velocidad, o detección automática) en vez de por GPIO.
    - **Red y hora:** se muestran pero no se cambian, porque las gestiona el sistema operativo del ordenador (en la
      Pi las cambia la app).
    - **Probado en Windows 11** con la portable compilada y su lanzador, mediante la API como la interfaz:
      - escaneo, importar, copia verificada y reinicio de servicios;
      - actualización completa: cambio de carpetas, reapertura en unos 2 s, datos intactos y `.previous` guardada.
    - Sin memoria USB real (se usó `SURVIVAL_EXTRA_MEDIA`) ni macOS.
  - **Validado el 2026-11-16 en Windows 11 (portable):**
    - bóveda: crear con PIN, abrir, documento de 135 kB idéntico al leerlo y ningún texto en claro en disco;
    - recuperación: el PIN viejo no abre y el nuevo sí;
    - batería real al 78 % con cargador;
    - hora «sin verificar», porque este PC no sincroniza;
    - malla y GPS: «no detectado», que es correcto;
    - compartir en LAN: portada y protocolos con 200; bóveda, administración y POST con 403; portal cautivo con 302.
