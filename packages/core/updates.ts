// Actualizaciones (Fase H): leer el `latest.yml` que publica electron-builder junto a cada versión (GitHub Releases),
// decidir si hay una versión nueva y bajar el instalador verificando su huella SHA-512. Sin Electron y sin dependencias:
// lo conecta apps/paila/electron/updates.ts. Se prueba con un servidor local (tests/updates.test.ts), nunca con GitHub.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { textos } from '@paila/shared/idioma'

// Lo que se ve si algo sale mal al buscar o bajar la versión nueva (Configuración → Actualizaciones).
const T = textos({
  consultar: { es: (st: number) => `No se pudo consultar si hay una versión nueva (respuesta ${st}).`, en: (st: number) => `Couldn't check for a new version (response ${st}).` },
  incompleta: { es: 'La información de la versión nueva vino incompleta.', en: 'The information about the new version came in incomplete.' },
  bajar: { es: (st: number) => `No se pudo bajar la versión nueva (respuesta ${st}).`, en: (st: number) => `Couldn't download the new version (response ${st}).` },
  huella: {
    es: 'El instalador que se bajó no es el que se publicó (la huella no coincide): no se instala.',
    en: "The installer that was downloaded isn't the one that was published (the fingerprint doesn't match): it won't be installed.",
  },
})

/** Lo que dice `latest.yml` de la última versión publicada. */
export interface UpdateInfo { version: string; file: string; sha512: string; size: number | null; releaseDate: string | null }

/**
 * Lee `latest.yml` (el formato de electron-builder: `version`, `path`, `sha512`, `releaseDate` y la lista `files`). Se
 * leen solo esas claves, línea por línea, sin un lector de YAML entero. Null si le falta algo.
 */
export function parseLatestYml(text: string): UpdateInfo | null {
  const top = new Map<string, string>()
  let size: number | null = null
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^([A-Za-z0-9]+):\s*(.*)$/.exec(raw)
    if (m) { top.set(m[1], m[2].trim().replace(/^(['"])(.*)\1$/, '$2')); continue }
    const s = /^\s+size:\s*(\d+)\s*$/.exec(raw)
    if (s && size == null) size = Number(s[1])
  }
  const version = top.get('version'); const file = top.get('path'); const sha512 = top.get('sha512')
  if (!version || !file || !sha512 || !/^[\w.+-]+$/.test(version)) return null
  // el instalador está al lado de latest.yml: nunca una ruta ni otra dirección
  if (file.includes('/') || file.includes('\\') || file.includes('..')) return null
  return { version, file, sha512, size, releaseDate: top.get('releaseDate') ?? null }
}

/** Compara versiones tipo 1.2.3 (y 1.2.3-beta.1, que va antes de 1.2.3). Positivo si `a` es más nueva que `b`. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => { const [main, pre] = v.replace(/^v/, '').split('-', 2); return { nums: main.split('.').map((x) => Number(x) || 0), pre: pre ?? null } }
  const x = split(a); const y = split(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) { const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0); if (d) return d }
  if (x.pre === y.pre) return 0
  if (x.pre == null) return 1
  if (y.pre == null) return -1
  return x.pre.localeCompare(y.pre, 'en', { numeric: true })
}

const trimSlash = (u: string) => u.replace(/\/+$/, '')

/** Si la búsqueda al abrir falló (sin internet, GitHub caído), se reintenta a la media hora, como mucho dos veces. */
export const REINTENTAR_MS = 30 * 60 * 1000
export const MAX_REINTENTOS = 2

/**
 * ¿Toca buscar sola una versión nueva? Una vez al abrir; después, solo si esa búsqueda falló, hasta MAX_REINTENTOS veces.
 * Nada periódico (el autor, 17/11: buscar cada tantas horas es gastar de más). `hechos` = búsquedas solas ya hechas.
 */
export function tocaBuscar(phase: string, hechos: number): boolean {
  if (hechos === 0) return phase === 'quieta' || phase === 'error'
  return phase === 'error' && hechos <= MAX_REINTENTOS
}

/**
 * Pregunta si hay una versión más nueva que `current` en `feed` (la carpeta donde están latest.yml y el instalador; en
 * GitHub, `https://github.com/<dueño>/<repo>/releases/latest/download`). Null si no hay o si `skip` es esa versión.
 */
export async function checkForUpdate(feed: string, current: string, opts: { skip?: string | null; fetch?: typeof fetch } = {}): Promise<UpdateInfo | null> {
  const r = await (opts.fetch ?? fetch)(`${trimSlash(feed)}/latest.yml`, { headers: { 'cache-control': 'no-cache' }, redirect: 'follow' })
  // todavía no hay ninguna versión publicada: no es un error
  if (r.status === 404) return null
  if (!r.ok) throw new Error(T.consultar(r.status))
  const info = parseLatestYml(await r.text())
  if (!info) throw new Error(T.incompleta)
  if (compareVersions(info.version, current) <= 0 || info.version === opts.skip) return null
  return info
}

/**
 * Baja el instalador a `dir` y comprueba que su SHA-512 sea el de latest.yml (si no, lo borra y avisa). Devuelve la ruta.
 * Si ya estaba bajado y entero, no lo baja de nuevo.
 */
export async function downloadUpdate(feed: string, info: UpdateInfo, dir: string, opts: { fetch?: typeof fetch; onProgress?: (done: number, total: number | null) => void; signal?: AbortSignal } = {}): Promise<string> {
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, info.file)
  if (fs.existsSync(dest) && await sha512File(dest) === info.sha512) return dest
  const part = `${dest}.bajando`
  const r = await (opts.fetch ?? fetch)(`${trimSlash(feed)}/${encodeURIComponent(info.file)}`, { redirect: 'follow', signal: opts.signal })
  if (!r.ok || !r.body) throw new Error(T.bajar(r.status))
  const total = Number(r.headers.get('content-length')) || info.size
  const hash = crypto.createHash('sha512')
  const out = fs.createWriteStream(part)
  let done = 0
  try {
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk); done += chunk.length
      if (!out.write(chunk)) await new Promise<void>((res) => out.once('drain', () => res()))
      opts.onProgress?.(done, total)
    }
    await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())))
  } catch (e) { out.destroy(); fs.rmSync(part, { force: true }); throw e }
  if (hash.digest('base64') !== info.sha512) {
    fs.rmSync(part, { force: true })
    throw new Error(T.huella)
  }
  fs.rmSync(dest, { force: true })
  fs.renameSync(part, dest)
  return dest
}

/** SHA-512 de un archivo, en base64 (como lo escribe electron-builder en latest.yml). */
export async function sha512File(file: string): Promise<string> {
  const h = crypto.createHash('sha512')
  for await (const c of fs.createReadStream(file)) h.update(c as Buffer)
  return h.digest('base64')
}

/** Borra los instaladores viejos que quedaron bajados (menos `keep`). */
export function cleanDownloads(dir: string, keep: string | null) {
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir)) if (f !== keep) fs.rmSync(path.join(dir, f), { force: true })
}

/**
 * Rehace latest.yml después de firmar el instalador (firmar cambia el archivo, y con él su SHA-512 y su tamaño): pone la
 * huella y el tamaño nuevos en la cabecera y en `files`. Lo usa scripts/version-firmada.ts en el armado de GitHub.
 */
export function rewriteLatestYml(text: string, sha512: string, size: number): string {
  return text.replace(/\r\n/g, '\n').split('\n').map((l) => l
    .replace(/^(\s*-?\s*sha512:\s*).*$/, `$1${sha512}`)
    .replace(/^(\s+size:\s*)\d+\s*$/, `$1${size}`)).join('\n')
}
