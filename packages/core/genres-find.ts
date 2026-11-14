// Géneros para proponer, a partir de lo ya buscado en internet (`online_cache`: Discogs y Last.fm; `mb_lookup`:
// MusicBrainz). Solo para los temas sin género o con uno que no dice nada ("Other", "Unknown"): lo que el usuario ya
// puso no se toca. Usa la forma de escribir que ya tiene la biblioteca ("Drum & Bass" si así lo tenés) y, si los otros
// temas del mismo disco ya tienen un género parejo, propone ese. Además arma "misma cosa, escrita distinto" ("rock" → "Rock").
import { loose } from './names'
import { realAlbum } from './albums'
import { visible, type Db } from './db'
import { OnlineCache } from './online/http'
import { isVarious, similarity, type RecHit } from './online/hits'
import type { LastfmTag } from './online/lastfm'
import { mainArtist, recKey, type NameRow } from './official-findings'
import { canonGenre, genreKey, isJunkGenre } from './genrewords'
import { versionRe } from './versionwords'
import { decideGenre, genreVotes, type DiscogsRelease, type GenreEvidence } from './genres'
import type { GenreLevel, GenreProposal, GenreReport, SpellingGroup } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

// por qué se propone el género del disco (se ve en la pantalla; el género no se traduce)
const T = textos({
  comoTuyos: { es: (n: number, total: number) => `Como ${n} de los ${total} temas del mismo disco que ya tienen género`, en: (n: number, total: number) => `Like ${n} of the ${total} tracks from the same album that already have a genre` },
  noEncontro: { es: (g: string, n: number, total: number) => `Internet no lo encontró, pero salió ${g} en ${n} de los ${total} temas del mismo disco`, en: (g: string, n: number, total: number) => `The internet did not find it, but ${g} came up in ${n} of the ${total} tracks from the same album` },
  comoDisco: { es: (n: number, total: number, g: string) => `Como ${n} de los ${total} temas del mismo disco (internet decía ${g})`, en: (n: number, total: number, g: string) => `Like ${n} of the ${total} tracks from the same album (the internet said ${g})` },
})

export const lastfmTrackKey = (artist: string, title: string) => `t:${loose(mainArtist(artist))}|${loose(title)}`
export const lastfmArtistKey = (artist: string) => `a:${loose(mainArtist(artist))}`


interface FileRow { id: number; rel: string; genre: string | null; album: string | null }
const single = (g: string) => !/[,;/|]/.test(g)
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

/** Un disco de remixes ("Bad Romance (Remixes)") y un tema que es un remix o una versión ("(Soulwax Remix)", "Club Mix"); las palabras son las de core/versionwords.ts. */
const REMIX_RELEASE = versionRe(['mezcla'], { except: ['version', 'radio'], extra: ['remixes', 'remixed', 'mixes', 'edits', 'bootlegs'] })
const REMIX_TRACK = versionRe(['mezcla'], { except: ['radio'] })

/** Lo que dijo internet de este tema (solo la caché). */
export function evidenceFor(cache: OnlineCache, mbGenre: (id: number) => string | null, r: NameRow): GenreEvidence {
  const ev: GenreEvidence = { musicbrainz: mbGenre(r.id) }
  if (!r.artist?.trim() || !r.title?.trim()) return ev
  const who = loose(mainArtist(r.artist))
  const remixTrack = REMIX_TRACK.test(r.title)
  const remix = (h: RecHit) => !remixTrack && !!h.release && REMIX_RELEASE.test(h.release.slice(h.release.indexOf(' - ') + 1))
  const dg = cache.get<RecHit[]>('discogs', recKey(r.artist, r.title))
  if (dg?.status === 'ok' && dg.data) {
    ev.discogs = dg.data.filter((h) => h.styles?.length).flatMap((h): DiscogsRelease[] => {
      const name = h.credit[0]?.name ?? ''
      if (isVarious(name)) return [{ styles: h.styles!, genres: h.genres, various: true, remix: remix(h) }]
      // Discogs devuelve discos de otros artistas con un tema de ese nombre: solo cuentan los del mismo artista
      return similarity(loose(name), who) >= 0.8 ? [{ styles: h.styles!, genres: h.genres, remix: remix(h) }] : []
    })
  }
  const lt = cache.get<LastfmTag[]>('lastfm', lastfmTrackKey(r.artist, r.title))
  if (lt?.status === 'ok' && lt.data) ev.lastfmTrack = lt.data
  const la = cache.get<LastfmTag[]>('lastfm', lastfmArtistKey(r.artist))
  if (la?.status === 'ok' && la.data) ev.lastfmArtist = la.data
  return ev
}

/** Los géneros para proponer. `rows`: los temas como los deja el asistente (core/official-run.ts, cleanedRows). */
export function genreReport(db: Db, rows: NameRow[], level: GenreLevel = 'biblioteca'): GenreReport {
  const cache = new OnlineCache(db)
  const files = new Map((db.prepare(`SELECT id, rel_path AS rel, genre, album FROM files WHERE ${visible()} AND error IS NULL AND kind = 'musica'`).all() as unknown as FileRow[]).map((f) => [f.id, f]))
  // tocado a mano: un cambio de género aplicado desde PAILA (y no deshecho), o uno que ya está en Cambios pendientes
  const touched = new Set([
    ...(db.prepare("SELECT DISTINCT file_id AS id FROM journal WHERE field = 'genre' AND undone_at IS NULL").all() as { id: number }[]).map((r) => r.id),
    ...(db.prepare("SELECT file_id AS id FROM pending_changes WHERE field = 'genre'").all() as { id: number }[]).map((r) => r.id),
  ])
  const mbQ = db.prepare("SELECT result FROM mb_lookup WHERE file_id = ? AND status = 'ok'")
  const mbGenre = (id: number) => { const r = mbQ.get(id) as { result: string } | undefined; try { return r ? (JSON.parse(r.result) as { genre?: string | null }).genre ?? null : null } catch { return null } }

  // cómo escribe la biblioteca cada género: la forma más usada ("Drum & Bass" le gana a "Drum n Bass" si es la tuya)
  const uses = new Map<string, number>()
  for (const f of files.values()) if (f.genre?.trim() && !isJunkGenre(f.genre) && single(f.genre)) uses.set(f.genre.trim(), (uses.get(f.genre.trim()) ?? 0) + 1)
  // solo formas prolijas ("Hip-Hop" sí; "rock nacional" o "ROCK" no) y, si es otra palabra ("Rap" por "Hip Hop"), usada más de una vez
  const spellings = new Map<string, { raw: string; n: number; tie: boolean }>()
  for (const [raw, n] of uses) {
    const c = canonGenre(raw)
    if (!c || !neat(raw) || (genreKey(raw) !== genreKey(c.name) && n < 2)) continue
    const best = spellings.get(c.name)
    if (!best || n > best.n) spellings.set(c.name, { raw, n, tie: false })
    else if (n === best.n) best.tie = true
  }
  const spell = (canon: string) => { const s = spellings.get(canon); return s && !s.tie ? s.raw : canon }
  // "como tu biblioteca": por familia, lo que más usás: el género general (445 temas con "Rock" a secas) o los estilos (Techno, Minimal)
  const fam = new Map<string, { parent: number; child: number }>()
  for (const [raw, n] of uses) { const c = canonGenre(raw); if (!c) continue; const e = fam.get(c.parent) ?? { parent: 0, child: 0 }; if (c.name === c.parent) e.parent += n; else e.child += n; fam.set(c.parent, e) }
  // el general tiene que ganar claro (el doble): "Latin" en 73 temas contra 40 de Cumbia y Reggaeton no alcanza
  const wide = (parent: string) => level === 'general' || (level === 'biblioteca' && (fam.get(parent)?.parent ?? 0) >= 5 && fam.get(parent)!.parent >= 2 * fam.get(parent)!.child)
  const atLevel = (raw: string) => { const c = canonGenre(raw); return !c ? raw : wide(c.parent) ? spell(c.parent) : spell(c.name) }
  const decide = (ev: GenreEvidence) => {
    if (level !== 'biblioteca') return decideGenre(ev, level, prior)
    const s = decideGenre(ev, 'estilo', prior)
    const parent = s && (canonGenre(s.genre)?.parent ?? s.genre)
    // los estilos puente entre dos familias no se achican: "Pop Rock" como "Rock" volvía rock a Katy Perry (corrida del 23/10)
    if (!s || !parent || !wide(parent) || BRIDGE.has(s.genre)) return s
    const g = decideGenre(ev, 'general', prior)
    return g && g.genre === parent ? g : { ...s, genre: parent }
  }

  // los otros temas del mismo disco (misma carpeta y mismo álbum)
  const albumKey = (f: FileRow) => (realAlbum(f.album) ? `${dirOf(f.rel)}|${loose(f.album!)}` : null) // "album", "Álbum desconocido": no es un disco
  const albums = new Map<string, { have: string[]; picks: Map<number, string> }>()
  const album = (k: string) => { let a = albums.get(k); if (!a) { a = { have: [], picks: new Map() }; albums.set(k, a) } return a }
  for (const f of files.values()) {
    const k = albumKey(f)
    if (!k || !f.genre?.trim() || isJunkGenre(f.genre) || !single(f.genre)) continue
    album(k).have.push(atLevel(f.genre.trim()))
  }

  // para desempatar: cuánto se usa cada género en tu biblioteca (pesa doble) y en lo que dijo internet de los demás temas
  const weight = new Map<string, number>()
  const bump = (k: string, x: number) => weight.set(k, (weight.get(k) ?? 0) + x)
  for (const [raw, n] of uses) { const c = canonGenre(raw); if (c) { bump(c.name, 2 * n); if (c.parent !== c.name) bump(c.parent, 2 * n) } }
  const todo: { r: NameRow; f: FileRow; ev: GenreEvidence }[] = []
  let empty = 0, handTouched = 0
  for (const r of rows) {
    const f = files.get(r.id)
    if (!f || !isJunkGenre(f.genre)) continue
    empty++
    if (touched.has(r.id)) { handTouched++; continue }
    const ev = evidenceFor(cache, mbGenre, r)
    for (const v of genreVotes(ev)) { bump(v.name, v.score); if (v.parent !== v.name) bump(v.parent, v.score) }
    todo.push({ r, f, ev })
  }
  const prior = (name: string) => weight.get(name) ?? 0

  const out: GenreProposal[] = []
  for (const { r, f, ev } of todo) {
    const pick = decide(ev)
    const base = { fileId: r.id, rel: f.rel, artist: r.artist, title: r.title, current: f.genre?.trim() || null }
    if (pick) out.push({ ...base, ...pick, genre: spell(pick.genre) })
    else out.push({ ...base, genre: '', conf: 'media', sources: [], why: '', others: [] })
    const k = albumKey(f)
    if (k && pick) album(k).picks.set(r.id, spell(pick.genre))
  }
  // el disco manda: si los demás temas ya tienen un género parejo (tuyo), ese; si no, el que salió en casi todos
  for (const p of out) {
    const f = files.get(p.fileId)!
    const a = albumKey(f) ? albums.get(albumKey(f)!) : undefined
    if (!a) continue
    const mine = majority(a.have)
    if (mine && a.have.length >= 2) {
      if (p.genre !== mine.value) Object.assign(p, { genre: mine.value, conf: a.have.length >= 3 ? 'alta' : 'media', sources: ['disco'], why: T.comoTuyos(mine.n, a.have.length), others: p.genre ? [p.genre] : [] })
      continue
    }
    const theirs = majority([...a.picks.values()])
    if (!theirs || a.picks.size < 3 || p.genre === theirs.value) continue
    // el que se sale del resto del disco (Rodrigo: 9 de Cumbia y uno "Ballad"): se empareja, con confianza media
    if (!p.genre) Object.assign(p, { genre: theirs.value, conf: 'media', sources: ['disco'], why: T.noEncontro(theirs.value, theirs.n, a.picks.size) })
    else if (a.picks.size >= 4) Object.assign(p, { genre: theirs.value, conf: 'media', sources: ['disco'], why: T.comoDisco(theirs.n, a.picks.size, p.genre), others: [p.genre] })
  }

  // misma cosa escrita distinto: solo mayúsculas, acentos o signos ("rock" y "Rock", "Rock And Roll" y "Rock & Roll");
  // "Rap" y "Hip-Hop" no, aunque sean parientes: eso lo decide cada uno
  const byRaw = new Map<string, number[]>()
  let withGenre = 0
  for (const f of files.values()) {
    if (isJunkGenre(f.genre)) continue
    withGenre++
    const g = f.genre!.trim()
    if (uses.has(g)) byRaw.set(g, [...(byRaw.get(g) ?? []), f.id])
  }
  const sameKey = new Map<string, { raw: string; n: number; tie: boolean }>()
  for (const [raw, n] of uses) {
    const k = genreKey(raw), best = sameKey.get(k)
    if (!best || n > best.n) sameKey.set(k, { raw, n, tie: false })
    else if (n === best.n) best.tie = true
  }
  const spelling: SpellingGroup[] = []
  for (const [raw] of uses) {
    const best = sameKey.get(genreKey(raw))
    if (!best || best.tie || best.raw === raw) continue
    spelling.push({ from: raw, to: best.raw, ids: byRaw.get(raw) ?? [] })
  }
  spelling.sort((a, b) => b.ids.length - a.ids.length)
  return { proposals: out.filter((p) => p.genre), spelling, empty, withGenre, handTouched }
}

/** Estilos que son de dos familias a la vez: con "Como tu biblioteca" quedan como estilo. */
const BRIDGE = new Set(['Pop Rock', 'Pop Rap', 'Latin Pop', 'Synth Pop', 'Dance Pop', 'Latin Trap', 'Rock en Español', 'Latin Jazz'])

/** Una forma prolija de escribir un género: sin palabras en minúscula ("Rock nacional") ni todo en mayúsculas ("CUMBIA"). */
const neat = (s: string) => !(s.length > 4 && s === s.toUpperCase()) && s.split(/[\s/-]+/).every((w) => w.length < 3 || !/^\p{Ll}/u.test(w))

/** El valor que tiene al menos el 70 % (y más de uno), o null. */
function majority(list: string[]): { value: string; n: number } | null {
  const c = new Map<string, number>()
  for (const v of list) c.set(v, (c.get(v) ?? 0) + 1)
  const [value, n] = [...c].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  return n >= 2 && n / list.length >= 0.7 ? { value, n } : null
}
