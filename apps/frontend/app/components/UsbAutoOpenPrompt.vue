<script setup lang="ts">
import { BellRing, X } from '@lucide/vue'

/**
 * Primera vez que se abre Survival OS desde su memoria USB en un equipo (ADR 0019): ofrece «abrir al conectar»,
 * instalarlo en el equipo o no volver a preguntar en él. Solo en la versión portable; nunca en la bienvenida.
 */
const t = useT()
const route = useRoute()
const { usb, load, autoOpen } = usePortableUsb()
const hidden = ref(false)
const busy = ref(false)
const done = ref(false)
const error = ref<string | null>(null)
let synced = false

onMounted(async () => {
  await load()
  // Memoria ya emparejada: los avisos del vigilante, en el idioma actual de la interfaz.
  if (usb.value?.autoOpen.paired && !synced) {
    synced = true
    await autoOpen('update').catch(() => undefined)
  }
})

const show = computed(() => {
  const s = usb.value
  if (hidden.value || !s || route.path.startsWith('/bienvenida')) return false
  if (done.value) return true
  return s.volume.removable && s.autoOpen.supported && !s.autoOpen.paired && !s.autoOpen.dismissed
})

async function act(fn: () => Promise<void>, after?: () => void): Promise<void> {
  busy.value = true
  error.value = null
  try {
    await fn()
    after?.()
  } catch (err) {
    error.value = actionErrorMessage(err)
  } finally {
    busy.value = false
  }
}

function yes(): void {
  void act(() => autoOpen('enable', 'ask'), () => {
    done.value = true
    setTimeout(() => (hidden.value = true), 6000)
  })
}

function install(): void {
  hidden.value = true
  void navigateTo('/sistema/mantenimiento#mnt-net')
}

function no(): void {
  void act(() => autoOpen('dismiss'), () => (hidden.value = true))
}
</script>

<template>
  <aside v-if="show" class="prompt tone-info" role="dialog" aria-live="polite" :aria-label="t('usb.prompt.title')">
    <span class="orb" aria-hidden="true"><BellRing :size="22" /></span>
    <div class="text">
      <template v-if="done">
        <p class="ok" role="status">{{ t('usb.prompt.done') }}</p>
      </template>
      <template v-else>
        <h2>{{ t('usb.prompt.title') }}</h2>
        <p>{{ t('usb.prompt.body') }}</p>
        <div class="actions">
          <button type="button" class="btn btn-primary" :disabled="busy" @click="yes">{{ t('usb.prompt.yes') }}</button>
          <button type="button" class="btn" :disabled="busy" @click="install">{{ t('usb.prompt.install') }}</button>
          <button type="button" class="btn" :disabled="busy" @click="no">{{ t('usb.prompt.no') }}</button>
        </div>
        <p v-if="error" class="warn" role="alert">{{ error }}</p>
      </template>
    </div>
    <button type="button" class="close" :aria-label="t('common.close')" @click="hidden = true"><X :size="18" /></button>
  </aside>
</template>

<style scoped>
.prompt {
  position: fixed;
  right: 1rem;
  bottom: calc(var(--action-h) + 0.8rem);
  z-index: 150;
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
  max-width: min(34rem, calc(100vw - 2rem));
  padding: 1rem 1.1rem;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background: var(--surface);
  box-shadow: 0 12px 32px rgb(0 0 0 / 45%);
}

.orb {
  display: grid;
  place-items: center;
  flex: none;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 50%;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.text {
  min-width: 0;
}

h2 {
  margin: 0 0 0.3rem;
  font-size: 1.05rem;
}

p {
  margin: 0;
  font-size: 0.9rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.7rem;
}

.close {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--touch);
  height: var(--touch);
  margin: -0.5rem -0.6rem 0 0;
  border: 0;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
}

.ok {
  color: var(--ok);
}

.warn {
  color: var(--warn);
  margin-top: 0.4rem;
}
</style>
