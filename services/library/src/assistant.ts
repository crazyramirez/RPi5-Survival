import type { ServerResponse } from 'node:http'

/**
 * Asistente de consulta con RAG: el modelo local SOLO ve fragmentos recuperados de la biblioteca
 * (protocolos, documentos propios, ZIM) y debe citarlos. Si no hay fuentes, no se llama al modelo.
 */

export interface Source {
  n: number
  title: string
  href: string
  source: 'protocol' | 'doc' | 'zim' | 'note'
  text: string
}

/** Idiomas de la interfaz; el asistente responde en el de quien pregunta. */
export type Lang = 'es' | 'en' | 'fr' | 'it'
export const LANGS: readonly Lang[] = ['es', 'en', 'fr', 'it']

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v)
}

/** Respuesta cuando no hay fuentes (no se llama al modelo). */
export const NOT_FOUND: Record<Lang, string> = {
  es: 'No lo encuentro en la biblioteca. Prueba con otras palabras o consulta Emergencias.',
  en: "I can't find it in the library. Try other words or check Emergency.",
  fr: "Je ne le trouve pas dans la bibliothèque. Essayez avec d'autres mots ou consultez Urgences.",
  it: 'Non lo trovo nella biblioteca. Prova con altre parole o consulta Emergenze.',
}

export const SYSTEM_PROMPTS: Record<Lang, string> = {
  es: `Eres el asistente de consulta de Survival OS, un equipo de supervivencia sin Internet.
Reglas obligatorias:
- Responde SOLO con la información de las FUENTES numeradas que se te dan. No uses conocimientos propios.
- Cita las fuentes con su número entre corchetes, por ejemplo [1] o [2].
- Si las fuentes no contienen la respuesta, responde exactamente: "No lo encuentro en la biblioteca."
- Ante una emergencia médica, empieza recordando llamar al 112 y remite al protocolo correspondiente.
- Responde en español, breve (máximo 150 palabras), con pasos numerados cuando proceda.`,
  en: `You are the reference assistant of Survival OS, an offline survival device.
Mandatory rules:
- Answer ONLY with the information in the numbered SOURCES you are given. Do not use your own knowledge.
- Cite the sources with their number in square brackets, for example [1] or [2].
- If the sources do not contain the answer, reply exactly: "I can't find it in the library."
- In a medical emergency, start by reminding to call 112 and refer to the relevant protocol.
- Answer in English, briefly (150 words maximum), with numbered steps when appropriate. Sources may be in another language: translate what you use.`,
  fr: `Vous êtes l'assistant de consultation de Survival OS, un appareil de survie sans Internet.
Règles obligatoires :
- Répondez UNIQUEMENT avec les informations des SOURCES numérotées fournies. N'utilisez pas vos propres connaissances.
- Citez les sources avec leur numéro entre crochets, par exemple [1] ou [2].
- Si les sources ne contiennent pas la réponse, répondez exactement : "Je ne le trouve pas dans la bibliothèque."
- En cas d'urgence médicale, commencez par rappeler d'appeler le 112 et renvoyez au protocole correspondant.
- Répondez en français, brièvement (150 mots maximum), avec des étapes numérotées si nécessaire. Les sources peuvent être dans une autre langue : traduisez ce que vous utilisez.`,
  it: `Sei l'assistente di consultazione di Survival OS, un dispositivo di sopravvivenza senza Internet.
Regole obbligatorie:
- Rispondi SOLO con le informazioni delle FONTI numerate che ti vengono date. Non usare conoscenze tue.
- Cita le fonti con il loro numero tra parentesi quadre, per esempio [1] o [2].
- Se le fonti non contengono la risposta, rispondi esattamente: "Non lo trovo nella biblioteca."
- In un'emergenza medica, inizia ricordando di chiamare il 112 e rimanda al protocollo corrispondente.
- Rispondi in italiano, in breve (massimo 150 parole), con passaggi numerati quando serve. Le fonti possono essere in un'altra lingua: traduci ciò che usi.`,
}

/** Compatibilidad: el prompt en español. */
export const SYSTEM_PROMPT = SYSTEM_PROMPTS.es

const LABELS: Record<Lang, { sources: string; question: string }> = {
  es: { sources: 'FUENTES', question: 'PREGUNTA' },
  en: { sources: 'SOURCES', question: 'QUESTION' },
  fr: { sources: 'SOURCES', question: 'QUESTION' },
  it: { sources: 'FONTI', question: 'DOMANDA' },
}

const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Palabras vacías y de pregunta (español, más inglés, francés e italiano): no ayudan a recuperar fuentes. */
const STOPWORDS = new Set(
  (
    'a al algo alguien algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contra cual cuales cuando cuanto de del desde donde dos el ella ellas ellos en entre era es esa ese eso esta estan este esto estos fue hace hacer hacerlo hago hay he la las le les lo los mas me mi mis mucho muy nada ni no nos o otra otro para pero poco por porque puede pueden puedo pues que quien se sea segun ser si sin sobre solo son su sus tambien tengo tiene tienen todo todos tu un una uno unos usted vez y ya yo debo deberia necesito quiero saber sirve funciona mejor' +
    ' the and are for was what when where which who why how can could should would does did has have had not you your with from this that these those into about there their them they will just need want know best' +
    ' les des une est dans pour par pas plus sur avec mais que qui quoi comment quand faut faire peut peux dois sont etre avoir cette ces mon mes votre vous nous' +
    ' gli che chi non per con sono come quando dove cosa devo posso fare essere avere questo questa della delle degli dello nel nella sul sulla una uno'
  ).split(' '),
)

/** Palabras clave de una pregunta (sin palabras vacías, sin acentos para comparar). */
export function keywords(question: string): string[] {
  return [...new Set(norm(question).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOPWORDS.has(w)))].slice(0, 8)
}

/** Términos para el buscador de Kiwix: mismas palabras clave pero con sus tildes originales. */
export function searchTerms(question: string): string {
  const keep = new Set(keywords(question))
  const seen = new Set<string>()
  return question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => keep.has(norm(w)) && !seen.has(norm(w)) && seen.add(norm(w)))
    .join(' ')
}

/** Raíz aproximada: prefijo de 6 letras (potabilizo/potabilizar → potabi). */
export const stem = (w: string): string => (w.length > 6 ? w.slice(0, 6) : w)

/** Puntuación de relevancia: coincidencias por raíz en título (×3) y texto (×1). */
export function relevance(kw: string[], title: string, text: string): number {
  const t = norm(title)
  const b = norm(text)
  return kw.reduce((acc, w) => acc + (t.includes(stem(w)) ? 3 : 0) + (b.includes(stem(w)) ? 1 : 0), 0)
}

/** Recorta texto a un máximo de caracteres sin partir palabras. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`
}

/** Versión normalizada de `t` con la MISMA longitud (posición i ↔ carácter i del original). */
function normSameLength(t: string): string {
  let out = ''
  for (let i = 0; i < t.length; i++) out += norm(t[i] as string)[0] ?? ' '
  return out
}

/**
 * Fragmento de `max` caracteres en la zona que reúne MÁS palabras distintas de la consulta
 * (p. ej. "síntomas" + "deshidratación"), no en la primera aparición: los artículos largos
 * nombran el tema al principio pero la respuesta está en su sección.
 */
export function excerpt(text: string, query: string, max: number): string {
  const t = text.normalize('NFC')
  const hay = normSameLength(t)
  const stems = [...new Set(keywords(query).map(stem))]
  const hits: { pos: number; k: number }[] = []
  stems.forEach((s, k) => {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gu')
    for (const m of hay.matchAll(re)) hits.push({ pos: m.index, k })
  })
  hits.sort((a, b) => a.pos - b.pos)
  // Ventana que empieza en cada aparición: gana la que reúne más palabras distintas; a igualdad,
  // la que las tiene más juntas ("síntomas de la deshidratación"); y a igualdad, la primera
  // (los artículos van de lo general a lo particular).
  const width = Math.floor(max * 0.75)
  let best = { pos: 0, distinct: 0, span: Infinity }
  for (let i = 0; i < hits.length; i++) {
    const hi = hits[i] as { pos: number; k: number }
    const first = new Map<number, number>()
    for (let j = i; j < hits.length && (hits[j] as { pos: number }).pos < hi.pos + width; j++) {
      const h = hits[j] as { pos: number; k: number }
      if (!first.has(h.k)) first.set(h.k, h.pos)
    }
    const span = Math.max(...first.values()) - hi.pos
    // Tolerancia de 40 caracteres: "síntomas de la deshidratación" y "síntomas de deshidratación" empatan.
    if (first.size > best.distinct || (first.size === best.distinct && span < best.span - 40)) {
      best = { pos: hi.pos, distinct: first.size, span }
    }
  }
  let start = Math.max(0, best.pos - Math.floor(max / 5))
  // Empieza en límite de palabra para no cortar una a medias.
  if (start > 0) {
    const sp = t.indexOf(' ', start)
    if (sp >= 0 && sp < best.pos) start = sp + 1
  }
  return clip((start > 0 ? '…' : '') + t.slice(start), max)
}

export function buildMessages(question: string, sources: Source[], lang: Lang = 'es'): { role: string; content: string }[] {
  const ctx = sources.map((s) => `[${s.n}] ${s.title}\n${s.text}`).join('\n\n')
  const l = LABELS[lang]
  return [
    { role: 'system', content: SYSTEM_PROMPTS[lang] },
    { role: 'user', content: `${l.sources}:\n${ctx}\n\n${l.question}: ${question}` },
  ]
}

export function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * Llama a llama-server (API compatible OpenAI, streaming) y reenvía los fragmentos como SSE.
 * Devuelve el texto completo.
 */
export async function streamCompletion(
  baseUrl: string,
  messages: { role: string; content: string }[],
  res: ServerResponse,
  signal: AbortSignal,
): Promise<string> {
  const r = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, stream: true, temperature: 0.2, top_p: 0.9, max_tokens: 380, cache_prompt: true }),
    signal,
  })
  if (!r.ok || !r.body) throw new Error(`modelo no disponible (${r.status})`)
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return full
      try {
        const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[]; timings?: unknown }
        const piece = j.choices?.[0]?.delta?.content
        if (piece) {
          full += piece
          sse(res, 'token', piece)
        }
        if (j.timings) sse(res, 'timings', j.timings)
      } catch {
        // línea parcial
      }
    }
  }
  return full
}
