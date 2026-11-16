/** Notas, diario y listas de comprobación (solo en el equipo, sin cifrar: lo sensible va a la bóveda). */

export interface NoteSummary {
  id: number
  title: string
  /** Primeras líneas del texto, sin las marcas de tarea. */
  preview: string
  pinned: boolean
  /** Tareas «- [ ]» / «- [x]» del texto. */
  tasks: { done: number; total: number }
  createdAt: string
  updatedAt: string
}

export interface Note extends NoteSummary {
  /** Texto libre; las líneas «- [ ] …» y «- [x] …» se muestran como casillas. */
  body: string
}
