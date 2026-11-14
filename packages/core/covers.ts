// "Tapas para todo": una tapa en buena resolución por disco (Cover Art Archive con la edición de MusicBrainz, Deezer o
// iTunes, sin clave), embebida en los temas y como cover.jpg en la carpeta. Solo propone: todo pasa por Cambios pendientes.
// Nunca pisa una tapa buena con una peor. Solo se manda el artista y el nombre del disco.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from './db'
import { albumGroups, type AlbumGroup } from './albums'
import { albumBase, pickCandidates, titleKey } from './albumcheck'
import type { AlbumCheck } from './albumrun'
import type { Changes } from './changes'
import { imageInfo, side, type CoverStore } from './coverstore'
import { FOLDER_NAMES, findFile } from './foldercover'
import { OnlineCache, Polite, realFetch, type FetchFn } from './online/http'
import { fold, loose } from './names'
import { similarity } from './online/hits'
import { readCover } from './tagio'
import { findFfmpeg } from './probe'
import { sameCover } from './coversimilar'
import type { CoverProposal } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'
import { ERR } from './online/http'
import { guardarTapas } from './covers-guardadas'

// por qué se propone (o no) una tapa: se ve en Discos y tapas
const T = textos({
  yaBuena: { es: (w: number, h: number) => `Ya tiene una tapa buena (${w}×${h})`, en: (w: number, h: number) => `It already has a good cover (${w}×${h})` },
  noSePudo: { es: (msg: string) => `No se pudo buscar: ${msg}`, en: (msg: string) => `Couldn't search: ${msg}` },
  carpeta: { es: (name: string) => `la carpeta (${name})`, en: (name: string) => `the folder (${name})` },
  wma: { es: 'Son WMA: no se les puede poner la tapa adentro (convertilos primero en "Programas de DJ")', en: 'They are WMA: a cover cannot be put inside them (convert them first in "DJ software")' },
  noEncontro: { es: 'No se encontró una tapa de buena resolución en internet', en: 'No good resolution cover was found on the internet' },
  sinDisco: { es: 'El disco no está conectado', en: "The drive isn't connected" },
  igualOMejor: { es: (w: number, h: number) => `La que tiene ya es igual o mejor (${w}×${h})`, en: (w: number, h: number) => `The one it has is already as good or better (${w}×${h})` },
})

/** Una tapa de este lado (o más) ya es buena: no se cambia. */
export const GOOD_SIDE = 1000
/** Menos que esto no vale la pena proponer. */
const MIN_SIDE = 500
const NO_EMBED = new Set(['wma', 'wmv', 'asf'])
/** De varios discos de Deezer con el mismo nombre, cuántos se comparan (cada uno es un pedido más). */
const MAX_CANDIDATES = 5
const enc = encodeURIComponent

interface Found { sha: string; width: number; height: number; bytes: number; source: string }
type Bin = { ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown> }

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10 }
/** El número con que termina el nombre de un disco ("Led Zeppelin II" → 2, "Vol. 3" → 3, "Thriller" → null). */
export function albumNumber(title: string): number | null {
  const w = fold(title).trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean).pop() ?? ''
  if (/^\d{1,4}$/.test(w)) return Number(w)
  if (!/^(?:x{0,3})(?:ix|iv|v?i{0,3})$/i.test(w) || !w) return null
  let n = 0
  for (let k = 0; k < w.length; k++) { const v = ROMAN[w[k].toLowerCase()], next = ROMAN[w[k + 1]?.toLowerCase() ?? ''] ?? 0; n += v < next ? -v : v }
  return n
}
/**
 * Dos nombres de disco parecidos pero con otro número al final son discos distintos: "Led Zeppelin I" no es "Led Zeppelin II"
 * (al comparar sin espacios se parecen un 95 % y la tapa de iTunes era la del II; ensayo general del punto 1, 23/10).
 */
export const sameNumber = (a: string, b: string) => albumNumber(a) === albumNumber(b)

/**
 * ¿Un nombre es el otro más invitados? "Wisin & Yandel" contiene a "Wisin", "Rihanna feat. Drake" a "Rihanna"; "Luis Miguel del
 * Amargue" no contiene a "Luis Miguel": es otro artista (Deezer daba su "Grandes Éxitos" para el de Luis Miguel; repaso del 24/10).
 */
const withGuests = (long: string, short: string) => {
  const l = fold(long).trim(), s = fold(short).trim()
  if (!s || !l.startsWith(s)) return false
  const rest = l.slice(s.length).trim()
  return !rest || /^(?:&|,|;|\/|\+|feat\.?|ft\.?|featuring|x|y|and|with|con|vs\.?)(?:\s|$)/.test(rest)
}

/**
 * ¿Es este disco? El mismo nombre (sin "(Remastered)", "Deluxe"…) con el mismo número final, y el mismo artista. 'quizas': un
 * artista contiene al otro con algo más que no es un invitado ("Robert Glasper Experiment", pero también "Luis Miguel del Amargue"):
 * vale solo si el disco tiene alguno de tus temas.
 */
export function albumMatch(g: AlbumGroup, artist: string, album: string): 'si' | 'quizas' | null {
  const a = albumBase(album), b = albumBase(g.album)
  if (!(a === b || (similarity(a, b) >= 0.85 && sameNumber(album, g.album)))) return null
  const x = loose(artist), y = loose(g.artist)
  if (g.various || x === y || withGuests(artist, g.artist) || withGuests(g.artist, artist) || similarity(x, y) >= 0.8) return 'si'
  return x.includes(y) || y.includes(x) ? 'quizas' : null
}
export const sameAlbum = (g: AlbumGroup, artist: string, album: string) => albumMatch(g, artist, album) === 'si'
/** ¿Es del año de tus tags? (sin año en tus tags, no se puede saber: no) */
const sameYear = (g: AlbumGroup, date: string | null | undefined) => !!g.year && !!date && date.startsWith(g.year.slice(0, 4))

export interface DeezerAlbum { id?: number; title: string; artist?: { name: string }; cover_xl?: string }
export interface DeezerAlbumInfo { release_date?: string; tracks?: { data?: { title: string }[] } }
/**
 * Varios discos de Deezer con el mismo nombre ("Grandes Éxitos" de Luis Miguel hay más de uno): el que tiene más de tus temas; si
 * empatan, el del año de tus tags, y después el que tiene menos temas que no son tuyos. Si no se puede decidir, el primero, como
 * antes (el autor, 24/10).
 */
export async function pickByTracks(g: AlbumGroup, cands: DeezerAlbum[], info: (id: number) => Promise<DeezerAlbumInfo | null>, unsure: Set<DeezerAlbum> = new Set()): Promise<DeezerAlbum | undefined> {
  const mine = new Set(g.tracks.map((t) => titleKey(t.title ?? '', t.artist ?? g.artist)).filter(Boolean))
  let best = cands.find((c) => !unsure.has(c)), bestScore = -1
  for (const c of cands.slice(0, MAX_CANDIDATES)) {
    const a = c.id == null ? null : await info(c.id)
    if (!a) continue
    const list = a.tracks?.data ?? []
    // cada tema tuyo cuenta una vez (la "Super Deluxe" trae también la versión en vivo de alguno)
    const matched = new Set(list.map((t) => titleKey(t.title, g.artist)).filter((k) => mine.has(k))).size
    const year = g.year && a.release_date?.startsWith(g.year.slice(0, 4)) ? 1 : 0
    // después, el de menos temas que no son tuyos: el disco original antes que la "Super Deluxe" ("Appetite for Destruction")
    const score = matched * 1000 + year * 100 - Math.min(99, list.length - matched)
    // "Luis Miguel del Amargue": ninguno de tus temas, es otro artista; un compilado ("Reggaeton Classics") vale también con tu año
    if (unsure.has(c) && !matched && !(g.various && year)) continue
    if (score > bestScore) { best = c; bestScore = score }
  }
  return best
}

export class Covers {
  private cache: OnlineCache
  private caa: Polite; private dz: Polite; private it: Polite
  last: CoverProposal[] = []
  /** El lado de la tapa embebida de cada tema, de la última revisión (0 = sin tapa). Se guarda con lo encontrado (covers-guardadas.ts). */
  sides = new Map<number, number>()
  constructor(private db: Db, private changes: Changes, private pathOf: (id: number) => string | null, private albums: AlbumCheck,
    private opts: { ua: string; useDeezer: () => boolean; fetchFn?: FetchFn; gapMs?: number; ffmpeg?: string | null }) {
    this.cache = new OnlineCache(db)
    const f = opts.fetchFn ?? realFetch, g = opts.gapMs
    this.caa = new Polite('Cover Art Archive', g ?? 500, f, opts.ua)
    this.dz = new Polite('Deezer', g ?? 400, f, opts.ua)
    this.it = new Polite('iTunes', g ?? 3000, f, opts.ua) // iTunes pide no más de 20 por minuto
  }
  private get store(): CoverStore { return this.changes.covers }

  /** Baja una imagen y la guarda; null si no hay (404) o no es una imagen. */
  private async image(http: Polite, url: string, source: string): Promise<Found | null> {
    const res = (await http.get(url, { Accept: 'image/*' })) as unknown as Bin
    if (res.status === 404) return null
    if (!res.ok) throw new Error(ERR.respondio(http.name, res.status))
    const bytes = new Uint8Array(await res.arrayBuffer())
    const info = imageInfo(bytes)
    if (!info || info.mime !== 'image/jpeg') return null // el cover.jpg tiene que ser JPG
    return { sha: this.store.put(bytes), width: info.width, height: info.height, bytes: bytes.length, source }
  }


  /** La mejor tapa de internet para un disco (guardada en la caché: no se vuelve a buscar). */
  async find(g: AlbumGroup, mb: { id: string; groupId: string | null } | null): Promise<Found | null> {
    // los compilados se buscan una vez más con la regla nueva (temas o año): lo guardado antes pudo ser la tapa de otro que se llama igual
    const key = g.various ? `tapa|varios2|${g.key}` : `tapa|${g.key}`
    const hit = this.cache.get<Found | null>('tapas', key)
    if (hit?.status === 'ok' && (!hit.data || this.store.path(hit.data.sha))) return hit.data
    const tries: (() => Promise<Found | null>)[] = []
    let release = mb
    if (!release) {
      // un compilado con nombre genérico ("Reggaeton Classics" hay muchos): la edición, solo si es de tu año
      const e = pickCandidates(await this.albums.sources.editions(g.artist, g.album), g, 1).filter((x) => !g.various || sameYear(g, x.date))[0]
      release = e ? { id: e.id, groupId: e.groupId } : null
    }
    if (release) {
      tries.push(() => this.image(this.caa, `https://coverartarchive.org/release/${release!.id}/front-1200`, 'Cover Art Archive'))
      if (release.groupId) tries.push(() => this.image(this.caa, `https://coverartarchive.org/release-group/${release!.groupId}/front-1200`, 'Cover Art Archive'))
    }
    if (this.opts.useDeezer()) tries.push(async () => {
      const q = g.various ? `album:"${g.album}"` : `artist:"${g.artist}" album:"${g.album}"`
      const j = await this.dz.json<{ data?: DeezerAlbum[] }>(`https://api.deezer.com/search/album?q=${enc(q)}&limit=8`)
      const all = (j.data ?? []).filter((d) => d.cover_xl)
      const cands = all.filter((d) => albumMatch(g, d.artist?.name ?? '', d.title))
      // un compilado con nombre genérico ("Varios Artistas — Reggaeton Classics" traía la tapa del de Jam and Suppose): con el nombre
      // no alcanza, tiene que tener alguno de tus temas o ser de tu año (punto 1 real del 24/10); si no, queda sin tapa nueva
      const unsure = new Set(cands.filter((d) => g.various || albumMatch(g, d.artist?.name ?? '', d.title) === 'quizas'))
      const m = cands.length > 1 || unsure.size ? await this.byTracks(g, cands, unsure) : cands[0]
      return m ? this.image(this.dz, m.cover_xl!, 'Deezer') : null
    })
    tries.push(async () => {
      const j = await this.it.json<{ results?: { collectionName: string; artistName: string; artworkUrl100?: string; releaseDate?: string }[] }>(`https://itunes.apple.com/search?term=${enc(`${g.various ? '' : g.artist} ${g.album}`.trim())}&entity=album&limit=10`)
      const m = (j.results ?? []).find((r) => r.artworkUrl100 && sameAlbum(g, r.artistName, r.collectionName) && (!g.various || sameYear(g, r.releaseDate)))
      return m ? this.image(this.it, m.artworkUrl100!.replace(/\/\d+x\d+bb\./, '/1200x1200bb.'), 'iTunes') : null
    })
    let best: Found | null = null
    for (const t of tries) {
      const f = await t()
      if (f && side(f) >= MIN_SIDE && (!best || side(f) > side(best))) best = f
      if (best && side(best) >= GOOD_SIDE) break
    }
    this.cache.put('tapas', key, 'ok', best)
    return best
  }

  private byTracks(g: AlbumGroup, cands: DeezerAlbum[], unsure: Set<DeezerAlbum>): Promise<DeezerAlbum | undefined> {
    return pickByTracks(g, cands, (id) => this.dz.json<DeezerAlbumInfo>(`https://api.deezer.com/album/${id}`).catch(() => null), unsure)
  }

  /** Cómo está cada disco hoy: la tapa más chica entre sus temas, cuántos no tienen y la de la carpeta. */
  local(g: AlbumGroup) {
    let min: { width: number; height: number; trackId: number } | null = null, without = 0
    for (const t of g.tracks) {
      const p = this.pathOf(t.id)
      if (!p || NO_EMBED.has(t.ext.toLowerCase())) continue
      let info: { width: number; height: number } | null = null
      try { const c = readCover(p); info = c ? imageInfo(Buffer.from((JSON.parse(c) as { data: string }).data, 'base64')) : null } catch { continue } // la librería de tags no lo puede abrir: no se toca
      this.sides.set(t.id, side(info))
      if (!info) { without++; continue }
      if (!min || side(info) < side(min)) min = { width: info.width, height: info.height, trackId: t.id }
    }
    let folder: CoverProposal['folder'] = null, win: { width: number; height: number } | null = null
    const first = g.tracks.map((t) => this.pathOf(t.id)).find(Boolean)
    if (g.ownFolder && first) {
      for (const n of FOLDER_NAMES) {
        const f = findFile(path.dirname(first), n)
        const info = f ? imageInfo(fs.readFileSync(f)) : null
        if (info && (!folder || side(info) > side(folder))) folder = { name: path.basename(f!), width: info.width, height: info.height }
        if (info && n === 'folder.jpg') win = info // el de Windows Media: se reemplaza si es más chico
      }
    }
    return { min: without ? null : min, minAny: min, without, folder, win }
  }

  /** Propuestas para todos los discos (con 2 temas o más): lee cómo están y busca lo que falta en internet. */
  async scan(onProgress: (p: { done: number; total: number; current: string; found: number; errors: number }) => void, isCancelled: () => boolean): Promise<CoverProposal[]> {
    const groups = albumGroups(this.db, 2)
    const mb = this.albums.mbReleases()
    const out: CoverProposal[] = []
    let done = 0, found = 0, errors = 0, inARow = 0
    for (const g of groups) {
      if (isCancelled()) break
      onProgress({ done, total: groups.length, current: `${g.artist} - ${g.album}`, found, errors })
      const l = this.local(g)
      const base: CoverProposal = { key: g.key, dir: g.dir, artist: g.artist, album: g.album, tracks: g.tracks.length, current: l.min, without: l.without, folder: l.folder, proposed: null, embed: 0, folderFile: false, windowsFolder: false, why: null }
      // ya está todo bien: cada tema con una buena adentro y, si la carpeta es del disco, una buena en la carpeta
      const inside = g.tracks.filter((t) => this.sides.has(t.id))
      if (inside.every((t) => this.sides.get(t.id)! >= GOOD_SIDE) && (!g.ownFolder || (l.folder && side(l.folder) >= GOOD_SIDE && (!l.win || side(l.win) >= GOOD_SIDE)))) {
        out.push(this.anotar(inside.length ? { ...base, why: T.yaBuena(l.minAny!.width, l.minAny!.height) } : this.decide(g, base, l, null))); done++; continue
      }
      let f: Found | null = null
      try {
        // la carpeta ya tiene una buena (un Front.jpg de 1200) y los temas una chica adentro: se usa esa, sin ir a internet
        f = this.fromFolder(g, l) ?? await this.find(g, mb.get(g.key) ?? null)
        inARow = 0
      } catch (e) {
        errors++; inARow++
        out.push({ ...base, why: T.noSePudo((e as Error).message) }); done++
        if (inARow >= 5) throw new Error(ERR.seCorto((e as Error).message))
        continue
      }
      out.push(this.anotar(this.decide(g, base, l, f)))
      if (f) found++
      done++
    }
    onProgress({ done, total: groups.length, current: '', found, errors })
    this.last = out
    guardarTapas(this.db, out, this.sides) // queda en la base: salís, volvés (o cerrás PAILA) y sigue ahí
    return out
  }

  /**
   * Lo que se decidió de cada disco queda en la base (si hay una tapa para poner o no): de ahí cuenta el estado de la colección
   * (core/estado-grupos.ts) los discos con tapa para poner y los que nunca se revisaron. Un disco que no se pudo revisar no se anota.
   */
  private anotar(p: CoverProposal): CoverProposal {
    this.cache.put('tapas', `veredicto|${p.key}`, 'ok', { poner: !!p.proposed })
    return p
  }

  /** La tapa buena (JPG) que ya está en la carpeta del disco, guardada para usarla; null si no hay. */
  private fromFolder(g: AlbumGroup, l: ReturnType<Covers['local']>): Found | null {
    const first = g.tracks.map((t) => this.pathOf(t.id)).find(Boolean)
    if (!l.folder || side(l.folder) < GOOD_SIDE || !first) return null
    const file = findFile(path.dirname(first), l.folder.name.toLowerCase())
    const bytes = file ? fs.readFileSync(file) : null
    if (!bytes || imageInfo(bytes)?.mime !== 'image/jpeg') return null
    // tiene que ser la misma tapa que ya tienen los temas: en "El Círculo" el folder.jpg grande era la de la edición instrumental
    if (l.minAny && !this.likeInside(l.minAny.trackId, bytes)) return null
    return { sha: this.store.put(bytes), width: l.folder.width, height: l.folder.height, bytes: bytes.length, source: T.carpeta(l.folder.name) }
  }

  /** ¿La imagen se parece a la tapa que tiene adentro el tema? Si no se puede comparar, no (core/coversimilar.ts). */
  private likeInside(trackId: number, image: Uint8Array): boolean {
    const ffmpeg = this.opts.ffmpeg ?? findFfmpeg(), file = this.pathOf(trackId)
    let inside: Buffer | null = null
    try { const c = file ? readCover(file) : null; inside = c ? Buffer.from((JSON.parse(c) as { data: string }).data, 'base64') : null } catch { /* no se lee */ }
    return !!ffmpeg && !!inside && sameCover(ffmpeg, image, inside) === true
  }

  /** Qué se haría con la tapa encontrada: solo donde la de hoy es peor (o no hay). */
  decide(g: AlbumGroup, base: CoverProposal, l: ReturnType<Covers['local']>, f: Found | null): CoverProposal {
    if (!f) {
      if (!l.minAny && !l.folder && g.tracks.every((t) => NO_EMBED.has(t.ext.toLowerCase()))) return { ...base, why: T.wma }
      return { ...base, why: T.noEncontro }
    }
    const bar = Math.min(GOOD_SIDE, Math.round(side(f) * 0.8)) // una de 1000 no se cambia por una de 1200
    const worse = (info: { width: number; height: number } | null) => side(info) < bar
    const embed = this.embedIds(g, bar).length
    const windowsFolder = g.ownFolder && !!l.win && worse(l.win)
    const folderFile = g.ownFolder && (!l.folder || worse(l.folder) || windowsFolder)
    if (!embed && !folderFile) {
      const have = l.minAny ?? l.folder
      // los WMA no llevan tapa adentro (no se les escriben tags) y su carpeta no es solo del disco: no hay dónde ponerla
      if (!have) return { ...base, why: g.tracks.every((t) => NO_EMBED.has(t.ext.toLowerCase())) ? T.wma : T.sinDisco }
      return { ...base, why: T.igualOMejor(have.width, have.height) }
    }
    return { ...base, proposed: f, embed, folderFile, windowsFolder }
  }

  /** Los temas donde la tapa nueva va embebida: los que no tienen o la tienen más chica que `bar`. */
  private embedIds(g: AlbumGroup, bar: number): number[] {
    return g.tracks.filter((t) => !NO_EMBED.has(t.ext.toLowerCase()) && this.sides.has(t.id) && this.sides.get(t.id)! < bar).map((t) => t.id)
  }

  /** Arma los Cambios pendientes de los discos elegidos: la tapa en los temas que la tienen peor y el cover.jpg. */
  stage(keys: string[]): { tracks: number; folders: number } {
    const want = new Set(keys)
    const all = albumGroups(this.db, 2), groups = new Map(all.map((g) => [g.key + '\u0000' + g.dir, g]))
    // si Organizar lo movió después de buscar, el disco se encuentra por su clave (si hay uno solo con esa clave)
    const porClave = (k: string) => { const gs = all.filter((g) => g.key === k); return gs.length === 1 ? gs[0] : undefined }
    const items: { id: number; field: 'cover' | 'folderCover'; value: string }[] = []
    let folders = 0
    const done = new Set<CoverProposal>()
    for (const p of this.last) {
      if (!want.has(p.key) || !p.proposed) continue
      // un disco que se movió o se renombró entre "Buscar" y "Proponer" (Organizar en el medio) ya no está ahí: no se marca
      // como propuesto (choques del 27/10, C7); al volver a buscar aparece en su lugar nuevo
      const g = groups.get(p.key + '\u0000' + p.dir) ?? porClave(p.key)
      if (!g) continue
      done.add(p)
      const value = JSON.stringify({ mime: 'image/jpeg', ref: p.proposed.sha })
      const bar = Math.min(GOOD_SIDE, Math.round(side(p.proposed) * 0.8))
      for (const id of this.embedIds(g, bar)) items.push({ id, field: 'cover', value })
      // un cover.jpg por carpeta (en un disco doble, uno en cada CD)
      const dirs = new Set<string>()
      for (const t of g.tracks) {
        const file = this.pathOf(t.id)
        if (!file || !p.folderFile || dirs.has(path.dirname(file))) continue
        dirs.add(path.dirname(file)); items.push({ id: t.id, field: 'folderCover', value }); folders++
      }
    }
    this.changes.stageMany(items)
    // lo que ya se mandó no se vuelve a ofrecer: antes la pestaña seguía diciendo "Proponer las N tildadas" hasta buscar de nuevo
    for (const p of done) p.staged = true
    return { tracks: items.filter((i) => i.field === 'cover').length, folders }
  }
}
