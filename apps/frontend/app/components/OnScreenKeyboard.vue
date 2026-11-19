<script setup lang="ts">
import { ArrowBigUp, CornerDownLeft, Delete, KeyboardOff } from '@lucide/vue'
import type { Locale } from '~/utils/i18n'

/**
 * Teclado en pantalla propio (no depende del compositor ni de squeekboard).
 * Aparece al enfocar un campo de texto; se retira 60 s si se usa un teclado físico.
 * Los botones no roban el foco (pointerdown.prevent): se escribe en el campo activo.
 */
const t = useT()
const { settings } = useDisplaySettings()
// Android (ADR 0020): el sistema ya tiene su teclado; el de pantalla es para el kiosco de la Pi.
const android = useAndroid()
const target = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const layer = ref<'letters' | 'symbols'>('letters')
const shift = ref(false)
type Dead = '´' | '`' | '^' | '¨'
const accent = ref<Dead | null>(null)
let physicalUntil = 0
let hideTimer: ReturnType<typeof setTimeout> | undefined

const TEXT_TYPES = new Set(['text', 'search', 'password', 'email', 'url', 'number', 'tel', ''])
/**
 * Distribución y acentos según el idioma de la interfaz: QWERTY con ñ (español), AZERTY con ç (francés),
 * QWERTY (inglés, italiano). Los acentos son teclas muertas: acento y luego la vocal.
 */
const LAYOUTS: Record<Locale, { letters: string[]; dead: Dead[] }> = {
  es: { letters: ['qwertyuiop', 'asdfghjklñ', 'zxcvbnm'], dead: ['´', '¨'] },
  en: { letters: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], dead: [] },
  fr: { letters: ['azertyuiop', 'qsdfghjklm', 'wxcvbnç'], dead: ['´', '`', '^', '¨'] },
  it: { letters: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], dead: ['`', '´'] },
  // QWERTZ con diéresis y ß en su sitio.
  de: { letters: ['qwertzuiopü', 'asdfghjklöä', 'yxcvbnmß'], dead: [] },
  // Chino y japonés: letras latinas (pinyin, rōmaji, nombres). El teclado en pantalla no convierte a caracteres
  // (sin método de entrada); con teclado físico, el del sistema.
  zh: { letters: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], dead: [] },
  ja: { letters: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], dead: [] },
}
const layout = LAYOUTS[locale.value]
const SYMBOLS = ['1234567890', '@#€&*()-_+', '!?/:;"\',=']
const ACCENTED: Record<Dead, string> = {
  '´': 'aáeéiíoóuúyý',
  '`': 'aàeèiìoòuù',
  '^': 'aâeêiîoôuû',
  '¨': 'aäeëiïoöuüyÿ',
}

/** Letra con acento (en minúscula o mayúscula) o null si esa combinación no existe. */
function accented(dead: Dead, c: string): string | null {
  const pairs = ACCENTED[dead]
  const lower = c.toLowerCase()
  for (let i = 0; i < pairs.length; i += 2) {
    if (pairs[i] === lower) return c === lower ? pairs[i + 1]! : pairs[i + 1]!.toUpperCase()
  }
  return null
}

function isTextField(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  return el instanceof HTMLInputElement && TEXT_TYPES.has(el.type) && !el.readOnly && !el.disabled
}

function onFocusIn(e: FocusEvent): void {
  if (android || !settings.value.osk || Date.now() < physicalUntil || !isTextField(e.target)) return
  if (hideTimer) clearTimeout(hideTimer)
  target.value = e.target
  layer.value = e.target instanceof HTMLInputElement && e.target.type === 'number' ? 'symbols' : 'letters'
  nextTick(() => target.value?.scrollIntoView({ block: 'center', behavior: 'instant' }))
}

function onFocusOut(): void {
  hideTimer = setTimeout(() => {
    if (!isTextField(document.activeElement)) target.value = null
  }, 150)
}

function onKeyDown(e: KeyboardEvent): void {
  // Pulsación real de un teclado físico: se oculta el virtual durante 60 s.
  if (e.isTrusted && target.value) {
    physicalUntil = Date.now() + 60_000
    target.value = null
  }
}

function emitInput(el: HTMLInputElement | HTMLTextAreaElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function insert(text: string): void {
  const el = target.value
  if (!el) return
  try {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    el.setRangeText(text, start, end, 'end')
  } catch {
    el.value += text // type=number/email no admiten selección
  }
  emitInput(el)
}

function press(ch: string): void {
  let c = shift.value ? ch.toUpperCase() : ch
  if (accent.value) {
    c = accented(accent.value, c) ?? `${accent.value}${c}`
    accent.value = null
  }
  insert(c)
  if (shift.value) shift.value = false
}

function backspace(): void {
  const el = target.value
  if (!el) return
  try {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    if (start === end && start > 0) el.setRangeText('', start - 1, end, 'end')
    else el.setRangeText('', start, end, 'end')
  } catch {
    el.value = el.value.slice(0, -1)
  }
  emitInput(el)
}

function enter(): void {
  const el = target.value
  if (!el) return
  if (el instanceof HTMLTextAreaElement) return insert('\n')
  if (el.form) el.form.requestSubmit()
  else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  el.blur()
  target.value = null
}

function hide(): void {
  target.value?.blur()
  target.value = null
}

onMounted(() => {
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('keydown', onKeyDown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('focusout', onFocusOut)
  document.removeEventListener('keydown', onKeyDown, true)
})

const rows = computed(() => (layer.value === 'letters' ? layout.letters : SYMBOLS))

// Con el teclado abierto se añade margen inferior a las páginas para que cualquier campo pueda subir por encima.
watch(target, (t) => document.documentElement.classList.toggle('osk-open', !!t))
</script>

<template>
  <div v-if="target" class="osk" role="group" :aria-label="t('osk.label')" @pointerdown.prevent>
    <div v-for="(row, ri) in rows" :key="ri" class="row">
      <button v-if="ri === 2 && layer === 'letters'" type="button" class="k wide" :class="{ on: shift }" :aria-label="t('osk.shift')" @pointerdown.prevent="shift = !shift">
        <ArrowBigUp :size="22" />
      </button>
      <button v-for="ch in row" :key="ch" type="button" class="k" @pointerdown.prevent="press(ch)">{{ shift ? ch.toUpperCase() : ch }}</button>
      <button v-if="ri === 2" type="button" class="k wide" :aria-label="t('osk.delete')" @pointerdown.prevent="backspace"><Delete :size="22" /></button>
    </div>
    <div class="row">
      <button type="button" class="k wide" @pointerdown.prevent="layer = layer === 'letters' ? 'symbols' : 'letters'">{{ layer === 'letters' ? '123' : 'abc' }}</button>
      <template v-if="layer === 'letters'">
        <button
          v-for="d in layout.dead" :key="d" type="button" class="k" :class="{ on: accent === d }"
          :aria-label="t('osk.accent', { mark: d })" @pointerdown.prevent="accent = accent === d ? null : d"
        >
          {{ d }}
        </button>
      </template>
      <button type="button" class="k" @pointerdown.prevent="insert(',')">,</button>
      <button type="button" class="k space" :aria-label="t('osk.space')" @pointerdown.prevent="insert(' ')">␣</button>
      <button type="button" class="k" @pointerdown.prevent="insert('.')">.</button>
      <button type="button" class="k wide enter" :aria-label="t('osk.enter')" @pointerdown.prevent="enter"><CornerDownLeft :size="22" /></button>
      <button type="button" class="k wide" :aria-label="t('osk.hide')" @pointerdown.prevent="hide"><KeyboardOff :size="22" /></button>
    </div>
  </div>
</template>

<style scoped>
.osk {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 150;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.4rem 0.5rem 0.5rem;
  background: var(--surface);
  border-top: 2px solid var(--accent);
  touch-action: manipulation;
}

.row {
  display: flex;
  gap: 0.3rem;
  justify-content: center;
}

.k {
  flex: 1 1 0;
  min-width: 0;
  max-width: 5.6rem;
  height: 3.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-3);
  color: var(--text);
  font: inherit;
  font-size: 1.3rem;
  font-weight: 700;
  cursor: var(--cursor-point);
}

.k:active,
.k.on {
  background: var(--accent);
  color: var(--accent-ink);
}

.k.wide {
  flex-grow: 1.5;
  max-width: 7rem;
}

.k.space {
  flex-grow: 5;
  max-width: none;
}

.k.enter {
  background: color-mix(in srgb, var(--accent) 35%, var(--surface-3));
}
</style>
