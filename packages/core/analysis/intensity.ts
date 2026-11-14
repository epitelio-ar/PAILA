// Intensidad del análisis (MASTERPLAN-2, 8.1): Tranqui, Normal o A fondo. Cuántos temas a la vez según el procesador,
// la batería y la memoria libre. Sin Electron: el que mira la batería y aplica el plan es electron/intensity.ts.
import type { Intensity } from '@paila/shared/types'

/**
 * Memoria que usa cada tema que se analiza a la vez: el proceso del worker más su ffmpeg. Medido el 20/10/2026 con 60
 * temas reales (docs/archivo/pruebas/2026-10-intensidad.md): 134–179 MB el worker y 22–28 MB su ffmpeg; se deja margen.
 */
export const WORKER_MB = 250
/** Lo que se le deja libre al resto de la PC (Windows, el navegador, Rekordbox…) antes de sumar workers. */
export const RESERVE_MB = 1500

/** Cuántos workers pide cada modo, solo por el procesador (`threads` = hilos lógicos). */
export function threadsFor(mode: Intensity, threads: number): number {
  if (mode === 'tranqui') return Math.max(1, Math.floor(threads / 4))
  if (mode === 'fondo') return Math.max(1, threads - 1)
  return Math.max(1, Math.min(8, Math.floor(threads / 2))) // Normal: la mitad (como antes de que se pudiera elegir)
}

export interface PlanInput {
  mode: Intensity
  threads: number
  onBattery: boolean
  /** Memoria libre ahora, en MB. */
  freeMb: number
  /** Workers que ya están andando (su memoria ya está descontada de `freeMb`). */
  running: number
}

export interface Plan {
  /** El modo que se aplica: A fondo a batería pasa a Normal. */
  effective: Intensity
  workers: number
  /** Tranqui a batería: en pausa hasta que se enchufe. */
  paused: boolean
  /** El procesador daría para más, pero la memoria libre no. */
  limitedByMemory: boolean
}

/** Qué hacer ahora según el modo elegido, la batería y la memoria. */
export function plan(i: PlanInput): Plan {
  const effective: Intensity = i.mode === 'fondo' && i.onBattery ? 'normal' : i.mode
  const byCpu = threadsFor(effective, i.threads)
  const byMem = Math.max(1, Math.floor((i.freeMb + i.running * WORKER_MB - RESERVE_MB) / WORKER_MB))
  return { effective, workers: Math.min(byCpu, byMem), paused: i.mode === 'tranqui' && i.onBattery, limitedByMemory: byMem < byCpu }
}
