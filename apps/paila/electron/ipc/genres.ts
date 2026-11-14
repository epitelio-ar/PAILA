// IPC de "Géneros desde internet" (MASTERPLAN-3, punto 4): estado y búsqueda en Discogs y Last.fm (proceso largo
// "genres"), las propuestas y mandarlas a Cambios pendientes. Las claves las conoce electron/ipc/online.ts (c.onlineKeys).
import { app, ipcMain } from 'electron'
import type { GenreLevel, GenresStatus } from '@paila/shared/types'
import { cleanedRows } from '@paila/core/official-run'
import type { NameRow } from '@paila/core/official-findings'
import { GenreSearch } from '@paila/core/genres-run'
import { genreReport } from '@paila/core/genres-find'
import { rulesOf, type TidyRule } from '@paila/shared/tidy-profiles'
import type { Ctx } from '../context'
import { avisarClaves } from '../chequeo'
import { cant, textos } from '@paila/shared/idioma'

// los avisos, el nombre de la tarea y cómo terminó (los géneros mismos no se traducen)
const T = textos({
  faltaClave: { es: 'Hace falta la clave de Discogs o la de Last.fm (Configuración → Servicios de internet)', en: 'You need the Discogs key or the Last.fm key (Settings → Internet services)' },
  buscando: { es: 'Buscando géneros', en: 'Searching for genres' },
  aviso: { es: 'aviso', en: 'warning' },
  hechas: {
    es: (n: number, found: number) => `Se hicieron ${n} búsquedas; ${found} temas con resultados. Las propuestas están abajo, para revisarlas`,
    en: (n: number, found: number) => `${cant(n, 'search was', 'searches were')} made; ${cant(found, 'track', 'tracks')} with results. The suggestions are below, for you to review`,
  },
})

export function registerGenres(c: Ctx) {
  const ua = `PAILA/${app.getVersion()} (https://github.com/epitelio-ar/PAILA)`
  const keys = () => { const k = c.onlineKeys?.(); return { discogs: k?.discogs ?? null, lastfm: k?.lastfm ?? null } }
  const search = new GenreSearch(c.lib.db, { ua, keys })
  // los temas como los deja el asistente (las mismas búsquedas que "nombres oficiales": lo de Discogs no se pide dos veces)
  let memo: { at: number; rows: NameRow[] } | null = null
  const savedRules = (): TidyRule[] => { try { const v = c.setting('tidy.reglas'); return v ? JSON.parse(v) as TidyRule[] : rulesOf('oficial') } catch { return rulesOf('oficial') } }
  const rows = () => {
    if (!memo || Date.now() - memo.at > 60_000) memo = { at: Date.now(), rows: cleanedRows(c.lib.db, savedRules()) }
    return memo.rows
  }

  ipcMain.handle('genres:status', (): GenresStatus => {
    const t = search.todo(rows()), k = keys()
    // Discogs: 60 pedidos por minuto; Last.fm: unos 3 por segundo
    return { tracks: t.tracks, left: { discogs: t.discogs, lastfm: t.lastfm }, keys: { discogs: !!k.discogs, lastfm: !!k.lastfm }, minutes: Math.ceil(Math.max(t.discogs * 1.1, t.lastfm * 0.35) / 60) }
  })
  ipcMain.handle('genres:run', (_e, retry: boolean) => {
    if (!keys().discogs && !keys().lastfm) throw new Error(T.faltaClave)
    return c.jobs.run('genres', T.buscando, async (h) => {
      if (retry) search.forgetErrors()
      memo = null
      const r = await search.run(rows(), (p) => h.update({ done: p.done, total: p.total, current: p.current, found: p.found }), h.cancelled)
      const stopped = Object.values(r.bySource).filter((v) => v?.stopped).map((v) => v!.stopped!)
      if (stopped.length) h.update({ problems: stopped.map((m) => ({ name: T.aviso, error: m })) })
      avisarClaves(c, r.bySource)
      return r
    // Discogs permite 60 pedidos por minuto: con otra búsqueda que lo usa (nombres, discos), espera en fila
    }, (r) => T.hechas(r.done, r.found), { uses: keys().discogs ? ['Discogs'] : [] })
  })
  ipcMain.handle('genres:report', (_e, level: GenreLevel) => genreReport(c.lib.db, rows(), level))
  ipcMain.handle('genres:stage', (_e, ids: number[], level: GenreLevel, spelling: string[]) => {
    // se recalcula acá (no se confía en lo que manda la pantalla) y solo se proponen los temas pedidos
    const rep = genreReport(c.lib.db, rows(), level)
    const want = new Set(ids), from = new Set(spelling)
    const items = [
      ...rep.proposals.filter((p) => want.has(p.fileId)).map((p) => ({ id: p.fileId, field: 'genre' as const, value: p.genre, source: 'generos' as const })),
      // unificar cómo se escribe un género es una regla automática (core/confianza.ts)
      ...rep.spelling.filter((s) => from.has(s.from)).flatMap((s) => s.ids.map((id) => ({ id, field: 'genre' as const, value: s.to, source: 'reglas' as const }))),
    ]
    const r = c.changes.stageMany(items)
    return { staged: r.staged, held: r.held }
  })
}
