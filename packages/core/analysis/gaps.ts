// Los huecos de un tema: los cuadros que el decodificador no pudo leer (un MP3 dañado), dónde están y cuánto duran (pedido de
// El autor del 24/10: que la ficha diga "3 cortes de 26 ms: 0:39, 0:49, 1:29" y que Duplicados prefiera la copia limpia). Solo se
// buscan si al leerlo hubo tropiezos (core/analysis/decodeerrors.ts): es una segunda lectura, con el tiempo de cada cuadro.
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { lowPriority } from '../lowpriority'

export interface Gap { /** segundos desde el principio */ at: number; ms: number }

/** El tiempo y el largo de cada cuadro que sí se pudo leer: "pts_time:39.288 … rate:44100 nb_samples:1152". */
const FRAME = /pts_time:\s*(-?[\d.]+).*?rate:\s*(\d+)\s+nb_samples:\s*(\d+)/
/** Un salto de más de medio cuadro entre el final de uno y el principio del siguiente es un hueco. */
const SLACK = 0.5
/** Más largo que esto (un set de una hora), no se busca dónde: alcanza con saber cuántos son. */
const MAX_SECONDS = 30 * 60

/** Dónde están los huecos. Vacío si no se pudo leer o el tema es muy largo. */
export function findGaps(ffmpeg: string, file: string, duration: number | null): Promise<Gap[]> {
  if (duration != null && duration > MAX_SECONDS) return Promise.resolve([])
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-nostats', '-nostdin', '-i', file, '-map', '0:a:0', '-af', 'ashowinfo', '-f', 'null', '-'], { windowsHide: true })
    lowPriority(p.pid)
    const gaps: Gap[] = []
    let prevEnd: number | null = null, prevDur = 0
    readline.createInterface({ input: p.stderr }).on('line', (l) => {
      const m = l.match(FRAME)
      if (!m) return
      const t = Number(m[1]), d = Number(m[3]) / Number(m[2])
      // varios cuadros seguidos que faltan son un solo salto (un hueco más largo)
      if (prevEnd != null && t - prevEnd > prevDur * SLACK) gaps.push({ at: Math.round(prevEnd * 10) / 10, ms: Math.round((t - prevEnd) * 1000) })
      prevEnd = t + d; prevDur = d
    })
    p.on('error', () => resolve([]))
    p.on('close', () => resolve(gaps))
  })
}
