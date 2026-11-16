import { describe, expect, it } from 'vitest'
import { filterGuides, groupGuides } from '../app/utils/guides'
import type { GuideEntry } from '../app/utils/guides'

const entries: GuideEntry[] = [
  { id: 'agua', title: 'Potabilización de agua', category: 'Agua', href: '/emergencias/agua' },
  { id: 'radio', title: 'Reparación de una radio', category: 'Reparación', href: '/manuales/radio', keywords: 'electrónica' },
  { id: 'solar', title: 'Panel solar portátil', category: 'Electricidad', href: '/manuales/solar' },
  { id: 'bomba', title: 'Reparación de una bomba de agua', category: 'Reparación', href: '/manuales/bomba' },
]

describe('catálogo de guías', () => {
  it('incorpora temáticas ajenas a primeros auxilios conservando las rutas y el orden del contenido', () => {
    const groups = groupGuides(entries)
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([['Agua', 1], ['Reparación', 2], ['Electricidad', 1]])
    expect(groups[1]?.items[0]?.href).toBe('/manuales/radio')
    expect(groups[1]?.color).toBeUndefined()
  })

  it('busca varias palabras en cualquier orden, con tildes y mayúsculas o mediante palabras clave', () => {
    const groups = groupGuides(entries)
    expect(filterGuides(groups, '  AGUA reparacion ', null).flatMap((g) => g.items.map((i) => i.id))).toEqual(['bomba'])
    expect(filterGuides(groups, 'ELECTRONICA', null)[0]?.items[0]?.id).toBe('radio')
    expect(filterGuides(groups, 'potabilizacion', null)[0]?.items[0]?.id).toBe('agua')
  })

  it('combina categoría y búsqueda sin alterar el catálogo ni perder temas al borrar filtros', () => {
    const groups = groupGuides(entries)
    expect(filterGuides(groups, 'agua', 'Reparación')[0]?.items.map((i) => i.id)).toEqual(['bomba'])
    expect(filterGuides(groups, 'solar', 'Reparación')).toEqual([])
    expect(filterGuides(groups, '', 'Electricidad')[0]?.items[0]?.id).toBe('solar')
    expect(filterGuides(groups, '', null).flatMap((g) => g.items)).toHaveLength(4)
    expect(groups[1]?.items).toHaveLength(2)
    expect(entries).toHaveLength(4)
  })

  it('admite un catálogo vacío y categorías nuevas sin configuración visual', () => {
    expect(filterGuides(groupGuides([]), 'agua', null)).toEqual([])
    const groups = groupGuides([{ id: 'huerto', title: 'Semillas', category: 'Cultivo', href: '/guias/semillas' }])
    expect(filterGuides(groups, 'cultivo', null)[0]?.items[0]?.id).toBe('huerto')
  })
})
