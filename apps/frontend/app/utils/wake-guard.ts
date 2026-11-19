/**
 * Primer toque con la pantalla apagada: solo la enciende.
 *
 * En el quiosco de la Pi, swayidle apaga el panel tras SCREEN_OFF_SECONDS sin tocarlo (o al pedirlo desde
 * Sistema) y lo enciende con el primer toque… pero Chromium recibe ese mismo toque y pulsaba lo que hubiera debajo.
 * La interfaz sabe cuánto lleva sin tocarse: si ha pasado el tiempo de apagado, el gesto completo (pulsar, deslizar,
 * soltar y el clic que genera) se descarta. Lógica pura aquí; los eventos los conecta plugins/wake-guard.client.ts.
 */
export type WakeInput = 'start' | 'move' | 'end' | 'click' | 'key'

export interface WakeGuard {
  /** true: descartar el evento (forma parte del gesto que despierta la pantalla). */
  input(kind: WakeInput, at: number): boolean
  /** La pantalla se acaba de apagar a mano: el siguiente gesto solo la enciende. */
  arm(): void
  /** Segundos sin tocar tras los que el quiosco apaga la pantalla (0 = nunca). */
  setOffAfter(seconds: number): void
}

/** Margen: un toque justo en el límite cuenta como si la pantalla siguiera encendida. */
const EDGE_MS = 500
/** Tras soltar, el navegador aún genera mousedown/mouseup/click del mismo toque. */
const TAIL_MS = 600

export function createWakeGuard(start: number): WakeGuard {
  let offAfterMs = 0
  let last = start
  let armed = false
  let swallowing = false
  let tailUntil = 0

  const asleep = (at: number) => armed || (offAfterMs > 0 && at - last >= offAfterMs - EDGE_MS)
  const wake = (at: number) => {
    armed = false
    last = at
  }

  return {
    input(kind, at) {
      switch (kind) {
        case 'start':
          if (!swallowing && asleep(at)) swallowing = true
          if (!swallowing) last = at
          else wake(at)
          return swallowing
        case 'move':
          if (swallowing) return true
          // Un ratón que se mueve enciende la pantalla sin pulsar nada: no hay nada que descartar.
          wake(at)
          return false
        case 'end':
          if (!swallowing) {
            last = at
            return false
          }
          swallowing = false
          tailUntil = at + TAIL_MS
          wake(at)
          return true
        case 'click':
          return swallowing || at < tailUntil
        case 'key': {
          // La tecla que enciende la pantalla no escribe en un campo que no se veía.
          const drop = asleep(at)
          wake(at)
          return drop
        }
      }
    },
    arm() {
      armed = true
    },
    setOffAfter(seconds) {
      offAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0
    },
  }
}

/** Instancia de la interfaz (la arma Sistema → «Apagar pantalla»). */
export const wakeGuard = createWakeGuard(Date.now())
