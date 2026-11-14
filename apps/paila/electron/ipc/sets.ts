// IPC del tracklist de sets (core/setlists.ts): qué archivos son sets, escuchar uno (proceso largo), corregir a mano y
// lo que sale: texto, .cue o CSV (con diálogo), el comentario del tag (va a Cambios pendientes) y cue points para Rekordbox.
import fs from 'node:fs'
import { app, clipboard, dialog, ipcMain } from 'electron'
import { SetLists } from '@paila/core/setlists'
import { AcoustId } from '@paila/core/online/sources'
import { AudD } from '@paila/core/online/audd'
import { readComment } from '@paila/core/tagio'
import type { Ctx } from '../context'
import type { ListenOptions, SetTracklist, TrackInSet, TracklistFormat } from '@paila/shared/types'
import { cant, textos } from '@paila/shared/idioma'

// Lo que se ve. El nombre que se propone para el archivo ("… - tracklist.txt") y lo que va adentro no se traducen.
const T = textos({
  txt: { es: 'Texto con minutos', en: 'Text with minutes' },
  cue: { es: 'Hoja .cue (reproductores)', en: '.cue sheet (players)' },
  csv: { es: 'Planilla (CSV)', en: 'Spreadsheet (CSV)' },
  escuchando: { es: 'Escuchando el set', en: 'Listening to the set' },
  reconocidos: { es: (n: number) => `${n} ${n === 1 ? 'tema reconocido' : 'temas reconocidos'}`, en: (n: number) => cant(n, 'track recognized', 'tracks recognized') },
  guardar: { es: 'Guardar el tracklist', en: 'Save the tracklist' },
  sinDisco: { es: 'El disco del set no está conectado', en: "The set's drive isn't connected" },
  sinTemas: { es: 'No hay temas para poner en el tag', en: 'There are no tracks to put in the tag' },
})

const EXT: Record<TracklistFormat, { ext: string; name: () => string }> = {
  txt: { ext: 'txt', name: () => T.txt }, cue: { ext: 'cue', name: () => T.cue }, csv: { ext: 'csv', name: () => T.csv },
}

export function registerSets(c: Ctx) {
  const sets = new SetLists(c.lib.db, (id) => c.lib.trackPath(id), c.ffmpeg)
  const ua = `PAILA/${app.getVersion()} (https://github.com/epitelio-ar/PAILA)`
  const withCues = (t: SetTracklist | null) => (t ? { ...t, cues: sets.cuesSaved(t.fileId) } : null)
  const recognizers = () => {
    const k = c.onlineKeys?.() ?? {}
    return { acoustid: k.acoustid ? new AcoustId(k.acoustid, ua) : null, audd: k.audd ? new AudD(k.audd, ua) : null }
  }

  ipcMain.handle('sets:list', () => sets.candidates())
  ipcMain.handle('sets:get', (_e, id: number) => withCues(sets.saved(id)))
  ipcMain.handle('sets:internet', () => { const k = c.onlineKeys?.() ?? {}; return { acoustid: !!k.acoustid, audd: !!k.audd } })
  ipcMain.handle('sets:listen', (_e, id: number, opts: ListenOptions) => c.jobs.run('tracklist', T.escuchando,
    async (h) => withCues(await sets.listen(id, { ...opts, recognizers: opts.internet ? recognizers() : undefined, onProgress: (p) => h.update(p), isCancelled: h.cancelled })),
    (t) => { const n = t?.entries.filter((e) => e.source && e.confidence !== 'baja').length ?? 0; return T.reconocidos(n) }))
  ipcMain.handle('sets:edit', (_e, id: number, entries: TrackInSet[]) => withCues(sets.edit(id, entries)))
  ipcMain.handle('sets:copy', (_e, id: number) => { const t = sets.export(id, 'txt'); clipboard.writeText(t); return t.trim().split('\n').filter(Boolean).length })
  ipcMain.handle('sets:save', async (_e, id: number, format: TracklistFormat) => {
    const t = sets.saved(id)
    if (!t) return null
    const base = t.rel.split('/').pop()!.replace(/\.[^.]+$/, '')
    const r = await dialog.showSaveDialog(c.win()!, { title: T.guardar, defaultPath: `${base} - tracklist.${EXT[format].ext}`, filters: [{ name: EXT[format].name(), extensions: [EXT[format].ext] }] })
    if (r.canceled || !r.filePath) return null
    // la hoja .cue va en UTF-8 con BOM (así la leen bien foobar2000 y VLC con acentos); el CSV también (Excel)
    fs.writeFileSync(r.filePath, (format === 'txt' ? '' : '﻿') + sets.export(id, format), 'utf8')
    return r.filePath
  })
  // el tracklist al comentario del tag del set: va a Cambios pendientes (se ve antes → después, se aplica y se deshace)
  ipcMain.handle('sets:stageTag', (_e, id: number) => {
    const p = c.lib.trackPath(id)
    if (!p || !fs.existsSync(p)) throw new Error(T.sinDisco)
    const value = sets.commentFor(id, readComment(p))
    if (!value) throw new Error(T.sinTemas)
    c.changes.stage([id], 'comment', value)
    return 1
  })
  ipcMain.handle('sets:cues', (_e, id: number, on: boolean) => (on ? sets.saveCues(id) : sets.clearCues(id)))
}
