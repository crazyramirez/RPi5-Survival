/** Bloqueo táctil (anti-toques accidentales). No es un mecanismo de seguridad. */
export function useScreenLock() {
  const locked = useState<boolean>('screen:locked', () => false)
  return {
    locked,
    lock: () => {
      locked.value = true
    },
    unlock: () => {
      locked.value = false
    },
  }
}
