// Vigila la carpeta de la Bandeja desde el proceso principal (anda en cualquier pantalla y con la ventana minimizada):
// fs.watch recursivo, espera a que cada archivo termine de bajarse, junta los avisos repetidos, hace una revisión
// completa al arrancar y cada pocos minutos, y procesa los archivos en una cola, de a uno.
import fs from 'node:fs'
import path from 'node:path'
import { AUDIO_EXT } from './files'
import { INBOX_DONE_DIRS, INBOX_SKIP_DIRS } from './inbox'
import { textos } from '@paila/shared/idioma'

/** Lo que se ve si la vigilancia se corta (en la pantalla de la Bandeja). */
const T = textos({
  dejo: { es: (m: string) => `Se dejó de vigilar la carpeta: ${m}`, en: (m: string) => `Stopped watching the folder: ${m}` },
  noPuede: { es: (m: string) => `No se puede vigilar la carpeta: ${m}`, en: (m: string) => `Can't watch the folder: ${m}` },
  noEsta: { es: 'La carpeta de la Bandeja no está (¿el disco está desconectado?)', en: "The Inbox folder isn't there (is the drive disconnected?)" },
})

/** Lo que los navegadores y programas de descarga usan mientras el archivo no terminó de bajar. */
const PARTIAL = /\.(part|crdownload|tmp|incomplete|partial|download|opdownload)$/i

export interface WatchOptions {
  /** Cuánto tiempo sin cambiar de tamaño ni de fecha para darlo por bajado (ms). */
  stableMs?: number
  /** Cada cuánto se mira de nuevo un archivo que todavía cambia (ms). */
  pollMs?: number
  /** Revisión completa cada tanto (ms), por si se perdió algún aviso. */
  rescanMs?: number
  /** Cuánto se espera para juntar los avisos repetidos de un mismo archivo (ms). */
  debounceMs?: number
}

export interface WatchDeps {
  /** Procesa un archivo (emparejar, verificar…). Nunca dos a la vez. */
  handle: (file: string) => Promise<void>
  /** Los audios de una carpeta o ZIP (Inbox.expand). */
  list: (paths: string[]) => Promise<string[]>
  /** ¿Se puede trabajar ahora? (el candado de operaciones libre: no se revisa mientras se escanea o se mueven archivos). */
  canWork: () => boolean
  /** Algo cambió (cola, archivo actual, error): para avisarle a la interfaz. */
  onState?: () => void
}

/** ¿El nombre es de un archivo que hay que tomar? (audio o ZIP, sin descargas a medias, carpetas de PAILA ni lo que descartó NAPIA). */
export function watchable(folder: string, file: string): boolean {
  const rel = path.relative(folder, file)
  if (!rel || rel.startsWith('..')) return false
  const dirs = rel.split(path.sep).slice(0, -1).map((d) => d.toLowerCase())
  const first = dirs[0] ?? ''
  if (INBOX_DONE_DIRS.includes(first) || first === '_paila' || dirs.some((d) => INBOX_SKIP_DIRS.includes(d))) return false
  const base = path.basename(file)
  if (PARTIAL.test(base) || base.startsWith('.') || base.startsWith('~$')) return false
  const ext = path.extname(base).slice(1).toLowerCase()
  return ext === 'zip' || AUDIO_EXT.has(ext)
}

/** ¿Se puede abrir? Si el programa que lo baja todavía lo tiene tomado, Windows no deja abrirlo para escribir. */
function canOpen(file: string): boolean {
  try { fs.closeSync(fs.openSync(file, 'r+')); return true } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') { // archivo de solo lectura: alcanza con poder leerlo
      try { if (!(fs.statSync(file).mode & 0o200)) { fs.closeSync(fs.openSync(file, 'r')); return true } } catch { /* no */ }
    }
    return false
  }
}

export class InboxWatcher {
  private folder: string | null = null
  private watcher: fs.FSWatcher | null = null
  private rescanTimer: ReturnType<typeof setInterval> | null = null
  private debounce = new Map<string, ReturnType<typeof setTimeout>>()
  /** Archivos esperando a que terminen de bajarse: último tamaño y fecha, y desde cuándo no cambian. */
  private settling = new Map<string, { size: number; mtime: number; since: number; timer: ReturnType<typeof setTimeout> }>()
  private queue: string[] = []
  private queued = new Set<string>()
  private running = false
  current: string | null = null
  lastFullScan: string | null = null
  error: string | null = null
  private o: Required<WatchOptions>

  constructor(private deps: WatchDeps, opts: WatchOptions = {}) {
    this.o = { stableMs: 4000, pollMs: 1000, rescanMs: 3 * 60_000, debounceMs: 800, ...opts }
  }

  get watching() { return !!this.watcher }
  /** Cuántos archivos esperan turno (los que se están bajando también cuentan). */
  get pending() { return this.queue.length + this.settling.size + this.debounce.size + (this.running ? 1 : 0) }

  /** Empieza a vigilar `folder` (deja de vigilar la anterior). Hace una revisión completa enseguida. */
  start(folder: string) {
    this.stop()
    this.folder = folder
    this.error = null
    try {
      this.watcher = fs.watch(folder, { recursive: true }, (_ev, name) => {
        if (!this.folder) return
        if (!name) { void this.rescan(); return } // el sistema no dijo qué cambió: se mira todo
        this.poke(path.join(this.folder, name.toString()))
      })
      this.watcher.on('error', (e) => { this.error = T.dejo(e.message); this.watcher?.close(); this.watcher = null; this.deps.onState?.() })
    } catch (e) { this.error = T.noPuede((e as Error).message) }
    this.rescanTimer = setInterval(() => void this.rescan(), this.o.rescanMs)
    void this.rescan()
    this.deps.onState?.()
  }

  stop() {
    this.watcher?.close(); this.watcher = null
    if (this.rescanTimer) clearInterval(this.rescanTimer)
    this.rescanTimer = null
    for (const t of this.debounce.values()) clearTimeout(t)
    for (const s of this.settling.values()) clearTimeout(s.timer)
    this.debounce.clear(); this.settling.clear(); this.queue = []; this.queued.clear()
    this.folder = null
  }

  /** Un aviso del sistema: se juntan los repetidos del mismo archivo y recién después se mira. */
  private poke(file: string) {
    const prev = this.debounce.get(file)
    if (prev) clearTimeout(prev)
    this.debounce.set(file, setTimeout(() => { this.debounce.delete(file); void this.consider(file) }, this.o.debounceMs))
    this.deps.onState?.()
  }

  /** Revisión completa de la carpeta (al arrancar, cada pocos minutos y cuando el sistema no dice qué cambió). */
  async rescan() {
    const folder = this.folder
    if (!folder) return
    try {
      if (!fs.existsSync(folder)) { this.error = T.noEsta; this.deps.onState?.(); return }
      const files = await this.deps.list([folder])
      for (const f of files) void this.consider(f)
      this.lastFullScan = new Date().toISOString()
      if (this.watcher) this.error = null
    } catch (e) { this.error = (e as Error).message }
    this.deps.onState?.()
  }

  /** Un archivo (o carpeta) que apareció o cambió: espera a que termine de bajarse y lo pone en la cola. */
  private async consider(file: string) {
    if (!this.folder) return
    let st: fs.Stats
    try { st = fs.statSync(file) } catch { return } // se borró o se renombró (el .part que pasó a .mp3 llega por su lado)
    if (st.isDirectory()) { // una carpeta que se movió adentro entera
      if (watchable(this.folder, path.join(file, 'x.mp3'))) for (const f of await this.deps.list([file])) void this.consider(f)
      return
    }
    // lo de un ZIP abierto en la carpeta de trabajo ya terminó de bajarse
    const inside = !path.relative(this.folder, file).startsWith('..')
    if (inside && !watchable(this.folder, file)) return
    if (!inside) { this.enqueue(file); return }
    if (this.queued.has(file) || this.settling.has(file)) { this.touch(file, st); return }
    // si hace rato que no cambia, no hace falta esperar
    if (Date.now() - st.mtimeMs >= this.o.stableMs && canOpen(file)) { await this.ready(file); return }
    this.touch(file, st)
  }

  /** Ya terminó de bajarse: a la cola (un ZIP, cada tema de adentro). */
  private async ready(file: string) {
    if (path.extname(file).toLowerCase() !== '.zip') { this.enqueue(file); return }
    try { for (const f of await this.deps.list([file])) this.enqueue(f) } catch (e) { this.error = (e as Error).message; this.deps.onState?.() }
  }

  /** Anota tamaño y fecha; si no cambian durante `stableMs` y se puede abrir, va a la cola. */
  private touch(file: string, st: fs.Stats) {
    if (this.queued.has(file)) return
    const s = this.settling.get(file)
    if (s) { if (s.size !== st.size || s.mtime !== st.mtimeMs) { s.size = st.size; s.mtime = st.mtimeMs; s.since = Date.now() } return }
    const check = () => {
      const cur = this.settling.get(file)
      if (!cur) return
      let now: fs.Stats
      try { now = fs.statSync(file) } catch { this.settling.delete(file); this.deps.onState?.(); return }
      if (now.size !== cur.size || now.mtimeMs !== cur.mtime) { cur.size = now.size; cur.mtime = now.mtimeMs; cur.since = Date.now() }
      if (Date.now() - cur.since >= this.o.stableMs && now.size > 0 && canOpen(file)) {
        this.settling.delete(file)
        void this.ready(file)
        return
      }
      cur.timer = setTimeout(check, this.o.pollMs)
    }
    this.settling.set(file, { size: st.size, mtime: st.mtimeMs, since: Date.now(), timer: setTimeout(check, this.o.pollMs) })
    this.deps.onState?.()
  }

  private enqueue(file: string) {
    if (this.queued.has(file)) return
    this.queued.add(file)
    this.queue.push(file)
    this.deps.onState?.()
    void this.pump()
  }

  /** La cola: de a uno, y solo cuando el candado de operaciones está libre. */
  private async pump() {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        if (!this.deps.canWork()) { await new Promise((r) => setTimeout(r, this.o.pollMs * 2)); continue }
        const file = this.queue.shift()!
        this.current = path.basename(file)
        this.deps.onState?.()
        try { if (fs.existsSync(file)) await this.deps.handle(file) } catch (e) { this.error = `${path.basename(file)}: ${(e as Error).message}` }
        this.queued.delete(file)
      }
    } finally {
      this.running = false
      this.current = null
      this.deps.onState?.()
    }
  }

  /** Espera a que la cola quede vacía (para los tests y la corrida supervisada). */
  async idle(timeoutMs = 60_000) {
    const end = Date.now() + timeoutMs
    while (this.pending > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
  }
}
