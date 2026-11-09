# SURVIVAL OS — Especificación maestra para Claude

**Versión:** 1.0  
**Fecha:** 2026-11-08  
**Objetivo:** Crear un terminal portátil de supervivencia **100 % utilizable sin Internet**, basado en Raspberry Pi 5, con documentación, mapas, GPS, biblioteca de emergencias, archivos privados cifrados y futura integración de ESP32/LoRa.

> **Instrucción para Claude:** Actúa como arquitecto de sistemas Linux embebidos, desarrollador senior de Nuxt/TypeScript y experto en seguridad. Implementa el proyecto por fases verificables, escribiendo código funcional y tests. No des por hecho el modelo de pantalla, módulo GPS, batería o sensores. Inspecciona el hardware y el repositorio antes de cambiar servicios, particiones o configuración de arranque. No declares que algo funciona si no se ha probado físicamente.

## 0. Decisiones cerradas

- **SBC principal:** Raspberry Pi 5 de **8 GB RAM**.
- **Sistema de almacenamiento disponible:** microSD de **128 GB**.
- **Pantalla inicial y única:** **7 pulgadas HDMI táctil**; conexión del táctil aún por verificar (probablemente USB, pero NO asumirlo).
- **Pantalla alternativa disponible:** **5 pulgadas DSI**, *reservada para comparar autonomía en una fase posterior*. **No desarrollar modo de doble pantalla**, ni alimentar ambas a la vez en la configuración final.
- **Fuente de desarrollo:** fuente del kit GeeekPi / Raspberry Pi, **27 W, 5,1 V / 5 A** según referencia del kit; verificar etiqueta y alimentación real.
- **Refrigeración:** disipador/ventilador PWM incluido.
- **Accesorios disponibles:** módulo(s) GPS de modelo aún desconocido, varios ESP32 (JC2432W328, JC3248W535, JC4827W543), botones y sensores de varios tipos, baterías sin compatibilidad confirmada con Raspberry Pi 5.
- **Idioma principal:** español; arquitectura preparada para traducción posterior.
- **Stack preferido:** **Nuxt + TypeScript + CSS**, Node.js para servicios locales; scripts Python cuando simplifiquen tareas Linux/serial. Kiosco en Chromium con Raspberry Pi OS y entorno gráfico Wayland soportado.
- **Conectividad operativa:** el equipo debe funcionar con LAN, Wi-Fi e Internet desconectados. El Wi-Fi local/AP es opcional y no debe bloquear el arranque.
- **Prioridad:** fiabilidad offline, consumo energético, portabilidad, seguridad y mantenimiento por encima de efectos visuales.

## 1. Filosofía del producto

El sistema NO es un juguete, ni un conjunto de demos independientes. Debe funcionar como un centro de conocimiento y navegación de campo:

1. Encender el equipo y llegar al panel principal en modo kiosco.
2. Consultar mapa y coordenadas sin Internet, incluso después de un reinicio.
3. Leer manuales y buscar contenido sin servicios remotos.
4. Acceder a una zona privada mediante contraseña fuerte; no debe estar disponible en el AP público.
5. Mostrar claramente el estado real: GPS sin fijación, servicios apagados, batería sin telemetría, datos cartográficos ausentes; jamás inventar datos.
6. Apagar de forma segura para evitar corrupción de la microSD.
7. Restaurar el funcionamiento después de un corte de energía o reinicio.

**No se permite** ninguna dependencia de Google Fonts, CDN, mapas remotos, APIs cloud o autenticación en línea para el uso diario. Todo JS/CSS/fuentes/iconos deben empaquetarse localmente.

## 2. Inventario y validaciones al comenzar

Antes de programar, Claude debe pedir/ejecutar **solo diagnósticos no destructivos** y registrar resultados en `docs/hardware-inventory.md`:

```bash
cat /proc/device-tree/model
cat /etc/os-release
uname -a
free -h
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS,MODEL
lsusb
find /dev -maxdepth 1 \( -name 'ttyUSB*' -o -name 'ttyACM*' -o -name 'serial*' \) -print
ls /dev/spidev* 2>/dev/null || true
vcgencmd get_throttled
vcgencmd measure_temp
cat /sys/class/drm/*/status 2>/dev/null || true
```

Comprobar: orientación, resolución real y calibración táctil de pantalla HDMI 7"; chip USB del táctil; presencia del sistema gráfico, puertos serie libres y estabilidad de alimentación. **No sobrescribir** una instalación existente ni modificar otra aplicación sin copia de seguridad y autorización. Mantener modo de recuperación por SSH/teclado.

## 3. Arquitectura lógica

```text
                   +----------------------------------+
                   |  Pantalla HDMI táctil 7"        |
                   |  Chromium Kiosk -> localhost     |
                   +----------------+-----------------+
                                    |
                +-------------------v--------------------+
                | SURVIVAL OS WEB APP (Nuxt + TS + CSS)    |
                | UI táctil / offline / PWA local          |
                +------+---------+-----------+------------+
                       |         |           |
                 +-----v--+ +----v-----+ +---v---------+
                 | Local  | | Content  | | Security    |
                 | API    | | service  | | vault API   |
                 | Node   | | Kiwix    | | local-only  |
                 +--+--+--+ +----+-----+ +------+------+
                    |  |         |              |
             +------v+ +v---------v------+  +---v----------+
             | GPS    | | microSD 128 GB |  | encrypted     |
             | gpsd   | | ZIM, maps, docs|  | private vault |
             +--------+ +---------------+  +--------------+
                    |
             +------v-----------------------------+
             | Optional ESP32 USB serial          |
             | Sensors / buttons / LoRa gateway   |
             +------------------------------------+
```

**Separation of concerns**:
- UI únicamente consume APIs locales y contenidos locales.
- Servicios privilegiados separados del servidor web sin exponer credenciales o dispositivos directamente al navegador.
- Los procesos de GPS, Kiwix, cartografía y sensores sobreviven/reinician de forma independiente.
- La bóveda y su API no se publican por Wi-Fi/LAN; por defecto escuchan solo en interfaz local y tienen autenticación dedicada. Un proxy debe denegar rutas privadas desde cualquier cliente remoto.
- Los procesos se controlan mediante `systemd`; logs y estados consultables.

## 4. Estructura del repositorio

```text
survival-os/
├── README.md
├── CLAUDE.md
├── package.json
├── apps/
│   └── frontend/              # Nuxt, TypeScript, UI táctil
├── services/
│   ├── device-api/            # estado, red local, reloj, sensores
│   ├── navigation/            # adaptador gpsd, waypoints, GPX
│   ├── library/               # catálogo, enlaces a Kiwix, FTS
│   ├── vault/                 # autenticación y cifrado; sin red
│   └── esp32-gateway/         # futuro: serial protocol
├── packages/
│   ├── shared-types/
│   └── content-schema/
├── data-samples/              # fixtures públicos sintéticos
├── scripts/
│   ├── diagnose.sh
│   ├── install.sh
│   ├── test-offline.sh
│   ├── backup.sh
│   └── restore.sh
├── systemd/                   # unidades y configuración de ejemplo
├── docs/
│   ├── architecture.md
│   ├── hardware-inventory.md
│   ├── power-tests.md
│   ├── security-model.md
│   ├── content-sources.md
│   └── commissioning.md
└── tests/
```

No guardar la clave de la bóveda en Git, código fuente, `.env` distribuido, ni SD pública. Se deben proporcionar `*.example` sin secretos. Documentar licencias y procedencia de contenidos.

## 5. Arquitectura de interfaz de 7 pulgadas

### Diseño visual
- Aspecto técnico elegante, serio, funcional y legible bajo luz exterior: verdes oscuros, grafito, blanco cálido y acentos de emergencia no estridentes.
- Objetivos táctiles amplios (idealmente >= 44 CSS px), alto contraste, tipografía local, navegación con guantes mediante botones físicos en futuro.
- Orientación horizontal inicialmente; adaptarse a resolución física real, sin fijarla arbitrariamente en 1024×600.
- Consumo reducido: sin fondos animados, sin render continuo fuera del mapa, sin polling agresivo.
- Siempre visible: hora (con fuente de tiempo), estado GNSS (sin fix/2D/3D), red (offline/local), temperatura CPU, espacio libre, estado de batería si existe medición real.
- Si no hay medidor de batería, mostrar **“Batería: no disponible”**, jamás porcentaje estimado sin datos.

### Pantallas principales
1. **Inicio:** accesos rápidos, estado, alertas y tareas urgentes.
2. **Mapas:** capas offline, posición, zoom, escala, marcadores, waypoints, coordenadas.
3. **Navegación:** rumbo por desplazamiento, altitud, calidad GNSS, destinos, track GPX.
4. **Biblioteca:** categorías, índice, búsqueda local, favoritos, lector modo noche.
5. **Emergencias:** procedimientos curados para agua, refugio, alimentación y primeros auxilios. Advertencias claras sobre incertidumbre y riesgos.
6. **Personal Vault:** documentos cifrados, vistas previas seguras y bloqueo automático.
7. **Comunicaciones:** Wi-Fi local; integración LoRa solo si existe hardware específico.
8. **Herramientas:** sensores detectados, coordenadas, calculadoras, bitácora, brújula solo con sensor o GPS en movimiento.
9. **Sistema:** alimentación, almacenamiento, diagnóstico, fecha/hora, servicios, actualización offline y apagado seguro.

### Accesibilidad y manejo
- Barra superior persistente con indicadores reales.
- Botones «Atrás», «Inicio» y «Bloquear» siempre localizables.
- Modo alto contraste, fuente ampliada, pantalla atenuable.
- Bloqueo táctil opcional y protección ante toques accidentales.
- Estados vacíos claros; no usar datos de demostración en producción.

## 6. Módulo Mapas offline

**Fase inicial**: MapLibre GL JS con estilos, fuentes y glifos locales, servido por HTTP en localhost; PMTiles como posible formato, o alternativa MBTiles/servidor de tiles local si resulta más robusta. Confirmar compatibilidad y rendimiento de Chromium ARM/Wayland.

Requisitos:
- Desplazamiento/zoom sin Internet; vista regional instalada de prueba.
- GPS overlay y posición actual sin retraso artificial.
- Markers locales: agua, refugios, hospitales, farmacias, rutas propias; distinguir datos verificables de anotaciones del usuario.
- GPX importar/exportar; track y waypoints persistentes.
- Vista de latitud/longitud en formato decimal y copiable.
- Capas topográficas o relieve solamente si se han descargado y probado.
- Si el mapa no está instalado o el dispositivo no tiene fix: aviso explícito.
- Opciones de ahorro: pausar render al abandonar la pantalla.
- No prometer navegación guiada/ruteo hasta integrar y evaluar un motor offline real.

**Licencias**: respetar atribución OSM y condiciones de fuentes cartográficas; evitar descargas masivas de servidores públicos de tiles contrarias a sus políticas. Descargar paquetes legales y preparar mapas en un PC cuando convenga.

## 7. GPS / GNSS

- Detectar si el módulo disponible es USB o UART; nunca asumir pinout o voltaje.
- Servicio `gpsd` si el hardware está soportado, con adaptador de API y salida tipada.
- Datos: timestamp GNSS, latitud, longitud, altitud si está disponible, velocidad, precisión estimada si está disponible, número de satélites si hay datos, modo de fix.
- Registrar tracks GPX con intervalo configurable (por defecto conservador); opción «no registrar» por privacidad.
- Identificar fuentes de hora: RTC/NTP/GNSS. No tratar hora del sistema como correcta sin validación.
- GPS no aporta brújula absoluta estando parado; mostrar rumbo de trayectoria solo cuando el desplazamiento sea suficiente.
- Si no se ha validado GNSS, permitir una simulación explícita **solo en desarrollo** con etiqueta visible, nunca en operación normal.

## 8. Biblioteca offline

- **Kiwix / kiwix-serve** para ficheros ZIM compatibles, con catálogo local.
- Fuentes iniciales: Wikipedia en español en versión adecuada al espacio disponible, primeros auxilios de fuentes sanitarias contrastadas, agricultura, agua, reparación, electricidad, mecánica y aprendizaje.
- Índice de documentación propia: metadatos en SQLite y búsqueda FTS5 para TXT/HTML/Markdown/PDF con extracción offline. Aceptar PDF como visor separado; OCR no es obligatorio en MVP.
- Búsqueda unificada, favoritos y «contenidos de emergencia descargados».
- Indexación y conversiones pesadas en equipo de desarrollo antes de copiarlas a la Raspberry; evitar saturar CPU y microSD durante uso de campo.
- Contenido versionado, origen, fecha de consulta, licencia, tamaño y checksum SHA-256.
- La microSD de 128 GB limita el catálogo inicial; medir espacio disponible antes de elegir descargas. Preparar SSD USB opcional futuro, no obligatorio.
- La biblioteca debe continuar funcionando sin red externa.

## 9. Personal Vault: seguridad real

**Modelo de amenaza**: pérdida/robo del equipo y extracción de microSD; acceso remoto indebido; desbloqueo por observación; cortes de alimentación. No afirmar resistencia a ataques forenses avanzados sin auditoría especializada.

- Separar almacenamiento público del privado.
- Usar **LUKS2/dm-crypt** como opción preferida para un volumen de documentos y una **contraseña robusta**; el PIN de la UI puede ser mecanismo secundario, nunca el único secreto que derive una clave de cifrado.
- El volumen privado **no debe montarse automáticamente** al arranque. El desbloqueo requiere intervención del usuario.
- Al bloquear, cerrar descriptores, desmontar el volumen cifrado si se puede, limpiar temporales, vistas previas y cachés de navegador; hacer explícita cualquier limitación.
- Limitar intentos en interfaz y servicio, sin plantear que ello sustituye una KDF y contraseña fuertes contra ataques offline.
- La API privada no accesible desde móviles conectados a Wi-Fi, salvo habilitación explícita en un diseño separado y auditado.
- No almacenar ni registrar contraseñas ni contenido sensible en logs.
- Copias cifradas verificadas y procedimiento de restauración documentado.
- **Nunca guardar frases semilla de recuperación de Ledger, claves privadas de wallets ni PIN de hardware wallet en este prototipo.** Mantenerlos en medios de custodia especializados, idealmente fuera de línea.
- Documentos: copias de DNI/pasaporte, contactos, pólizas, datos médicos voluntarios; ofrecer etiquetado y fecha de revisión.
- Antes de introducir documentación real, ejecutar pruebas de cifrado, bloqueo, robo simulado de microSD y restauración.

## 10. Comunicaciones y ESP32 (fase posterior)

- Wi-Fi Access Point local opcional con SSID configurable y contraseña WPA2/3 según soporte real, sin acceso automático a Internet. No confundir conexión al AP con acceso al vault.
- UI compartible limitada a documentación pública y mapas; acceso privado solo en consola local.
- ESP32 como servicio complementario por USB serial: sensores, botones, telemetría y control de energía.
- Protocolo serie versionado: JSON Lines/CBOR con `type`, `version`, `timestamp`, `deviceId`, payload y validación; definir reconexión y límites.
- LoRa/Meshtastic requiere radio LoRa real (SX126x/SX127x o placa compatible); ESP32 por sí solo no transmite LoRa.
- Nunca exponer servicios inseguros o administración del sistema en el hotspot público.

## 11. Gestión energética y pantalla

**Fase 1 = 7" HDMI táctil solamente**. La pantalla DSI 5" queda guardada para ensayo futuro de autonomía, **no** modo dual.

- Desarrollo con fuente USB-C de 27 W compatible. Para Raspberry Pi 5, comprobar 5 V / 5 A y capacidad de corriente para periféricos. No suponer que la batería de 10 000 mAh válida en Pi 4B lo es también para Pi 5.
- Confirmar si la pantalla requiere alimentación USB independiente, GPIO u otra; nunca alimentar sin verificar voltaje/corriente.
- Medir consumo *real* del conjunto en: idle, lectura de manual, GPS, mapa, Wi-Fi local, pantalla atenuada y apagada.
- Implementar suspensión/apagado de retroiluminación según soporte del monitor; HDMI apagado ≠ necesariamente backlight apagada.
- Botón de apagado seguro y opción de apagado mediante UI. No cortar alimentación de microSD mientras haya escrituras.
- Parar módulos inactivos, limitar polling, evitar animaciones permanentes, rotación de logs y escritura excesiva en SD.
- Temperatura CPU y throttling medidos; ventilador PWM no debe dejar el equipo sin refrigeración suficiente.
- Monitorización de batería únicamente si se dispone de sensor/UPS compatible; nunca inventar SOC ni autonomía.
- Un ESP32 independiente podría proporcionar modo vigilancia de bajo consumo más adelante, pero sin afirmarlo como funcionalidad actual.
- Test futuro: cambiar 7" HDMI por 5" DSI, mismo caso de uso y brillo comparable, medir Wh y documentar relación utilidad/autonomía.

## 12. Kiosco y arranque

- Usar la versión de Raspberry Pi OS de 64 bits compatible con el hardware y registrar release/kernel. Evitar guías obsoletas dependientes de X11 cuando el equipo use Wayland.
- Priorizar **Raspberry Pi OS Desktop mínimo / labwc + Chromium --kiosk** si es la ruta más fiable para HTML táctil. No exigir a priori arrancar sin entorno gráfico; ocultar escritorio y terminal en producción.
- La aplicación local debe iniciarse antes que Chromium; systemd con orden y `Restart=on-failure`, sin bucles de reinicio agresivos.
- En caso de fallo de la app mostrar una pantalla de recuperación o instrucción útil, nunca una pantalla negra permanente.
- Mantener SSH y un método físico/teclado de recuperación documentado. No deshabilitar el login administrativo antes de verificar el kiosco.
- Establecer un usuario Linux de servicio con permisos mínimos; jamás correr Nuxt como root.
- Desactivar pantalla de inicio, notificaciones y bloqueos del escritorio solamente cuando estén comprobados los controles de recuperación.

## 13. Fases de implementación (obligatorias)

### Fase 0 — Auditoría hardware y entorno
**Entregables:** inventario, resolución, estado táctil, energía, OS y plan de montaje.
**Aceptación:** pantalla 7" y toque operativos, alimentación sin undervoltage, recuperación local/SSH disponible.

### Fase 1 — Skeleton operativo
- Monorepo, TypeScript estricto, ESLint, scripts de desarrollo/producción y systemd de ejemplo.
- Dashboard táctil con 9 módulos y estados honestos.
- API de salud (`/api/health`), almacenamiento, temperatura y uptime.
- Demo local ejecutable antes de configurar autostart.
**Aceptación:** una semana de arranques/reinicios repetidos en prueba, UI accesible en localhost y sin requests externos.

### Fase 2 — Kiosco y energía
- Autostart condicional tras comprobación manual; watchdog de aplicación; menú de apagado seguro.
- Ajuste de brillo y pantalla en reposo si hardware lo permite.
**Aceptación:** arranque autónomo y vuelta a UI después de error/reinicio.

### Fase 3 — Biblioteca y emergencias
- Kiwix local y lectura de un ZIM pequeño legalmente redistribuible.
- Importador de contenido TXT/MD/HTML/PDF, índices locales y búsqueda.
- Protocolos de emergencia con origen y fecha.
**Aceptación:** leer y buscar documentos con cable de red y Wi-Fi desactivados.

### Fase 4 — Mapas y GPS
- Primer paquete geográfico de prueba y render offline.
- Integración GPS real tras identificación; mapa con estado sin fijación.
- GPX y favoritos.
**Aceptación:** abrir mapa en ausencia total de Internet, obtener coordenadas reales al aire libre y guardar un track.

### Fase 5 — Personal Vault
- Diseño de amenaza, LUKS2, UI de bloqueo, importación de documentos ficticios y restauración.
**Aceptación:** extracción de microSD no permite leer los documentos de prueba sin contraseña; bloqueo y backup/recovery probados. Prohibido incorporar datos reales hasta pasar pruebas.

### Fase 6 — ESP32 y sensores
- Detección, protocolo, tarjetas de sensores y manejo de desconexiones.
**Aceptación:** un ESP32 conectado/desconectado no cuelga la UI ni bloquea otros módulos.

### Fase 7 — Preparación de campo
- Carcasa, autonomía, batería certificada/compatibilidad real, funcionamiento térmico, respaldo y documentación de emergencia en papel.
**Aceptación:** pruebas de tiempo de uso, reinicios, pérdida de GPS, desconexión de red y cortes controlados.

## 14. Calidad y pruebas

- Unit tests para parsers GPS, catálogos, permisos, estados y serial.
- E2E para navegación con ratón/táctil simulado; validar manualmente en pantalla física.
- Test sin Internet con interfaz de red externa desactivada y bloqueo de DNS remoto.
- Tests de recuperación tras reinicio y SD casi llena; nunca forzar apagados brutales de forma repetida sin backups.
- Riesgos importantes: corrupción SD, caída de tensión, mapas no descargados, GPS sin fix, congelación de kiosk, vault expuesto, fugas de previews o logs.
- Recopilar métricas: memoria, CPU, temperatura, consumo (si hay medidor), tiempo de arranque, FPS solo en mapas.
- Mantener un `CHANGELOG.md` y decisiones de arquitectura (`docs/adr/`).

## 15. Lo que Claude NO debe hacer

- No prometer funcionalidad de pantalla/táctil sin identificarla.
- No crear una interfaz que dependa de Internet para cargar iconos, fuentes, CSS, mapas o módulos JavaScript.
- No afirmar que GPS funciona sin receptor ni que ESP32 incluye LoRa.
- No guardar datos personales reales en fixtures, logs o repositorio.
- No tratar un PIN de 4–6 dígitos como protección suficiente de archivos cifrados.
- No guardar semilla de Ledger ni claves de recuperación cripto en el dispositivo.
- No instalar actualizaciones de sistema que cambien drásticamente GPU, Wayland, kernel o módulos sin copia de seguridad y plan de rollback.
- No ejecutar comandos destructivos (`dd`, particionado, `mkfs`, borrados o cambios de boot) sin enseñar objetivo exacto, dispositivo exacto y requerir autorización.
- No simular porcentajes de batería, coordenadas, temperatura o información de sensores como si fueran reales.
- No intentar implementar todos los módulos a la vez: comenzar por un vertical slice funcional.

## 16. Primer encargo concreto para Claude

> **Empieza por la Fase 0 y la Fase 1.** Inspecciona el entorno actual sin modificar nada destructivo. Construye un repositorio Survival OS con Nuxt + TypeScript + CSS, una interfaz táctil de 7" orientada a uso offline, navegación entre módulos con pantallas de estado, una API local de diagnóstico real, y un README de instalación y desarrollo. Crea `.env.example` sin secretos, `docs/hardware-inventory.md`, pruebas básicas y un script `test-offline.sh`. No implementes todavía el desbloqueo real de la bóveda ni alteres el arranque del dispositivo hasta validar la app manualmente. Cuando esa primera fase funcione, propón los cambios de systemd/kiosco para revisión.

## 17. Referencias técnicas verificadas (consultar versiones vigentes)

- Alimentación y documentación oficial de Raspberry Pi: https://www.raspberrypi.com/documentation/computers/raspberry-pi.html
- Tutorial oficial de kiosco Raspberry Pi: https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/
- Ejemplo MapLibre + PMTiles: https://maplibre.org/maplibre-gl-js/docs/examples/pmtiles-source-and-protocol/
- MapLibre GL JS: https://maplibre.org/maplibre-gl-js/
- Kiwix: https://kiwix.org/
- GPSD: https://gpsd.io/
- Raspberry Pi 5 USB-PD (documentación oficial): https://pip-assets.raspberrypi.com/categories/685-app-notes-guides-whitepapers/documents/RP-009856-WP-1-USB%20Power%20delivery%20on%20Raspberry%20Pi%205.pdf

**Definición de éxito de MVP:** la Raspberry Pi 5 con su pantalla HDMI táctil de 7" arranca una aplicación estable, operable al tacto, verdaderamente offline y preparada para añadir contenido, navegación, cifrado y módulos auxiliares por etapas.
