// Tipos de "Lista para compartir" (Fase H): actualizaciones automáticas y "Exportar diagnóstico".

/** Cómo están las actualizaciones (lo muestra el aviso de versión nueva y Configuración). */
export interface UpdateState {
  /** Si se pueden buscar versiones nuevas; si no, `why` dice por qué (todavía no hay versiones publicadas, desarrollo…). */
  enabled: boolean
  why: string | null
  /** Buscar sola al abrir (se apaga en Configuración). */
  auto: boolean
  /** La portable no se actualiza sola: avisa y abre la página de descargas. */
  portable: boolean
  /** En Mac (sin firma de Apple) tampoco: se baja el .dmg de la página. */
  mac?: boolean
  current: string
  phase: 'quieta' | 'buscando' | 'hay' | 'bajando' | 'lista' | 'error'
  available: { version: string; releaseDate: string | null } | null
  /** 0–1 mientras baja. */
  progress: number | null
  /** La persona eligió "Al cerrar PAILA": se instala sola al salir. */
  onQuit: boolean
  error: string | null
  lastCheck: string | null
}

/** Un archivo del diagnóstico, tal cual va en el zip (para mostrarlo antes). */
export interface DiagnosticPreviewFile { name: string; what: string; content: string }
