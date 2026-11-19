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
// Índices revisados en es/en/fr/it/de/zh/ja. Una modificación exige revisar la presentación.
const OUTLINES: Record<string, readonly string[]> = {
  "pas-112": [
    "62ce0208",
    "e29a3ce9",
    "f2f9089a",
    "23f00406",
    "cd72a803",
    "3e07a3d7",
    "e719f668"
  ],
  "rcp-adulto": [
    "bf6c35fe",
    "d39f7a17",
    "d878dbe3",
    "18336336",
    "9638d493",
    "119bdc96",
    "9181ed84"
  ],
  "hemorragia": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b",
    "149ea066",
    "ed3add5c",
    "81b796ec"
  ],
  "atragantamiento": [
    "3d4b78d8",
    "8d34c774",
    "4fed8890",
    "ba095aa5",
    "7ddb4fd2",
    "9c37607d",
    "4603ef47"
  ],
  "quemaduras": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b",
    "149ea066",
    "ed3add5c",
    "81b796ec"
  ],
  "hipotermia": [
    "624e9179",
    "f676dcdb",
    "910e70c7",
    "9e338bf4",
    "bd159e24",
    "842634c3",
    "8cacf4d4"
  ],
  "golpe-calor": [
    "624e9179",
    "f676dcdb",
    "910e70c7",
    "9e338bf4",
    "bd159e24",
    "842634c3",
    "8cacf4d4"
  ],
  "agua-potable": [
    "85991792",
    "a3a7e9b4",
    "a8c5c052",
    "8aa0a672",
    "dc9240fb",
    "8cc4dbb",
    "4a30e13b"
  ],
  "rcp-ninos-lactantes": [
    "bf6c35fe",
    "d39f7a17",
    "d878dbe3",
    "18336336",
    "9638d493",
    "119bdc96",
    "9181ed84"
  ],
  "dea": [
    "bf6c35fe",
    "d39f7a17",
    "d878dbe3",
    "18336336",
    "9638d493",
    "119bdc96",
    "debe7f8f"
  ],
  "posicion-lateral-seguridad": [
    "bf6c35fe",
    "d39f7a17",
    "d878dbe3",
    "18336336",
    "9638d493",
    "119bdc96",
    "9181ed84"
  ],
  "atragantamiento-ninos": [
    "36895da5",
    "ee6906cb",
    "d2d7970",
    "5e21b394",
    "e5beb37c",
    "d1fc4354",
    "ad50268e"
  ],
  "ictus": [
    "a6445c48",
    "9f3bdf89",
    "bce780d8",
    "9b95b442",
    "9af50e2f",
    "1775403b",
    "8b9580b"
  ],
  "dolor-toracico": [
    "6345b6b2",
    "64750a63",
    "943257",
    "361c2816",
    "20e2c500",
    "864d1cbd",
    "6bac5e3e"
  ],
  "anafilaxia": [
    "624e9179",
    "f676dcdb",
    "2ce4bf05",
    "9e338bf4",
    "bd159e24",
    "842634c3",
    "d516a104"
  ],
  "convulsiones": [
    "35b7e8f7",
    "ed2f7d70",
    "67b575bd",
    "882f75b",
    "149ea066",
    "ed3add5c",
    "81b796ec"
  ],
  "shock": [
    "624e9179",
    "f676dcdb",
    "2ce4bf05",
    "9e338bf4",
    "bd159e24",
    "842634c3",
    "d516a104"
  ],
  "traumatismo-craneal": [
    "35b7e8f7",
    "ed2f7d70",
    "67b575bd",
    "882f75b",
    "149ea066",
    "ed3add5c",
    "81b796ec"
  ],
  "lesion-columna": [
    "a87a2467",
    "eabce00c",
    "a06ca340",
    "f41e3a3a",
    "8e1b9641",
    "25639369",
    "9b14143f"
  ],
  "fracturas-esguinces": [
    "7631a5be",
    "44041c95",
    "ae79b67b",
    "87481c57",
    "ee558709",
    "a504d0",
    "b1531807"
  ],
  "heridas": [
    "35b7e8f7",
    "ed2f7d70",
    "67b575bd",
    "882f75b",
    "149ea066",
    "ed3add5c",
    "81b796ec"
  ],
  "quemaduras-quimicas-electricas": [
    "112bcae3",
    "ffa84bbe",
    "86fd026a",
    "6eac3ce4",
    "186291af",
    "70eadf5b",
    "9718bcaf"
  ],
  "hipoglucemia": [
    "a87a2467",
    "eabce00c",
    "a06ca340",
    "f41e3a3a",
    "8e1b9641",
    "25639369",
    "9b14143f"
  ],
  "ahogamiento": [
    "9bcbd403",
    "dad0380c",
    "959832fc",
    "c79cf77b",
    "3a1f2f9f",
    "cb2e4eb4",
    "4c118392"
  ],
  "congelacion": [
    "624e9179",
    "f676dcdb",
    "2ce4bf05",
    "9e338bf4",
    "bd159e24",
    "842634c3",
    "d516a104"
  ],
  "deshidratacion-suero-oral": [
    "67b2e8a2",
    "caaa094e",
    "b8a2dbc7",
    "ae3736ca",
    "2dcf0ff3",
    "4975bb7d",
    "a6729c55"
  ],
  "monoxido-carbono": [
    "2a2cd8ee",
    "bbbeebee",
    "df16af7a",
    "3f3b0853",
    "bdfe4f9b",
    "e634884a",
    "5bace905"
  ],
  "intoxicaciones": [
    "35b7e8f7",
    "ed2f7d70",
    "67b575bd",
    "882f75b",
    "149ea066",
    "ed3add5c",
    "81b796ec"
  ],
  "mordedura-vibora": [
    "aa5661c1",
    "9e61e62",
    "7520c662",
    "f056a202",
    "1b12d808",
    "a7d4cf8c",
    "3ff92bcb"
  ],
  "picaduras-garrapatas": [
    "72ddeaa1",
    "a412e127",
    "1f4c5f59",
    "f5eafae9",
    "722dd7dc",
    "8fc584df",
    "ae80462d"
  ],
  "mordedura-animal": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b",
    "149ea066",
    "3bd10df5",
    "81b796ec"
  ],
  "incendio-casa": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b",
    "149ea066",
    "3bd10df5",
    "81b796ec"
  ],
  "incendio-forestal": [
    "ffd8f923",
    "7a19e763",
    "257c0ed2",
    "28dbd404",
    "e706f263",
    "7c7f4f3f",
    "52c1dfdb"
  ],
  "terremoto": [
    "75a551ff",
    "1ea7a4f6",
    "8d22dd5b",
    "f08db509",
    "9d9d5843",
    "982cd4f9",
    "b8d131dd"
  ],
  "inundacion": [
    "c5d8c1ef",
    "f76d7462",
    "125a7a05",
    "94fa1057",
    "3cf7858d",
    "65a5a0cb",
    "45d1005f"
  ],
  "tormenta-electrica": [
    "71b7ebad",
    "cde03d67",
    "4462f5da",
    "70d51167",
    "5c025ffd",
    "f73c4c7a",
    "8c11b3b7"
  ],
  "apagon": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b",
    "149ea066",
    "3bd10df5",
    "81b796ec"
  ],
  "fuga-gas": [
    "35b7e8f7",
    "ed2f7d70",
    "578ab57f",
    "882f75b",
    "149ea066",
    "3bd10df5",
    "81b796ec"
  ],
  "ola-frio-refugio": [
    "9b8f7f12",
    "63b8522d",
    "f7ab9cc6",
    "bb5994bc",
    "333c82b9",
    "c1393c51",
    "d00cb8f"
  ],
  "kit-emergencia-72h": [
    "3d4b318d",
    "d940d391",
    "e15daf27",
    "78f1f896",
    "9b28847f",
    "f3e9216",
    "d1336df3"
  ],
  "senales-socorro": [
    "78471642",
    "dfc7b39e",
    "1b2e375e",
    "7c524288",
    "31963632",
    "2cb456bc",
    "9ef1435d"
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
