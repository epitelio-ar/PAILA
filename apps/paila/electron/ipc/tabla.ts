// IPC de la tabla de la biblioteca: las vistas guardadas (core/views.ts) y "A Excel": la tabla a un .csv con las columnas que
// se ven (shared/tablecsv.ts), con el separador y la coma decimal de la configuración de Windows.
import fs from 'node:fs'
import { app, dialog, ipcMain } from 'electron'
import { TRACK_FIELDS, type SavedView, type Track } from '@paila/shared/types'
import { BIG_LIBRARY } from '@paila/shared/tableview'
import { csvFormatFor, tableCsv } from '@paila/shared/tablecsv'
import type { SortKey } from '@paila/shared/trackinfo'
import { Views } from '@paila/core/views'
import type { Ctx } from '../context'
import { textos } from '@paila/shared/idioma'

/** Lo que se ve. El nombre del .csv que se propone sale de la vista ("Biblioteca" si no hay: es un nombre de archivo, no se traduce). */
const T = textos({
  nada: { es: 'No hay temas a la vista para exportar', en: 'There are no tracks in view to export' },
  guardar: { es: 'Guardar la tabla para Excel', en: 'Save the table for Excel' },
  planilla: { es: 'Planilla (CSV)', en: 'Spreadsheet (CSV)' },
})

const toTrack = (r: unknown[]) => Object.fromEntries(TRACK_FIELDS.map((f, i) => [f, r[i]])) as Track
/** Lo que no puede ir en un nombre de archivo de Windows. */
const safe = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Biblioteca'

export function registerTabla(c: Ctx) {
  const views = new Views(c.lib.db)
  ipcMain.handle('views:list', () => views.list())
  ipcMain.handle('views:save', (_e, v: Omit<SavedView, 'id'>) => views.save(v))
  ipcMain.handle('views:rename', (_e, id: string, name: string) => views.rename(id, name))
  ipcMain.handle('views:remove', (_e, id: string) => views.remove(id))

  /** Los temas a la vista (`ids`, en el orden de la tabla) a un .csv para Excel. null = se canceló. */
  ipcMain.handle('table:csv', async (_e, ids: number[], columns: { key: SortKey; label: string }[], name: string) => {
    if (!ids.length) throw new Error(T.nada)
    const r = await dialog.showSaveDialog(c.win()!, { title: T.guardar, defaultPath: `${safe(name)}.csv`, filters: [{ name: T.planilla, extensions: ['csv'] }] })
    if (r.canceled || !r.filePath) return null
    const rows = c.lib.tableCount() < BIG_LIBRARY ? c.lib.tracks() : await c.table.rows(ids)
    const byId = new Map(rows.map((x) => { const t = toTrack(x); return [t.id, t] }))
    const tracks = ids.map((id) => byId.get(id)).filter((t): t is Track => !!t)
    fs.writeFileSync(r.filePath, tableCsv(tracks, columns, csvFormatFor(app.getSystemLocale() || app.getLocale())), 'utf8')
    return { path: r.filePath, count: tracks.length }
  })
}
