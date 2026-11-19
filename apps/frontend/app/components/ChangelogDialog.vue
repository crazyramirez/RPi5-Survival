<script setup lang="ts">
import { Sparkles, X } from '@lucide/vue'
import { changelogSections, type ChangelogSection } from '~/utils/changelog'

/**
 * Novedades tras actualizar: las secciones del CHANGELOG.md de las versiones nuevas (de `from`, sin incluirla,
 * hasta `version`). El CHANGELOG va dentro de la app y solo se carga al abrir esta ventana: sin Internet.
 */
const props = defineProps<{ version: string; from?: string | null }>()
const emit = defineEmits<{ close: [] }>()
const t = useT()

const sections = ref<ChangelogSection[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const md = (await import('../../../../CHANGELOG.md?raw')).default as string
    sections.value = changelogSections(md, props.version, props.from ?? null)
  } catch {
    sections.value = []
  } finally {
    loading.value = false
  }
})

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="scrim" role="dialog" aria-modal="true" :aria-label="t('upd.changelog.title')" @click.self="emit('close')">
    <article class="card">
      <header class="head">
        <span class="orb" aria-hidden="true"><Sparkles :size="20" /></span>
        <div class="titles">
          <h2>{{ t('upd.changelog.title') }}</h2>
          <p>{{ t('upd.notice.body', { v: props.version }) }}</p>
        </div>
        <button type="button" class="close" :aria-label="t('common.close')" @click="emit('close')"><X :size="20" /></button>
      </header>

      <div class="scroll">
        <p v-if="loading" class="muted">{{ t('state.loading') }}</p>
        <p v-else-if="!sections.length" class="muted">{{ t('upd.changelog.empty') }}</p>
        <section v-for="s in sections" :key="s.version" class="ver">
          <div class="ver-head">
            <span class="tag">v{{ s.version }}</span>
            <span class="date">{{ s.date }}</span>
          </div>
          <h3 v-if="s.title">{{ s.title }}</h3>
          <!-- Texto del CHANGELOG del propio repositorio, escapado antes de dar formato. -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="md" v-html="s.html" />
        </section>
      </div>

      <footer class="foot">
        <button type="button" class="btn btn-primary" @click="emit('close')">{{ t('upd.changelog.ok') }}</button>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 170;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(4 6 5 / 0.62);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  animation: fade-in 0.2s ease-out;
}

.card {
  display: flex;
  flex-direction: column;
  width: min(40rem, 100%);
  max-height: calc(100dvh - 2rem);
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
  background: var(--surface);
  box-shadow: 0 30px 80px rgb(0 0 0 / 0.6);
  overflow: hidden;
  animation: pop-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.head {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.9rem 0.9rem 0.8rem 1.1rem;
  border-bottom: 1px solid var(--hairline);
  background:
    linear-gradient(90deg, var(--surface) 30%, transparent),
    url('/backgrounds/welcome-topo.webp') center / cover;
}

.orb {
  display: grid;
  place-items: center;
  flex: none;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 50%;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.titles {
  flex: 1;
  min-width: 0;
}

.titles h2 {
  margin: 0;
  font-size: 1.2rem;
}

.titles p {
  margin: 0.1rem 0 0;
  font-size: 0.88rem;
  color: var(--text-muted);
}

.close {
  display: grid;
  place-items: center;
  flex: none;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: var(--cursor-point);
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.4rem 1.2rem 0.8rem;
  overscroll-behavior: contain;
  touch-action: pan-y;
}

.ver {
  padding: 0.8rem 0;
}

.ver + .ver {
  border-top: 1px solid var(--hairline);
}

.ver-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.tag {
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  font-weight: 700;
}

.date {
  font-size: 0.8rem;
  color: var(--text-faint);
}

h3 {
  margin: 0.45rem 0 0.2rem;
  font-size: 1.05rem;
}

.md :deep(h4) {
  margin: 0.7rem 0 0.3rem;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.md :deep(ul) {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding-left: 1.1rem;
}

.md :deep(ul ul) {
  margin-top: 0.3rem;
}

.md :deep(li) {
  font-size: 0.92rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.md :deep(li::marker) {
  color: var(--accent);
}

.md :deep(strong) {
  color: var(--text);
}

.md :deep(code) {
  padding: 0 0.25rem;
  border-radius: 4px;
  background: var(--surface-2);
  font-family: var(--font-mono);
  font-size: 0.85em;
}

.md :deep(p) {
  margin: 0.3rem 0;
  color: var(--text-muted);
}

.muted {
  color: var(--text-muted);
}

.foot {
  display: flex;
  justify-content: flex-end;
  padding: 0.7rem 1rem;
  border-top: 1px solid var(--hairline);
}

.foot .btn {
  min-width: 9rem;
  justify-content: center;
}
</style>
