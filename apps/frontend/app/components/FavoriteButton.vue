<script setup lang="ts">
import { Star } from '@lucide/vue'

/** Alterna un favorito de la biblioteca (persistido en el servicio library). */
const props = defineProps<{ favId: string; title: string; href: string }>()
const t = useT()
const { favorites, toggleFavorite } = useLibrary()
const active = computed(() => favorites.value.some((f) => f.id === props.favId))
const busy = ref(false)

async function toggle(): Promise<void> {
  busy.value = true
  try {
    await toggleFavorite(props.favId, props.title, props.href)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button type="button" class="btn fav" :class="{ on: active }" :aria-pressed="active" :disabled="busy" @click="toggle">
    <Star :size="20" aria-hidden="true" />
    <span>{{ active ? t('lib.fav.remove') : t('lib.fav.add') }}</span>
  </button>
</template>

<style scoped>
.fav.on svg {
  fill: var(--warn);
  color: var(--warn);
}
</style>
