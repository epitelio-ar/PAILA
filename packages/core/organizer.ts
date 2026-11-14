// Organizador de carpetas: arma una vista previa de "dónde iría cada tema" según una regla, y lo aplica moviendo archivos
// dentro de su misma carpeta de música (mismo disco, instantáneo). Todo se anota para poder deshacerlo.
// Solo toca la colección Música: sample packs, proyectos y sets nunca se mueven, y los sets largos que todavía están en
// Música (core/sets.ts) se saltean: no se les arma "Artista/Álbum/Título".
import fs from 'node:fs'
import path from 'node:path'
import { liberarLugar } from './lugar'
import { enPaila, visible, type Db } from './db'
import { runMovesAsync } from './ops/run'
import type { Step } from './ops/types'
import { isPlaceholder, isSite, loose } from './names'
import { purgedMsg } from './purge'
import { setReason } from './sets'
import type { OrganizeBatch, OrganizeOptions, OrganizePlan, OrganizeResult } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'; import { generoPrincipal } from '@paila/shared/generos'
import { extrasFor } from './organizer-extras'
import { inRekordbox } from './rbmoving'
import { anioDe, anioPorDisco, carpetaSegura, numeroDe, collabTargets, duoKey, firstOfList, officialSpelling, rankSpellings, wholeNames } from './organizer-names'
import { dejadosDe } from './estado-dejar'; import { conFuturo } from './organizer-futuro'; import { anotarCreadas, faltanPorDisco, podar, vaciarOrigen } from './restos'; import { ahora } from './reloj'

// Lo que se muestra en la vista previa. Las carpetas que arma ("Varios Artistas", "Desconocido", "Sin género") NO van acá:
// son nombres que se escriben en el disco y quedan iguales en los dos idiomas.
const T = textos({
  campo: { es: (k: string) => `Campo desconocido en la regla: %${k}%`, en: (k: string) => `Unknown field in the rule: %${k}%` },
  set: { es: (why: string) => `${why}. No se le arma carpeta de artista: pasalo a "Sets y en vivo" desde Arreglar nombres`, en: (why: string) => `${why}. It doesn't get an artist folder: move it to "Sets y en vivo" from Fix names and tags` },
  sinTags: { es: 'Le faltan tags (título o artista)', en: "It's missing tags (title or artist)" },
  mismosTags: {
    es: (n: number, cual: string) => `${n} temas distintos tienen los mismos tags (${cual}) y se llamarían igual: arreglá los tags primero (Arreglar nombres o a mano)`,
    en: (n: number, cual: string) => `${n} different tracks have the same tags (${cual}) and would get the same name: fix the tags first (Fix names and tags, or by hand)`,
  },
  cambio: { es: 'Cambió de lugar o de nombre después (o está en la papelera): queda donde está', en: 'It was moved or renamed later (or is in the trash): it stays where it is' },
  dejado: { es: 'Lo dejaste como está', en: 'You chose to leave it as it is' },
  esperando: { es: 'Espera que decidas si es un repetido', en: 'Waiting for you to decide whether it is a repeat' },
})
export const DEFAULT_RULE = '%artista%/%año% - %album%/%n% - %titulo%'
const VARIOS = /^(various( artists)?|varios( artistas)?|v\.?a\.?|v[_/]a|artisti vari|verschiedene interpreten|vários artistas)$/i

/**
 * El artista de la carpeta: el principal, sin invitados. "Beyoncé feat. JAY Z" va en "Beyoncé" y "Bizarrap, Duki" en "Bizarrap"
 * (los duos con "&", como "Wisin & Yandel", quedan enteros). Así un artista no queda repartido en veinte carpetas. Un nombre con
 * coma que es un solo artista ("Earth, Wind & Fire", `whole`) no se corta. El ";" separa igual que la coma.
 */
export const mainArtist = (a: string, whole?: (name: string) => boolean) => firstOfList(a.split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0], whole)

/** Saca lo que Windows no permite en un nombre y los puntos o espacios del final. */
export function cleanName(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s{2,}/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '')
}

export interface TagRow { id: number; rootId: number; rel: string; ext: string; kind: string; artist: string | null; albumArtist: string | null; title: string | null; album: string | null; track: string | null; year: string | null; genre: string | null; duration?: number | null
  /** Un tema de compilado que va suelto: cómo se escribe la carpeta de su artista (lo votado entre todas las formas). */
  folderArtist?: string
  /** Los nombres con coma que son un solo artista ("Earth, Wind & Fire"): la carpeta no se corta ahí (organizer-names.ts). */
  whole?: (name: string) => boolean }
/**
 * Los tags que cuentan: "Unknown Artist", "Artista sconosciuto", "Album", un título "Track11" o una página ("www.htrk.org",
 * "y2mate.com") son vacíos: el tema no se ordena con eso y Ordenar pregunta de quién es (corrida supervisada, 13/11).
 */
const vale = (v: string | null) => (v && !isSite(v) && !isPlaceholder(v) ? v : null)
function usable(row: TagRow) {
  return { ...row, artist: vale(row.artist), albumArtist: vale(row.albumArtist), album: vale(row.album), title: vale(row.title) }
}

/** Carpeta del artista de un tema (sin invitados; "Varios Artistas" para los compilados). */
function folderArtistOf(row: TagRow): string {
  const t = usable(row)
  return t.albumArtist && VARIOS.test(t.albumArtist.trim()) ? 'Varios Artistas' : variosName(mainArtist(t.albumArtist || t.artist || '', row.whole))
}
/** "Various Artists" como artista del tema también va a "Varios Artistas" (no a una carpeta aparte con el nombre en inglés). */
const variosName = (a: string) => (VARIOS.test(a) ? 'Varios Artistas' : a)

/**
 * Un compilado ("Varios Artistas") lleva su carpeta solo si sus temas están juntos donde están hoy: 3 o más en la misma carpeta, y
 * son la mitad o más de ella (como un disco en Duplicados). Dos temas sueltos que de tag traen el mismo compilado (lo que dejan
 * las descargas: "Saturday Night Party 80's", "Now #1s") van con su artista; si no, "Stayin' Alive" quedaba escondido en
 * "Varios Artistas/2021 - Saturday Night Party 80's" (repaso de criterios del 24/10).
 */
const COMPILATION_HERE = 3

/**
 * Arma la ruta nueva (relativa a la carpeta de música) de un tema. null si le faltan los datos mínimos.
 * `alone`: es el único tema de su disco en la biblioteca (o no tiene disco). Entonces no se arma carpeta de disco: va directo
 * a la carpeta del artista, sin n.º de tema (decidido el 20/10: "puede ser directo dentro del artista").
 */
export function targetFor(row: TagRow, opts: OrganizeOptions, alone = !row.album): string | null {
  const t = usable(row)
  if (!t.title) return null
  const isVarios = !!t.albumArtist && VARIOS.test(t.albumArtist.trim())
  // un compilado del que tenés un solo tema va con su artista (una carpeta "Varios Artistas" con un tema suelto no ordena nada);
  // si el artista del tema también dice "VA", se queda en la carpeta del compilado
  if (isVarios && alone && t.album && (!t.artist || VARIOS.test(t.artist.trim()))) alone = false
  const folderArtist = isVarios && !alone ? 'Varios Artistas' : variosName(mainArtist((isVarios ? row.folderArtist ?? t.artist : t.albumArtist || t.artist) || '', row.whole))
  if (!folderArtist && !t.artist) return null
  const segs = opts.rule.split('/').map((s) => s.trim()).filter(Boolean)
  const single = (alone || !t.album) && segs.slice(0, -1).some((s) => /%(?:album|álbum)%/i.test(s))
  const out = segs.map((seg, i) => {
    const last = i === segs.length - 1
    // sin carpeta de disco, la parte del disco (con su año) se va, y el n.º de tema también: suelto no ordena nada
    if (single && !last && /%(?:album|álbum)%/i.test(seg)) seg = seg.replace(/%(?:album|álbum|año|anio)%/gi, '')
    if (single && last) seg = seg.replace(/%n%/gi, '')
    const filled = seg.replace(/%([^%]+)%/g, (_m, k: string) => {
      switch (k.toLowerCase()) {
        case 'artista': return last ? (t.artist || folderArtist) : (folderArtist || 'Desconocido')
        case 'albumartista': return t.albumArtist || folderArtist
        case 'album': case 'álbum': return t.album || ''
        case 'año': case 'anio': return anioDe(t.year) ?? ''
        case 'n': return numeroDe(t.track)
        case 'titulo': case 'título': return t.title ?? ''
        case 'genero': case 'género': return generoPrincipal(t.genre) ?? 'Sin género'
        default: throw new Error(T.campo(k))
      }
    })
    // si faltó un dato ("%año% - %album%" sin año) se limpian los separadores que quedaron colgando
    return cleanName(carpetaSegura(filled.replace(/^[\s\-–._]+|[\s\-–._]+$/g, '').replace(/(\s[-–]\s){2,}/g, ' - '), last))
  }).filter(Boolean)
  if (!out.length) return null
  const file = `${out[out.length - 1]}.${t.ext}`
  return [...(opts.dest ? opts.dest.split('/').map(cleanName).filter(Boolean) : []), ...out.slice(0, -1), file].join('/')
}
/** Lo que se anota de un movimiento (en el diario antes de mover, y en moves_log después). */
export interface MoveData { batchId: number; rootId: number; fileId: number | null; from: string; to: string }
/** Anota en la base un movimiento ya hecho (también lo usa la recuperación al abrir, si el corte fue justo después de mover). */
export function logMove(db: Db, m: MoveData) {
  if (m.fileId != null) { liberarLugar(db, m.rootId, m.to, m.fileId); db.prepare('UPDATE files SET rel_path = ? WHERE id = ?').run(m.to, m.fileId) }
  db.prepare('INSERT INTO moves_log (batch_id, root_id, file_id, from_rel, to_rel, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(m.batchId, m.rootId, m.fileId, m.from, m.to, ahora())
}

/** Anota en la base que un movimiento se deshizo (el archivo ya volvió a `fromRel`). */
export function logMoveUndo(db: Db, u: { logId: number; fileId: number | null; fromRel: string }) {
  if (u.fileId != null) db.prepare('UPDATE files SET rel_path = ? WHERE id = ?').run(u.fromRel, u.fileId)
  db.prepare('UPDATE moves_log SET undone_at = ? WHERE id = ?').run(new Date().toISOString(), u.logId)
}

/** ¿Es el mismo archivo con otra extensión? (lo reemplazó o convirtió el Reemplazo: "Tema.mp3" → "Tema.flac"). */
export const sameButExtension = (a: string, b: string) => a !== b && a.replace(/\.[^./]+$/, '') === b.replace(/\.[^./]+$/, '')

export class Organizer {
  constructor(private db: Db, private rootPath: (rootId: number) => string | null) {}

  // futuro: con lo que está para aplicar (core/organizer-futuro.ts). quietos: los temas de una carta "¿Son el mismo?" sin contestar
  // (Ordenar): no se mueven ni cuentan para armar la carpeta de un disco, y su lugar sigue ocupado (corrida supervisada, 13/11)
  plan(opts: OrganizeOptions, futuro = false, quietos?: ReadonlySet<number>): OrganizePlan {
    const rows = conFuturo(this.db, this.db.prepare(
      `SELECT id, root_id AS rootId, rel_path AS rel, ext, kind, artist, album_artist AS albumArtist, title, album, track, year, genre, duration
       FROM files WHERE ${visible()} AND error IS NULL AND kind = 'musica' ORDER BY root_id, rel_path`,
    ).all() as unknown as TagRow[], futuro)
    const plan: OrganizePlan = { moves: [], alreadyOk: 0, skipped: [], extras: [], conflicts: 0, clashes: [] }
    const dejados = dejadosDe(this.db, 'carpetas') // "Dejar como está" (core/estado.ts): no se mueve, pero su lugar sigue ocupado
    const whole = wholeNames(this.db, rows); for (const r of rows) r.whole = whole // "Earth, Wind & Fire" no se corta en la coma
    // Una sola carpeta por artista (y por disco) aunque los tags lo escriban distinto: en Windows "El Bordo" y "el bordo" son la
    // misma carpeta, y "La Mona Jiménez" y "La Mona Jimenez" serían dos. Se usa la forma más común (mejor si no es todo minúscula
    // o todo mayúscula); los tags no se tocan.
    const spellings = new Map<string, Map<string, number>>()
    const vote = (k: string, v: string | null) => { if (!v?.trim()) return; const m = spellings.get(k) ?? new Map<string, number>(); m.set(v.trim(), (m.get(v.trim()) ?? 0) + 1); spellings.set(k, m) }
    // el mismo artista que usa la carpeta: un "artista del álbum" que es una página ("WwW.ZonaCumbieros.NeT") no cuenta, y si no
    // "DE LA CALLE" quedaba sin votar con los "De La Calle" (en Windows, la misma carpeta escrita de dos formas)
    const artistKey = (r: TagRow) => `a|${duoKey(folderArtistOf(r))}`
    // en un compilado vota también el artista del tema: si el compilado no está junto, el tema va a la carpeta de su artista
    // ("Ángel & Khriz" del compilado de GTA y "Angel y Khriz" suelto, en una sola carpeta)
    const isVa = (r: TagRow) => !!r.albumArtist && VARIOS.test(r.albumArtist.trim())
    const trackKey = (r: TagRow) => { const a = usable(r).artist; return a ? `a|${duoKey(variosName(mainArtist(a, whole)))}` : null }
    for (const r of rows) {
      vote(artistKey(r), folderArtistOf(r)); vote(`${artistKey(r)}|${loose(r.album ?? '')}`, r.album)
      const k = isVa(r) ? trackKey(r) : null
      if (k) vote(k, variosName(mainArtist(usable(r).artist!, whole)))
    }
    // la carpeta del artista con su nombre oficial (MusicBrainz: "ABBA", "a-ha"); si no está en internet, la forma que más usás
    const official = officialSpelling(this.db, rows)
    const officialOf = (k: string) => { for (const v of spellings.get(k)?.keys() ?? []) { const o = official(v); if (o) return o } return null }
    const pick = (k: string, artist = false) => rankSpellings(spellings.get(k), artist ? officialOf(k) : null)
    for (const r of rows) {
      const a = pick(artistKey(r), true), al = r.album ? pick(`${artistKey(r)}|${loose(r.album)}`) : null
      if (a && !isVa(r)) r.albumArtist = a // solo para la carpeta: el nombre del archivo usa el artista del tema
      if (al) r.album = al
      const k = isVa(r) ? trackKey(r) : null, ta = k ? pick(k, true) : null
      if (ta) r.folderArtist = ta
    }
    // una colaboración de uno o dos temas va a la carpeta del primer artista si ese tiene una con más temas (el autor, 24/10), y
    // también la de un tema suelto de un compilado ("Mi Gente" de J. Balvin & Willy William en "Chengue", de "Various": punto 1)
    const perArtist = new Map<string, number>(), nameOf = new Map<string, string>()
    for (const r of rows) if (!isVa(r)) { const f = folderArtistOf(r), k = duoKey(f); perArtist.set(k, (perArtist.get(k) ?? 0) + 1); nameOf.set(k, f) }
    const vaFolder = (r: TagRow) => variosName(mainArtist(r.folderArtist ?? usable(r).artist ?? '', whole)) // como en targetFor
    for (const r of rows) if (isVa(r) && vaFolder(r) && !nameOf.has(duoKey(vaFolder(r)))) nameOf.set(duoKey(vaFolder(r)), vaFolder(r))
    const collab = collabTargets(nameOf.values(), (k) => perArtist.get(k) ?? 0, duoKey, (k) => nameOf.get(k) ?? null)
    for (const r of rows) { const to = collab.get(duoKey(isVa(r) ? vaFolder(r) : folderArtistOf(r))); if (to && isVa(r)) r.folderArtist = to; else if (to) r.albumArtist = to }
    const taken = new Set(rows.map((r) => `${r.rootId}|${r.rel.toLowerCase()}`)) // destinos ocupados (por otro tema o por el mismo)
    const planned = new Set<string>()
    // quién va a cada destino: para avisar antes con quién choca un "(2)" (casi siempre es el mismo tema repetido)
    const plannedFrom = new Map<string, string>()
    const sameName = new Map<string, TagRow[]>() // destino sin "(2)" → los temas que van ahí
    const busy = (key: string, self: string) => (taken.has(key) && key !== self) || planned.has(key)
    // la carpeta de un disco se arma solo con 2 temas o más de ese disco; uno solo va directo a la carpeta del artista
    const albumKey = (r: TagRow) => `${r.rootId}|${loose(folderArtistOf(r))}|${loose(r.album ?? '')}`
    anioPorDisco(rows, albumKey) // un disco, una carpeta: el año más repetido entre sus temas (organizer-names.ts)
    const perAlbum = new Map<string, number>()
    const sets = new Map<number, string>()
    const dirOf = (r: TagRow) => `${r.rootId}|${path.posix.dirname(r.rel)}`
    const perDir = new Map<string, number>(), perAlbumDir = new Map<string, number>()
    for (const r of rows) {
      perDir.set(dirOf(r), (perDir.get(dirOf(r)) ?? 0) + 1)
      const why = setReason(r.rel, r.duration, r)
      if (why) { sets.set(r.id, why); continue }
      if (r.album && !quietos?.has(r.id) && targetFor(r, opts, false)) {
        perAlbum.set(albumKey(r), (perAlbum.get(albumKey(r)) ?? 0) + 1)
        perAlbumDir.set(`${albumKey(r)}|${dirOf(r)}`, (perAlbumDir.get(`${albumKey(r)}|${dirOf(r)}`) ?? 0) + 1)
      }
    }
    const looseCompilation = (r: TagRow) => {
      if (!r.albumArtist || !VARIOS.test(r.albumArtist.trim())) return false
      const n = perAlbumDir.get(`${albumKey(r)}|${dirOf(r)}`) ?? 0
      return n < COMPILATION_HERE || n * 2 < (perDir.get(dirOf(r)) ?? 0)
    }
    for (const t of rows) {
      // un set o un enganchado largo no tiene "Artista - Título": no se le arma carpeta (va a la colección "Sets y en vivo")
      const set = sets.get(t.id)
      if (set || dejados.has(t.id) || quietos?.has(t.id)) { plan.skipped.push({ fileId: t.id, rel: t.rel, reason: set ? T.set(set) : quietos?.has(t.id) ? T.esperando : T.dejado }); continue }
      const alone = !t.album || (perAlbum.get(albumKey(t)) ?? 0) < 2 || looseCompilation(t)
      // "solo carpetas": la carpeta de la regla con el nombre que ya tiene (01/11: 886 se renombraban por el n.º de pista)
      const nombre = (x: string | null) => (x && opts.soloCarpetas ? path.posix.join(path.posix.dirname(x), path.posix.basename(t.rel)) : x)
      let to = nombre(targetFor(t, opts, alone))
      if (!to) { plan.skipped.push({ fileId: t.id, rel: t.rel, reason: T.sinTags, motivo: 'sinTags' }); continue }
      if (to === t.rel) { plan.alreadyOk++; continue }
      const self = `${t.rootId}|${t.rel.toLowerCase()}`
      // dos temas sueltos con el mismo título (de discos distintos): antes que "(2)", cada uno en la carpeta de su disco
      if (alone && t.album && busy(`${t.rootId}|${to.toLowerCase()}`, self)) {
        const alt = nombre(targetFor(t, opts, false))
        if (alt && !busy(`${t.rootId}|${alt.toLowerCase()}`, self)) to = alt
      }
      if (to === t.rel) { plan.alreadyOk++; continue }
      const base = to; let k = 1
      let key = `${t.rootId}|${to.toLowerCase()}`
      // choque: otro tema ya va (o ya está) ahí
      const baseKey = key
      while (busy(key, self)) {
        k++
        const ext = path.posix.extname(base)
        to = `${base.slice(0, base.length - ext.length)} (${k})${ext}`
        key = `${t.rootId}|${to.toLowerCase()}`
      }
      if (to === t.rel) { plan.alreadyOk++; continue }
      planned.add(key)
      plannedFrom.set(key, t.rel)
      // un choque cuenta solo si se va a mover (el que ya quedó en su "(2)" la vez anterior no es un choque nuevo)
      if (k > 1) { plan.conflicts++; plan.clashes!.push({ fileId: t.id, from: t.rel, to, with: plannedFrom.get(baseKey) ?? base }) }
      plan.moves.push({ fileId: t.id, rootId: t.rootId, from: t.rel, to })
      sameName.set(baseKey, [...(sameName.get(baseKey) ?? []), t])
    }
    // tres temas o más que irían al mismo nombre no son un duplicado: son tags rotos (un disco entero con artista "AL046" y título
    // "KAS:ST"). Con "(2)", "(3)"… perderían el único nombre que los distingue, el del archivo: no se mueven
    for (const [, ts] of sameName) {
      if (ts.length < 3) continue
      const ids = new Set(ts.map((t) => t.id))
      const cual = [usable(ts[0]).artist, usable(ts[0]).title].filter(Boolean).join(' — ')
      plan.moves = plan.moves.filter((m) => !ids.has(m.fileId))
      plan.conflicts -= plan.clashes!.filter((c) => ids.has(c.fileId)).length
      plan.clashes = plan.clashes!.filter((c) => !ids.has(c.fileId))
      for (const t of ts) plan.skipped.push({ fileId: t.id, rel: t.rel, reason: T.mismosTags(ts.length, cual), motivo: 'mismosTags' })
    }
    plan.extras = extrasFor(this.db, this.rootPath, plan.moves, rows)
    return { ...plan, inRekordbox: inRekordbox(this.db, plan.moves.map((m) => m.fileId)) }
  }

  /**
   * Aplica el plan con el motor de operaciones: mueve los archivos, actualiza la base y anota todo para poder deshacerlo.
   * Asíncrono a propósito: mientras mueve, la app sigue respondiendo (avance y Cancelar).
   */
  async apply(plan: OrganizePlan, opts: { onProgress?: (p: { done: number; total: number; current: string; errors: number }) => void; isCancelled?: () => boolean; versiones?: Map<number, { size: number | null; mtime: number | null }>; vaciar?: boolean } = {}): Promise<OrganizeResult> {
    const res: OrganizeResult = { batchId: null, moved: 0, extras: 0, failed: [] }
    if (!plan.moves.length && !plan.extras.length) return res
    const batchId = (this.db.prepare('SELECT COALESCE(MAX(batch_id), 0) AS m FROM moves_log').get() as { m: number }).m + 1
    const v = (fileId: number | null) => { const x = fileId != null ? opts.versiones?.get(fileId) : undefined; return x?.size != null ? { size: x.size, mtime: x.mtime ?? undefined } : {} } // si cambió, no se mueve
    const step = (rootId: number, fileId: number | null, from: string, to: string): Step<MoveData> => ({ kind: 'mover', op: 'organizar', rootId, fileId, src: from, dst: to, data: { batchId, rootId, fileId, from, to }, ...v(fileId) })
    const deps = { rootPath: this.rootPath, annotate: (s: Step<MoveData>) => logMove(this.db, s.data) }
    // las carpetas que faltan (las que va a crear esta tanda): se anotan, para sacarlas al deshacer si quedan vacías (core/restos.ts)
    const faltaban = faltanPorDisco(this.rootPath, [...plan.moves, ...plan.extras])
    const r = await runMovesAsync(this.db, plan.moves.map((m) => step(m.rootId, m.fileId, m.from, m.to)), deps, {
      isCancelled: opts.isCancelled,
      onStep: (done, total, s, errors) => { if (done % 20 === 0) opts.onProgress?.({ done, total, current: s.src, errors }) },
    })
    res.moved = r.done.length
    if (res.moved) { res.batchId = batchId; anotarCreadas(this.db, 'organizar', batchId, this.rootPath, faltaban) }
    res.failed = r.failed.map((x) => ({ rel: x.step.src, error: x.error }))
    if (r.cancelled) { res.cancelled = true; return res }
    // lo que acompaña al disco (tapas, .cue): solo si sigue ahí y su lugar nuevo está libre (no pisa)
    const extras = plan.extras.filter((x) => {
      const root = this.rootPath(x.rootId)
      return !!root && fs.existsSync(path.join(root, ...x.from.split('/'))) && !fs.existsSync(path.join(root, ...x.to.split('/')))
    })
    const e = await runMovesAsync(this.db, extras.map((x) => step(x.rootId, null, x.from, x.to)), deps)
    res.extras = e.done.length
    if (res.extras) { res.batchId = batchId; anotarCreadas(this.db, 'organizar', batchId, this.rootPath, faltaban) }
    res.failed.push(...e.failed.map((x) => ({ rel: x.step.src, error: x.error })))
    // con `vaciar` (el Aplicar): las carpetas de donde salió todo quedan vacías y se sacan, anotadas en su tanda (core/restos.ts)
    if (opts.vaciar) res.carpetas = vaciarOrigen(this.db, this.rootPath, [...r.done, ...e.done].map((s) => ({ rootId: s.rootId!, from: s.src! })))
    return res
  }

  batches(): OrganizeBatch[] {
    return (this.db.prepare(
      `SELECT batch_id AS batchId, MIN(created_at) AS createdAt, SUM(file_id IS NOT NULL) AS files, SUM(file_id IS NULL) AS extras, MIN(undone_at IS NOT NULL) AS undone, MAX(purged_at) AS purgedAt
       FROM moves_log GROUP BY batch_id ORDER BY batch_id DESC`,
    ).all() as { batchId: number; createdAt: string; files: number; extras: number; undone: number; purgedAt: string | null }[]).map((b) => ({ ...b, undone: !!b.undone }))
  }

  /** Deshace una tanda: devuelve cada archivo a su lugar. Las carpetas nuevas que quedan vacías se sacan (nunca otras). */
  async undo(batchId: number): Promise<OrganizeResult> {
    const res: OrganizeResult = { batchId, moved: 0, extras: 0, failed: [] }
    const rows = this.db.prepare(
      `SELECT m.id, m.root_id AS rootId, m.file_id AS fileId, m.from_rel AS fromRel, m.to_rel AS toRel, m.purged_at AS purgedAt, f.rel_path AS nowRel, f.trashed_at IS NOT NULL AS trashed
       FROM moves_log m LEFT JOIN files f ON f.id = m.file_id WHERE m.batch_id = ? AND m.undone_at IS NULL AND ${enPaila('m.root_id')} ORDER BY m.id DESC`,
    ).all(batchId) as unknown as { id: number; rootId: number; fileId: number | null; fromRel: string; toRel: string; purgedAt: string | null; nowRel: string | null; trashed: number }[]
    type U = { logId: number; fileId: number | null; fromRel: string; toRel: string }
    const steps: Step<U>[] = []
    for (const r of rows) {
      if (r.purgedAt) { res.failed.push({ rel: r.toRel, error: purgedMsg(r.purgedAt) }); continue } // limpiezas de Espacio: la papelera ya se vació
      // el tema de hoy: si después se reemplazó o convirtió (otra extensión), vuelve con la extensión de hoy; si cambió de
      // lugar, de nombre o está en la papelera, queda donde está (lo avisa el Historial)
      let src = r.toRel, dst = r.fromRel
      if (r.fileId != null && r.nowRel !== r.toRel) {
        if (r.trashed || !r.nowRel || !sameButExtension(r.nowRel, r.toRel)) { res.failed.push({ rel: r.toRel, error: T.cambio }); continue }
        src = r.nowRel
        dst = r.fromRel.replace(/\.[^./]+$/, '') + path.posix.extname(r.nowRel)
      }
      steps.push({ kind: 'mover', op: 'deshacer-organizar', rootId: r.rootId, fileId: r.fileId, src, dst, data: { logId: r.id, fileId: r.fileId, fromRel: dst, toRel: r.toRel } })
    }
    const r = await runMovesAsync(this.db, steps, {
      rootPath: this.rootPath,
      annotate: (s) => logMoveUndo(this.db, s.data),
      after: (s) => { const root = this.rootPath(s.rootId!); if (root) podar(this.db, batchId, s.rootId!, root, path.posix.dirname(s.src)) },
    })
    for (const s of r.done) if (s.fileId != null) res.moved++; else res.extras++
    res.failed.push(...r.failed.map((x) => ({ rel: x.step.data.toRel, error: x.error })))
    return res
  }
}
