// NAPIA: revisar un pedazo mientras baja (el autor, 1/11: "aunque sea descargando unos pedacitos chiquititos tipo muestras").
// sockseek deja lo que va bajando en <trabajo>/<lista>/<nombre del archivo allá>.incomplete. Cuando un tema lleva un 30 % (y
// por lo menos 1 MB), NAPIA copia lo que hay con ffmpeg (sin recodificar, a un temporal con su extensión) y le pasa la misma
// revisión que al archivo entero (calidad.ts). De a un pedazo por vez, con el mismo proceso de prioridad baja.
// Del pedazo solo se cree lo que se ve claro en el espectro: un MP3 inflado o un "sin pérdida" que por dentro es un MP3. No la
// nota (un principio tranquilo puntúa distinto que el tema entero) ni "dañado" (un archivo cortado a la mitad tropieza al final),
// ni el "puede ser recodificado" (es una duda, no una prueba).
// Qué se hace con eso (lentitud.ts y control.ts, porMuestra): mientras haya otros temas en marcha, nada: el trucho termina de bajar
// y lo decide la revisión entera. Cuando lo único que queda en el tramo es lento o trucho en la muestra, se corta y se busca en otro
// usuario: no se espera a que termine de bajar algo que no va a servir. Tests: tests/napia-muestra.test.ts.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { incompleteFiles } from './indexcsv'
import type { Revision } from './calidad'
import type { MotivoTrucho, TrackProgress } from '@paila/shared/napia'

export interface Umbral {
  /** Qué parte del archivo tiene que haber bajado. */
  fraccion: number
  /** Y por lo menos cuántos bytes (con menos, el espectro no alcanza). */
  minimo: number
}
export const MUESTRA: Umbral = { fraccion: 0.3, minimo: 1024 * 1024 }

/** Lo que se vio en el pedazo, si suena trucho. */
export interface Trucha { motivo: Extract<MotivoTrucho, 'inflado' | 'sinPerdidaFalso'>; nota: string; es: string }

/** ¿Bajó lo suficiente para mirar un pedazo? */
export const alcanza = (t: TrackProgress, u: Umbral = MUESTRA) =>
  t.state === 'bajando' && !!t.archivo && !!t.total && typeof t.bytes === 'number' && t.bytes >= Math.max(u.minimo, t.total * u.fraccion)

const SIN_PERDIDA = new Set(['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv'])

/** Si el pedazo suena trucho: solo lo que se ve claro en el espectro (inflado, sin pérdida falso). */
export function truchaEn(r: Pick<Revision, 'marcas' | 'nota' | 'es'>, ext: string): Trucha | null {
  if (r.marcas.includes('upscaled')) return { motivo: 'inflado', nota: r.nota, es: r.es }
  if (SIN_PERDIDA.has(ext.toLowerCase()) && r.marcas.includes('fake_lossless')) return { motivo: 'sinPerdidaFalso', nota: r.nota, es: r.es }
  return null
}

const plano = (s: string) => s.toLowerCase().replace(/\.incomplete$/, '').replace(/[^\p{L}\p{N}]+/gu, '')

/** Dónde quedó el pedazo de un archivo que baja (`archivo`: el nombre allá, con su carpeta). null: todavía no está. */
export function aMedias(carpeta: string, archivo: string): string | null {
  const base = path.basename(archivo.replace(/\\/g, '/'))
  for (const n of [base, base.replace(/[<>:"/\\|?*]/g, '_')]) { const f = path.join(carpeta, `${n}.incomplete`); if (fs.existsSync(f)) return f }
  // sockseek cambió algún carácter del nombre: el que se llama igual sin contar los signos
  const quiere = plano(base)
  return incompleteFiles(carpeta).find((f) => plano(path.basename(f)) === quiere) ?? null
}

/** Para ffmpeg, qué es el pedazo (por la extensión ".incomplete" no se da cuenta solo en todos los casos). */
const FORMATO: Record<string, string> = { mp3: 'mp3', flac: 'flac', wav: 'wav', aiff: 'aiff', aif: 'aiff', ogg: 'ogg' }

/** Copia lo que hay del pedazo a un archivo de audio de verdad (sin recodificar). null: no se pudo (por ejemplo un M4A, que se lee desde el final). */
export function sacarMuestra(ffmpeg: string, incompleto: string, ext: string, dir = path.join(os.tmpdir(), 'napia-muestras')): Promise<string | null> {
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'mp3'}`)
  const f = FORMATO[ext.toLowerCase()]
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-v', 'error', '-y', ...(f ? ['-f', f] : []), '-i', incompleto, '-map', '0:a:0', '-c', 'copy', out], { windowsHide: true, timeout: 60_000 }, () => {
      // lo que llegó cortado a la mitad del último cuadro hace que ffmpeg se queje: alcanza con que haya escrito algo
      try { if (fs.statSync(out).size > 0) return resolve(out) } catch { /* no escribió nada */ }
      fs.rmSync(out, { force: true }); resolve(null)
    })
  })
}

export interface MuestraOpciones {
  /** La carpeta donde sockseek deja los pedazos de esta corrida (<trabajo>/<lista>). */
  carpeta: string
  /** Copia el pedazo (sacarMuestra). */
  sacar: (incompleto: string, ext: string) => Promise<string | null>
  /** La revisión de calidad de siempre (null: no se puede revisar). */
  revisar: (archivo: string) => Promise<Revision | null>
  umbral?: Umbral
}

/** De qué fuente es lo que baja: si sockseek pasó a otro usuario u otro archivo, es otra muestra. */
const fuenteDe = (t: TrackProgress) => `${t.fuente ?? ''}|${t.total ?? ''}|${t.archivo ?? ''}`

/** Mira un pedazo de cada tema que baja (de a uno por vez) y recuerda cuáles suenan truchos. Para `vigilar` de lentitud.ts. */
export class VigiaMuestras {
  private vistos = new Map<TrackProgress, { de: string; trucha: Trucha | null }>()
  private ocupada = false
  /** Cuántos pedazos se revisaron (para el registro y los tests). */
  revisadas = 0

  constructor(private readonly o: MuestraOpciones) {}

  mirar = (tracks: TrackProgress[]) => {
    if (this.ocupada) return
    for (const t of tracks) {
      if (!alcanza(t, this.o.umbral) || this.vistos.get(t)?.de === fuenteDe(t)) continue
      // todavía no está el pedazo (o se llama distinto): se prueba en la vuelta siguiente
      const inc = aMedias(this.o.carpeta, t.archivo!)
      if (!inc) continue
      this.ocupada = true
      void this.muestrear(t, fuenteDe(t), inc).catch(() => {}).finally(() => { this.ocupada = false })
      return
    }
  }

  private async muestrear(t: TrackProgress, de: string, inc: string) {
    this.vistos.set(t, { de, trucha: null })
    const ext = path.extname(t.archivo!.replace(/\\/g, '/')).slice(1).toLowerCase() || (t.format ?? '').split(' ')[0]
    const tmp = await this.o.sacar(inc, ext)
    if (!tmp) return
    try {
      const r = await this.o.revisar(tmp)
      this.revisadas++
      const v = this.vistos.get(t)
      if (r && v?.de === de) v.trucha = truchaEn(r, ext)
    } finally { fs.rmSync(tmp, { force: true }) }
  }

  /** Lo que se vio en el pedazo de lo que baja ahora (null: sirve, o todavía no se miró). */
  trucha(t: TrackProgress): Trucha | null {
    const v = this.vistos.get(t)
    return v && v.de === fuenteDe(t) ? v.trucha : null
  }

  trucho = (t: TrackProgress) => !!this.trucha(t)
}
