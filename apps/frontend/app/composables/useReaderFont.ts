/**
 * Tamaño de letra de los lectores (libros de la biblioteca y documentos de texto), en %. Se recuerda en el
 * navegador del equipo; los lectores lo aplican sin recargar (zoom del artículo o variable --fs del documento).
 */
export const READER_FONT_STEPS = [80, 90, 100, 110, 125, 140, 160, 180, 200] as const
const KEY = 'survival-os:reader-font'

function load(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return (READER_FONT_STEPS as readonly number[]).includes(v) ? v : 100
  } catch {
    return 100
  }
}

export function useReaderFont() {
  const pct = useState<number>('reader:font', () => (import.meta.client ? load() : 100))

  function set(v: number): void {
    pct.value = v
    try {
      localStorage.setItem(KEY, String(v))
    } catch {
      // sin almacenamiento: dura hasta recargar
    }
  }
  const idx = computed(() => READER_FONT_STEPS.indexOf(pct.value as (typeof READER_FONT_STEPS)[number]))
  const canSmaller = computed(() => idx.value > 0)
  const canLarger = computed(() => idx.value < READER_FONT_STEPS.length - 1)

  return {
    pct,
    canSmaller,
    canLarger,
    smaller: () => canSmaller.value && set(READER_FONT_STEPS[idx.value - 1]!),
    larger: () => canLarger.value && set(READER_FONT_STEPS[idx.value + 1]!),
    reset: () => set(100),
  }
}
