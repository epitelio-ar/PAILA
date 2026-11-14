// IPC de Rekordbox y cabina: equipos, compatibilidad, exportar e importar rekordbox.xml, marcadores de Serato, grilla y
// cues (con el motor de electron/gridengine.ts), armado de set y qué temas ya se exportaron.
import path from 'node:path'
import { dialog, ipcMain } from 'electron'
import { DEVICES } from '@paila/core/rekordbox'
import { convertForDj, djUnreadable, type DjTarget } from '@paila/core/convert'
import type { Ctx } from '../context'
import type { BpmStyle, RekordboxExportOptions } from '@paila/shared/types'
import { gridPass, gridPlan } from '@paila/core/gridrun'
import { diskReason, waitUntil } from '@paila/core/readguard'
import { SetBuilder, combinan } from '@paila/core/setbuilder'
import { GridEngine, MODELS_SETTING, gridWorkerScript, modelsFolder } from '../gridengine'
import { BPM_STYLES_SETTING, applyBpmStyles, bpmStyles } from '@paila/core/reanalysis'
import { DEFAULT_STYLES, parseStyles } from '@paila/core/analysis/bpmrange'
import { cant, num, textos } from '@paila/shared/idioma'

const T = textos({
  elegirXml: { es: 'Elegí el rekordbox.xml que exportaste de Rekordbox', en: 'Choose the rekordbox.xml you exported from Rekordbox' },
  elegirModelos: { es: 'Elegí la carpeta de modelos (la que tiene beat-this y npm)', en: 'Choose the models folder (the one with beat-this and npm)' },
  // dice qué lista: en la pantalla, con una tanda en marcha, es lo único que queda arriba (no la estimación de otra lista)
  grilla: { es: (lista: string | null) => (lista ? `Calculando grilla y cues: ${lista}` : 'Calculando grilla y cues de toda la Música'), en: (lista: string | null) => (lista ? `Working out the grid and cues: ${lista}` : 'Working out the grid and cues for all the Music') },
  esperandoDisco: { es: 'Esperando que vuelva el disco…', en: 'Waiting for the drive to come back…' },
  grillaListo: {
    es: (n: number, min: number, fallados: number) => `${cant(n, 'tema', 'temas')} con grilla en ${min} min${fallados ? `; ${fallados} sin grilla (sin pulso parejo o el disco no está)` : ''}`,
    en: (n: number, min: number, fallados: number) => `${cant(n, 'track', 'tracks')} with a grid in ${min} min${fallados ? `; ${num(fallados)} without a grid (no steady beat, or the drive isn't there)` : ''}`,
  },
  revisarCompat: { es: (equipo: string) => `Revisar compatibilidad: ${equipo}`, en: (equipo: string) => `Check compatibility: ${equipo}` },
  guardarXml: { es: 'Guardar rekordbox.xml', en: 'Save rekordbox.xml' },
  exportandoXml: { es: 'exportando el rekordbox.xml', en: 'exporting the rekordbox.xml' },
  rangoMal: { es: 'Algún rango no es válido: el BPM mínimo tiene que estar entre 40 y 200.', en: 'One of the ranges isn\'t valid: the lowest BPM has to be between 40 and 200.' },
  convirtiendo: { es: 'Convirtiendo para Rekordbox', en: 'Converting for Rekordbox' },
  convertidos: {
    es: (n: number, gb: number, fallados: number) => `${n} convertidos${n ? `; los originales quedan en la papelera: liberás ${gb.toFixed(2)} GB cuando la vacíes` : ''}${fallados ? `; ${fallados} no se convirtieron` : ''}`,
    en: (n: number, gb: number, fallados: number) => `${num(n)} converted${n ? `; the originals stay in the Trash: you free up ${num(gb, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB when you empty it` : ''}${fallados ? `; ${num(fallados)} couldn't be converted` : ''}`,
  },
})

/** Registra los pedidos y devuelve el motor de la grilla (main.ts le pasa `paila://modelo/…` y lo cierra al salir). */
export function registerDj(c: Ctx, workerDir: string): GridEngine {
  const { rekordbox, playlists } = c
  const dj = rekordbox.dj
  const sets = new SetBuilder(c.lib.db)
  const engine = new GridEngine(gridWorkerScript(workerDir), c.ffmpeg, () => modelsFolder(c.setting(MODELS_SETTING)))
  const idsOf = (playlistId: number | null) => (playlistId == null ? null : playlists.trackIds(playlistId))
  ipcMain.handle('rb:import', async () => {
    const r = await dialog.showOpenDialog(c.win()!, { title: T.elegirXml, filters: [{ name: 'Rekordbox XML', extensions: ['xml'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    return dj.importRekordbox(r.filePaths[0])
  })
  ipcMain.handle('rb:serato', () => dj.importSerato())
  ipcMain.handle('grid:engine', (_e, probe: boolean) => engine.info(probe))
  ipcMain.handle('grid:skip', () => engine.skip())
  ipcMain.handle('grid:models', async () => {
    const r = await dialog.showOpenDialog(c.win()!, { title: T.elegirModelos, properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    c.setSetting(MODELS_SETTING, r.filePaths[0])
    engine.gpu.failure = null
    return engine.info(true)
  })
  ipcMain.handle('grid:plan', async (_e, playlistId: number | null, force: boolean, theirs = false) => {
    await engine.info(true)
    const { todo: _todo, ...plan } = gridPlan(c.lib.db, dj, idsOf(playlistId), engine.kind(), force, theirs)
    return plan
  })
  ipcMain.handle('grid:run', (_e, playlistId: number | null, force: boolean, theirs = false) => {
    const label = T.grilla(playlistId == null ? null : (c.lib.db.prepare('SELECT name FROM playlists WHERE id = ?').get(playlistId) as { name: string } | undefined)?.name ?? null)
    return c.jobs.run('grid', label, async (h) => {
      await engine.info(true)
      const kind = engine.kind()
      const plan = gridPlan(c.lib.db, dj, idsOf(playlistId), kind, force, theirs)
      h.update({ total: plan.todo.length })
      // No escribe archivos, pero los lee un buen rato: lo que mueve archivos espera a que termine (y si algo se está moviendo,
      // espera ella; core/oplock.ts). Pausa el análisis mientras dura para no pelearse por el procesador, y lo prende recién
      // cuando terminaron todos los que lo pausaron: antes lo prendía en medio de un Organizar (choques del 27/10, C7).
      return c.lib.ops.read(label, async () => {
        const release = c.lib.hold('grilla')
        engine.active = true
        // si se desconecta el disco, espera a que vuelva (con el aviso) en vez de dar por fallados los temas que siguen
        const rootOf = (id: number) => (c.lib.db.prepare('SELECT root_id FROM files WHERE id = ?').get(id) as { root_id: number } | undefined)?.root_id
        const here = (id: number) => { const r = rootOf(id); return r != null && c.rootPath(r) != null }
        const disk = {
          ok: here,
          wait: (id: number) => {
            const r = c.lib.roots().find((x) => x.id === rootOf(id))
            h.update({ current: r ? diskReason(r.path, r.volumeLabel, false, true) : T.esperandoDisco })
            return waitUntil(() => here(id), h.cancelled)
          },
        }
        const r = await gridPass(c.lib.db, dj, plan.todo, (id) => c.lib.trackPath(id), (file) => engine.run(file, kind),
          (p) => h.update({ done: p.done, total: p.total, current: p.current }), h.cancelled, disk).finally(() => {
          engine.active = false
          release()
          // si quedó algo por analizar (o se quiso arrancar mientras tanto), sigue solo, salvo que otro lo tenga en pausa
          if (!c.lib.status.running && !c.lib.held) c.analyze().catch(() => null)
        })
        return { done: r.done, failed: r.failed.length, seconds: Math.round(r.ms / 1000), stages: r.stages }
      }, h)
    }, (r) => T.grillaListo(r.done, Math.round(r.seconds / 60), r.failed))
  })
  ipcMain.handle('set:curve', (_e, playlistId: number) => sets.curve(playlists.trackIds(playlistId)))
  ipcMain.handle('set:combinan', (_e, id: number) => combinan(c.lib.db, id))
  ipcMain.handle('set:next', (_e, fromId: number, playlistId: number | null, energy: number) => {
    const inList = playlistId == null ? [] : playlists.trackIds(playlistId)
    return sets.next(fromId, { playlistIds: inList, energy })
  })
  ipcMain.handle('rb:devices', () => DEVICES)
  ipcMain.handle('rb:compat', (_e, d: string) => rekordbox.compatibility(d))
  ipcMain.handle('rb:compatPlaylist', (_e, d: string) => {
    const r = rekordbox.compatibility(d)
    const id = playlists.create(T.revisarCompat(r.device.label.split(' / ')[0]).slice(0, 60), 'list')
    playlists.addTracks(id, r.issues.map((i) => i.fileId))
    return r.issues.length
  })
  ipcMain.handle('rb:export', async (_e, scope: 'todo' | 'playlists', ids: number[], opts?: RekordboxExportOptions) => {
    const r = await dialog.showSaveDialog(c.win()!, { title: T.guardarXml, defaultPath: 'rekordbox.xml', filters: [{ name: 'Rekordbox XML', extensions: ['xml'] }] })
    if (r.canceled || !r.filePath) return null
    const dest = r.filePath
    // escribe por el motor (ops/copy.ts): va con el candado de operaciones
    return c.lib.ops.run(T.exportandoXml, () => rekordbox.export({ scope, playlistIds: ids, dest, grid: opts?.grid ?? true, suggestedCues: opts?.suggestedCues ?? false, pailaWhenMoving: opts?.pailaWhenMoving ?? false }))
  })
  ipcMain.handle('rb:in', (_e, ids: number[]) => [...rekordbox.exportedIds(ids)])
  ipcMain.handle('dj:unreadable', () => djUnreadable(c.lib.db))
  ipcMain.handle('dj:bpmStyles', () => {
    const custom = !!c.lib.db.prepare('SELECT 1 FROM settings WHERE key = ?').get(BPM_STYLES_SETTING)
    return { styles: bpmStyles(c.lib.db), custom }
  })
  ipcMain.handle('dj:setBpmStyles', (_e, styles: BpmStyle[] | null) => {
    if (styles == null) c.lib.db.prepare('DELETE FROM settings WHERE key = ?').run(BPM_STYLES_SETTING)
    else {
      const json = JSON.stringify(styles)
      // parseStyles devuelve los de fábrica cuando algo está mal: no se guarda
      if (parseStyles(json) === DEFAULT_STYLES) throw new Error(T.rangoMal)
      c.setSetting(BPM_STYLES_SETTING, json)
    }
    return applyBpmStyles(c.lib.db)
  })
  ipcMain.handle('dj:convert', (_e, target: DjTarget) => c.jobs.run('djconvert', T.convirtiendo,
    (h) => c.withPaused(() => convertForDj(c.lib.db, djUnreadable(c.lib.db).map((u) => u.id), target, (id) => c.lib.trackPath(id), c.replacer, c.ffmpeg, c.ffprobe,
      path.join(c.userData, 'convert'), (p) => h.update({ done: p.done, total: p.total, current: p.current }), h.cancelled), h),
    (r) => T.convertidos(r.converted, r.trashedBytes / 1e9, r.failed.length)))
  return engine
}
