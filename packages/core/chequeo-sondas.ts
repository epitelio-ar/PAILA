// Las pruebas de verdad del Chequeo que no dependen de la ventana: si un programa contesta, escribir y borrar un archivito,
// cuánto lugar queda, PRAGMA quick_check de la base (en un hilo aparte, con su propia conexión de solo lectura: con una base
// grande tarda y la ventana no se traba) y si MusicBrainz contesta. Las claves y NAPIA las pone electron/chequeo.ts.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { Sondas } from './chequeo'
import { T } from './chequeo.textos'

/** ¿Contesta `-version` en menos de 15 s? */
export const responde = (exe: string) => new Promise<boolean>((resolve) => {
  try { execFile(exe, ['-version'], { windowsHide: true, timeout: 15_000 }, (err) => resolve(!err)) } catch { resolve(false) }
})

/** Escribe un archivito vacío y lo borra al instante (en `_PAILA` si la carpeta lo tiene). null si anduvo; si no, el código del error. */
export async function escribir(dir: string): Promise<string | null> {
  const donde = fs.existsSync(path.join(dir, '_PAILA')) ? path.join(dir, '_PAILA') : dir
  const f = path.join(donde, `.paila-prueba-${process.pid}-${Date.now()}.tmp`)
  try {
    await fs.promises.writeFile(f, '')
    await fs.promises.unlink(f).catch(() => {})
    return null
  } catch (e) { return (e as NodeJS.ErrnoException).code ?? (e as Error).message }
}

export async function libre(dir: string): Promise<number | null> {
  try { const s = await fs.promises.statfs(dir); return s.bavail * s.bsize } catch { return null }
}

// el hilo: abre la base en solo lectura y corre quick_check (lo mismo que integrity_check, sin revisar los índices a fondo)
const HILO = `const { parentPort, workerData } = require('node:worker_threads')
const { DatabaseSync } = require('node:sqlite')
try {
  const db = new DatabaseSync(workerData, { readOnly: true })
  const filas = db.prepare('PRAGMA quick_check').all().map((r) => String(Object.values(r)[0]))
  db.close()
  parentPort.postMessage({ filas })
} catch (e) { parentPort.postMessage({ error: String((e && e.message) || e) }) }`

/** PRAGMA quick_check de esa base: los problemas (vacío = sana) o, si no se pudo correr, por qué. Una base que no es base, dañada. */
export function revisarBase(file: string, ms = 10 * 60_000): ReturnType<Sondas['base']> {
  return new Promise((resolve) => {
    let listo = false
    const fin = (r: Awaited<ReturnType<Sondas['base']>>) => { if (!listo) { listo = true; clearTimeout(t); void w.terminate(); resolve(r) } }
    const w = new Worker(HILO, { eval: true, workerData: file })
    const t = setTimeout(() => fin({ error: T.tardo }), ms)
    w.once('message', (m: { filas?: string[]; error?: string }) => {
      if (m.filas) fin({ problemas: m.filas.filter((x) => x !== 'ok') })
      else if (/malformed|not a database|corrupt/i.test(m.error ?? '')) fin({ problemas: [m.error!] })
      else fin({ error: m.error ?? '?' })
    })
    w.once('error', (e) => fin({ error: e.message }))
  })
}

/** Un pedido chico a MusicBrainz (un artista por su número). null si contestó; 'ocupado' si pide ir más despacio; si no, por qué. */
export async function musicbrainz(ua: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await fetchFn('https://musicbrainz.org/ws/2/artist/5182c1d9-c7d2-4dad-afa0-ccfeada921a8?fmt=json', { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    // cualquier respuesta (también "no existe") dice que se llega; 503 es que pide ir más despacio (lo usan muchos a la vez)
    return r.status === 503 ? 'ocupado' : r.status < 500 ? null : `HTTP ${r.status}`
  } catch (e) {
    const m = String((e as Error & { cause?: { code?: string } }).cause?.code ?? (e as Error).name ?? e)
    return /Timeout|Abort/i.test(m) ? T.tardo : m
  }
}
