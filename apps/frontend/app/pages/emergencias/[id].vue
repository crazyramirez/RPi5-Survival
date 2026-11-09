<script setup lang="ts">
import { ArrowLeft, BookMarked, Bot, CalendarCheck, Phone } from '@lucide/vue'
import type { ProtocolDetail } from '@survival-os/shared-types'

/**
 * Protocolo de emergencia. El HTML viene del renderizador seguro del servicio
 * library (todo escapado, solo etiquetas conocidas) a partir de ficheros
 * versionados en la release: por eso se puede insertar con v-html.
 */
const t = useT()
/** Vista pública (punto de acceso): sin favoritos (son del equipo, no del móvil). */
const publicView = isPublicView()
const route = useRoute()
const router = useRouter()
const protocol = ref<ProtocolDetail | null>(null)
const error = ref(false)

onMounted(async () => {
  try {
    protocol.value = await $fetch<ProtocolDetail>(`/api/library/protocols/${String(route.params.id)}`, { timeout: 8000, retry: 0 })
  } catch {
    error.value = true
  }
})
</script>

<template>
  <div class="page">
    <div class="bar">
      <button type="button" class="btn" @click="router.push('/emergencias')">
        <ArrowLeft :size="20" aria-hidden="true" />
        {{ t('module.emergency') }}
      </button>
      <span class="call-hint" aria-hidden="true"><Phone :size="16" /><span class="mono">{{ t('em.call.number') }}</span></span>
      <FavoriteButton v-if="protocol && !publicView" :fav-id="`protocol:${protocol.id}`" :title="protocol.title" :href="`/emergencias/${protocol.id}`" />
    </div>

    <div v-if="error" class="notice tone-danger">{{ t('em.notFound') }}</div>
    <p v-else-if="!protocol" class="muted">{{ t('state.loading') }}</p>

    <article v-else class="protocol">
      <header class="head">
        <div class="tags">
          <span v-if="protocol.category" class="ui-chip cat">{{ protocol.category }}</span>
          <span class="ui-chip"><CalendarCheck :size="14" aria-hidden="true" />{{ t('em.reviewed', { date: protocol.reviewed }) }}</span>
        </div>
        <h1>{{ protocol.title }}</h1>
      </header>

      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="content" v-html="protocol.html" />

      <footer class="meta">
        <p class="src">
          <BookMarked :size="18" aria-hidden="true" />
          <span><strong>{{ t('em.sources') }}</strong>{{ protocol.sources }}</span>
        </p>
        <p class="notice tone-warn ai">
          <Bot :size="18" aria-hidden="true" />
          <span>{{ t('em.aiNotice') }}</span>
        </p>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.75rem;
}

/* Recordatorio pasivo del 112 (no es un botón: el equipo no llama). */
.call-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--danger) 50%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
  font-weight: 700;
}

.protocol {
  max-width: 52rem;
  animation: fade-in 0.18s ease-out;
}

/* ------------------------------------------------------------ Cabecera */
.head {
  padding: 0.85rem 1rem 0.95rem;
  margin-bottom: 0.4rem;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--danger) 12%, transparent), transparent 55%),
    var(--surface-grad);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.45rem;
}

.cat {
  color: var(--text);
  font-weight: 700;
}

h1 {
  font-size: 1.55rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

/* ------------------------------------------------------------ Texto */
.content {
  padding: 0 0.2rem;
  font-size: 1.12rem;
  line-height: 1.6;
  color: var(--text);
}

.content :deep(p) {
  margin: 0.5rem 0;
}

.content :deep(h2),
.content :deep(h3),
.content :deep(h4) {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin: 1.25rem 0 0.5rem;
  font-size: 1.18rem;
  font-weight: 700;
  line-height: 1.3;
  color: var(--accent);
}

.content :deep(h2)::before,
.content :deep(h3)::before,
.content :deep(h4)::before {
  content: '';
  flex: none;
  width: 4px;
  height: 1.1em;
  border-radius: 2px;
  background: var(--accent);
}

.content :deep(h3),
.content :deep(h4) {
  font-size: 1.05rem;
  color: var(--text);
}

/* Pasos numerados: cifra en círculo y separador fino entre pasos. */
.content :deep(ol) {
  counter-reset: step;
  list-style: none;
  margin: 0.4rem 0 0.8rem;
  padding: 0;
}

.content :deep(ol > li) {
  counter-increment: step;
  position: relative;
  min-height: 2.2rem;
  margin: 0;
  padding: 0.55rem 0.2rem 0.55rem 3rem;
  border-bottom: 1px solid var(--hairline);
}

.content :deep(ol > li:last-child) {
  border-bottom: none;
}

.content :deep(ol > li)::before {
  content: counter(step);
  position: absolute;
  left: 0.1rem;
  top: 0.55rem;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1;
  color: var(--accent-ink);
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 85%, #fff), var(--accent));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}

/* Viñetas: punto del acento con halo. */
.content :deep(ul) {
  list-style: none;
  margin: 0.3rem 0 0.8rem;
  padding: 0;
}

.content :deep(ul > li) {
  position: relative;
  margin: 0;
  padding: 0.3rem 0.2rem 0.3rem 1.6rem;
}

.content :deep(ul > li)::before {
  content: '';
  position: absolute;
  left: 0.35rem;
  top: 0.95rem;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}

.content :deep(strong) {
  color: var(--text);
  font-weight: 700;
}

.content :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.92em;
  padding: 0 0.3rem;
  border-radius: 4px;
  background: var(--surface-3);
}

.content :deep(a) {
  color: var(--info);
}

.content :deep(blockquote) {
  margin: 0.6rem 0 0.9rem;
  padding: 0.65rem 0.95rem;
  border-left: 4px solid var(--warn);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--warn) 10%, var(--surface));
  color: var(--text);
  font-size: 1rem;
  line-height: 1.5;
}

/* ------------------------------------------------------------ Pie */
.meta {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 1.3rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--border);
  font-size: 0.88rem;
  line-height: 1.45;
}

.src {
  display: flex;
  gap: 0.55rem;
  align-items: flex-start;
  color: var(--text-muted);
}

.src svg {
  flex: none;
  margin-top: 0.1rem;
  color: var(--accent);
}

.src strong {
  display: block;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}
</style>
