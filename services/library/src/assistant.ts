import type { ServerResponse } from 'node:http'

/**
 * Asistente de consulta: primero la biblioteca (RAG). El modelo local recibe los fragmentos recuperados
 * (protocolos, documentos propios, notas, ZIM) y los cita; si no bastan, o si no hay ninguno, responde con su
 * conocimiento general y lo dice («Fuera de la biblioteca»), para que se distinga lo comprobable de lo que no.
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

/** Respuesta cuando no hay fuentes y el modelo no está en marcha. */
export const NOT_FOUND: Record<Lang, string> = {
  es: 'No lo encuentro en la biblioteca. Prueba con otras palabras o consulta Emergencias.',
  en: "I can't find it in the library. Try other words or check Emergency.",
  fr: "Je ne le trouve pas dans la bibliothèque. Essayez avec d'autres mots ou consultez Urgences.",
  it: 'Non lo trovo nella biblioteca. Prova con altre parole o consulta Emergenze.',
}

/**
 * Con fuentes: biblioteca primero, con citas; conocimiento general solo para completar, marcado.
 * Probado con Qwen 2.5 1.5B en la Pi: si se le pide solo «cita con [n]», con fuentes poco relacionadas copia los
 * fragmentos o escribe «[1] [2] [3] [4]» en bucle. Por eso se le dice que puede haber fuentes ajenas, que responda
 * con frases completas y que la cita va al final de la frase que la usa, con un ejemplo.
 */
export const SYSTEM_PROMPTS: Record<Lang, string> = {
  es: `Eres el asistente de consulta de Survivelia OS, un equipo de supervivencia sin Internet. Respondes a la PREGUNTA con frases completas.
Reglas obligatorias:
- Las FUENTES son fragmentos de la biblioteca encontrados por palabras; algunas pueden no tener relación con la pregunta: ignóralas.
- Si una fuente responde, usa su información y pon su número entre corchetes al final de la frase que la usa, por ejemplo: «El agua se hierve un minuto [1].» Nunca escribas números de cita sueltos ni copies las fuentes.
- Si las fuentes no contienen la respuesta o no bastan, responde con tu conocimiento general y empieza esa parte con "Fuera de la biblioteca:" (sin citas). Si no lo sabes con seguridad, dilo: no inventes cifras, fechas ni nombres.
- Ante una emergencia médica, empieza recordando llamar al 112 y remite al protocolo correspondiente.
- Responde en español, breve (máximo 150 palabras), con pasos numerados cuando proceda.`,
  en: `You are the reference assistant of Survivelia OS, an offline survival device. You answer the QUESTION in full sentences.
Mandatory rules:
- The SOURCES are library excerpts found by keywords; some may be unrelated to the question: ignore them.
- If a source answers, use its information and put its number in square brackets at the end of the sentence that uses it, for example: "Boil the water for one minute [1]." Never write bare citation numbers or copy the sources.
- If the sources do not contain the answer or are not enough, answer from your general knowledge and start that part with "Outside the library:" (no citations). If you are not sure, say so: do not make up figures, dates or names.
- In a medical emergency, start by reminding to call 112 and refer to the relevant protocol.
- Answer in English, briefly (150 words maximum), with numbered steps when appropriate. Sources may be in another language: translate what you use.`,
  fr: `Vous êtes l'assistant de consultation de Survivelia OS, un appareil de survie sans Internet. Vous répondez à la QUESTION par des phrases complètes.
Règles obligatoires :
- Les SOURCES sont des extraits de la bibliothèque trouvés par mots-clés ; certaines peuvent ne pas avoir de rapport avec la question : ignorez-les.
- Si une source répond, utilisez ses informations et mettez son numéro entre crochets à la fin de la phrase qui l'utilise, par exemple : « Faites bouillir l'eau une minute [1]. » N'écrivez jamais de numéros de citation seuls et ne recopiez pas les sources.
- Si les sources ne contiennent pas la réponse ou ne suffisent pas, répondez avec vos connaissances générales et commencez cette partie par "Hors de la bibliothèque :" (sans citations). Si vous n'êtes pas sûr, dites-le : n'inventez ni chiffres, ni dates, ni noms.
- En cas d'urgence médicale, commencez par rappeler d'appeler le 112 et renvoyez au protocole correspondant.
- Répondez en français, brièvement (150 mots maximum), avec des étapes numérotées si nécessaire. Les sources peuvent être dans une autre langue : traduisez ce que vous utilisez.`,
  it: `Sei l'assistente di consultazione di Survivelia OS, un dispositivo di sopravvivenza senza Internet. Rispondi alla DOMANDA con frasi complete.
Regole obbligatorie:
- Le FONTI sono estratti della biblioteca trovati per parole chiave; alcune possono non avere relazione con la domanda: ignorale.
- Se una fonte risponde, usa le sue informazioni e metti il suo numero tra parentesi quadre alla fine della frase che la usa, per esempio: «Fai bollire l'acqua per un minuto [1].» Non scrivere mai numeri di citazione isolati e non copiare le fonti.
- Se le fonti non contengono la risposta o non bastano, rispondi con le tue conoscenze generali e inizia quella parte con "Fuori dalla biblioteca:" (senza citazioni). Se non sei sicuro, dillo: non inventare cifre, date o nomi.
- In un'emergenza medica, inizia ricordando di chiamare il 112 e rimanda al protocollo corrispondente.
- Rispondi in italiano, in breve (massimo 150 parole), con passaggi numerati quando serve. Le fonti possono essere in un'altra lingua: traduci ciò che usi.`,
}

/** Sin fuentes: conocimiento general del modelo (la pantalla lo avisa: no hay nada que comprobar). */
export const GENERAL_PROMPTS: Record<Lang, string> = {
  es: `Eres el asistente de Survivelia OS, un equipo de supervivencia sin Internet. La biblioteca del equipo no tiene nada sobre esta pregunta: responde con tu conocimiento general.
Reglas obligatorias:
- Si no lo sabes con seguridad, dilo: no inventes cifras, fechas ni nombres.
- Ante una emergencia médica, empieza recordando llamar al 112 y consultar los protocolos de Emergencias.
- Responde en español, breve (máximo 150 palabras), con pasos numerados cuando proceda.`,
  en: `You are the assistant of Survivelia OS, an offline survival device. The device's library has nothing about this question: answer from your general knowledge.
Mandatory rules:
- If you are not sure, say so: do not make up figures, dates or names.
- In a medical emergency, start by reminding to call 112 and to check the Emergency protocols.
- Answer in English, briefly (150 words maximum), with numbered steps when appropriate.`,
  fr: `Vous êtes l'assistant de Survivelia OS, un appareil de survie sans Internet. La bibliothèque de l'appareil n'a rien sur cette question : répondez avec vos connaissances générales.
Règles obligatoires :
- Si vous n'êtes pas sûr, dites-le : n'inventez ni chiffres, ni dates, ni noms.
- En cas d'urgence médicale, commencez par rappeler d'appeler le 112 et de consulter les protocoles d'Urgences.
- Répondez en français, brièvement (150 mots maximum), avec des étapes numérotées si nécessaire.`,
  it: `Sei l'assistente di Survivelia OS, un dispositivo di sopravvivenza senza Internet. La biblioteca del dispositivo non ha nulla su questa domanda: rispondi con le tue conoscenze generali.
Regole obbligatorie:
- Se non sei sicuro, dillo: non inventare cifre, date o nomi.
- In un'emergenza medica, inizia ricordando di chiamare il 112 e di consultare i protocolli di Emergenze.
- Rispondi in italiano, in breve (massimo 150 parole), con passaggi numerati quando serve.`,
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

/** Pregunta y respuesta anteriores de la misma conversación. */
export interface PriorTurn {
  question: string
  answer: string
}

/** Aviso al modelo cuando hay preguntas anteriores: la nueva puede referirse a ellas («¿y si es un niño?»). */
const CONTEXT_NOTES: Record<Lang, string> = {
  es: '- Antes de la PREGUNTA verás preguntas y respuestas anteriores de esta conversación: úsalas para entender a qué se refiere la PREGUNTA nueva, pero responde solo a ella y no repitas lo ya dicho.',
  en: '- Before the QUESTION you will see earlier questions and answers of this conversation: use them to understand what the new QUESTION refers to, but answer only it and do not repeat what was already said.',
  fr: "- Avant la QUESTION, vous verrez des questions et réponses précédentes de cette conversation : servez-vous-en pour comprendre à quoi se réfère la nouvelle QUESTION, mais ne répondez qu'à elle et ne répétez pas ce qui a déjà été dit.",
  it: '- Prima della DOMANDA vedrai domande e risposte precedenti di questa conversazione: usale per capire a cosa si riferisce la nuova DOMANDA, ma rispondi solo a quella e non ripetere quanto già detto.',
}

/**
 * Respuesta anterior tal como se le recuerda al modelo: sin citas [n] (sus fuentes ya no están en el contexto y
 * confundirían las nuevas) y recortada, para que quepan varias en el contexto de 4096 tokens de la Pi.
 */
export function priorAnswer(answer: string): string {
  return clip(answer.replace(/\s*\[\d+\]/g, ''), 700)
}

/** Consulta de búsqueda de una pregunta de seguimiento: la nueva primero y, detrás, la anterior («¿y si es un niño?» sola no encuentra nada). */
export function retrievalQuery(question: string, prior: PriorTurn[]): string {
  const last = prior.at(-1)
  return last ? `${question} ${last.question}` : question
}

/**
 * Mensajes para el modelo: con fuentes (biblioteca primero) o, sin ninguna, solo la pregunta (conocimiento general).
 * Con `prior`, las preguntas y respuestas anteriores de la conversación van entre el sistema y la pregunta nueva,
 * sin sus fuentes: solo la pregunta nueva lleva fuentes.
 */
export function buildMessages(question: string, sources: Source[], lang: Lang = 'es', prior: PriorTurn[] = []): { role: string; content: string }[] {
  const note = prior.length ? `\n${CONTEXT_NOTES[lang]}` : ''
  const past = prior.flatMap((p) => [
    { role: 'user', content: p.question },
    { role: 'assistant', content: priorAnswer(p.answer) },
  ])
  if (!sources.length) return [
    { role: 'system', content: GENERAL_PROMPTS[lang] + note },
    ...past,
    { role: 'user', content: question },
  ]
  const ctx = sources.map((s) => `[${s.n}] ${s.title}\n${s.text}`).join('\n\n')
  const l = LABELS[lang]
  return [
    { role: 'system', content: SYSTEM_PROMPTS[lang] + note },
    ...past,
    // La pregunta antes y después de las fuentes: el modelo pequeño no la pierde de vista tras fragmentos largos.
    { role: 'user', content: `${l.question}: ${question}\n\n${l.sources}:\n${ctx}\n\n${l.question}: ${question}` },
  ]
}

export function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * Freno de bucles: los modelos pequeños a veces repiten la misma frase o línea (p. ej. «[1] [2] [3] [4]») hasta
 * agotar los tokens. Si una frase o línea completa (de 8 caracteres o más) sale por tercera vez, devuelve el texto
 * hasta antes de su segunda aparición; si no, null.
 */
export function repetitionCut(text: string): string | null {
  const seen = new Map<string, { n: number; second: number }>()
  // Unidades completas: hasta un signo de fin de frase o hasta un salto de línea (la última, a medias, no cuenta).
  for (const m of text.matchAll(/[^\n.!?]+(?:[.!?]+|(?=\n))/g)) {
    const key = m[0].replace(/\s+/g, ' ').trim().toLowerCase()
    if (key.length < 8) continue
    const e = seen.get(key) ?? { n: 0, second: -1 }
    e.n++
    if (e.n === 2) e.second = m.index
    if (e.n >= 3) return text.slice(0, e.second).trimEnd()
    seen.set(key, e)
  }
  return null
}

/**
 * Llama a llama-server (API compatible OpenAI, streaming) y reenvía los fragmentos como SSE.
 * Devuelve el texto completo. Si el modelo entra en bucle, corta la generación y envía `replace` con el texto
 * sin la repetición (la pantalla sustituye lo que llevaba).
 */
export async function streamCompletion(
  baseUrl: string,
  messages: { role: string; content: string }[],
  res: ServerResponse,
  signal: AbortSignal,
): Promise<string> {
  const stop = new AbortController()
  const r = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, stream: true, temperature: 0.2, top_p: 0.9, max_tokens: 380, cache_prompt: true }),
    signal: AbortSignal.any([signal, stop.signal]),
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
          const cut = repetitionCut(full)
          if (cut !== null) {
            sse(res, 'replace', cut)
            stop.abort()
            return cut
          }
        }
        if (j.timings) sse(res, 'timings', j.timings)
      } catch {
        // línea parcial
      }
    }
  }
  return full
}
