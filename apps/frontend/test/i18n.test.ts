import { describe, expect, it } from 'vitest'
import { en } from '../app/locales/en'
import { es } from '../app/locales/es'
import { fr } from '../app/locales/fr'
import { it as itCat } from '../app/locales/it'
import { serverEn } from '../app/locales/server/en'
import { serverFr } from '../app/locales/server/fr'
import { serverIt } from '../app/locales/server/it'
import { locale, translate, translateServer } from '../app/utils/i18n'

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('catálogos de idioma', () => {
  for (const [name, cat] of [['en', en], ['fr', fr], ['it', itCat]] as const) {
    it(`${name}: mismas claves que es y sin textos vacíos`, () => {
      expect(Object.keys(cat).sort()).toEqual(Object.keys(es).sort())
      for (const [k, v] of Object.entries(cat)) expect(v.trim(), k).not.toBe('')
    })
    it(`${name}: mismos marcadores {x} que el español`, () => {
      for (const k of Object.keys(es) as (keyof typeof es)[]) expect(placeholders(cat[k]), k).toEqual(placeholders(es[k]))
    })
  }

  for (const [name, cat] of [['en', serverEn], ['fr', serverFr], ['it', serverIt]] as const) {
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
