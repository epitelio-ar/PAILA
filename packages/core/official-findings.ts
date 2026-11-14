// Nombres oficiales a partir de la caché de internet (`online_cache`, la llena core/official-run.ts): junta lo que se sabe de
// cada tema y decide (core/official.ts). Además generaliza con cuidado: si varios temas de "Los Redondos" se confirmaron
// como "Patricio Rey y sus Redonditos de Ricota" y ninguno lo contradice, los demás temas de "Los Redondos" también.
import { createHash } from 'node:crypto'
import type { Db } from './db'
import { artistParts, isSeparator } from './artists'
import { fold, loose } from './names'
import { OnlineCache, type Source } from './online/http'
import type { ArtistHit, RecHit } from './online/hits'
import type { AcoustHit } from './online/sources'
import type { AuddResult } from './online/audd'
import { decideByAudd, decideByPrint, decideTrack, leads, relate, replaceLead, type Found, type OfficialTrack } from './official'
import { cant, textos } from '@paila/shared/idioma'

// los motivos que se ven en "para mirar a mano" (después de "Nombre oficial:" o "Internet:")
const T = textos({
  mismoArtista: {
    es: (n: number) => `es el mismo artista que en ${n} ${n === 1 ? 'tema confirmado' : 'temas confirmados'} de tu biblioteca`,
    en: (n: number) => `it is the same artist as in ${cant(n, 'confirmed track', 'confirmed tracks')} in your library`,
  },
  alias: {
    es: (first: string, name: string) => `según MusicBrainz, "${first}" es otro nombre de ${name} (no se encontró el tema para confirmarlo)`,
    en: (first: string, name: string) => `according to MusicBrainz, "${first}" is another name for ${name} (the track was not found to confirm it)`,
  },
  publicado: {
    es: (as: string, mb: string) => `como lo publica Deezer en otros temas tuyos: "${as}" (MusicBrainz lo tiene como ${mb})`,
    en: (as: string, mb: string) => `as Deezer publishes it in other tracks of yours: "${as}" (MusicBrainz has it as ${mb})`,
  },
})

/** Claves de la caché: siempre sobre el texto "suelto" (sin mayúsculas, acentos ni signos), así sirven con cualquier perfil. */
export const artistKey = (name: string) => `a:${loose(name)}`
export const recKey = (artist: string, title: string) => `r:${loose(mainArtist(artist))}|${loose(title)}`
export const printKey = (fp: string) => `f:${createHash('sha1').update(fp).digest('hex').slice(0, 20)}`
/** Clave de AudD: un tema (no hay huella que compartir: se manda su audio). */
export const auddKey = (r: { id: number; duration: number | null }) => `u:${r.id}:${Math.round(r.duration ?? 0)}`
export const mainArtist = (a: string) => artistParts(a).find((p) => !isSeparator(p))?.trim() ?? a
export const REC_SOURCES: Source[] = ['musicbrainz', 'deezer', 'discogs']

/** Un tema tal como lo ve la búsqueda de nombres (artista y título ya limpios por el asistente). */
export interface NameRow { id: number; artist: string | null; title: string | null; duration: number | null; chromaprint?: string | null; /** tiene huella acústica guardada (los que tienen nombre también se preguntan a AcoustID: de ahí se aprenden las palabras que sobran) */ hasPrint?: boolean; /** nombre del archivo (para comparar con lo reconocido por el sonido) */ file?: string }

/** Lo propuesto para cada tema (id → propuestas). Solo lee la caché: no pide nada a internet. */
export function officialFindings(db: Db, rows: NameRow[]): Map<number, Found[]> {
  const cache = new OnlineCache(db)
  // se pregunta a la base solo por lo que está guardado (con muchos temas y poco buscado, casi nada)
  for (const s of [...REC_SOURCES, 'acoustid', 'audd'] as const) cache.known(s)
  const out = new Map<number, Found[]>()
  const artistsOf = new Map<string, ArtistHit[]>()
  const artistHits = (name: string) => {
    const k = artistKey(name)
    let v = artistsOf.get(k)
    if (!v) { v = cache.lista<ArtistHit>('musicbrainz', k); artistsOf.set(k, v) }
    return v
  }
  // por artista principal ("Wisin & Yandel" o "Balvin"): qué dijeron los temas confirmados
  const byName = new Map<string, { to: Map<string, { to: string; alta: number; media: number }>; keeps: number }>()
  const entry = (lead: string) => { const k = fold(lead); let e = byName.get(k); if (!e) { e = { to: new Map(), keeps: 0 }; byName.set(k, e) } return e }
  const open: OfficialTrack[] = []
  // un artista que cambió de nombre: cómo lo publica Deezer en alguno de tus temas vale para todos los del mismo artista
  const published = new Map<string, string>(), viaAlias: { t: OfficialTrack; lead: string; mb: string }[] = []
  for (const r of rows) {
    if (!r.artist?.trim() || !r.title?.trim()) {
      if (r.chromaprint && r.duration) {
        const hits = cache.get<AcoustHit[]>('acoustid', printKey(r.chromaprint))
        if (hits?.status === 'ok' && hits.data) { const f = decideByPrint(r, hits.data); if (f.length) out.set(r.id, f) }
      }
      if (!out.has(r.id)) {
        const a = cache.get<AuddResult | null>('audd', auddKey(r))
        if (a?.status === 'ok') { const f = decideByAudd(r, a.data); if (f.length) out.set(r.id, f) }
      }
      continue
    }
    const t: OfficialTrack = { id: r.id, artist: r.artist, title: r.title, duration: r.duration }
    const recs: Partial<Record<Source, RecHit[]>> = {}
    for (const s of REC_SOURCES) { const c = cache.get<RecHit[]>(s, recKey(r.artist, r.title)); if (c?.status === 'ok' && c.data) recs[s] = c.data }
    const artists = artistHits(mainArtist(r.artist))
    const d = decideTrack(t, { artists, recs })
    if (d.found.length) out.set(r.id, d.found)
    if (d.alias?.as) published.set(loose(d.alias.mb), d.alias.as)
    // lo que Deezer devolvió buscando este artista también dice cómo lo publica, aunque el título no coincida ("Gorgeus")
    for (const h of recs.deezer ?? []) for (const c of h.credit) {
      const mb = artists.find((a) => a.source === 'musicbrainz' && a.score >= 90 && loose(a.name) !== loose(c.name) && a.aliases.some((x) => loose(x) === loose(c.name)))
      if (mb && !published.has(loose(mb.name))) published.set(loose(mb.name), c.name)
    }
    if (d.alias && !d.alias.as && d.main) viaAlias.push({ t, lead: d.main.from, mb: d.alias.mb })
    if (d.main) { const e = entry(d.main.from), x = e.to.get(loose(d.main.to)) ?? { to: d.main.to, alta: 0, media: 0 }; x[d.main.conf]++; e.to.set(loose(d.main.to), x) }
    else if (d.keeps && d.lead) entry(d.lead).keeps++
    else if (!d.confirmed) open.push(t)
  }
  for (const x of viaAlias) {
    const as = published.get(loose(x.mb))
    if (!as) continue
    const rest = (out.get(x.t.id) ?? []).filter((f) => f.field !== 'artist')
    const to = replaceLead(x.t.artist, x.lead, as)
    const f = to === x.t.artist ? rest : [...rest, { field: 'artist' as const, to, conf: 'media' as const, why: T.publicado(as, x.mb), sources: ['deezer', 'musicbrainz'] as Source[] }]
    if (f.length) out.set(x.t.id, f); else out.delete(x.t.id)
  }
  // los temas que ninguna fuente confirmó: heredan el nombre de los confirmados del mismo artista, o el alias de
  // MusicBrainz (con aviso). Si algún tema confirmó el nombre tal cual, no se hereda nada (pueden ser dos artistas).
  for (const t of open) {
    let to: string | null = null, lead = '', conf: 'alta' | 'media' = 'media', why = ''
    for (const l of leads(t.artist)) {
      const e = byName.get(fold(l))
      if (!e || e.keeps || e.to.size !== 1) { if (e) break; continue }
      const x = [...e.to.values()][0]
      to = x.to; lead = l; conf = x.alta >= 2 ? 'alta' : 'media'
      why = T.mismoArtista(x.alta + x.media)
      break
    }
    if (!to) {
      // ningún tema confirmado: solo el alias exacto de MusicBrainz, y únicamente si ningún artista se llama así de verdad
      const first = mainArtist(t.artist)
      const known = leads(t.artist).some((l) => byName.has(fold(l)))
      const hits = artistHits(first)
      const alias = hits.find((h) => h.score >= 95 && relate(first, h.name, h.aliases) === 'alias')
      // una sola palabra corta ("Morgan") es alias de demasiados: no alcanza
      const vague = !/\s/.test(first) && first.length < 8
      if (!known && !vague && alias && !hits.some((h) => relate(first, h.name) === 'same')) { to = alias.name; lead = first; why = T.alias(first, alias.name) }
    }
    if (to) to = published.get(loose(to)) ?? to // el que cambió de nombre: como lo publica Deezer
    if (!to || to === lead) continue
    const full = replaceLead(t.artist, lead, to)
    if (artistParts(full).filter((p) => !isSeparator(p)).length !== artistParts(t.artist).filter((p) => !isSeparator(p)).length) continue // no duplica ni come nombres
    out.set(t.id, [...(out.get(t.id) ?? []), { field: 'artist', to: full, conf, why, sources: ['musicbrainz'] }])
  }
  return out
}
