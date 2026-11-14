// "Discos completos": el proceso que busca la lista de temas oficial de cada disco (retomable: lo ya buscado queda en la
// caché), el informe para la pantalla (sin internet), la edición elegida a mano y mandar lo que falta a la lista «Faltan o suenan mal».
import type { Db } from './db'
import { albumGroups, type AlbumGroup } from './albums'
import { AlbumSources, type Edition, type Tracklist } from './albumsources'
import { decide, evaluate, pickCandidates } from './albumcheck'
import type { Wanted } from './wanted'
import type { AlbumReport, AlbumsSummary } from '@paila/shared/types'
import { ERR } from './online/http'
import { tr } from '@paila/shared/idioma'

/** Para revisar si un disco está completo hacen falta por lo menos 3 temas juntos. */
export const MIN_CHECK = 3

export class AlbumCheck {
  constructor(private db: Db, readonly sources: AlbumSources) {}

  /** Los discos que se revisan (en su carpeta o en la de su artista; nunca sueltos, sets ni sample packs). */
  groups(): { check: AlbumGroup[]; skipped: number } {
    const all = albumGroups(this.db, MIN_CHECK)
    const check = all.filter((g) => g.checkable)
    return { check, skipped: all.length - check.length }
  }

  private choices(): Map<string, string> {
    return new Map((this.db.prepare('SELECT key, choice FROM album_choice').all() as { key: string; choice: string }[]).map((r) => [r.key, r.choice]))
  }

  /** Las listas guardadas de un disco: las candidatas de MusicBrainz, y las de Discogs si se buscaron. */
  private cachedLists(g: AlbumGroup, choice: string | null): { lists: Tracklist[]; searched: boolean } {
    const mb = this.sources.cachedEditions(g.artist, g.album)
    const dz = this.sources.hasDeezer ? this.sources.cachedDeezer(g.artist, g.album) : null
    const dg = this.sources.cachedDiscogs(g.artist, g.album)
    const eds = [...pickCandidates(mb ?? [], g), ...pickCandidates(dz ?? [], g, 2), ...pickCandidates(dg ?? [], g, 3)]
    if (choice && choice !== 'ignorar') {
      const [source, id] = choice.split(':') as [Edition['source'], string]
      if (!eds.some((e) => e.source === source && e.id === id)) eds.push({ source, id } as Edition)
    }
    const lists = eds.map((e) => this.sources.cachedTracklist(e)).filter((l): l is Tracklist => !!l)
    return { lists, searched: mb != null }
  }

  /** El informe para la pantalla, con lo guardado (no pide nada a internet). */
  report(): AlbumsSummary {
    const { check, skipped } = this.groups()
    const ch = this.choices()
    const reports = check.map((g) => { const c = ch.get(g.key) ?? null; const { lists, searched } = this.cachedLists(g, c); return decide(g, lists, c, searched) })
    const order: Record<AlbumReport['status'], number> = { elegir: 0, faltan: 1, no_encontrado: 2, sin_buscar: 3, completo: 4, ignorado: 5 }
    reports.sort((a, b) => order[a.status] - order[b.status] || a.artist.localeCompare(b.artist, 'es') || a.album.localeCompare(b.album, 'es'))
    return { reports, skipped, discogs: this.sources.hasDiscogs, deezer: this.sources.hasDeezer }
  }

  /** Cuántos discos faltan buscar (para decir cuánto va a tardar). */
  pending(): number { return this.groups().check.filter((g) => this.sources.cachedEditions(g.artist, g.album) == null).length }

  /** La edición de MusicBrainz ya decidida de cada disco (para buscar su tapa en Cover Art Archive). */
  mbReleases(): Map<string, { id: string; groupId: string | null }> {
    const out = new Map<string, { id: string; groupId: string | null }>()
    for (const r of this.report().reports) {
      if (!r.edition || r.edition.source !== 'musicbrainz' || r.status === 'elegir' || r.status === 'ignorado') continue
      const l = this.sources.cachedTracklist({ source: 'musicbrainz', id: r.edition.ref.slice('musicbrainz:'.length) })
      if (l) out.set(r.key, { id: l.id, groupId: l.groupId })
    }
    return out
  }

  /**
   * Busca la lista oficial de cada disco que todavía no se buscó: MusicBrainz (las ediciones que vale la pena comparar,
   * hasta 4), Deezer (hasta 2) y, si ninguna coincide y hay clave, Discogs. Lo que se corta queda guardado y se retoma.
   */
  async run(onProgress: (p: { done: number; total: number; current: string; found: number; errors: number }) => void, isCancelled: () => boolean, opts: { retry?: boolean } = {}) {
    const { check } = this.groups()
    const fits = (g: AlbumGroup, ls: Tracklist[]) => ls.some((l) => evaluate(g, l).matched >= Math.max(2, Math.ceil(g.tracks.length * 0.6)))
    const unfinished = (g: AlbumGroup) => {
      const mb = this.sources.cachedEditions(g.artist, g.album)
      if (mb == null || pickCandidates(mb, g).some((e) => !this.sources.cachedTracklist(e))) return true
      if (this.sources.hasDeezer) { const dz = this.sources.cachedDeezer(g.artist, g.album); if (dz == null || pickCandidates(dz, g, 2).some((e) => !this.sources.cachedTracklist(e))) return true }
      return this.sources.hasDiscogs && !fits(g, this.cachedLists(g, null).lists) && this.sources.cachedDiscogs(g.artist, g.album) == null
    }
    const todo = check.filter((g) => opts.retry || unfinished(g))
    let done = 0, found = 0, errors = 0, inARow = 0
    for (const g of todo) {
      if (isCancelled()) break
      onProgress({ done, total: todo.length, current: `${g.artist} - ${g.album}`, found, errors })
      try {
        const lists: Tracklist[] = []
        for (const e of pickCandidates(await this.sources.editions(g.artist, g.album), g)) {
          if (isCancelled()) break
          lists.push(await this.sources.tracklist(e.id))
        }
        // Deezer siempre (es rápido y tiene muchos discos digitales y EPs que MusicBrainz no)
        if (this.sources.hasDeezer) for (const e of pickCandidates(await this.sources.deezerEditions(g.artist, g.album), g, 2)) {
          if (isCancelled()) break
          lists.push(await this.sources.deezerTracklist(e.id))
        }
        if (!fits(g, lists) && this.sources.hasDiscogs) {
          for (const e of pickCandidates(await this.sources.discogsEditions(g.artist, g.album), g, 3)) {
            if (isCancelled()) break
            lists.push(await this.sources.discogsTracklist(e.id))
          }
        }
        if (fits(g, lists)) found++
        inARow = 0
      } catch (e) {
        errors++; inARow++
        if (inARow >= 5) throw new Error(ERR.seCorto((e as Error).message)) // sin internet, o el servicio no responde
      }
      done++
    }
    onProgress({ done, total: todo.length, current: '', found, errors })
    return { looked: done, found, errors }
  }

  /** Elegir a mano la edición de un disco ("musicbrainz:<id>"), "ignorar" (no es un disco o no interesa), o null = que decida PAILA. */
  choose(key: string, choice: string | null) {
    if (choice == null) this.db.prepare('DELETE FROM album_choice WHERE key = ?').run(key)
    else {
      if (choice !== 'ignorar' && !/^(?:musicbrainz|deezer|discogs):[\w-]+$/.test(choice)) throw new Error(tr({ es: 'Edición desconocida', en: 'Unknown edition' }))
      this.db.prepare('INSERT INTO album_choice (key, choice, chosen_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET choice = excluded.choice, chosen_at = excluded.chosen_at')
        .run(key, choice, new Date().toISOString())
    }
  }

  /** Manda los temas que faltan de esos discos a la lista «Faltan o suenan mal» (motivo "falta del disco"). Devuelve cuántos sumó. */
  toWanted(wanted: Wanted, keys: string[]): number {
    const want = new Set(keys)
    const before = (this.db.prepare('SELECT COUNT(*) AS n FROM wanted').get() as { n: number }).n
    for (const r of this.report().reports) {
      if (!want.has(r.key) || r.status !== 'faltan') continue
      for (const m of r.missing) wanted.addMissing(m.artist || r.artist, m.title, null, r.album)
    }
    return (this.db.prepare('SELECT COUNT(*) AS n FROM wanted').get() as { n: number }).n - before
  }
}
