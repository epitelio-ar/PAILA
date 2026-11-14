// Espacio: qué ocupa el disco (mapa de rectángulos por carpeta, coloreado por nota), archivos que no son música,
// cuánto se puede ahorrar y conversión WAV/AIFF → FLAC verificada. Nada se borra: lo que se limpia va a la papelera.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { lowPriority } from './lowpriority'
import { visible, type Db } from './db'
import { kindFor, type Rule } from './collections'
import { findDuplicates } from './duplicates'
import { isSystemDir } from './files'
import type { Replacer } from './replace'
import { pcmHash } from './audiohash'
import { trashBatch } from './safefs'
import { runMovesAsync } from './ops/run'
import { EmptyDirs, untouchable } from './emptydirs'
import type { Step } from './ops/types'
import { logMove, type MoveData } from './organizer'
import { inRekordbox } from './rbmoving'
import type { JunkFile, JunkReport, SavingsReport, SpaceNode } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

// Lo que se muestra en Espacio. La carpeta de la papelera ("…_limpieza-3_…") y la raíz del mapa no se traducen.
const T = textos({
  video: { es: 'Es un video, no música', en: "It's a video, not music" },
  comprimido: { es: 'Comprimido sin abrir: puede tener música adentro', en: 'Unopened archive: it may have music inside' },
  proyecto: { es: 'Archivo de análisis de otro programa (Ableton, SoundForge…): se regenera solo', en: 'Analysis file from another program (Ableton, SoundForge…): it gets rebuilt on its own' },
  basura: { es: 'Archivo auxiliar o temporal', en: 'Helper or temporary file' },
  lista: { es: 'Playlist vieja: las de PAILA reemplazan a esta', en: "Old playlist: PAILA's playlists replace this one" },
  imagen: { es: 'Imagen suelta (las tapas llamadas cover/folder se dejan)', en: 'Loose image (covers named cover/folder are kept)' },
  noPcm: { es: 'No es PCM entero: no se convierte', en: "It isn't integer PCM: it isn't converted" },
  noCoincide: { es: 'La verificación del audio no coincide: no se reemplaza', en: "The audio check doesn't match: it isn't replaced" },
  noAhorra: { es: 'El FLAC no ocupa menos: no vale la pena', en: "The FLAC doesn't take up less space: it isn't worth it" },
  sinDisco: { es: 'El disco no está conectado', en: "The disk isn't connected" },
  rutaMala: { es: 'Ruta no válida', en: 'Not a valid path' },
  samples: { es: 'Está en una carpeta de samples o de inéditos: no se toca', en: "It's in a samples or unreleased folder: it isn't touched" },
  esTema: { es: 'Es un tema de la biblioteca', en: "It's a track in the library" },
  ffmpeg: { es: (code: number | null) => `ffmpeg terminó con código ${code}`, en: (code: number | null) => `ffmpeg ended with code ${code}` },
})

const node = (n: string): SpaceNode => ({ n, b: 0, c: 0, g: {}, f: {}, ch: [] })

/** Árbol de carpetas con tamaños, para el mapa de rectángulos. */
export function spaceTree(db: Db): SpaceNode {
  const rows = db.prepare(
    `SELECT f.id, f.rel_path AS rel, f.size, f.ext, a.grade FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')}`,
  ).all() as unknown as { id: number; rel: string; size: number; ext: string; grade: string | null }[]
  const root = node('Biblioteca')
  for (const r of rows) {
    const parts = r.rel.split('/')
    let cur = root
    const chain = [root]
    for (const dir of parts.slice(0, -1)) {
      let next = cur.ch!.find((x) => x.n === dir && x.ch)
      if (!next) { next = node(dir); cur.ch!.push(next) }
      cur = next; chain.push(cur)
    }
    const leaf: SpaceNode = { n: parts[parts.length - 1], b: r.size, c: 1, g: { [r.grade ?? '-']: r.size }, f: { [r.ext]: r.size }, id: r.id }
    cur.ch!.push(leaf)
    for (const nd of chain) {
      nd.b += r.size; nd.c++
      nd.g[r.grade ?? '-'] = (nd.g[r.grade ?? '-'] ?? 0) + r.size
      nd.f[r.ext] = (nd.f[r.ext] ?? 0) + r.size
    }
  }
  const sort = (nd: SpaceNode) => { nd.ch?.sort((a, b) => b.b - a.b); nd.ch?.forEach(sort) }
  sort(root)
  return root
}

// ---------- archivos que no son música ----------

const VIDEO = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v', 'webm_video'])
const ARCH = new Set(['zip', 'rar', '7z', 'tar', 'gz'])
const TRASH = new Set(['tmp', 'temp', 'nfo', 'db', 'ini', 'url', 'bak', 'crdownload', 'part', 'ds_store'])
const IMG = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'])
const LISTS = new Set(['m3u', 'm3u8', 'pls'])
const PROJ = new Set(['asd', 'sfk', 'es1', 'reapeaks', 'pkf'])

export class Space {
  /** Sacar las carpetas vacías que encuentra junk() (con Historial y deshacer). */
  readonly empty: EmptyDirs
  constructor(private db: Db, private roots: () => { id: number; path: string; available: boolean; rules: { rel: string; kind: string }[] }[]) { this.empty = new EmptyDirs(db, roots) }

  /** Recorre las carpetas de Música y "Para revisar" buscando lo que no es audio. Los sample packs, proyectos y sets no se miran. */
  junk(): JunkReport {
    const rep: JunkReport = { files: [], emptyDirs: [], byKind: {} }
    const add = (f: JunkFile) => { rep.files.push(f); const k = (rep.byKind[f.kind] ??= { count: 0, bytes: 0 }); k.count++; k.bytes += f.size }
    const audio = new Set(['mp3', 'flac', 'wav', 'aif', 'aiff', 'm4a', 'aac', 'alac', 'ogg', 'oga', 'opus', 'webm', 'wma', 'ape', 'wv', 'mka', 'tta', 'dsf', 'dff'])
    for (const root of this.roots()) {
      if (!root.available) continue
      const walk = (rel: string): boolean => {
        const abs = rel ? path.join(root.path, ...rel.split('/')) : root.path
        let entries: fs.Dirent[]
        try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return false }
        // el export de Rekordbox y un proyecto de Ableton (sus carpetas vacías son parte del proyecto): cuentan como llenos
        if (rel && untouchable(path.posix.basename(rel), entries.map((e) => e.name))) return true
        let hasContent = false
        for (const e of entries) {
          const childRel = rel ? `${rel}/${e.name}` : e.name
          if (e.isDirectory()) {
            if (isSystemDir(e.name)) { hasContent = true; continue }
            const kind = kindFor(childRel, root.rules as never)
            if (kind === 'excluir' || kind === 'produccion' || kind === 'proyectos' || kind === 'sets') { hasContent = true; continue }
            if (walk(childRel)) hasContent = true
            else rep.emptyDirs.push({ rootId: root.id, rel: childRel })
          } else if (e.isFile()) {
            hasContent = true
            const ext = path.extname(e.name).slice(1).toLowerCase()
            if (audio.has(ext) || e.name.startsWith('._')) continue
            let size = 0
            try { size = fs.statSync(path.join(abs, e.name)).size } catch { continue }
            const lower = e.name.toLowerCase()
            if (VIDEO.has(ext)) add({ rel: childRel, rootId: root.id, size, kind: 'video', why: T.video })
            else if (ARCH.has(ext)) add({ rel: childRel, rootId: root.id, size, kind: 'comprimido', why: T.comprimido })
            else if (PROJ.has(ext)) add({ rel: childRel, rootId: root.id, size, kind: 'proyecto', why: T.proyecto })
            else if (TRASH.has(ext) || lower === 'thumbs.db' || lower === 'desktop.ini' || lower === '.ds_store') add({ rel: childRel, rootId: root.id, size, kind: 'basura', why: T.basura })
            else if (LISTS.has(ext)) add({ rel: childRel, rootId: root.id, size, kind: 'lista', why: T.lista })
            else if (IMG.has(ext) && !/^(cover|folder|front|album ?art\w*)\./i.test(lower)) add({ rel: childRel, rootId: root.id, size, kind: 'imagen', why: T.imagen })
          }
        }
        return hasContent
      }
      walk('')
    }
    return rep
  }

  // ---------- calculadora de ahorro ----------

  savings(): SavingsReport {
    const sum = (sql: string) => this.db.prepare(sql).get() as { c: number; b: number | null; d: number | null }
    const w = sum(`SELECT COUNT(*) AS c, SUM(size) AS b, 0 AS d FROM files WHERE ${visible()} AND kind IN ('musica','revisar') AND ext IN ('wav','aif','aiff') AND COALESCE(codec,'') LIKE 'pcm_%' AND COALESCE(codec,'') NOT LIKE 'pcm_f%'`)
    const fl = this.db.prepare(
      `SELECT COUNT(*) AS c, SUM(f.size) AS b, SUM(MAX(0, f.size - COALESCE(f.duration, 0) * 40000)) AS d FROM files f JOIN analysis a ON a.file_id = f.id
       WHERE ${visible('f')} AND f.ext IN ('flac','wav','aiff','aif','alac','ape','wv') AND (',' || COALESCE(a.flags, '') || ',') LIKE '%,fake_lossless,%'`,
    ).get() as { c: number; b: number | null; d: number | null }
    return {
      // pasar a FLAC cambia la extensión: Rekordbox los pierde hasta volver a importar (choques del 27/10, C8)
      wavAiff: { count: w.c, bytes: w.b ?? 0, saving: Math.round((w.b ?? 0) * 0.45), inRekordbox: inRekordbox(this.db, this.convertibles().map((x) => x.id)) },
      fakeLossless: { count: fl.c, bytes: fl.b ?? 0, saving: Math.round(fl.d ?? 0) },
    }
  }

  async duplicateSavings(pathOf: (id: number) => string | null): Promise<{ groups: number; bytes: number }> {
    const g = (await findDuplicates(this.db, pathOf)).filter((x) => x.level === 'exact')
    return { groups: g.length, bytes: g.reduce((s, x) => s + x.items.filter((i) => i.id !== x.keep).reduce((a, i) => a + i.size, 0), 0) }
  }

  // ---------- WAV/AIFF → FLAC verificado ----------

  /** Temas que se pueden pasar a FLAC sin perder nada: WAV/AIFF PCM entero de la Música. */
  convertibles(): { id: number; rel: string; size: number }[] {
    return this.db.prepare(
      `SELECT id, rel_path AS rel, size FROM files WHERE ${visible()} AND error IS NULL AND kind IN ('musica','revisar') AND ext IN ('wav','aif','aiff') AND COALESCE(codec,'') LIKE 'pcm_%' AND COALESCE(codec,'') NOT LIKE 'pcm_f%' ORDER BY size DESC`,
    ).all() as unknown as { id: number; rel: string; size: number }[]
  }

  /**
   * Pasa a FLAC verificando bit a bit. El original NO se borra: va a la papelera (Reemplazos), así que el espacio
   * (savedBytes = lo que ocupaba el original menos el FLAC) recién se libera cuando el usuario vacía la papelera.
   */
  async wavToFlac(
    ids: number[], pathOf: (id: number) => string | null, replacer: Replacer, ffmpeg: string, workDir: string,
    onProgress: (p: { done: number; total: number; current: string }) => void = () => {}, isCancelled: () => boolean = () => false,
  ): Promise<{ converted: number; savedBytes: number; failed: { rel: string; error: string }[] }> {
    const res = { converted: 0, savedBytes: 0, failed: [] as { rel: string; error: string }[] }
    fs.mkdirSync(workDir, { recursive: true })
    let i = 0
    for (const id of ids) {
      if (isCancelled()) break
      const src = pathOf(id)
      const row = this.db.prepare('SELECT rel_path AS rel, size, ext, codec FROM files WHERE id = ?').get(id) as { rel: string; size: number; ext: string; codec: string | null } | undefined
      onProgress({ done: i, total: ids.length, current: row?.rel ?? '' })
      i++
      if (!src || !row) continue
      const tmp = path.join(workDir, `shrink-${id}.flac`)
      try {
        // Regla: solo se pasa a FLAC lo que ya es sin pérdida (PCM entero). Nunca de con pérdida a sin pérdida.
        if (!/^pcm_/.test(row.codec ?? '') || /^pcm_f/.test(row.codec ?? '')) throw new Error(T.noPcm)
        await run(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-threads', '1', '-i', src, '-map', '0:a:0', '-map', '0:v?', '-c:v', 'copy', '-disposition:v', 'attached_pic', '-c:a', 'flac', '-compression_level', '8', tmp])
        const [a, b] = await Promise.all([pcmHash(ffmpeg, src), pcmHash(ffmpeg, tmp)])
        if (a !== b) throw new Error(T.noCoincide)
        const newSize = fs.statSync(tmp).size
        if (newSize >= row.size) throw new Error(T.noAhorra)
        await replacer.replace(id, tmp, { keepTags: true, keepCover: true, sameName: true, keepDj: true })
        res.converted++; res.savedBytes += row.size - newSize
      } catch (e) {
        res.failed.push({ rel: row.rel, error: (e as Error).message })
      } finally { fs.rmSync(tmp, { force: true }) }
    }
    onProgress({ done: i, total: ids.length, current: '' })
    return res
  }

  /** Manda a la papelera archivos que no son música (con registro para deshacer, en moves_log), cediendo el control mientras mueve. */
  async trashFiles(items: { rootId: number; rel: string }[]): Promise<{ batchId: number | null; moved: number; failed: { rel: string; error: string }[] }> {
    const all = this.roots()
    const roots = new Map(all.map((r) => [r.id, r.path]))
    const rulesOf = new Map(all.map((r) => [r.id, r.rules as Rule[]]))
    const res = { batchId: null as number | null, moved: 0, failed: [] as { rel: string; error: string }[] }
    const batchId = (this.db.prepare('SELECT COALESCE(MAX(batch_id), 0) + 1 AS n FROM moves_log').get() as { n: number }).n
    const folder = trashBatch(`limpieza-${batchId}`)
    const steps: Step<MoveData>[] = []
    for (const it of items) {
      try {
        if (!roots.get(it.rootId)) throw new Error(T.sinDisco)
        // la lista viene de la interfaz: se vuelve a controlar acá (nada fuera de la carpeta, nada de PAILA, nunca samples ni proyectos)
        if (!it.rel || it.rel.split('/').some((p) => p === '..' || p === '') || /^_paila(\/|$)/i.test(it.rel)) throw new Error(T.rutaMala)
        const k = kindFor(it.rel, rulesOf.get(it.rootId) ?? [])
        if (k === 'produccion' || k === 'proyectos') throw new Error(T.samples)
        // nunca se toca algo que sea un tema de la biblioteca
        if (this.db.prepare('SELECT 1 FROM files WHERE root_id = ? AND rel_path = ?').get(it.rootId, it.rel)) throw new Error(T.esTema)
        const to = `_PAILA/papelera/${folder}/${it.rel}`
        steps.push({ kind: 'mover', op: 'limpieza', rootId: it.rootId, fileId: null, src: it.rel, dst: to, data: { batchId, rootId: it.rootId, fileId: null, from: it.rel, to } })
      } catch (e) { res.failed.push({ rel: it.rel, error: (e as Error).message }) }
    }
    const r = await runMovesAsync(this.db, steps, { rootPath: (id) => roots.get(id) ?? null, annotate: (st) => logMove(this.db, st.data) })
    res.moved = r.done.length
    if (res.moved) res.batchId = batchId
    res.failed.push(...r.failed.map((x) => ({ rel: x.step.src, error: x.error })))
    return res
  }
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true })
    lowPriority(p.pid)
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').pop() || T.ffmpeg(code)))))
  })
}

