<script setup lang="ts">
import { Eye, EyeOff, KeyRound, Power, RadioTower, ShieldCheck, Smartphone, TriangleAlert, Users } from '@lucide/vue'
import type { ApStatus } from '@survival-os/shared-types'

/**
 * Punto de acceso Wi-Fi local (ADR 0009). Todo pasa por la tarea root `ap` (lista cerrada de acciones);
 * el estado mostrado es el que devuelve esa tarea (medido con nmcli/iw/nft/systemctl), nunca supuesto.
 */
const t = useT()
const job = useAdminJob('ap')
const ap = computed(() => (job.status.value?.data as ApStatus | null | undefined) ?? null)
const reveal = ref(false)
const confirmOn = ref(false)
const confirmPassword = ref(false)

onMounted(() => {
  // Estado real al entrar (la tarea es ligera: solo consulta).
  setTimeout(() => {
    if (!job.running.value) void job.start({ action: 'status' })
  }, 300)
})

let hideTimer: ReturnType<typeof setTimeout> | undefined
function toggleReveal(): void {
  reveal.value = !reveal.value
  if (hideTimer) clearTimeout(hideTimer)
  if (reveal.value) hideTimer = setTimeout(() => (reveal.value = false), 30_000)
}
onBeforeUnmount(() => hideTimer && clearTimeout(hideTimer))
</script>

<template>
  <AppCard
    :title="t('ui.ap.title')" :icon="RadioTower" :tone="ap?.active ? 'ok' : 'muted'"
    :pill="job.running.value ? t('ui.ap.checking') : ap?.active ? t('ui.ap.on') : t('ui.ap.off')"
  >
    <p>{{ t('ui.ap.note') }}</p>

    <template v-if="ap?.active">
      <div class="creds">
        <div class="cred">
          <small>{{ t('ui.ap.ssid') }}</small>
          <strong class="mono">{{ ap.ssid ?? '—' }}</strong>
        </div>
        <div class="cred">
          <small>{{ t('ui.ap.password') }}</small>
          <strong class="mono">{{ reveal ? (ap.password ?? '—') : '••••••••••••' }}</strong>
          <button type="button" class="btn icon" :aria-label="t('ui.ap.reveal')" :aria-pressed="reveal" @click="toggleReveal">
            <component :is="reveal ? EyeOff : Eye" :size="18" />
          </button>
        </div>
        <div class="cred">
          <small>{{ t('ui.ap.url') }}</small>
          <strong class="mono">{{ ap.url }}</strong>
        </div>
      </div>
      <p class="steps"><Smartphone :size="16" aria-hidden="true" />{{ t('ui.ap.steps', { url: ap.url }) }}</p>
      <div class="chips">
        <span class="ui-chip" :class="ap.clients ? 'tone-ok' : ''"><Users :size="14" aria-hidden="true" />{{ t('ui.ap.clients') }}: {{ ap.clients ?? '—' }}</span>
        <span class="ui-chip" :class="ap.firewall ? 'tone-ok' : 'tone-danger'"><ShieldCheck :size="14" aria-hidden="true" />{{ t('ui.ap.firewall') }}: {{ ap.firewall ? t('state.ok') : t('state.error') }}</span>
        <span class="ui-chip" :class="ap.gateway ? 'tone-ok' : 'tone-danger'">{{ t('ui.ap.gateway') }}: {{ ap.gateway ? t('state.ok') : t('state.error') }}</span>
      </div>
      <div class="row">
        <button type="button" class="btn btn-danger grow" :disabled="job.running.value" @click="job.start({ action: 'off' })">
          <Power :size="18" /> {{ t('ui.ap.turnOff') }}
        </button>
        <button type="button" class="btn" :disabled="job.running.value" @click="confirmPassword = true">
          <KeyRound :size="18" /> {{ t('ui.ap.newPassword') }}
        </button>
      </div>
    </template>
    <template v-else>
      <p class="warn"><TriangleAlert :size="16" aria-hidden="true" />{{ t('ui.ap.confirmBody') }}</p>
      <button type="button" class="btn btn-primary" :disabled="job.running.value" @click="confirmOn = true">
        <RadioTower :size="18" /> {{ t('ui.ap.turnOn') }}
      </button>
    </template>
    <JobLog :status="job.status.value?.state === 'failed' || job.running.value ? job.status.value : null" :error="job.error.value" :lines="4" />

    <ConfirmDialog
      v-if="confirmOn"
      :title="t('ui.ap.confirmTitle')"
      :message="t('ui.ap.confirmBody')"
      :confirm-label="t('ui.ap.turnOn')"
      danger
      @confirm="confirmOn = false; job.start({ action: 'on' })"
      @cancel="confirmOn = false"
    />
    <ConfirmDialog
      v-if="confirmPassword"
      :title="t('ui.ap.newPasswordTitle')"
      :message="t('ui.ap.newPasswordBody')"
      :confirm-label="t('ui.ap.newPassword')"
      @confirm="confirmPassword = false; job.start({ action: 'password' })"
      @cancel="confirmPassword = false"
    />
  </AppCard>
</template>

<style scoped>
.creds {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg);
}

.cred {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: var(--touch);
  padding: 0.2rem 0.4rem 0.2rem 0.8rem;
  border-bottom: 1px solid var(--hairline);
}

.cred:last-child {
  border-bottom: none;
}

.cred small {
  flex: none;
  width: 7.5rem;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.cred strong {
  flex: 1;
  min-width: 0;
  font-size: 1.1rem;
  overflow-wrap: anywhere;
}

.steps,
.warn {
  display: flex;
  gap: 0.45rem;
  align-items: flex-start;
}

.steps svg {
  flex: none;
  margin-top: 0.15rem;
  color: var(--info);
}

.warn svg {
  flex: none;
  margin-top: 0.15rem;
  color: var(--warn);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.row {
  display: flex;
  gap: 0.5rem;
}

.grow {
  flex: 1;
}

.btn.icon {
  flex: none;
  min-width: var(--touch);
  padding: 0;
}
</style>
