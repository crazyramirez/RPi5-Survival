# ADR 0020 — App Android (APK para tablets)

- **Estado:** aceptada e implementada (2026-11-16) a petición del usuario: «APK para tablet Android, que funcione todo
  instalando el APK». Validada en el emulador (Android 16, tablet x86_64) y en una tablet física Realme Pad Mini (RMP2105, Android 11,
  Unisoc T616, 3,5 GB de RAM, microSD de 128 GB).
- **Principio:** la misma aplicación que la portable (ADR 0014/0016), sin reescribir nada. El APK lleva Node y los
  binarios nativos para Android, y la parte Java solo hace lo que Node no puede hacer en Android.

## Decisión

### Arquitectura

```
APK
├── assets/app.zip         carpeta app/ de la portable (scripts/stage-app.mjs): web Nuxt, servicios, contenido
├── lib/<abi>/lib*.so      ejecutables y bibliotecas: Node 24, kiwix-tools, llama-server, pmtiles
├── jar BRouter            dentro del dex: Android lo ejecuta sin JRE
└── Java                   MainActivity (WebView), SurvivalService (primer plano), Bridge, USB, GNSS, BRouter
```

- **Arranque:**
  1. `SurvivalService` (servicio en primer plano) extrae `app.zip` en la carpeta privada la primera vez y tras cada
     actualización del APK.
  2. Lanza `portable/launcher.mjs` con el Node del APK.
  3. La WebView abre `http://127.0.0.1:47800`.
- **Mismo lanzador:** `process.platform === 'android'` activa el modo Android:
  - sin navegador ni unidades USB de escritorio;
  - los componentes del APK se enlazan en `runtime/android-<arq>/` con su marca `.version`, así el motor de
    descargas no los descarga;
  - BRouter se arranca por el puente.
- **Datos:** donde elija la persona en el primer arranque:
  - carpeta `SurvivalOS` en la memoria interna o en la microSD (permiso «acceso a todos los archivos»; sobrevive a
    desinstalar);
  - o la carpeta privada de la app en cualquiera de las dos (sin permisos, pero Android la borra al desinstalar; se
    avisa).
- **Idioma y país por defecto:** los de la tablet, en `<datos>/defaults.json`, solo si no existe.

### Binarios (`android/scripts/natives.mjs`, versiones en `android/natives.lock.json`)

- **Node 24 LTS y kiwix-tools 3.8.2: paquetes de Termux** (bionic, segmentos alineados a 16 KB):
  - SHA-256 del índice del repositorio;
  - cierre de dependencias automático;
  - sonames versionados renombrados (`libssl.so.3` → `libssl3.so`): Android solo instala `lib*.so`. Se parchean
    DT_NEEDED/DT_SONAME en su sitio (`android/scripts/elf.mjs`).
  - **Motivo:** nodejs-mobile se quedó en Node 18 y el proyecto necesita 22.5 o posterior (`node:sqlite`). Node no
    publica binarios para Android.
- **llama.cpp b12428:** compilado aquí con el NDK, la misma versión que el catálogo:
  - todas las variantes de CPU (`GGML_CPU_ALL_VARIANTS`): el dispositivo carga la mejor (dotprod, i8mm, SVE…);
  - páginas de 16 KB.
- **pmtiles 1.31.2:** go-pmtiles compilado aquí para Android (`GOOS=android`, cgo con el NDK); las dependencias de
  Go se verifican con `go.sum`.
  - **Motivo:** el binario oficial de Linux (Go estático, sin cgo) no tiene DNS en Android (no hay
    `/etc/resolv.conf`); el de Android resuelve con el sistema y lee los certificados de Android.
  - Se probó antes un proxy CONNECT local para el binario de Linux. Funcionaba, pero se descartó: era una pieza
    más escuchando en loopback.
- **pdftotext (Xpdf 4.06):** compilado con el NDK, solo la herramienta de texto (sin FreeType ni Qt).
  Así los manuales entran en la búsqueda.
- **BRouter 1.7.10:** el jar del catálogo, convertido a dex; se ejecuta en el proceso `:routing`.
- **Android solo ejecuta lo instalado desde el APK** (W^X desde Android 10): ningún binario se descarga en tiempo de
  ejecución. Los contenidos (ZIM, mapas, modelos, rutas) sí.
- **Certificados:** Node usa sus raíces de Mozilla (`--use-bundled-ca`). El almacén de Android nombra los ficheros
  con el hash antiguo y OpenSSL 3 no los encuentra. pmtiles (Go para Android) lee el almacén del sistema.

### Hardware de la tablet (puente nativo `Bridge.java`)

- **Batería y cargador:** `BatteryManager` (nivel, voltaje, temperatura, fuente de carga) → device-api.
- **GNSS interno:** «puerto» `android:gnss` para serial-hub.
  - Se reenvían las frases NMEA del receptor que tienen checksum válido.
  - Si no llegan válidas, se componen GGA y RMC con la posición real de `Location` y los satélites de `GnssStatus`.
  - Lo que Android no da (HDOP; altitud sobre el nivel del mar antes de Android 14) queda vacío.
  - serial-hub lo asigna solo si no hay otro GPS.
- **LoRa (Meshtastic), GPS USB y placas ESP32 por USB OTG:** usb-serial-for-android (CP210x, CH34x, FTDI, PL2303,
  CDC-ACM de ESP32-S3/RP2040/nRF52).
  - Mismos VID que serial-hub.
  - Al enchufar, Android ofrece abrir Survival OS y concede el permiso del dispositivo.
- **Memorias USB y microSD:** `StorageManager` → `<privado>/volumes.json` → `portable/usb.mjs`, para importar y para
  las copias de seguridad.
- **BRouter:** proceso aparte (`RoutingService`, `:routing`), con memoria propia; se cierra sin tocar lo demás.
- **Actualizar:**
  - desde un APK en una memoria USB (con su `.sha256`): portable-admin lo verifica y la app abre el instalador de
    Android;
  - o instalando el APK nuevo a mano.
- **Fijar la pantalla** (modo quiosco de Android) y **permisos**: tarjeta «Survival OS para Android» en
  Mantenimiento.
- **CPU y Wi-Fi despiertos solo mientras dura una tarea larga** (descargas, copias). El servicio en primer plano
  mantiene vivo el resto con la pantalla apagada.

### Seguridad

- **Cualquier app de Android puede conectarse a 127.0.0.1:** en un PC eso solo lo hacen los programas del propio
  usuario. Por eso todos los procesos Node cargan `portable/android-guard.mjs` (`NODE_OPTIONS=--import`):
  - un token aleatorio por arranque;
  - los servidores HTTP en loopback rechazan con 403 lo que no lo lleve. Llega en la cabecera `x-survival-token`
    (entre servicios: `fetch` y `http.request` la añaden solos) o en la cookie `survival_app` (la WebView);
  - el puente Java exige la misma cabecera.
- **Sockets Unix en la carpeta privada:** la bóveda y el protocolo gpsd (ubicación). No en TCP de loopback.
- **Flujos USB/GNSS:** puertos efímeros con clave de un solo uso.
- **Sin protección propia:** kiwix-serve, llama-server y BRouter siguen en loopback sin token. Solo exponen
  contenido público y tiempo de CPU, nunca datos personales.
- **Sin copia en la nube** (`allowBackup=false` y reglas de extracción vacías). La WebView solo navega por loopback;
  los enlaces externos se abren en el navegador del sistema.
- **Firma:** clave propia en `.data/android-keystore.jks`, fuera de Git. Sin ella no se puede publicar una
  actualización que Android acepte.

### Asistente en equipos con poca memoria

- **Nuevo modelo `qwen2.5-1.5b`** (Qwen2.5 1.5B Instruct Q4_0, 1,07 GB, Apache-2.0). Elemento `asistente-ligero`.
- **«Descargarlo todo» y el asistente inicial** omiten los modelos que no caben: hace falta ~1,3 × el tamaño del
  modelo + 1,5 GiB de RAM. Con poca memoria, el recomendado (y activo) pasa a ser el ligero.
- **En Android, el asistente usa 4 hilos como máximo:** en big.LITTLE más hilos que núcleos rápidos lo frenan.

## Medido (emulador, tablet Android 16 x86_64, 6 GB)

| Prueba | Resultado |
|---|---|
| Primer arranque (extraer `app.zip`, 1579 ficheros) y Node listo | < 2 s (x86_64); 8 s con el APK arm64 bajo traducción ARM |
| Guarda de loopback | sin token, 403; servicios entre sí, bien |
| Descargas con verificación | ZIM, manual PDF, mapa de Andorra (pmtiles, 10 MB), rutas de Andorra |
| Wikipedia | kiwix-serve sirviendo el ZIM |
| Ruta a pie con BRouter | 0,58 s, ~130 MB de RSS en el proceso `:routing` |
| Asistente (Llama 3.2 3B, 4 hilos) | 8,6 tokens/s generando, 40 tokens/s leyendo; responde citando los protocolos |
| GNSS interno | NMEA del emulador con checksum incorrecto: descartado y sustituido por frases compuestas con la posición real |

## Medido en la Realme Pad Mini (Android 11, arm64)

| Prueba | Resultado |
|---|---|
| Instalación por `adb` y primer arranque | Node listo en 2 s; datos en la carpeta SurvivalOS de la microSD |
| Permisos | Archivos, ubicación y batería sin restricciones (Realme la concede sin diálogo) |
| Datos del equipo | Batería, cargador, modelo y red reales; GNSS interno detectado |
| Mapa de España (pmtiles ARM, Go para Android) | Descarga a ~3–4 MB/s por Wi-Fi |
| Interfaz | Se adapta en vertical (800×1340) y en horizontal |

Encontrado y corregido en la tablet:

- el progreso de los mapas no avanzaba;
- una descarga cortada se quedaba en «Descargando 0 %» y bloqueaba el botón;
- Realme llama a la microSD «disk»: el selector la nombra ahora como tarjeta;
- una compilación con ficheros llenos de ceros llegó a empaquetarse; ahora el empaquetado lo impide.

## Limitaciones

- **USB OTG (LoRa, GPS USB, memorias) y rendimiento arm64 sin probar en un dispositivo físico:** el emulador de
  Windows no pasa USB.
- **El punto de acceso Wi-Fi lo activa la persona en Ajustes:** Android no deja a las apps crearlo. «Compartir en la
  red local» funciona sobre él.
- **La hora no se puede ajustar desde una app:** Android la toma de la red o del GNSS.
- **El quiosco total** (sin poder salir) exige configurar la tablet como dispositivo dedicado; «Fijar la pantalla»
  es el equivalente sin administración.
- **Algunas marcas** (Realme, Xiaomi, Huawei…) cierran apps en segundo plano aunque estén exentas de la optimización
  de batería. Hay que activar «Inicio automático» y «Actividad en segundo plano» a mano; la app lo indica.
- **Validación ARM64 en el emulador:**
  - Node, kiwix-tools, llama-server y pdftotext arrancan bajo la traducción ARM del emulador x86.
  - pmtiles (Go) no: el runtime de Go y la traducción ARM son incompatibles. Funciona en nativo x86_64 (descarga y
    DNS verificados); en ARM falta probarlo en un dispositivo físico.
- **Compilar el APK necesita** JDK, Android SDK y NDK, y Go.
- **Termux solo publica la versión actual de cada paquete:** si la fijada desaparece,
  `natives.mjs --update-lock` fija la nueva (revisando el cambio).
