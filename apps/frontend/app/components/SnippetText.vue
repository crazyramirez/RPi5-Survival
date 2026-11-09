<script setup lang="ts">
import { splitSnippet } from '~/utils/snippet'

const props = defineProps<{ text: string }>()
const parts = computed(() => splitSnippet(props.text))
</script>

<template>
  <span class="snippet"><template v-for="(p, i) in parts" :key="i"><mark v-if="p.mark">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></span>
</template>

<style scoped>
mark {
  background: color-mix(in srgb, var(--warn) 30%, transparent);
  color: var(--text);
  border-radius: 3px;
  padding: 0 2px;
}
</style>
