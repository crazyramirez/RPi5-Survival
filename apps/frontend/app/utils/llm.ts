import type { MessageKey } from '~/locales/es'

/** Catálogo cerrado de modelos del asistente (debe coincidir con scripts/llm-install.sh). */
export const LLM_MODELS = [
  { id: 'qwen3-4b', file: 'Qwen3-4B-Instruct-2507-Q4_0.gguf', size: '2,4 GB', license: 'Apache-2.0' },
  { id: 'gemma3-4b', file: 'gemma-3-4b-it-Q4_K_M.gguf', size: '2,5 GB', license: 'Gemma' },
  { id: 'llama3.2-3b', file: 'Llama-3.2-3B-Instruct-Q4_0.gguf', size: '1,9 GB', license: 'Llama 3.2' },
] as const

/** Nombre para mostrar de un fichero de modelo: el del catálogo o, si no está, el fichero sin extensión. */
export function llmModelLabel(file: string | null | undefined, t: (key: MessageKey) => string): string | null {
  if (!file) return null
  const m = LLM_MODELS.find((x) => x.file === file)
  return m ? t(`mnt.llm.${m.id}` as MessageKey) : file.replace(/\.gguf$/i, '')
}
