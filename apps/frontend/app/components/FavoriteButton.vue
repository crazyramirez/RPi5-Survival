<script setup lang="ts">
import { Star, TriangleAlert } from '@lucide/vue'

/** Alterna un favorito de la biblioteca (persistido en el servicio library). Si falla, lo dice unos segundos. */
const props = defineProps<{ favId: string; title: string; href: string }>()
const t = useT()
const { favorites, toggleFavorite } = useLibrary()
const active = computed(() => favorites.value.some((f) => f.id === props.favId))
const busy = ref(false)
const failed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function toggle(): Promise<void> {
  busy.value = true
  failed.value = false
  clearTimeout(timer)
  try {
    await toggleFavorite(props.favId, props.title, props.href)
  } catch {
    failed.value = true
    timer = setTimeout(() => (failed.value = false), 4000)
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <button type="button" class="btn fav" :class="{ on: active, failed }" :aria-pressed="active" :disabled="busy" @click="toggle">
    <TriangleAlert v-if="failed" :size="20" aria-hidden="true" />
    <Star v-else :size="20" aria-hidden="true" />
    <span role="status">{{ failed ? t('lib.fav.error') : active ? t('lib.fav.remove') : t('lib.fav.add') }}</span>
  </button>
</template>

<style scoped>
.fav.on svg {
  fill: var(--warn);
  color: var(--warn);
}
.fav.failed {
  color: var(--danger);
}
</style>
