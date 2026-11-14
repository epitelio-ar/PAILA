// Prioridad baja para los procesos de audio que lanza PAILA (ffmpeg, workers de análisis): usan lo que sobra del procesador
// y la PC sigue andando liviana. En los tests no (PAILA_PRIORIDAD_NORMAL, lo pone vitest.config.ts): con la PC ocupada por
// otras sesiones, un ffmpeg en prioridad baja casi no recibe procesador y los tests se cortaban por tiempo.
import os from 'node:os'

/** Baja la prioridad del proceso (Windows: "por debajo de lo normal"). Si no hay permiso, sigue igual. */
export function lowPriority(pid?: number) {
  if (!pid || process.env.PAILA_PRIORIDAD_NORMAL) return
  try { os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* sin permiso: sigue igual */ }
}
