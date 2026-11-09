# ADR 0009 — Punto de acceso Wi-Fi local y vista pública (§10)

- **Estado:** ACEPTADA e implementada (2026-11-09). El usuario la autorizó («que sea funcional, yo puedo activar o
  desactivar desde la pantalla y volver a tener SSH»). Revisión de diseño: rpi5-survival-81.
- **Implementación:**
  - tarea root `ap` en `scripts/admin-job.py` (on, off, status, password);
  - pasarela `scripts/public-gateway.mjs` con su unidad `systemd/survival-public.service`;
  - tarjeta `ApCard.vue` en Comunicaciones;
  - vista pública en el cliente (`utils/publicView.ts`, middleware de rutas).
- **Detalles añadidos al implementar:**
  - el nft limita además la entrada desde `wlan0` a DHCP, DNS y HTTP, así que SSH y VNC quedan cerrados desde el AP;
  - portal cautivo: dnsmasq resuelve cualquier nombre a 10.42.0.1 y la pasarela redirige a la portada, con lo que el
    móvil abre Survival OS solo;
  - la búsqueda de la biblioteca queda fuera de la vista pública porque mezcla documentos propios e historial del
    asistente;
  - el bloqueo de tareas «network» es común a `ap` y `wifi`;
  - la contraseña del AP no pasa nunca por argv ni por el registro de la tarea (revisión de rpi5-survival-81):
    - el perfil se escribe como keyfile 0600 en `/etc/NetworkManager/system-connections/` (solo WPA2-CCMP) y se
      carga con `nmcli con load`;
    - `run()` enmascara los secretos;
    - cualquier excepción al encender revierte todo.

    Prueba: `tests/python/test_admin_job_ap.py`.
- **Verificado en el PC:**
  - 6 pruebas de la pasarela: lista blanca, portal, métodos, X-Forwarded-For y cookies;
  - vista pública de extremo a extremo con la pasarela real delante de la app;
  - `/sistema` y `/boveda` redirigen a Inicio, y `POST` devuelve 403.
- **Pendiente:** encenderlo en la Pi desde la pantalla y conectar un móvil (corta el SSH por Wi-Fi mientras emite).
- **Objetivo:** que un móvil o portátil cercano se conecte a una red Wi-Fi propia del equipo, sin Internet, y consulte
  mapas, protocolos de emergencia y la biblioteca en **solo lectura**. La bóveda, el sistema, el
  mantenimiento y el asistente de IA quedan solo en la pantalla local.

## Decisión propuesta

1. **Red:** una conexión de NetworkManager `survival-ap` en `wlan0`:
   - modo AP, 2,4 GHz, WPA2-PSK (WPA3 si el chip lo admite, tras comprobarlo);
   - `ipv4.method shared` en `10.42.0.1/24` (DHCP propio);
   - `autoconnect=no`: **nunca arranca solo**; se enciende y se apaga desde Comunicaciones.
2. **Sin Internet para los clientes:** regla nftables propia `table inet survival_ap { chain forward { iifname "wlan0" drop } }`,
   que se crea al encender el AP y se borra al apagarlo. Así no hay salida aunque haya un cable con Internet.
3. **Vista pública:** una pasarela mínima `survival-public` (Node, usuario `survival`) que escucha solo en
   `10.42.0.1:80` y reenvía a `127.0.0.1:3000`:
   - solo **GET/HEAD** y solo rutas en **lista blanca**: `/`, `/_nuxt/**`, `/mapas`, `/emergencias/**`,
     `/biblioteca`, `/biblioteca/leer`, `/api/maps/**`, `/api/library/{protocols,search,status}`, `/kiwix/**`,
     `/map-assets/**`, `/tiles/**`;
   - siempre añade `X-Forwarded-For`, con lo que el guardián privado de Nitro rechaza cualquier ruta privada aunque
     algo se colara (doble barrera);
   - en la vista pública se ocultan la bóveda, el sistema, el mantenimiento, el asistente, el apagado y el bloqueo.
4. **Control:** tarea de administración `ap` (`on`/`off`/`status`) por la vía existente (`survival-admin@`, polkit
   acotado). La pantalla Comunicaciones muestra el SSID, la contraseña (oculta hasta tocar) y los clientes conectados.
5. **Credenciales:** el SSID y la contraseña se generan aleatoriamente en el equipo (`/etc/survival-os/ap.env`, 0600
   root); la contraseña se puede cambiar desde la pantalla. No van al repositorio ni a los logs.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| **Al encender el AP, `wlan0` deja la red de casa: se pierde SSH/VNC por Wi-Fi** | Aviso y confirmación en la UI; recomendar cable Ethernet o acceso físico; el AP nunca se enciende solo |
| Alguien en el AP intenta acceder a la bóveda o al sistema | Lista blanca en la pasarela + `X-Forwarded-For` → guardián privado; servicios privados solo por loopback o socket |
| Clientes usan el equipo como salida a Internet | nftables `forward drop` en `wlan0` |
| Consumo y calor | Aviso de consumo; apagado automático opcional tras N minutos sin clientes |
| El asistente de IA (un solo hueco) saturado por clientes | Excluido de la vista pública |

## Plan de vuelta atrás (probado antes de dar la fase por buena)

1. Desde la pantalla: Comunicaciones → «Apagar punto de acceso» (borra la regla nftables y baja la conexión).
2. Por SSH con cable o teclado local:
   - `sudo nmcli con down survival-ap`
   - `sudo nft delete table inet survival_ap`
   - `sudo nmcli con up <conexión de casa>`
3. Desinstalar:
   - `sudo systemctl disable --now survival-public`
   - `sudo nmcli con delete survival-ap`
   - `sudo rm /etc/survival-os/ap.env`

   Las releases anteriores no traen la pasarela.

## Pruebas de aceptación

- Con el AP encendido, un móvil ve mapas, emergencias y biblioteca; `/boveda`, `/sistema`, `/api/vault/*`,
  `/api/admin/*` y `/biblioteca/preguntar` dan 403/404 desde el móvil.
- `curl` desde el móvil a una IP de Internet falla; `test-offline.sh` sigue pasando.
- Al apagar el AP, `wlan0` vuelve a la red de casa y la regla nftables desaparece.
