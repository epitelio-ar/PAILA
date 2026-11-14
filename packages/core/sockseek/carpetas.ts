// NAPIA: dónde queda lo bajado y dónde trabaja sockseek, sin mezclar sus archivos con la música.
// - Lo bajado: una carpeta propia (por defecto Música\NAPIA), con una subcarpeta por lista ("80s Mood", sin el día: si la
//   volvés a bajar otro día, lo nuevo se suma ahí y lo que ya estaba no se baja de nuevo, gracias al índice de la lista).
// - Lo que está bajando: en la carpeta de datos de NAPIA (trabajo\<lista>\, con los .incomplete); cada tema pasa a la carpeta
//   de la lista recién cuando termina. El _index.csv de sockseek también va a los datos de NAPIA (indices\<lista>.csv), y al
//   terminar se le corrigen las rutas de lo que se movió: así la próxima vez saltea lo que ya bajó.
// - El disco: cuánto espacio libre queda y si es externo (USB) o de red, para decirlo antes de bajar.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { csvRows } from '../listparse'
import { listFileName } from './args'
import { incompleteFiles } from './indexcsv'
import type { Disco } from '@paila/shared/napia'

/** "80s Mood": la carpeta de una lista, siempre la misma (decidido el 22/10: sin el día). */
export function carpetaLista(nombre: string): string {
  return listFileName(nombre)
}

/** Las carpetas de trabajo de sockseek dentro de los datos de NAPIA. sockseek guarda en <trabajo>/<lista>/. */
export const rutasTrabajo = (datos: string, nombre: string) => ({
  trabajo: path.join(datos, 'trabajo'),
  carpeta: path.join(datos, 'trabajo', listFileName(nombre)),
  indice: path.join(datos, 'indices', `${listFileName(nombre)}.csv`),
})

/** Un nombre libre en la carpeta: "tema.mp3", y si ya hay uno, "tema (2).mp3". */
export function nombreLibre(dir: string, base: string): string {
  const ext = path.extname(base), stem = base.slice(0, base.length - ext.length)
  let candidate = path.join(dir, base)
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${stem} (${i})${ext}`)
  return candidate
}

/**
 * Mueve un archivo terminado a la carpeta de la lista (sin pisar nada; entre discos copia y borra), con su nombre o con `nombre`
 * (el de la lista: nombres.ts). Devuelve dónde quedó.
 */
export function entregar(archivo: string, carpeta: string, nombre?: string | null): string {
  fs.mkdirSync(carpeta, { recursive: true })
  const destino = nombreLibre(carpeta, nombre || path.basename(archivo))
  try { fs.renameSync(archivo, destino) } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    fs.copyFileSync(archivo, destino, fs.constants.COPYFILE_EXCL)
    fs.unlinkSync(archivo)
  }
  return destino
}

// las "\" se pasan a "/" antes de resolver: en Mac, "\" no separa carpetas y la ruta quedaría como si fuera relativa
const norm = (p: string) => path.resolve(p.replace(/\\/g, '/')).replace(/\\/g, '/').toLowerCase()
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** Cambia en el índice de sockseek las rutas de lo que NAPIA movió (viejo → nuevo). Devuelve cuántas cambió. */
export function corregirIndice(indice: string, movidos: Map<string, string>): number {
  let text: string
  try { text = fs.readFileSync(indice, 'utf8') } catch { return 0 }
  const rows = csvRows(text)
  const col = (rows[0] ?? []).map((h) => h.trim().toLowerCase()).indexOf('filepath')
  if (col < 0 || !movidos.size) return 0
  const porRuta = new Map([...movidos].map(([a, b]) => [norm(a), b]))
  let n = 0
  for (const r of rows.slice(1)) {
    const nuevo = r[col]?.trim() ? porRuta.get(norm(r[col])) : undefined
    if (nuevo) { r[col] = nuevo.replace(/\\/g, '/'); n++ }
  }
  if (n) fs.writeFileSync(indice, rows.filter((r) => r.some((c) => c !== '')).map((r) => r.map(cell).join(',')).join('\n') + '\n')
  return n
}

/**
 * Anota como bajados en el índice de sockseek temas que llegaron por otra corrida (la de otra fuente, cuando la de la lista se
 * cortó por una fuente lenta: control.ts): así la próxima vez se saltean. sockseek reconoce cada renglón por artista, álbum,
 * título y duración (la del CSV, en segundos; -1 si no se sabe). Si ya hay uno, lo cambia; si no, lo suma. Devuelve cuántos.
 */
export function anotarBajados(indice: string, temas: { artist: string; title: string; album?: string | null; duration?: number | null; path: string }[]): number {
  let text: string
  try { text = fs.readFileSync(indice, 'utf8') } catch { return 0 }
  const rows = csvRows(text).filter((r) => r.some((c) => c !== ''))
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (n: string) => head.indexOf(n)
  const [fp, ar, al, ti, le, st, fr] = ['filepath', 'artist', 'album', 'title', 'length', 'state', 'failurereason'].map(col)
  if (!temas.length || fp < 0 || ti < 0 || st < 0) return 0
  const k = (artist: string, title: string) => `${artist}\u0000${title}`.toLowerCase()
  for (const t of temas) {
    let r = rows.slice(1).find((x) => k(x[ar] ?? '', x[ti] ?? '') === k(t.artist, t.title))
    if (!r) {
      r = head.map(() => '0')
      if (ar >= 0) r[ar] = t.artist
      if (al >= 0) r[al] = t.album ?? ''
      r[ti] = t.title
      if (le >= 0) r[le] = t.duration != null ? String(Math.round(t.duration)) : '-1'
      rows.push(r)
    }
    r[fp] = t.path.replace(/\\/g, '/'); r[st] = '1'
    if (fr >= 0) r[fr] = '0'
  }
  fs.writeFileSync(indice, rows.map((r) => r.map(cell).join(',')).join('\n') + '\n')
  return temas.length
}

const dentro = (f: string, dir: string) => path.resolve(f).toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep)

/** La subcarpeta de la lista donde quedan las copias truchas (calidad falsa): no se borran. La Bandeja de PAILA no la mira. */
export const DESCARTADOS = 'descartados'

type Tema = { state: string; path: string | null }

/**
 * Durante una corrida: cada tema bajado que todavía está en la carpeta de trabajo pasa a la carpeta de la lista (se llama
 * en cada aviso de sockseek; si el archivo está ocupado, se reintenta en el próximo). Al terminar, `cerrar` corrige el índice.
 * `listo`: si está, solo pasa lo que ya revisó la calidad real (calidad.ts); lo trucho lo aparta `apartar`. También pasa lo
 * que sockseek da por "ya estaba" y quedó en la carpeta de trabajo (de una vez que NAPIA se cerró antes de moverlo).
 */
export class Reparto {
  readonly movidos = new Map<string, string>()
  constructor(private readonly trabajo: string, readonly carpeta: string, private readonly listo?: (t: Tema) => boolean) {}

  /** Está terminado y todavía en la carpeta de trabajo. */
  enTrabajo(t: Tema): boolean {
    return (t.state === 'bajado' || t.state === 'yaEstaba') && !!t.path && dentro(t.path, this.trabajo) && fs.existsSync(t.path)
  }

  repartir(tracks: Tema[]) {
    for (const t of tracks) if (this.enTrabajo(t) && (!this.listo || this.listo(t))) this.pasar(t)
  }

  /** Pasa un tema a la carpeta de la lista (con `nombre`, se llama así). false si está ocupado (se reintenta después). */
  pasar(t: Tema, nombre?: string | null): boolean {
    if (!t.path) return false
    try { const nuevo = entregar(t.path, this.carpeta, nombre); this.movidos.set(t.path, nuevo); t.path = nuevo; return true } catch { return false }
  }

  /** Aparta una copia trucha a <lista>/descartados. No se anota en el índice: la próxima vez sockseek lo vuelve a buscar. */
  apartar(t: Tema): boolean {
    if (!t.path) return false
    try { t.path = entregar(t.path, path.join(this.carpeta, DESCARTADOS)); return true } catch { return false }
  }

  /** Lo último y el índice con las rutas nuevas (así la próxima vez sockseek saltea lo que ya bajó). */
  cerrar(tracks: { state: string; path: string | null }[], indice: string): number {
    this.repartir(tracks)
    return corregirIndice(indice, this.movidos)
  }
}

/**
 * Borra los pedazos a medio bajar (.incomplete) que quedaron en esas carpetas de trabajo: los de una fuente muy lenta que se
 * cortó (lentitud.ts) o de un usuario que se fue a la mitad. Solo cuando la lista terminó sola: si la cortaste, quedan para
 * retomarse la próxima vez. Son datos de NAPIA, nunca música. Devuelve cuántos borró.
 */
export function limpiarAMedias(carpetas: string[]): number {
  let n = 0
  for (const f of carpetas.flatMap(incompleteFiles)) { try { fs.rmSync(f); n++ } catch { /* tomado: queda para la próxima */ } }
  return n
}

export type { Disco }

/** Qué dice Windows del tipo de disco ("USB", "Removable"…). */
export function esExterno(busType: string, driveType: string): boolean | null {
  if (!busType && !driveType) return null
  return /usb|1394|sd|mmc/i.test(busType) || /removable/i.test(driveType)
}

/** La carpeta existente más cercana (para medir el espacio de una que todavía no se creó). */
function existente(p: string): string {
  let d = path.resolve(p)
  while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d)
  return d
}

const cache = new Map<string, { etiqueta: string | null; externo: boolean | null }>()

/** El disco de una carpeta: espacio libre (statfs) y, en Windows, etiqueta y si es externo (Get-Disk, sin administrador). */
export function infoDisco(carpeta: string): Disco {
  const abs = path.resolve(carpeta)
  const red = abs.startsWith('\\\\')
  const raiz = red ? abs.split('\\').slice(0, 4).join('\\') : path.parse(abs).root
  let libre: number | null = null, total: number | null = null
  try { const s = fs.statfsSync(existente(abs)); libre = s.bavail * s.bsize; total = s.blocks * s.bsize } catch { /* sin acceso */ }
  const letra = /^([a-z]):/i.exec(raiz)?.[1]?.toUpperCase()
  if (letra && process.platform === 'win32' && !cache.has(letra)) {
    const ps = `$v = Get-Volume -DriveLetter ${letra} -ErrorAction SilentlyContinue; $d = Get-Partition -DriveLetter ${letra} -ErrorAction SilentlyContinue | Get-Disk -ErrorAction SilentlyContinue; "$($d.BusType)|$($v.DriveType)|$($v.FileSystemLabel)"`
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
    const [bus = '', tipo = '', etiqueta = ''] = (r.stdout ?? '').trim().split('|')
    cache.set(letra, { etiqueta: etiqueta.trim() || null, externo: esExterno(bus.trim(), tipo.trim()) })
  }
  const c = letra ? cache.get(letra) : undefined
  return { raiz, etiqueta: c?.etiqueta ?? null, libre, total, externo: red ? null : c?.externo ?? null, red }
}
