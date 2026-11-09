import type { Component } from 'vue'
import { BookOpen, Compass, Cpu, LifeBuoy, Map as MapIcon, Radio, Vault, Wrench } from '@lucide/vue'
import type { MessageKey } from '../locales/es'
import type { ModuleId } from './summaries'

export interface ModuleDef {
  id: ModuleId
  path: string
  titleKey: MessageKey
  icon: Component
  /** Fase del plan en la que el módulo pasa a ser funcional. */
  phase: number
}

/** Última fase implementada en este software (los módulos de fases posteriores se marcan pendientes). */
export const CURRENT_PHASE = 6

/** Orden = orden en la pantalla de inicio (rejilla 4×2). */
export const MODULES: readonly ModuleDef[] = [
  { id: 'maps', path: '/mapas', titleKey: 'module.maps', icon: MapIcon, phase: 4 },
  { id: 'navigation', path: '/navegacion', titleKey: 'module.navigation', icon: Compass, phase: 4 },
  { id: 'library', path: '/biblioteca', titleKey: 'module.library', icon: BookOpen, phase: 3 },
  { id: 'emergency', path: '/emergencias', titleKey: 'module.emergency', icon: LifeBuoy, phase: 3 },
  { id: 'vault', path: '/boveda', titleKey: 'module.vault', icon: Vault, phase: 5 },
  { id: 'comms', path: '/comunicaciones', titleKey: 'module.comms', icon: Radio, phase: 6 },
  { id: 'tools', path: '/herramientas', titleKey: 'module.tools', icon: Wrench, phase: 6 },
  { id: 'system', path: '/sistema', titleKey: 'module.system', icon: Cpu, phase: 1 },
]

export function moduleByPath(path: string): ModuleDef | undefined {
  return MODULES.find((m) => path === m.path || path.startsWith(`${m.path}/`))
}
