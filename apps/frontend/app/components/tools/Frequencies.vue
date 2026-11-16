<script setup lang="ts">
/**
 * Frecuencias de emergencia y de llamada de referencia. Solo valores normalizados, con su norma;
 * lo que es costumbre (no oficial) se marca como tal.
 */
import { RadioTower } from '@lucide/vue'

const t = useT()
/** Separador decimal del idioma (las frecuencias se guardan con punto). */
const mhz = (v: string): string => (locale.value === 'en' ? v : v.replace(/\./g, ','))

type FreqId = 'marine16' | 'air' | 'beacon' | 'cb9' | 'cb19' | 'pmr' | 'ham2m' | 'ham70' | 'hamHf' | 'meshEu' | 'meshUs' | 'frs1' | 'gmrs20'

interface Freq {
  id: FreqId
  mhz: string
  /** Ámbito: internacional, Europa (CEPT / IARU Región 1) o EE. UU. */
  region: 'intl' | 'eu' | 'us'
  /** Necesita licencia para emitir (salvo peligro). */
  licence: boolean
  /** Uso por costumbre, no por norma. */
  informal?: boolean
}

const FREQS: Freq[] = [
  { id: 'marine16', mhz: '156.800', region: 'intl', licence: true },
  { id: 'air', mhz: '121.500', region: 'intl', licence: true },
  { id: 'beacon', mhz: '406', region: 'intl', licence: false },
  { id: 'cb9', mhz: '27.065', region: 'intl', licence: false },
  { id: 'cb19', mhz: '27.185', region: 'intl', licence: false, informal: true },
  { id: 'pmr', mhz: '446.00625–446.19375', region: 'eu', licence: false },
  { id: 'ham2m', mhz: '145.500', region: 'eu', licence: true },
  { id: 'ham70', mhz: '433.500', region: 'eu', licence: true },
  { id: 'hamHf', mhz: '3.760 · 7.110 · 14.300 · 18.160 · 21.360', region: 'intl', licence: true },
  { id: 'meshEu', mhz: '869.525', region: 'eu', licence: false },
  { id: 'meshUs', mhz: '906.875', region: 'us', licence: false },
  { id: 'frs1', mhz: '462.5625', region: 'us', licence: false },
  { id: 'gmrs20', mhz: '462.675', region: 'us', licence: true, informal: true },
]
</script>

<template>
  <AppCard :title="t('field.freq.title')" :icon="RadioTower" tone="info" class="wide">
    <div class="table" role="table" :aria-label="t('field.freq.title')">
      <div v-for="f in FREQS" :key="f.id" class="row" role="row">
        <span class="mhz mono" :class="{ multi: f.mhz.includes('·') }" role="cell">{{ mhz(f.mhz) }} <small>MHz</small></span>
        <span class="what" role="cell">
          <strong>{{ t(`field.freq.${f.id}`) }}</strong>
          <small>
            {{ t(`field.freq.${f.id}.src`) }}
            <template v-if="f.informal"> · {{ t('field.freq.informal') }}</template>
          </small>
        </span>
        <span class="tags" role="cell">
          <span class="ui-chip">{{ t(`field.freq.region.${f.region}`) }}</span>
          <span class="ui-chip" :class="f.licence ? 'lic' : 'free'">{{ t(f.licence ? 'field.freq.licence' : 'field.freq.free') }}</span>
        </span>
      </div>
    </div>
    <p class="note">{{ t('field.freq.note') }}</p>
  </AppCard>
</template>

<style scoped>
.wide {
  grid-column: 1 / -1;
}

.table {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
  gap: 0.3rem 0.8rem;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.mhz {
  flex: none;
  width: 7.2rem;
  font-weight: 700;
  color: var(--tone);
  font-size: 0.95rem;
  word-break: break-word;
}

.mhz.multi {
  /* Varias frecuencias (HF): celda más ancha y letra algo menor, en dos líneas como mucho. */
  width: 10.5rem;
  font-size: 0.8rem;
  line-height: 1.35;
}

.mhz small {
  color: var(--text-faint);
  font-size: 0.7rem;
}

.what {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.what strong {
  font-size: 0.88rem;
}

.what small {
  font-size: 0.72rem;
  color: var(--text-faint);
}

.tags {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
}

.tags .ui-chip {
  font-size: 0.68rem;
}

.lic {
  color: var(--warn);
}

.free {
  color: var(--ok);
}

.note {
  font-size: 0.78rem;
  color: var(--text-faint);
}
</style>
