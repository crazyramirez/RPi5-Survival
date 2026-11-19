import { describe, expect, it } from 'vitest'
import { de } from '../app/locales/de'
import { en } from '../app/locales/en'
import { es } from '../app/locales/es'
import { fr } from '../app/locales/fr'
import { it as itCat } from '../app/locales/it'
import { ja } from '../app/locales/ja'
import { zh } from '../app/locales/zh'
import { serverDe } from '../app/locales/server/de'
import { serverEn } from '../app/locales/server/en'
import { serverFr } from '../app/locales/server/fr'
import { serverIt } from '../app/locales/server/it'
import { serverJa } from '../app/locales/server/ja'
import { serverZh } from '../app/locales/server/zh'
import { locale, translate, translateServer } from '../app/utils/i18n'

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
/** Grupos de plural {n:uno|varios}: el nombre del número de cada grupo. */
const plurals = (s: string): string[] => [...new Set([...s.matchAll(/\{(\w+):[^|{}]*\|[^{}]*\}/g)].map((m) => m[1]!))].sort()

describe('catálogos de idioma', () => {
  for (const [name, cat] of [['en', en], ['fr', fr], ['it', itCat], ['de', de], ['zh', zh], ['ja', ja]] as const) {
    it(`${name}: mismas claves que es y sin textos vacíos`, () => {
      expect(Object.keys(cat).sort()).toEqual(Object.keys(es).sort())
      for (const [k, v] of Object.entries(cat)) expect(v.trim(), k).not.toBe('')
    })
    it(`${name}: mismos marcadores {x} que el español`, () => {
      for (const k of Object.keys(es) as (keyof typeof es)[]) expect(placeholders(cat[k]), k).toEqual(placeholders(es[k]))
    })
    // Donde el español distingue singular y plural, la traducción también (puede añadir más: verbos que concuerdan).
    it(`${name}: los plurales {n:…|…} del español`, () => {
      for (const k of Object.keys(es) as (keyof typeof es)[]) expect(plurals(cat[k]), k).toEqual(expect.arrayContaining(plurals(es[k])))
    })
  }

  for (const [name, cat] of [['en', serverEn], ['fr', serverFr], ['it', serverIt], ['de', serverDe], ['zh', serverZh], ['ja', serverJa]] as const) {
    it(`servidor ${name}: conserva los marcadores {0}, {1}…`, () => {
      expect(Object.keys(cat).length).toBeGreaterThan(50)
      for (const [k, v] of Object.entries(cat)) expect(placeholders(v), k).toEqual(placeholders(k))
    })
  }
})

describe('translate / translateServer', () => {
  it('cambia de idioma y vuelve al español', () => {
    locale.value = 'en'
    expect(translate('nav.home')).toBe(en['nav.home'])
    expect(translateServer('Equipo sin batería')).toBe(serverEn['Equipo sin batería'])
    locale.value = 'es'
    expect(translate('nav.home')).toBe(es['nav.home'])
    expect(translateServer('Equipo sin batería')).toBe('Equipo sin batería')
  })
  it('traduce plantillas con valores y deja tal cual lo desconocido', () => {
    locale.value = 'fr'
    const tmpl = serverFr['Solo disponible en Linux (plataforma actual: {0})']!
    expect(translateServer('Solo disponible en Linux (plataforma actual: win32)')).toBe(tmpl.replace('{0}', 'win32'))
    expect(translateServer('Mensaje que no está en el catálogo')).toBe('Mensaje que no está en el catálogo')
    locale.value = 'es'
  })
})

describe('plurales {n:uno|varios}', () => {
  it('elige la forma según el número y el idioma', () => {
    const prev = locale.value
    try {
      locale.value = 'es'
      expect(translate('lib.books.count', { n: 1 })).toBe('1 libro')
      expect(translate('lib.books.count', { n: 0 })).toBe('0 libros')
      expect(translate('summary.comms', { n: 3 })).toBe('3 interfaces activas')
      locale.value = 'fr'
      expect(translate('lib.books.count', { n: 0 })).toBe('0 livre')
      expect(translate('lib.books.count', { n: 2 })).toBe('2 livres')
      locale.value = 'en'
      expect(translate('lib.docs.count', { n: 1 })).toBe('1 document')
    } finally {
      locale.value = prev
    }
  })
  it('sin «(s)» ni «/i» de robot en los textos con número', () => {
    for (const [name, cat] of [['es', es], ['en', en], ['fr', fr], ['it', itCat], ['de', de]] as const) {
      for (const [k, v] of Object.entries(cat)) {
        if (/\{n\}/.test(v)) expect(/\w\((s|es)\)|\w\/[aeio]\b/.test(v), `${name} ${k}: ${v}`).toBe(false)
      }
    }
  })
})
