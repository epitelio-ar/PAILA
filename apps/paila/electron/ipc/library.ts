// IPC de la biblioteca: carpetas, escaneo, tabla de temas, análisis, reproductor.
import path from 'node:path'
import { dialog, ipcMain, shell } from 'electron'
import { TRACK_FIELDS, type AppState, type CollectionKind, type Intensity, type TrackExtras } from '@paila/shared/types'
import { BIG_LIBRARY, type TableQuery } from '@paila/shared/tableview'
import { DJ_TOOLS_OFFERED, DJ_TOOLS_SETTING, LEGACY_USE_PROFILE, USE_PROFILE_ASKED, djOfferReasons, resolveDjTools } from '@paila/shared/profile'
import { djSignals } from '@paila/core/djsignals'
import { collectionStats } from '@paila/core/colstats'
import { albumQueue } from '@paila/core/playerqueue'
import { recentAlbums } from '@paila/core/inicio'
import { analyzeFolder } from '@paila/core/collections'
import { vinylOf } from '@paila/core/tidy'
import { artistCountry, countryName } from '@paila/core/artistcountry'
import { OnlineCache } from '@paila/core/online/http'
import { labelOf, serialOf } from '@paila/core/volumes'
import { coverThumb, spectrogram, waveform } from '../media'
import type { Ctx } from '../context'
import { fueraDeLaPrueba } from '@paila/core/prueba'
import { textos } from '@paila/shared/idioma'

const T = textos({
  sinFfmpeg: { es: 'No se encontró ffmpeg/ffprobe. Reinstalá PAILA.', en: "Couldn't find ffmpeg/ffprobe. Reinstall PAILA." },
  elegiCarpeta: { es: 'Elegí la carpeta de tu música', en: 'Choose your music folder' },
  soloPrueba: { es: 'En la prueba se usa solo la música de la prueba: esa carpeta queda afuera.', en: 'In the test only the test music is used: that folder stays out.' },
  ocupada: { es: (what: string) => `No se puede escanear ahora: PAILA está ${what}. Esperá a que termine.`, en: (what: string) => `Can't scan right now: PAILA is ${what}. Wait for it to finish.` },
})

export function registerLibrary(c: Ctx) {
  const { lib } = c
  const state = (): AppState => ({
    roots: lib.roots(),
    scan: lib.status,
    tools: { ffprobe: c.ffprobe, ffmpeg: c.ffmpeg, error: c.ffprobe && c.ffmpeg ? null : T.sinFfmpeg },
    trackCount: lib.trackCount(),
  })

  ipcMain.handle('state', () => state())
  ipcMain.handle('pickFolder', async () => {
    const r = await dialog.showOpenDialog(c.win()!, { title: T.elegiCarpeta, properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('analyzeFolder', async (_e, p: string) => {
    const [res, label] = await Promise.all([analyzeFolder(p), labelOf(p)])
    const inside = (r: string) => { const x = path.relative(path.resolve(p), path.resolve(r)); return !!x && !x.startsWith('..') && !path.isAbsolute(x) }
    const joins = lib.roots().filter((r) => r.available && inside(r.path)).map((r) => r.path)
    return { path: p, volumeLabel: label, volumeSerial: serialOf(p), ...res, joins }
  })
  ipcMain.handle('addRoot', (_e, p: string, rules: { rel: string; kind: CollectionKind }[]) => {
    if (fueraDeLaPrueba(process.env.PAILA_PRUEBA, p)) throw new Error(T.soloPrueba)
    return lib.addRoot(p, rules)
  })
  ipcMain.handle('removeRoot', (_e, id: number) => lib.removeRoot(id))
  ipcMain.handle('setRule', (_e, id: number, rel: string, kind: CollectionKind) => lib.setRule(id, rel, kind))
  // Biblioteca chica: todos los temas a la interfaz (filtra y ordena ella). Grande: los temas quedan en el hilo de la tabla
  // y la interfaz pide el orden y las filas que se ven (ver core/tableindex.ts).
  ipcMain.handle('tracks', async () => {
    if (lib.tableCount() < BIG_LIBRARY) { void c.table.close(); return { fields: TRACK_FIELDS, rows: lib.tracks() } }
    return { fields: TRACK_FIELDS, rows: null, big: await c.table.load() }
  })
  ipcMain.handle('table:query', (_e, q: TableQuery, from: number) => c.table.query(q, from))
  ipcMain.handle('table:rows', (_e, ids: number[]) => c.table.rows(ids))

  ipcMain.handle('scan:start', async () => {
    // antes de mirar los discos: si volvió uno con algo a medias, se termina primero (así el escaneo no lo ve a medio mover)
    await c.recoveryCheck()
    // si otra operación tiene el candado, se avisa en vez de no hacer nada
    if (lib.ops.busy) return T.ocupada(lib.ops.busy)
    c.scanThenAnalyze()
    return null
  })
  ipcMain.handle('scan:pause', () => lib.pause())
  ipcMain.handle('scan:resume', () => lib.resume())
  ipcMain.handle('scan:cancel', () => lib.stop())

  ipcMain.handle('jobs:list', () => c.jobs.list())
  ipcMain.handle('jobs:cancel', (_e, kind: string) => c.jobs.cancelRequest(kind))
  ipcMain.handle('jobs:dismiss', (_e, kind: string) => c.jobs.dismiss(kind))
  ipcMain.handle('reveal', (_e, id: number) => { const p = lib.trackPath(id); if (p) shell.showItemInFolder(p) })
  ipcMain.handle('analysis', (_e, id: number) => lib.getAnalysis(id))
  ipcMain.handle('track:extras', (_e, id: number): TrackExtras => {
    const side = vinylOf(lib.db, id)
    const artist = (lib.db.prepare('SELECT artist FROM files WHERE id = ?').get(id) as { artist: string | null } | undefined)?.artist
    const code = artist?.trim() ? artistCountry(new OnlineCache(lib.db), artist) : null
    return { vinyl: side === undefined ? null : { side }, country: code ? countryName(code) : null }
  })
  ipcMain.handle('insights', () => lib.insights())
  // "Herramientas para DJ y producción": apagadas de fábrica; quien había elegido DJ o producción las tiene prendidas (se pasa una vez)
  const djToolsNow = () => resolveDjTools(c.setting(DJ_TOOLS_SETTING), c.setting(LEGACY_USE_PROFILE), c.setting(USE_PROFILE_ASKED))
  ipcMain.handle('profile:get', () => {
    const on = djToolsNow()
    if (c.setting(DJ_TOOLS_SETTING) == null) c.setSetting(DJ_TOOLS_SETTING, on ? '1' : '0')
    return on
  })
  ipcMain.handle('profile:set', (_e, on: boolean) => {
    c.setSetting(DJ_TOOLS_SETTING, on ? '1' : '0')
    if (!c.setting(DJ_TOOLS_OFFERED)) c.setSetting(DJ_TOOLS_OFFERED, new Date().toISOString()) // si lo decidió a mano, no se le ofrece
    return on
  })
  // se ofrece una sola vez, si están apagadas y parece que pincha
  ipcMain.handle('profile:offer', () => {
    if (c.setting(DJ_TOOLS_OFFERED) || djToolsNow()) return null
    const why = djOfferReasons(djSignals(lib.db))
    return why.length ? why : null
  })
  ipcMain.handle('profile:offered', () => { c.setSetting(DJ_TOOLS_OFFERED, new Date().toISOString()) })
  ipcMain.handle('player:tracks', (_e, ids: number[]) => ids.slice(0, 500).flatMap((id) => lib.tracks(id)))
  ipcMain.handle('player:album', (_e, id: number) => albumQueue(lib.db, id))
  ipcMain.handle('stats:collection', () => collectionStats(lib.db))
  ipcMain.handle('intensity:get', () => c.intensity.info())
  ipcMain.handle('intensity:set', (_e, m: Intensity) => c.intensity.set(m))
  ipcMain.handle('spectrogram', async (_e, id: number) => {
    const f = lib.trackFile(id)
    if (!f) return null
    const dur = (lib.db.prepare('SELECT duration FROM files WHERE id = ?').get(id) as { duration: number | null } | undefined)?.duration
    try { return await spectrogram(c.ffmpeg, path.join(c.userData, 'espectro'), id, f, false, dur) } catch { return null }
  })
  ipcMain.handle('home:recentAlbums', (_e, limit: number) => recentAlbums(lib.db, limit))
  ipcMain.handle('cover:thumb', async (_e, id: number) => {
    const f = lib.trackFile(id)
    if (!f) return null
    try { return await coverThumb(c.ffmpeg, path.join(c.userData, 'tapas'), id, f) } catch { return null }
  })
  ipcMain.handle('waveform', async (_e, id: number) => {
    const f = lib.trackFile(id)
    if (!f) return null
    try { return await waveform(c.ffmpeg, path.join(c.userData, 'onda'), id, f) } catch { return null }
  })
  ipcMain.handle('audioUrl', (_e, id: number) => `paila://audio/${id}`)
}
