import type { Component } from 'vue'

/** También sirve para manuales y guías de cualquier otra temática. */
export interface GuideEntry {
  id: string
  title: string
  category: string
  href: string
  keywords?: string
  /** Rótulo breve del resumen; la búsqueda conserva el título íntegro. */
  overviewTitle?: string
}

export interface GuideOverview {
  ids: string[]
  label?: string
}

export interface GuideCategoryLook {
  icon?: Component
  color?: string
}

export interface GuideGroup extends GuideCategoryLook {
  id: string
  label: string
  items: GuideEntry[]
}

/** Las categorías proceden de los contenidos; los temas nuevos se incorporan automáticamente. */
export function groupGuides(items: readonly GuideEntry[], looks: Record<string, GuideCategoryLook> = {}): GuideGroup[] {
  const groups = new Map<string, GuideGroup>()
  for (const item of items) {
    let group = groups.get(item.category)
    if (!group) {
      group = { id: item.category, label: item.category, items: [], ...looks[item.category] }
      groups.set(item.category, group)
    }
    group.items.push(item)
  }
  return [...groups.values()]
}

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Búsqueda local por palabras, sin distinguir tildes ni mayúsculas. */
export function filterGuides(groups: readonly GuideGroup[], query: string, category: string | null): GuideGroup[] {
  const words = fold(query).trim().split(/\s+/).filter(Boolean)
  return groups
    .filter((group) => category === null || group.id === category)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const text = fold(`${item.title} ${group.label} ${item.keywords ?? ''}`)
        return words.every((word) => text.includes(word))
      }),
    }))
    .filter((group) => group.items.length > 0)
}
