# Survival OS — Hoja de campo (imprimir y guardar con el equipo)

> Esta hoja existe porque un equipo electrónico puede fallar. Imprímela, plastifícala y guárdala junto al dispositivo.

## Emergencias

- **112** — emergencias en la UE. Indica qué ocurre, **dónde** (coordenadas de Navegación) y cuántas víctimas.
- Protocolos completos en **Emergencias** (PAS, RCP, hemorragia, atragantamiento, quemaduras, hipotermia,
  golpe de calor, potabilizar agua). Son resúmenes orientativos: no sustituyen a la formación.

## Encender, apagar, recuperar

| Situación | Qué hacer |
|---|---|
| Encender | Conectar la alimentación USB-C (5 V / 5 A). La interfaz aparece en ~1–2 min |
| Apagar | **Sistema → Apagar equipo** o pulsar una vez el botón de la placa. Desconectar solo con el LED verde apagado |
| Pantalla apagada | Tocarla (se apaga sola tras 10 min sin uso) |
| Pantalla bloqueada | Mantener pulsado el botón central 1,5 s |
| Interfaz negra o colgada | Esperar 2 min (se recupera sola). Si no: apagar con el botón de la placa y volver a encender |
| Sin interfaz | Teclado USB → `Ctrl+Alt+F2` → usuario de escritorio (`survival-pi`) → `sudo systemctl restart 'survival-*'` |
| Mantenimiento | SSH: `ssh survival-pi@<IP>` (solo con red local) |

## Bóveda personal

- Solo se abre con **tu contraseña**. Sin ella los documentos son irrecuperables: nadie puede abrirla.
- Escribe aquí una pista (nunca la contraseña): ______________________________________
- Se bloquea sola a los 5 minutos y al bloquear la pantalla.
- Copia cifrada: `sudo /opt/survival-os/current/scripts/vault-backup.sh /media/<usuario>/<USB>` (con la bóveda bloqueada).
- **No guardes** semillas de wallets, claves privadas ni PIN de hardware wallets.

## Navegación

- La posición requiere receptor GNSS y cielo abierto. **Parado no hay rumbo**: el GPS no es una brújula.
- Los puntos guardados son anotaciones tuyas, no datos verificados.
- Sin red, la hora puede ser incorrecta tras un apagado (sin pila RTC): fíjate en la etiqueta junto al reloj.

## Datos del equipo

| | |
|---|---|
| Versión de Survival OS | ________ |
| Fecha de la última copia de seguridad | ________ |
| Ubicación de la copia (USB) | ________ |
| Mapas instalados / fecha de datos | ________ |
