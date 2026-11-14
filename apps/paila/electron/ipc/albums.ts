// IPC de la pantalla Discos: discos completos (lista de temas oficial), tapas para todo y volumen parejo (ReplayGain).
// Lo que cambia archivos solo se arma en Cambios pendientes: se aplica y se deshace desde ahí.
import { app, ipcMain } from 'electron'
import { AlbumSources } from '@paila/core/albumsources'
import { AlbumCheck } from '@paila/core/albumrun'
import { Covers } from '@paila/core/covers'
import { tapasAlDia, tapasGuardadas } from '@paila/core/covers-guardadas'
import { gainChanges, gainPlan } from '@paila/core/replaygain'
import { replacedSince } from '@paila/core/replace'
import type { GainPlan } from '@paila/shared/types'
import type { Ctx } from '../context'
import { cant, num, textos } from '@paila/shared/idioma'

// los nombres de las tareas, cómo terminaron y los avisos
const T = textos({
  names: { es: 'Buscar nombres oficiales', en: 'Search for official names' },
  mb: { es: 'Completar álbum, año y género', en: 'Fill in album, year and genre' },
  albums: { es: 'Buscar discos completos', en: 'Search for complete albums' },
  covers: { es: 'Buscar tapas', en: 'Search for covers' },
  buscandoListas: { es: 'Buscando la lista de temas de cada disco', en: 'Searching for the track list of each album' },
  revisados: {
    es: (looked: number, found: number, errors: number) => `Se revisaron ${looked} discos; ${found} con su lista oficial${errors ? ` (${errors} con error: reintentá más tarde)` : ''}`,
    en: (looked: number, found: number, errors: number) => `${cant(looked, 'album was', 'albums were')} checked; ${num(found)} with their official list${errors ? ` (${num(errors)} with an error: try again later)` : ''}`,
  },
  buscandoTapas: { es: 'Buscando tapas', en: 'Searching for covers' },
  tapasNuevas: { es: (n: number, total: number) => `Tapas nuevas para ${n} discos (de ${total})`, en: (n: number, total: number) => `New covers for ${cant(n, 'album', 'albums')} (out of ${num(total)})` },
  primeroTapas: { es: 'Primero buscá las tapas', en: 'Search for the covers first' },
  calculando: { es: 'Calculando el volumen parejo', en: 'Working out the even volume' },
  listos: { es: (n: number) => `${n} temas listos para el volumen parejo`, en: (n: number) => `${cant(n, 'track', 'tracks')} ready for even volume` },
  primeroVolumen: { es: 'Primero calculá el volumen parejo', en: 'Work out the even volume first' },
  sinTapa: { es: 'No se encontró la tapa', en: 'The cover was not found' },
})

/**
 * Las búsquedas que usan MusicBrainz (permite un pedido por segundo en total) y Discogs (60 por minuto): nunca dos a la
 * vez sobre el mismo servicio. La que llega segunda se pone en fila sola (core/jobs.ts) y lo dice en su panel.
 */
export const servicios = (discogs: boolean) => ({ uses: ['MusicBrainz', ...(discogs ? ['Discogs'] : [])] })

export function registerAlbums(c: Ctx) {
  const ua = `PAILA/${app.getVersion()} (https://github.com/epitelio-ar/PAILA)`
  // la clave de Discogs (si hay) la conoce el área de internet (electron/ipc/online.ts); se pide en cada uso
  const check = () => new AlbumCheck(c.lib.db, new AlbumSources(c.lib.db, { ua, discogs: c.onlineKeys?.().discogs ?? null, deezer: c.useDeezer?.() ?? true }))
  let covers: Covers | null = null, coversAt = ''
  let plan: GainPlan | null = null, planAt = ''

  // ---- discos completos ----
  ipcMain.handle('albums:report', () => check().report())
  ipcMain.handle('albums:pending', () => check().pending())
  ipcMain.handle('albums:run', (_e, retry: boolean) => {
    return c.jobs.run('albums', T.buscandoListas, async (h) => check().run((p) => h.update(p), h.cancelled, { retry }),
      (r) => T.revisados(r.looked, r.found, r.errors), servicios(!!c.onlineKeys?.().discogs))
  })
  ipcMain.handle('albums:choose', (_e, key: string, choice: string | null) => { check().choose(key, choice); return check().report() })
  ipcMain.handle('albums:toWanted', (_e, keys: string[]) => check().toWanted(c.wanted, keys))

  // ---- tapas ----
  const nuevas = () => new Covers(c.lib.db, c.changes, (id) => c.lib.trackPath(id), check(), { ua, useDeezer: () => c.useDeezer?.() ?? true, ffmpeg: c.ffmpeg })
  // lo encontrado la última vez sale de la base (core/covers-guardadas.ts): salís, volvés o cerrás PAILA, y sigue ahí, al día
  ipcMain.handle('covers:last', () => {
    if (!covers) { const g = tapasGuardadas(c.lib.db); if (!g) return null; covers = nuevas(); covers.last = g.props; covers.sides = g.sides; coversAt = g.at }
    return tapasAlDia(c.lib.db, covers.last, coversAt)
  })
  const buscarTapas = () => {
    const cv = nuevas(), desde = new Date().toISOString()
    // lee los archivos un rato: lo que mueve archivos espera a que termine (core/oplock.ts, choques del 27/10: C7)
    return c.jobs.run('covers', T.buscandoTapas, (h) => c.lib.ops.read(T.buscandoTapas, async () => { const r = await cv.scan((p) => h.update(p), h.cancelled); covers = cv; coversAt = desde; return r }, h),
      (r) => T.tapasNuevas(r.filter((p) => p.proposed).length, r.length), servicios(!!c.onlineKeys?.().discogs))
  }
  ipcMain.handle('covers:scan', () => buscarTapas())
  // Ordenar, con el OK de internet: busca y suma las tapas nuevas (las que esta pantalla trae tildadas)
  c.internet = { ...c.internet, tapas: async () => { const r = await buscarTapas(); return r && covers ? covers.stage(r.filter((p) => p.proposed && !p.staged && !p.puesta).map((p) => p.key)) : null } }
  ipcMain.handle('covers:stage', (_e, keys: string[]) => {
    if (!covers) { const g = tapasGuardadas(c.lib.db); if (!g) throw new Error(T.primeroTapas); covers = nuevas(); covers.last = g.props; covers.sides = g.sides; coversAt = g.at }
    return covers.stage(keys)
  })

  // ---- volumen parejo ----
  ipcMain.handle('gain:last', () => plan)
  ipcMain.handle('gain:plan', () => c.jobs.run('gain', T.calculando, (h) => c.lib.ops.read(T.calculando, async () => {
    planAt = new Date().toISOString()
    plan = await gainPlan(c.lib.db, (id) => c.lib.trackPath(id), { readCurrent: true, onProgress: (p) => h.update(p), isCancelled: h.cancelled })
    return plan
  }, h), (p) => T.listos(p.ready)))
  ipcMain.handle('gain:stage', (_e, onlyWrong?: boolean) => {
    if (!plan) throw new Error(T.primeroVolumen)
    const wrong = new Set(plan.albums.flatMap((a) => a.tracks).filter((t) => t.wrong != null).map((t) => t.id))
    // lo reemplazado (o convertido) después de calcular ya es otro audio: su volumen no vale (choques del 27/10, C6)
    const gone = replacedSince(c.lib.db, planAt)
    const items = gainChanges(plan).filter((c) => (!onlyWrong || wrong.has(c.id)) && !gone.has(c.id))
    c.changes.stageMany(items)
    return items.length
  })
}

/** Respuesta del protocolo paila://tapa/<huella>: una tapa guardada por PAILA (nunca una ruta de afuera). */
export function coverResponse(req: Request, c: Pick<Ctx, 'changes'>): Response {
  const sha = new URL(req.url).pathname.replace(/^\//, '')
  const bytes = c.changes.covers.get(sha)
  if (!bytes) return new Response(T.sinTapa, { status: 404 })
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': bytes[0] === 0x89 ? 'image/png' : 'image/jpeg', 'Cache-Control': 'max-age=31536000' } })
}
