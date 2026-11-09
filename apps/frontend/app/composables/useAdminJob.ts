import type { AdminJob, AdminJobStatus } from '@survival-os/shared-types'

/**
 * Tarea de mantenimiento (unidad systemd survival-admin@<tarea>). Sondea cada 2 s solo
 * mientras está en curso; emite `onDone` al terminar para recargar los datos afectados.
 */
export function useAdminJob(job: AdminJob, onDone?: (st: AdminJobStatus) => void) {
  const status = ref<AdminJobStatus | null>(null)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined
  let wasRunning = false

  const running = computed(() => status.value?.state === 'active' || status.value?.state === 'activating')

  async function refresh(): Promise<void> {
    try {
      status.value = await $fetch<AdminJobStatus>(`/api/admin/${job}`, { timeout: 8000, retry: 0 })
      if (wasRunning && !running.value) onDone?.(status.value)
      wasRunning = running.value
      if (!running.value && timer) {
        clearInterval(timer)
        timer = undefined
      }
    } catch {
      // se reintenta en el siguiente ciclo
    }
  }

  function poll(): void {
    if (!timer) timer = setInterval(() => void refresh(), 2000)
  }

  async function start(params: Record<string, unknown> = {}): Promise<void> {
    error.value = null
    try {
      status.value = await postAction<AdminJobStatus>(`/api/admin/${job}`, params)
      wasRunning = true
      poll()
    } catch (err) {
      error.value = actionErrorMessage(err)
    }
  }

  async function stop(): Promise<void> {
    try {
      status.value = await postAction<AdminJobStatus>(`/api/admin/${job}?stop=1`)
    } catch (err) {
      error.value = actionErrorMessage(err)
    }
  }

  onMounted(async () => {
    await refresh()
    if (running.value) poll()
  })
  onBeforeUnmount(() => timer && clearInterval(timer))

  return { status, error, running, start, stop, refresh }
}
