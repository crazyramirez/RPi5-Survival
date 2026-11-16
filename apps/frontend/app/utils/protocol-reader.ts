import { guideOutlineKey } from './guide-reader'
import type { GuideSectionStyle } from './guide-reader'

export interface ProtocolReaderProfile {
  sections: GuideSectionStyle[]
  tone: 'danger' | 'info' | 'warn' | 'neutral'
  medical: boolean
  contact: boolean
}

/**
 * Tratamiento visual editorial por sección, contrastado con las 41 fichas y sus traducciones.
 * Los índices no sustituyen el contenido: una ficha nueva sin perfil se lee como prosa y listas normales.
 * Importante: los ingredientes numerados del suero no son pasos de actuación.
 */
const SECTIONS: Record<string, GuideSectionStyle[]> = {
  'pas-112': ['phase', 'phase', 'phase', 'warning'],
  'rcp-adulto': ['prose', 'steps', 'warning'],
  hemorragia: ['steps', 'warning'],
  atragantamiento: ['condition', 'condition', 'warning'],
  quemaduras: ['steps', 'warning'],
  hipotermia: ['prose', 'steps', 'warning'],
  'golpe-calor': ['prose', 'steps', 'warning'],
  'agua-potable': ['prose', 'method', 'method', 'method', 'warning'],
  'rcp-ninos-lactantes': ['prose', 'steps', 'warning'],
  dea: ['prose', 'steps', 'warning'],
  'posicion-lateral-seguridad': ['prose', 'steps', 'warning'],
  'atragantamiento-ninos': ['condition', 'condition', 'warning'],
  ictus: ['prose', 'steps', 'warning'],
  'dolor-toracico': ['prose', 'steps', 'warning'],
  anafilaxia: ['prose', 'steps', 'warning'],
  convulsiones: ['steps', 'warning'],
  shock: ['prose', 'steps', 'warning'],
  'traumatismo-craneal': ['steps', 'warning'],
  'lesion-columna': ['prose', 'steps', 'warning'],
  'fracturas-esguinces': ['prose', 'steps', 'prose', 'warning'],
  heridas: ['steps', 'warning'],
  'quemaduras-quimicas-electricas': ['condition', 'condition', 'warning'],
  hipoglucemia: ['prose', 'steps', 'warning'],
  ahogamiento: ['phase', 'phase', 'warning'],
  congelacion: ['prose', 'steps', 'warning'],
  'deshidratacion-suero-oral': ['warning', 'recipe', 'steps', 'warning'],
  'monoxido-carbono': ['prose', 'steps', 'warning'],
  intoxicaciones: ['steps', 'warning'],
  'mordedura-vibora': ['prose', 'steps', 'warning'],
  'picaduras-garrapatas': ['condition', 'condition', 'warning'],
  'mordedura-animal': ['steps', 'warning'],
  'incendio-casa': ['steps', 'warning'],
  'incendio-forestal': ['condition', 'condition', 'warning'],
  terremoto: ['phase', 'phase', 'warning'],
  inundacion: ['phase', 'phase', 'phase'],
  'tormenta-electrica': ['steps', 'condition', 'warning'],
  apagon: ['steps', 'warning'],
  'fuga-gas': ['steps', 'warning'],
  'ola-frio-refugio': ['condition', 'condition', 'warning'],
  'kit-emergencia-72h': ['inventory', 'inventory', 'inventory', 'inventory', 'warning'],
  'senales-socorro': ['prose', 'prose', 'warning'],
}
// Índices revisados en es/en/fr/it. Una modificación exige revisar la presentación.
const OUTLINES: Record<string, readonly string[]> = {
  "pas-112": [
    "62ce0208",
    "e29a3ce9",
    "f2f9089a",
    "23f00406"
  ],
  "rcp-adulto": [
    "bf6c35fe",
    "d39f7a17",
    "d878dbe3",
    "18336336"
  ],
  "hemorragia": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b"
  ],
  "atragantamiento": [
    "3d4b78d8",
    "8d34c774",
    "4fed8890",
    "ba095aa5"
  ],
  "quemaduras": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b"
  ],
  "hipotermia": [
    "624e9179",
    "f676dcdb",
    "910e70c7",
    "9e338bf4"
  ],
  "golpe-calor": [
    "624e9179",
    "f676dcdb",
    "910e70c7",
    "9e338bf4"
  ],
  "agua-potable": [
    "85991792",
    "a3a7e9b4",
    "a8c5c052",
    "8aa0a672"
  ],
  "rcp-ninos-lactantes": [
    "bf6c35fe",
    "d39f7a17",
    "d878dbe3",
    "18336336"
  ],
  "dea": [
    "bf6c35fe",
    "d39f7a17",
    "d878dbe3",
    "18336336"
  ],
  "posicion-lateral-seguridad": [
    "bf6c35fe",
    "d39f7a17",
    "d878dbe3",
    "18336336"
  ],
  "atragantamiento-ninos": [
    "36895da5",
    "ee6906cb",
    "d2d7970",
    "5e21b394"
  ],
  "ictus": [
    "a6445c48",
    "9f3bdf89",
    "bce780d8",
    "9b95b442"
  ],
  "dolor-toracico": [
    "6345b6b2",
    "64750a63",
    "943257",
    "361c2816"
  ],
  "anafilaxia": [
    "624e9179",
    "f676dcdb",
    "2ce4bf05",
    "9e338bf4"
  ],
  "convulsiones": [
    "35b7e8f7",
    "ed2f7d70",
    "67b575bd",
    "882f75b"
  ],
  "shock": [
    "624e9179",
    "f676dcdb",
    "2ce4bf05",
    "9e338bf4"
  ],
  "traumatismo-craneal": [
    "35b7e8f7",
    "ed2f7d70",
    "67b575bd",
    "882f75b"
  ],
  "lesion-columna": [
    "a87a2467",
    "eabce00c",
    "a06ca340",
    "f41e3a3a"
  ],
  "fracturas-esguinces": [
    "7631a5be",
    "44041c95",
    "ae79b67b",
    "87481c57"
  ],
  "heridas": [
    "35b7e8f7",
    "ed2f7d70",
    "67b575bd",
    "882f75b"
  ],
  "quemaduras-quimicas-electricas": [
    "112bcae3",
    "ffa84bbe",
    "86fd026a",
    "6eac3ce4"
  ],
  "hipoglucemia": [
    "a87a2467",
    "eabce00c",
    "a06ca340",
    "f41e3a3a"
  ],
  "ahogamiento": [
    "9bcbd403",
    "dad0380c",
    "959832fc",
    "c79cf77b"
  ],
  "congelacion": [
    "624e9179",
    "f676dcdb",
    "2ce4bf05",
    "9e338bf4"
  ],
  "deshidratacion-suero-oral": [
    "67b2e8a2",
    "caaa094e",
    "b8a2dbc7",
    "ae3736ca"
  ],
  "monoxido-carbono": [
    "2a2cd8ee",
    "bbbeebee",
    "df16af7a",
    "3f3b0853"
  ],
  "intoxicaciones": [
    "35b7e8f7",
    "ed2f7d70",
    "67b575bd",
    "882f75b"
  ],
  "mordedura-vibora": [
    "aa5661c1",
    "9e61e62",
    "7520c662",
    "f056a202"
  ],
  "picaduras-garrapatas": [
    "72ddeaa1",
    "a412e127",
    "1f4c5f59",
    "f5eafae9"
  ],
  "mordedura-animal": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b"
  ],
  "incendio-casa": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b"
  ],
  "incendio-forestal": [
    "ffd8f923",
    "7a19e763",
    "257c0ed2",
    "28dbd404"
  ],
  "terremoto": [
    "75a551ff",
    "1ea7a4f6",
    "8d22dd5b",
    "f08db509"
  ],
  "inundacion": [
    "c5d8c1ef",
    "f76d7462",
    "125a7a05",
    "94fa1057"
  ],
  "tormenta-electrica": [
    "71b7ebad",
    "cde03d67",
    "4462f5da",
    "70d51167"
  ],
  "apagon": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b"
  ],
  "fuga-gas": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b"
  ],
  "ola-frio-refugio": [
    "9b8f7f12",
    "63b8522d",
    "f7ab9cc6",
    "bb5994bc"
  ],
  "kit-emergencia-72h": [
    "3d4b318d",
    "d940d391",
    "e15daf27",
    "78f1f896"
  ],
  "senales-socorro": [
    "78471642",
    "dfc7b39e",
    "1b2e375e",
    "7c524288"
  ]
}

const NON_MEDICAL = new Set([
  'pas-112', 'agua-potable', 'incendio-casa', 'incendio-forestal', 'terremoto', 'inundacion',
  'tormenta-electrica', 'apagon', 'fuga-gas', 'ola-frio-refugio', 'kit-emergencia-72h', 'senales-socorro',
])

export function protocolReaderProfile(id: string, titles?: readonly string[]): ProtocolReaderProfile {
  const configured = SECTIONS[id]
  if (!configured) return { sections: [], tone: 'neutral', medical: false, contact: false }
  // Un índice modificado se conserva con presentación neutral hasta revisar sus estilos.
  const sections = !titles || OUTLINES[id]?.includes(guideOutlineKey(titles)) ? configured : []
  const medical = !NON_MEDICAL.has(id)
  return {
    sections: [...sections],
    tone: id === 'agua-potable' ? 'info' : id === 'kit-emergencia-72h' ? 'neutral' : medical ? 'danger' : 'warn',
    medical,
    contact: id !== 'agua-potable' && id !== 'kit-emergencia-72h',
  }
}
