// Qué hacer cuando una pasada de análisis no puede leer un tema (core/queue.ts, reanalysis.ts, precise.ts): si se fue el
// disco (o la carpeta), el análisis se pausa solo, avisa y sigue cuando vuelve, sin marcar nada; si el archivo ya no está
// en su lugar, se saltea (lo ubica el próximo escaneo); solo un error del archivo mismo (ilegible, dañado) cuenta como
// intentado, y recién después de MAX_TRIES intentos. Salió de un caso real del 21/10/2026: se desenchufó el SSD con el análisis
// andando y la pasada precisa marcó 946 temas como hechos sin leer ninguno (docs/archivo/pruebas/2026-10-21-disco-y-precisa.md).
import fs from 'node:fs'
import path from 'node:path'
import { cant, textos } from '@paila/shared/idioma'

// Los avisos de la pausa por el disco y de los temas que no estaban (solo se muestran; la pausa se reconoce por el mismo texto
// que se puso, dentro de la misma pasada).
const T = textos({
  noCarpeta: { es: (p: string) => `No se encuentra la carpeta ${p}`, en: (p: string) => `Can't find the folder ${p}` },
  desconecto: {
    es: (d: string, label: string | null) => `Se desconectó ${d}${label ? ` (${label})` : ''}`,
    en: (d: string, label: string | null) => `${d}${label ? ` (${label})` : ''} was disconnected`,
  },
  sigue: {
    es: (what: string, grilla: boolean) => `${what}. ${grilla ? 'La grilla' : 'El análisis'} sigue solo cuando vuelva; no se marcó nada como hecho.`,
    en: (what: string, grilla: boolean) => `${what}. The ${grilla ? 'grid' : 'analysis'} continues on its own when it's back; nothing was marked as done.`,
  },
  noEstaban: {
    es: (n: number) => `${n === 1 ? '1 tema no estaba' : `${n} temas no estaban`} en su carpeta (se movió o se borró por fuera de PAILA): no se analizó y queda pendiente. El próximo escaneo lo ubica.`,
    en: (n: number) => `${cant(n, 'track was', 'tracks were')} not in ${n === 1 ? 'its' : 'their'} folder (moved or deleted outside PAILA): ${n === 1 ? "it wasn't" : "they weren't"} analyzed and ${n === 1 ? 'stays' : 'stay'} pending. The next scan will find ${n === 1 ? 'it' : 'them'}.`,
  },
})

/** Cuántas veces se prueba un tema con un error del archivo antes de anotarlo como intentado (con error). */
export const MAX_TRIES = 3

/** Cada cuánto se mira si volvió el disco mientras el análisis espera. */
export const DISK_POLL_MS = 2000

/**
 * Lo que la pasada tiene que hacer con un tema que falló: `retry` = el disco no estaba (ya volvió: repetirlo);
 * `skip` = no marcarlo (el archivo no está, o le quedan intentos: se vuelve a probar al final de la pasada);
 * `mark` = error real con los intentos agotados: anotarlo como intentado; `stop` = se detuvo el análisis.
 */
export type Outcome = 'retry' | 'skip' | 'mark' | 'stop'

/** Lo que necesita de la biblioteca: pausar y seguir, el estado y dónde está hoy cada carpeta. */
export interface GuardLib {
  cancel: boolean
  status: { paused: boolean; pauseReason: string | null; waitingDisk?: string | null; warnings: string[] }
  pause(reason?: string | null): void
  resume(): void
  emit(force?: boolean): void
  roots(): { id: number; path: string; available: boolean; volumeLabel?: string | null }[]
}

const exists = (p: string) => { try { return fs.existsSync(p) } catch { return false } }

/** Espera hasta que `back()` dé true (volvió el disco: true) o `cancelled()` (false), mirando cada `everyMs`. */
export async function waitUntil(back: () => boolean, cancelled: () => boolean, everyMs = DISK_POLL_MS): Promise<boolean> {
  while (!cancelled()) {
    await new Promise((r) => setTimeout(r, everyMs))
    if (cancelled()) return false
    if (back()) return true
  }
  return false
}

/** El disco de una carpeta para el aviso: "F:", en Mac "/Volumes/SSD" (o la carpeta entera si no es ninguno de los dos). */
export function driveOf(p: string): string {
  const mac = p.match(/^\/Volumes\/[^/]+/)
  if (mac) return mac[0]
  const root = path.parse(path.resolve(p)).root.replace(/[\\/]+$/, '')
  return /^[A-Za-z]:$/.test(root) ? root.toUpperCase() : p
}

/**
 * El aviso de la pausa: "Se desconectó F: (SSD EXTERNO). El análisis sigue solo cuando vuelva; no se marcó nada."
 * `grilla`: lo que espera es la grilla (apps/paila/electron/ipc/dj.ts), no el análisis.
 */
export function diskReason(rootPath: string, label?: string | null, folderOnly = false, grilla = false): string {
  return T.sigue(folderOnly ? T.noCarpeta(rootPath) : T.desconecto(driveOf(rootPath), label ?? null), grilla)
}

/**
 * Un guardián por pasada. `bases`: id de carpeta → ruta de hoy (la misma que usa la pasada; si el disco vuelve con otra
 * letra, se actualiza acá). `everyMs`: cada cuánto mirar si volvió (los tests usan menos).
 */
export class ReadGuard {
  private tries = new Map<number, number>()
  private waiting: Promise<boolean> | null = null
  /** Temas que no estaban en su lugar (se saltearon sin marcar). */
  gone = 0

  constructor(private lib: GuardLib, private bases: Map<number, string>, private everyMs = DISK_POLL_MS) {}

  /** ¿Está la carpeta de este tema? (la raíz: si no está, es el disco o la carpeta entera, no el archivo). */
  rootOk(rootId: number): boolean {
    const base = this.bases.get(rootId)
    return !!base && exists(base)
  }

  /**
   * Una lectura salió bien: si mientras tanto se fue el disco, el resultado puede estar cortado (ffmpeg leyó la mitad):
   * se espera a que vuelva y se repite. Si no, se olvidan los intentos de ese tema.
   */
  async ok(fileId: number, rootId: number): Promise<'ok' | 'retry' | 'stop'> {
    if (!this.rootOk(rootId)) return (await this.waitFor(rootId)) ? 'retry' : 'stop'
    this.tries.delete(fileId)
    return 'ok'
  }

  /** Una lectura falló: decide (ver Outcome). Si el disco no está, espera acá a que vuelva (con el análisis en pausa). */
  async failed(fileId: number, rootId: number, file: string): Promise<Outcome> {
    if (this.lib.cancel) return 'stop'
    if (!this.rootOk(rootId)) return (await this.waitFor(rootId)) ? 'retry' : 'stop'
    if (!exists(file)) { this.gone++; return 'skip' }
    const n = (this.tries.get(fileId) ?? 0) + 1
    this.tries.set(fileId, n)
    if (n < MAX_TRIES) return 'retry'
    this.tries.delete(fileId)
    return 'mark'
  }

  /** Al terminar la pasada: si se saltearon temas que no estaban, se avisa (los ubica el próximo escaneo). */
  finish() {
    if (this.gone) this.lib.status.warnings.push(T.noEstaban(this.gone))
    this.gone = 0
  }

  /**
   * Pausa el análisis con el aviso del disco y espera a que vuelva (true) o a que lo detengan (false). Todos los temas que
   * fallan mientras tanto esperan la misma vuelta. Si la pausa la puso el usuario, al volver el disco sigue en pausa.
   */
  waitFor(rootId: number): Promise<boolean> {
    if (this.waiting) return this.waiting
    const base = this.bases.get(rootId) ?? ''
    const root = this.lib.roots().find((r) => r.id === rootId)
    const folderOnly = !!root && exists(path.parse(path.resolve(base)).root) // el disco está, falta la carpeta
    const reason = diskReason(base, root?.volumeLabel, folderOnly)
    const mine = !this.lib.status.paused
    if (mine) this.lib.pause(reason)
    this.lib.status.waitingDisk = folderOnly ? base : driveOf(base)
    this.lib.emit()
    this.waiting = new Promise<boolean>((resolve) => {
      const tick = () => {
        if (this.lib.cancel) return done(false)
        const r = this.lib.roots().find((x) => x.id === rootId)
        if (r?.available && exists(r.path)) { this.bases.set(rootId, r.path); return done(true) }
        setTimeout(tick, this.everyMs)
      }
      const done = (back: boolean) => {
        this.waiting = null
        this.lib.status.waitingDisk = null
        if (mine && this.lib.status.pauseReason === reason) this.lib.resume()
        else this.lib.emit()
        resolve(back)
      }
      setTimeout(tick, this.everyMs)
    })
    return this.waiting
  }
}
