<script setup lang="ts">
import { CircleCheckBig, TriangleAlert, X } from '@lucide/vue'

/**
 * Aviso tras actualizar (ADR 0021): «Survivelia OS actualizado — ya tienes la versión X», una sola vez por versión
 * en este equipo; o, si la última instalación falló y se volvió atrás, qué versión no se instaló. Sirve para la
 * Pi, la portable y Android. La versión vista se guarda en el navegador (sin almacenamiento: se usa la fecha de
 * la última instalación, avisando solo durante las 24 h siguientes).
 */
const t = useT()
const route = useRoute()
const updates = useUpdates()
const SEEN = 'survival-os:seen-version'
const SEEN_FAIL = 'survival-os:seen-update-fail'
const notice = ref<{ ok: true; version: string; from: string | null } | { ok: false; version: string; message: string } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

const newer = (a: string, b: string): boolean => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}
const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v)
  } catch {
    // sin almacenamiento
  }
}

onMounted(async () => {
  const s = await updates.refresh()
  if (!s?.supported || !/^\d+\.\d+\.\d+$/.test(s.installed)) return
  const prev = read(SEEN)
  write(SEEN, s.installed)
  const li = s.lastInstall
  if (li && !li.ok && li.version && read(SEEN_FAIL) !== li.at) {
    write(SEEN_FAIL, li.at)
    notice.value = { ok: false, version: li.version, message: li.message ?? '' }
  } else if (prev && /^\d+\.\d+\.\d+$/.test(prev) && newer(s.installed, prev)) {
    notice.value = { ok: true, version: s.installed, from: prev }
  } else if (!prev && li?.ok && li.version === s.installed && Date.now() - Date.parse(li.at) < 24 * 3600_000) {
    // Primera vez con este aviso (se actualizó desde una versión que aún no guardaba la versión vista).
    notice.value = { ok: true, version: s.installed, from: null }
  }
  if (notice.value?.ok) timer = setTimeout(() => (notice.value = null), 20_000)
})
onBeforeUnmount(() => timer && clearTimeout(timer))

const show = computed(() => !!notice.value && !route.path.startsWith('/bienvenida'))

/** «Ver novedades»: el registro de cambios en una ventana encima, sin cambiar de pantalla. */
const changelog = ref<{ version: string; from: string | null } | null>(null)
function details(): void {
  const n = notice.value
  if (!n) return
  changelog.value = { version: n.version, from: n.ok ? n.from : null }
  notice.value = null
  if (timer) clearTimeout(timer)
}
</script>

<template>
  <ChangelogDialog v-if="changelog" :version="changelog.version" :from="changelog.from" @close="changelog = null" />
  <aside v-if="show && notice" class="notice-upd" :class="notice.ok ? 'tone-ok' : 'tone-warn'" role="status" aria-live="polite">
    <span class="orb" aria-hidden="true">
      <CircleCheckBig v-if="notice.ok" :size="22" />
      <TriangleAlert v-else :size="22" />
    </span>
    <div class="text">
      <template v-if="notice.ok">
        <h2>{{ t('upd.notice.title') }}</h2>
        <p>{{ notice.from ? t('upd.notice.bodyFrom', { v: notice.version, from: notice.from }) : t('upd.notice.body', { v: notice.version }) }}</p>
      </template>
      <template v-else>
        <h2>{{ t('upd.notice.failTitle') }}</h2>
        <p>{{ t('upd.last.fail', { v: notice.version, msg: notice.message }) }}</p>
      </template>
      <button type="button" class="btn" @click="details">{{ t('upd.notice.details') }}</button>
    </div>
    <button type="button" class="close" :aria-label="t('common.close')" @click="notice = null"><X :size="18" /></button>
  </aside>
</template>

<style scoped>
.notice-upd {
  position: fixed;
  top: calc(var(--bar-h) + 0.8rem);
  right: 1rem;
  z-index: 150;
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
  max-width: min(28rem, calc(100vw - 2rem));
  padding: 0.9rem 1rem;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--tone, var(--accent)) 45%, var(--border));
  background: var(--surface);
  box-shadow: 0 12px 32px rgb(0 0 0 / 45%);
}

.tone-ok {
  --tone: var(--ok, var(--accent));
}

.tone-warn {
  --tone: var(--warn, var(--accent));
}

.orb {
  display: grid;
  place-items: center;
  flex: none;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 50%;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 14%, transparent);
}

.text {
  display: grid;
  gap: 0.35rem;
  justify-items: start;
  min-width: 0;
}

h2 {
  margin: 0;
  font-size: 1.05rem;
}

p {
  margin: 0;
  color: var(--text-muted);
}

.close {
  display: grid;
  place-items: center;
  flex: none;
  width: 2.75rem;
  height: 2.75rem;
  margin: -0.4rem -0.4rem 0 0;
  border: 0;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--text-muted);
  cursor: var(--cursor-point);
}
</style>
