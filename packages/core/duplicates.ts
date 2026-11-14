// Duplicados: el mismo archivo copiado, el mismo audio en otra calidad (por la huella acústica), versiones del mismo tema
// (radio edit, extended, remix: se muestran juntas pero NO son duplicados) y los probables por nombre (mismos tags y duración).
// Solo propone: mandar a la papelera lo decide el usuario. Los sample packs ("produccion") nunca entran.
import crypto from 'node:crypto'
import fs from 'node:fs'
import { allRows, visible, type Db } from './db'
import { buildFromDb, fingerprintOf } from './soundindex'
import { DIFFERENT_SIM, FRAMES_PER_SECOND, VERSION_SECONDS, bestAlignment, closeLength, sameLength, soundRelation, soundsAlike, withShared, type Alignment } from './soundmatch'
import { GENERIC_TITLES, namesSayDifferent, normalize, otherRecording, titleCore, titlesDisagree } from './dupnames'
import { setReason } from './sets'
import { pickKeeper } from './dupkeeper'
import { realAlbum } from './albums'
import { T } from './duplicates.textos'
import type { DupGroup, DupItem, DupLevel } from '@paila/shared/types'

export type { DupLevel }
// otros módulos (Bandeja, Mejorar playlist) y los tests los usan desde acá
export { isCopyName, normalize, titleCore } from './dupnames'
export { soundRelation } from './soundmatch'
export { pickKeeper } from './dupkeeper'

async function sha1(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1')
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

/** Uniones de conjuntos (para armar los grupos a partir de pares). */
class Groups {
  private parent = new Map<number, number>()
  find(x: number): number {
    let p = this.parent.get(x) ?? x
    if (p === x) return x
    p = this.find(p)
    this.parent.set(x, p)
    return p
  }
  join(a: number, b: number) { const x = this.find(a), y = this.find(b); if (x !== y) this.parent.set(y, x) }
  components(ids: Iterable<number>): number[][] {
    const by = new Map<number, number[]>()
    for (const id of ids) { const r = this.find(id); by.set(r, [...(by.get(r) ?? []), id]) }
    return [...by.values()]
  }
}

type Row = Omit<DupItem, 'tagged' | 'playlists' | 'inAlbum' | 'gaps'> & { flags: string | null; artist: string | null; title: string | null; album: string | null; md5: string | null; printed: number | null }

const isSet = (r: Row) => setReason(r.rel, r.duration, r) != null

/** Qué tan seguros estamos de cada unión, de más a menos: así se arma el título del grupo. */
type Edge = 'archivo' | 'audio' | 'sonido' | 'nombre' | 'largo' | 'corto'

/** Más corto que esto, la huella acústica no alcanza para comparar cómo suenan (10 s de huella son ~12 s de audio). */
const SHORT_SECONDS = 12
/** El nombre del archivo sin carpeta, extensión ni " (1)" de copia. */
const fileStem = (rel: string) => (rel.split('/').pop() ?? rel).replace(/\.[^.]+$/, '').replace(/(\s*\(\d\))+$|\s-\s(copia|copy)(\s*\(\d+\))?$/i, '')

export async function findDuplicates(
  db: Db, pathOf: (id: number) => string | null, onProgress: (msg: string, done?: number, total?: number) => void = () => {}, isCancelled: () => boolean = () => false,
): Promise<DupGroup[]> {
  const rows = allRows<Row>(db,
    `SELECT f.id, f.rel_path AS rel, f.ext, f.size, f.kbps, f.duration, f.kind, f.artist, f.title, f.album, a.grade, a.clip_events AS clipEvents, a.lufs, a.flags, a.cutoff, a.encoder, f.sample_rate AS sampleRate,
            CASE WHEN a.audio_size = f.size AND ABS(a.audio_mtime - f.mtime) < 1 THEN a.audio_md5 END AS md5,
            a.chromaprint IS NOT NULL AND a.src_size = f.size AND a.src_mtime = f.mtime AS printed
     FROM files f LEFT JOIN analysis a ON a.file_id = f.id
     WHERE ${visible('f')} AND f.error IS NULL AND f.kind IN ('musica', 'revisar')`)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const dup = new Groups() // duplicados: se propone quedarse con uno
  const edges = new Map<number, Set<Edge>>() // raíz del grupo → cómo se unió (se recalcula al final)
  const pairEdges: [number, number, Edge][] = [] // [a, b, cómo se unieron]
  const link = (a: number, b: number, how: Edge) => { dup.join(a, b); pairEdges.push([a, b, how]) }

  // 1) Mismo archivo: mismo tamaño primero (barato) y recién ahí se calcula el hash.
  onProgress(T.buscandoIdenticos)
  const bySize = new Map<number, Row[]>()
  for (const r of rows) if (r.size > 0) bySize.set(r.size, [...(bySize.get(r.size) ?? []), r])
  const candidates = [...bySize.values()].filter((g) => g.length >= 2)
  const totalFiles = candidates.reduce((n, g) => n + g.length, 0)
  let hashed = 0
  for (const same of candidates) {
    const byHash = new Map<string, Row[]>()
    for (const r of same) {
      if (isCancelled()) return []
      const p = pathOf(r.id)
      if (!p) continue
      onProgress(r.rel, hashed++, totalFiles)
      try { const h = await sha1(p); byHash.set(h, [...(byHash.get(h) ?? []), r]) } catch { /* ilegible: se saltea */ }
    }
    for (const g of byHash.values()) for (let i = 1; i < g.length; i++) link(g[0].id, g[i].id, 'archivo')
  }

  // 2) Mismo audio exacto (la huella del sonido, MD5 del audio decodificado): cambian solo los tags, el nombre o el
  //    contenedor (un WAV y un FLAC con el mismo audio). Ya está calculada: no hace falta leer nada.
  const byMd5 = new Map<string, Row[]>()
  for (const r of rows) if (r.md5) byMd5.set(r.md5, [...(byMd5.get(r.md5) ?? []), r])
  for (const g of byMd5.values()) for (let i = 1; i < g.length; i++) if (dup.find(g[0].id) !== dup.find(g[i].id)) link(g[0].id, g[i].id, 'audio')

  // 3) Mismo audio en otra calidad, y versiones: la huella acústica con el índice (sin comparar todos contra todos).
  if (isCancelled()) return []
  onProgress(T.comparando)
  const index = await buildFromDb(db, (done, total) => onProgress(T.leyendoHuellas, done, total))
  // las huellas enteras se leen de la base solo para los pares candidatos (y se guardan mientras dura la búsqueda)
  const fps = new Map<number, Uint32Array | null>()
  const fpOf = (id: number) => {
    if (!fps.has(id)) fps.set(id, fingerprintOf(db, id))
    return fps.get(id) ?? null
  }
  const versionPairs: [number, number, string][] = []
  const soundSim = new Map<string, number>() // "a|b" → parecido, para mostrar
  const pairs = await index.pairsAsync(undefined, (done, total) => onProgress(T.buscandoParecidos, done, total), isCancelled)
  for (let k = 0; k < pairs.length; k++) {
    if (k % 2000 === 0) { if (isCancelled()) return []; onProgress(T.comparando, k, pairs.length) }
    const p = pairs[k]
    const a = byId.get(index.ids[p.a]), b = byId.get(index.ids[p.b])
    const fa = a && fpOf(a.id), fb = b && fpOf(b.id)
    if (!a || !b || !fa || !fb) continue
    let al = bestAlignment(fa, fb, p.offset)
    let rel = soundRelation(al, a.duration, b.duration, fa.length, fb.length)
    // suenan igual pero el nombre dice otra grabación (un instrumental, otra letra): va a Versiones, que nunca se tiran
    if (rel === 'same' && otherRecording(a, b)) { versionPairs.push([a.id, b.id, sharedWhy(al)]); continue }
    if (rel === 'same') { soundSim.set(`${Math.min(a.id, b.id)}|${Math.max(a.id, b.id)}`, al.sim); if (dup.find(a.id) !== dup.find(b.id)) link(a.id, b.id, 'sonido') }
    // un set largo "comparte" un pedazo con cada tema que tiene adentro: no es una versión de ninguno (y los encadenaría a todos)
    if (rel === 'same' || isSet(a) || isSet(b)) continue
    // si no son el mismo audio, se mira qué comparten de verdad (una intro o un sample cuenta; un tramo de solo bombo, no)
    al = withShared(fa, fb, al)
    rel = soundRelation(al, a.duration, b.duration, fa.length, fb.length)
    if (rel === 'version') versionPairs.push([a.id, b.id, sharedWhy(al)])
  }

  // 4) Probables por nombre: mismos artista y título (normalizados) y duración parecida (±3 s o 2 %, el mismo
  //    margen que por sonido: el FLAC y el MP3 de "Madonna - Music" difieren 3,4 s). Si los dos tienen huella y suenan distinto, NO es un duplicado (un tema con el nombre cambiado, otra versión): va a Versiones.
  //    Si la huella confirma que suenan igual, se acepta hasta ±10 s o 4 % (closeLength: la intro de un video, aplausos, silencio
  //    de más); van como probables, con un aviso para escucharlos antes de elegir.
  onProgress(T.buscandoMismoTema)
  const byName = new Map<string, Row[]>()
  for (const r of rows) {
    if (!r.artist || !r.title || (r.duration != null && r.duration < SHORT_SECONDS)) continue // los muy cortos, en el paso 4b
    const key = `${normalize(r.artist)}|${normalize(r.title)}`
    if (key.length < 5) continue
    byName.set(key, [...(byName.get(key) ?? []), r])
  }
  const soundSays = (a: Row, b: Row): 'same' | 'longer' | 'different' | 'unknown' => {
    const fa = a.printed ? fpOf(a.id) : null, fb = b.printed ? fpOf(b.id) : null
    if (!fa || !fb) return 'unknown'
    // el índice ya encontró los que suenan igual; acá se confirma con una búsqueda de corrimientos de ±10 s
    let best: Alignment | null = null
    for (let off = -80; off <= 80; off += 4) { const x = bestAlignment(fa, fb, off, 2); if (!best || x.matched > best.matched || (x.matched === best.matched && x.sim > best.sim)) best = x }
    if (soundRelation(best!, a.duration, b.duration, fa.length, fb.length) === 'same') return 'same'
    if (soundsAlike(best!, fa.length, fb.length) && closeLength(a.duration, b.duration)) return 'longer' // igual, pero uno dura más
    // "distinto" solo si no se parecen en ningún corrimiento; si se parecen pero no alcanza (otro master, techno que se
    // parece a todo), la huella no decide y queda lo que dicen los tags
    return best!.sim < DIFFERENT_SIM ? 'different' : 'unknown'
  }
  for (const g of byName.values()) {
    if (g.length < 2) continue
    // se separan por duración: una versión de 3:30 y otra de 7:00 (extended) no son el mismo archivo
    const sorted = [...g].sort((a, b) => (a.duration ?? 0) - (b.duration ?? 0))
    let cluster: Row[] = []
    const flush = () => {
      for (let i = 0; i < cluster.length; i++) {
        for (let j = i + 1; j < cluster.length; j++) {
          const a = cluster[i], b = cluster[j]
          if (dup.find(a.id) === dup.find(b.id) || namesSayDifferent(a, b)) continue
          const s = soundSays(a, b)
          if (!sameLength(a.duration ?? 0, b.duration ?? 0)) { if (s === 'longer') link(a.id, b.id, 'largo'); continue } // solo con la huella
          if (s === 'different') versionPairs.push([a.id, b.id, T.suenanDistinto])
          else link(a.id, b.id, s === 'same' ? 'sonido' : 'nombre')
        }
      }
      cluster = []
    }
    for (const r of sorted) {
      const prev = cluster.length ? cluster[cluster.length - 1].duration ?? 0 : null, cur = r.duration ?? 0
      if (prev != null && !closeLength(cur, prev)) flush()
      cluster.push(r)
    }
    flush()
  }

  // 4b) Muy cortos (un efecto, un grito, un jingle): la huella acústica no existe por debajo de ~3 s y la comparación por
  //     sonido pide 10 s. Si no son el mismo audio bit a bit (paso 2), se juntan por nombre (los tags o, sin tags, el
  //     nombre del archivo) y casi la misma duración, como probables y con aviso.
  const byShort = new Map<string, Row[]>()
  for (const r of rows) {
    if (r.duration == null || r.duration >= SHORT_SECONDS) continue
    const name = r.artist && r.title ? `${normalize(r.artist)}|${normalize(r.title)}` : normalize(fileStem(r.rel))
    if (name.length < 3 || GENERIC_TITLES.has(name)) continue
    byShort.set(name, [...(byShort.get(name) ?? []), r])
  }
  for (const g of byShort.values()) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j], da = a.duration!, db = b.duration!
        if (dup.find(a.id) !== dup.find(b.id) && Math.abs(da - db) <= Math.max(0.2, 0.05 * Math.max(da, db))) link(a.id, b.id, 'corto')
      }
    }
  }

  // 5) Versiones por nombre: mismo artista y el mismo título "núcleo" (sin "(Remix)", "- Radio Edit", "(En vivo)"…).
  const byCore = new Map<string, Row[]>()
  for (const r of rows) {
    if (!r.artist || !r.title) continue
    const core = titleCore(r.title, r.artist)
    if (core.length < 3 || GENERIC_TITLES.has(core)) continue
    const key = `${normalize(r.artist)}|${core}`
    byCore.set(key, [...(byCore.get(key) ?? []), r])
  }
  for (const g of byCore.values()) {
    if (g.length > 40) continue // 40 "versiones" del mismo título: es un título genérico, no un tema
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j]
        if (dup.find(a.id) !== dup.find(b.id) && !isSet(a) && !isSet(b) && !namesSayDifferent(a, b)) versionPairs.push([a.id, b.id, T.otraVersion])
      }
    }
  }

  // ---------- armar los grupos ----------
  onProgress(T.armando)
  for (const [a, , how] of pairEdges) { const r = dup.find(a); edges.set(r, new Set([...(edges.get(r) ?? []), how])) }
  const playlists = playlistsOf(db)
  // la carpeta de su disco: 4 temas o más de ese álbum, y son la mitad o más de la carpeta (una carpeta "Psy" con 4 temas de
  // un disco entre 16 sueltos no es un disco; "Álbum desconocido (03/05/2006 16:34:34)" tampoco: core/albums.ts, realAlbum)
  const dirOf = (r: Row) => r.rel.slice(0, r.rel.lastIndexOf('/') + 1)
  const albumKey = (r: Row) => (realAlbum(r.album) ? `${dirOf(r)}|${r.album!.trim().toLowerCase()}` : null)
  const perAlbum = new Map<string, number>(), perDir = new Map<string, number>()
  for (const r of rows) {
    perDir.set(dirOf(r), (perDir.get(dirOf(r)) ?? 0) + 1)
    const k = albumKey(r)
    if (k) perAlbum.set(k, (perAlbum.get(k) ?? 0) + 1)
  }
  const inAlbum = (r: Row) => { const n = perAlbum.get(albumKey(r) ?? '') ?? 0; return n >= 4 && n * 2 >= (perDir.get(dirOf(r)) ?? 0) }
  const toItem = (r: Row): DupItem => ({
    id: r.id, rel: r.rel, ext: r.ext, size: r.size, kbps: r.kbps, duration: r.duration, grade: r.grade, kind: r.kind,
    tagged: !!(r.artist && r.title), artist: r.artist, title: r.title, playlists: playlists(r.id), inAlbum: inAlbum(r),
    clipEvents: r.clipEvents, lufs: r.lufs, cutoff: r.cutoff, encoder: r.encoder, sampleRate: r.sampleRate,
    gaps: (',' + (r.flags ?? '') + ',').includes(',gaps,'),
  })
  const groups: DupGroup[] = []
  const keeperOf = new Map<number, number>() // raíz del grupo de duplicados → el que se queda
  for (const ids of dup.components(pairEdges.flatMap(([a, b]) => [a, b]))) {
    if (ids.length < 2) continue
    const uniq = [...new Set(ids)]
    if (uniq.length < 2) continue
    const items = uniq.map((id) => toItem(byId.get(id)!))
    const keep = pickKeeper(items)
    keeperOf.set(dup.find(uniq[0]), keep)
    const how = edges.get(dup.find(uniq[0])) ?? new Set<Edge>()
    const level: DupLevel = how.has('nombre') || how.has('largo') || how.has('corto') ? 'probable' : how.has('sonido') || (how.has('audio') && new Set(items.map((i) => i.ext)).size > 1) ? 'quality' : 'exact'
    const sims = uniq.flatMap((x) => uniq.map((y) => soundSim.get(`${x}|${y}`))).filter((x): x is number => x != null)
    // riesgo 1 del MASTERPLAN-5 (la persona 2 tiró "05 - Comentario" como repetido de "03 - Comentario", 01/11): lo que se junta solo por
    // el nombre, sin que el audio o el sonido lo confirmen: dos pistas del mismo disco no son repetidos (Versiones); lo demás queda
    // "para decidir vos", sin tildar (decidir)
    const porSonido = how.has('sonido') || how.has('audio') || how.has('archivo') || how.has('largo')
    if (level === 'probable' && !porSonido && pistasDelMismoDisco(items)) {
      groups.push({ level: 'version', items, keep: null, label: T.version, why: T.soloNombre, warning: null, similarity: null })
      continue
    }
    groups.push({
      decidir: level === 'probable' || undefined,
      level, items, keep,
      label: T[level],
      why: (['archivo', 'audio', 'sonido', 'nombre', 'largo', 'corto'] as Edge[]).filter((e) => how.has(e)).map((e) => WHY[e]()).join('; '),
      warning: titlesDisagree(items) ? T.titulosDistintos
        : how.has('corto') ? T.muyCortos
        : how.has('largo') ? T.unoDuraMas(items.length > 2, secs(items)) : null,
      similarity: sims.length ? Math.min(...sims) : null,
    })
  }

  // Versiones: de cada grupo de duplicados va solo el que se queda (son grabaciones distintas, no copias).
  const vers = new Groups()
  const reasons = new Map<number, Set<string>>()
  const rep = (id: number) => keeperOf.get(dup.find(id)) ?? id
  for (const [a, b, why] of versionPairs) {
    const x = rep(a), y = rep(b)
    if (x === y) continue
    vers.join(x, y)
    reasons.set(x, new Set([...(reasons.get(x) ?? []), why]))
  }
  for (const [x, w] of reasons) { const r = vers.find(x); if (r !== x) { reasons.set(r, new Set([...(reasons.get(r) ?? []), ...w])); reasons.delete(x) } }
  for (const ids of vers.components(versionPairs.flatMap(([a, b]) => [rep(a), rep(b)]))) {
    const uniq = [...new Set(ids)]
    if (uniq.length < 2) continue
    const items = uniq.map((id) => toItem(byId.get(id)!)).sort((a, b) => (a.duration ?? 0) - (b.duration ?? 0))
    groups.push({ level: 'version', items, keep: null, label: T.version, why: [...(reasons.get(vers.find(uniq[0])) ?? [])].join('; '), warning: null, similarity: null })
  }

  const ORDER: Record<DupLevel, number> = { exact: 0, quality: 1, probable: 2, version: 3 }
  return groups.sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.items[0].rel.localeCompare(b.items[0].rel))
}

/** Por qué están juntos, según cómo se unió cada par (un grupo puede tener varias razones). */
const WHY: Record<Edge, () => string> = {
  archivo: () => T.porArchivo, audio: () => T.porAudio, sonido: () => T.porSonido, nombre: () => T.porNombre, largo: () => T.porLargo, corto: () => T.porCorto,
}
/** Qué comparten dos versiones por sonido: "comparten 40 s de audio" o, si es poco, "comparten un pedazo de 12 s". */
function sharedWhy(al: Alignment): string {
  const s = Math.round((al.shared ?? al.matched) / FRAMES_PER_SECOND)
  const moved = Math.abs(al.offset) > 2 * FRAMES_PER_SECOND ? T.corrido(Math.round(Math.abs(al.offset) / FRAMES_PER_SECOND)) : ''
  return s < VERSION_SECONDS ? T.compartenPedazo(s, moved) : T.compartenAudio(s, moved)
}

/** Cuánto más dura el más largo de un grupo ("6 s"). */
/** Dos pistas distintas del mismo disco: en la misma carpeta y con otro número adelante ("03 - Comentario", "05 - Comentario"). */
export function pistasDelMismoDisco(items: Pick<DupItem, 'rel'>[]) {
  const n = (rel: string) => /^(\d{1,3})\D/.exec(rel.split('/').pop() ?? '')?.[1]
  return items.some((a, i) => items.some((b, j) => j > i && a.rel.replace(/\/[^/]*$/, '') === b.rel.replace(/\/[^/]*$/, '') && n(a.rel) != null && n(b.rel) != null && Number(n(a.rel)) !== Number(n(b.rel))))
}
const secs = (items: DupItem[]) => { const d = items.map((i) => i.duration ?? 0); return `${Math.round(Math.max(...d) - Math.min(...d))} s` }

/** Nombres de las playlists comunes donde está cada tema (para ver qué se pierde o se pasa al que se queda). */
function playlistsOf(db: Db): (id: number) => string[] {
  const rows = db.prepare(
    `SELECT pi.file_id AS id, p.name FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id ORDER BY p.name`,
  ).all() as { id: number; name: string }[]
  const by = new Map<number, string[]>()
  for (const r of rows) by.set(r.id, [...(by.get(r.id) ?? []), r.name])
  return (id) => by.get(id) ?? []
}
