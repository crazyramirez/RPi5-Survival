<script setup lang="ts">
import { CircleCheckBig, CloudDownload, Globe2, Languages, LoaderCircle } from '@lucide/vue'
import type { ContentOverview } from '@survival-os/shared-types'
import { formatBytes } from '~/utils/format'
import { LOCALES } from '~/utils/i18n'
import { autoFit, downloadPlan, orderPlan } from '~/utils/content'

/**
 * «Descargarlo todo» (ADR 0018): con un toque se completa TODO lo que falta para el idioma y el país del
 * equipo — bibliotecas, manuales, mapas y rutas del país, mundo y todos los modelos del asistente —,
 * ajustado al espacio libre. Si ya está todo, lo confirma. Lo instalado no se vuelve a bajar.
 */
const props = defineProps<{ online: boolean; compact?: boolean; noConfirm?: boolean }>()
const emit = defineEmits<{ started: [items: string[]] }>()
const t = useT()
const { load: loadRegion, country } = useRegion()
const job = useAdminJob('content', () => void load())
const ov = ref<ContentOverview | null>(null)
const confirming = ref(false)

async function load(): Promise<void> {
  ov.value = await $fetch<ContentOverview>('/api/content', { timeout: 10_000, retry: 0 }).catch(() => ov.value)
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void loadRegion()
  void load()
  timer = setInterval(() => void load(), 6000)
})
onBeforeUnmount(() => timer && clearInterval(timer))

const installed = computed(() => new Set((ov.value?.items ?? []).filter((s) => s.state === 'installed').map((s) => s.id)))
const busy = computed(() => job.running.value || (ov.value?.items ?? []).some((s) => s.state === 'downloading' || s.state === 'verifying'))
const plan = computed(() => (ov.value ? downloadPlan(ov.value.catalog, installed.value, locale.value, country.value, 'all') : []))
const fit = computed(() => autoFit(plan.value, ov.value?.freeBytes ?? null))
const bytes = computed(() => fit.value.keep.reduce((n, i) => n + i.approxBytes, 0))
const droppedBytes = computed(() => fit.value.dropped.reduce((n, i) => n + i.approxBytes, 0))
const langName = computed(() => LOCALES.find((l) => l.code === locale.value)?.name ?? '')
const done = computed(() => !!ov.value && plan.value.length === 0)

async function start(): Promise<void> {
  confirming.value = false
  const items = orderPlan(fit.value.keep).map((i) => i.id)
  if (!items.length) return
  await job.start({ action: 'install', items })
  if (!job.error.value) emit('started', items)
}
</script>

<template>
  <section class="all" :class="{ compact: props.compact, done }">
    <span class="orb" aria-hidden="true">
      <CircleCheckBig v-if="done" :size="34" />
      <LoaderCircle v-else-if="busy" :size="34" class="spin" />
      <CloudDownload v-else :size="34" />
    </span>
    <div class="body">
      <h3>{{ done ? t('all.doneTitle') : t('all.title') }}</h3>
      <p v-if="done">{{ t('all.doneBody') }}</p>
      <p v-else>{{ props.compact ? t('all.bodyShort') : t('all.body') }}</p>
      <div class="chips">
        <span class="ui-chip"><Languages :size="14" aria-hidden="true" />{{ langName }}</span>
        <span v-if="country" class="ui-chip"><Globe2 :size="14" aria-hidden="true" />{{ country.name }}</span>
        <span v-if="!done && ov" class="ui-chip tone-info mono">{{ t('all.summary', { n: fit.keep.length, size: formatBytes(bytes) }) }}</span>
        <span v-if="ov?.freeBytes != null" class="ui-chip faint mono">{{ t('content.free', { size: formatBytes(ov.freeBytes) }) }}</span>
      </div>
      <p v-if="fit.dropped.length" class="notice tone-warn">{{ t('all.noSpace', { n: fit.dropped.length, size: formatBytes(droppedBytes) }) }}</p>
      <p v-if="!props.online && !done" class="notice tone-warn">{{ t('content.offline') }}</p>
    </div>
    <div v-if="!done" class="act">
      <button
        type="button" class="btn btn-primary big" :disabled="!props.online || busy || !fit.keep.length"
        @click="props.noConfirm ? start() : (confirming = true)"
      >
        <CloudDownload :size="22" aria-hidden="true" />
        {{ busy ? t('all.running') : t('all.go') }}
      </button>
    </div>
    <JobLog v-if="!props.compact" :status="job.status.value" :error="job.error.value" :lines="2" class="log" />
    <p v-else-if="job.error.value" class="notice tone-danger log">{{ job.error.value }}</p>
    <ConfirmDialog
      v-if="confirming" :title="t('all.confirm')" :message="t('all.confirmBody', { n: fit.keep.length, size: formatBytes(bytes) })"
      :confirm-label="t('all.go')" @confirm="start" @cancel="confirming = false"
    />
  </section>
</template>

<style scoped>
.all {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.9rem 1.1rem;
  padding: 1.1rem 1.2rem;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background:
    radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%),
    var(--surface-grad);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
}

.all.done {
  border-color: color-mix(in srgb, var(--ok) 45%, var(--border));
}

.orb {
  display: grid;
  place-items: center;
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
}

.done .orb {
  color: var(--ok);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

h3 {
  font-size: 1.25rem;
}

.body p {
  color: var(--text-muted);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.2rem;
}

.big {
  min-height: 3.6rem;
  padding: 0 1.4rem;
  font-size: 1.1rem;
}

.log {
  grid-column: 1 / -1;
}

.spin {
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 44rem) {
  .all {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .act {
    grid-column: 1 / -1;
  }

  .act .btn {
    width: 100%;
  }
}

/* Compacto (bienvenida): vertical, el botón a todo el ancho. */
.all.compact {
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.7rem 0.9rem;
  padding: 0.9rem 1rem;
}

.compact .orb {
  width: 3rem;
  height: 3rem;
}

.compact h3 {
  font-size: 1.1rem;
}

.compact .body p {
  font-size: 0.9rem;
}

.compact .act {
  grid-column: 1 / -1;
}

.compact .act .btn {
  width: 100%;
  min-height: 3.2rem;
}
</style>
