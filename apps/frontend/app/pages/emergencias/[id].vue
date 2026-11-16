<script setup lang="ts">
import { ArrowLeft, Phone, Printer } from '@lucide/vue'
import type { ProtocolDetail } from '@survival-os/shared-types'
import { protocolReaderProfile } from '~/utils/protocol-reader'
import { buildGuideDocument } from '~/utils/guide-reader'

definePageMeta({ guideCatalog: true })

const t = useT()
const route = useRoute()
const publicView = isPublicView()
const { loadFavorites } = useLibrary()
const protocol = ref<ProtocolDetail | null>(null)
const error = ref(false)
const profile = computed(() => protocolReaderProfile(
  String(route.params.id),
  protocol.value ? buildGuideDocument(protocol.value.html).sections.map((section) => section.title) : undefined,
))
let request = 0

async function load(): Promise<void> {
  const current = ++request
  protocol.value = null
  error.value = false
  try {
    const value = await $fetch<ProtocolDetail>(`/api/library/protocols/${encodeURIComponent(String(route.params.id))}`, { timeout: 8000, retry: 0 })
    if (current === request) protocol.value = value
  } catch {
    if (current === request) error.value = true
  }
}
watch(() => route.params.id, load, { immediate: true })
onMounted(() => { if (!publicView) void loadFavorites() })
onBeforeUnmount(() => { request++ })
</script>

<template>
  <GuideReader
    v-if="protocol" :title="protocol.title" :html="protocol.html" :category="protocol.category"
    :reviewed="protocol.reviewed" :sources="protocol.sources" :section-styles="profile.sections" :tone="profile.tone"
    :review-status="profile.medical ? t('reader.medicalPending') : undefined"
    :note="profile.medical ? t('em.aiNotice') : t('reader.aiNotice')"
    :translation-note="protocol.translatedFrom ? t('em.translated') : undefined"
  >
    <template #back><NuxtLink to="/emergencias" class="btn"><ArrowLeft :size="22" aria-hidden="true" />{{ t('module.emergency') }}</NuxtLink></template>
    <template #actions>
      <span v-if="profile.contact" class="reader-phone" role="note" :aria-label="`${t('em.call')}: ${t('em.call.number')}`"><Phone :size="21" aria-hidden="true" /><strong>{{ t('em.call.number') }}</strong></span>
      <FavoriteButton v-if="!publicView" :fav-id="`protocol:${protocol.id}`" :title="protocol.title" :href="`/emergencias/${protocol.id}`" />
      <NuxtLink to="/emergencias/imprimir" class="btn reader-print" :aria-label="t('ui.print.open')"><Printer :size="22" aria-hidden="true" /><span>{{ t('ui.print.open') }}</span></NuxtLink>
    </template>
  </GuideReader>
  <div v-else class="page">
    <PageHeader :title="t('module.emergency')" :back="{ to: '/emergencias', label: t('module.emergency') }" />
    <div v-if="error" class="notice tone-danger reader-error" role="alert"><p>{{ t('em.notFound') }}</p><button type="button" class="btn" @click="load">{{ t('guides.retry') }}</button></div>
    <p v-else role="status" class="muted">{{ t('state.loading') }}</p>
  </div>
</template>

<style scoped>
.reader-phone { display: inline-flex; align-items: center; gap: 0.4rem; min-height: var(--touch); padding: 0.35rem 0.8rem; border: 1px solid var(--danger); border-radius: var(--radius); background: color-mix(in srgb, var(--danger) 8%, var(--surface)); color: var(--danger); font-size: 1.25rem; }
.reader-error { display: grid; justify-items: start; gap: 0.75rem; }
@media (max-width: 800px) {
  .reader-print { min-width: var(--touch); padding-inline: 0.65rem; }
  .reader-print span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
}
@media (max-width: 600px) {
  .reader-phone { padding-inline: 0.55rem; font-size: 1.1rem; }
}
</style>
