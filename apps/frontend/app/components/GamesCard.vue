<script setup lang="ts">
import { Download, Gamepad2, RefreshCw, Trash2 } from '@lucide/vue'
import type { GamesStatus } from '@survival-os/shared-types'
import { formatBytes } from '~/utils/format'

/**
 * Juegos offline (ADR 0012) en Mantenimiento: descarga o vuelve a descargar la copia de Viseni Games.
 * Solo baja lo que haya cambiado; la copia actual sigue funcionando hasta que la nueva está completa.
 */
const props = defineProps<{ online: boolean }>()
const t = useT()
const status = ref<GamesStatus | null>(null)
const games = useGamesInstalled()
async function load(): Promise<void> {
  // También actualiza el botón «Juegos» de la barra inferior (aparece/desaparece al descargar o quitar).
  status.value = await games.refresh()
}
const job = useAdminJob('games', () => setTimeout(() => void load(), 2000))
onMounted(load)
const confirmSync = ref(false)
const confirmRemove = ref(false)
const installed = computed(() => !!status.value?.installed)
</script>

<template>
  <AppCard
    :title="t('ui.games.title')" :icon="Gamepad2" :tone="status?.available ? 'ok' : 'muted'"
    :pill="status?.available ? t('ui.games.on') : installed ? t('ui.games.down') : t('ui.games.off')"
  >
    <p>{{ t('ui.games.note') }}</p>
    <p v-if="installed && status" class="faint small">
      {{ t('ui.games.summary', { n: status.games.length, files: status.files, size: formatBytes(status.bytes), date: status.installedAt?.slice(0, 10) ?? '—' }) }}
    </p>
    <p v-if="status?.incompleteGames.length" class="warn small">{{ t('ui.games.incomplete', { list: status.incompleteGames.join(', ') }) }}</p>
    <p v-if="status?.external.length" class="faint small">
      {{ t('ui.games.external', { n: status.external.length, example: status.external[0]!.file.split('/').slice(0, 2).join('/') }) }}
    </p>
    <div class="row">
      <button type="button" class="btn" :class="{ 'btn-primary': !installed }" :disabled="job.running.value || !props.online" @click="confirmSync = true">
        <component :is="installed ? RefreshCw : Download" :size="18" aria-hidden="true" />{{ installed ? t('ui.games.update') : t('ui.games.download') }}
      </button>
      <span v-if="!installed" class="faint small">{{ t('ui.games.firstSize') }}</span>
      <button v-if="installed" type="button" class="btn" :disabled="job.running.value" @click="confirmRemove = true">
        <Trash2 :size="18" aria-hidden="true" />{{ t('ui.games.remove') }}
      </button>
    </div>
    <p v-if="!props.online" class="warn small">{{ t('mnt.content.offline') }}</p>
    <JobLog :status="job.status.value" :error="job.error.value" :lines="4" />

    <ConfirmDialog
      v-if="confirmSync"
      :title="t('ui.games.confirmTitle')"
      :message="t('ui.games.confirmBody')"
      :confirm-label="installed ? t('ui.games.update') : t('mnt.content.download')"
      @confirm="job.start({ action: 'sync' }); confirmSync = false"
      @cancel="confirmSync = false"
    />
    <ConfirmDialog
      v-if="confirmRemove"
      :title="t('ui.games.removeTitle')"
      :message="t('ui.games.removeBody', { size: formatBytes(status?.bytes ?? 0) })"
      :confirm-label="t('ui.games.remove')"
      danger
      @confirm="job.start({ action: 'remove' }); confirmRemove = false"
      @cancel="confirmRemove = false"
    />
  </AppCard>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.small {
  font-size: 0.82rem;
}

.warn {
  color: var(--warn) !important;
}
</style>
