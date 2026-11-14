// IPC de recortar silencios (core/trim.ts): buscar dónde cortar (proceso 'recortar': solo lee los archivos) y pasar lo elegido
// a Cambios pendientes. Aplicar va por Cambios pendientes, que recorta con el Reemplazo (Changes.trimmer, puesto acá).
import path from 'node:path'
import { ipcMain } from 'electron'
import type { Ctx } from '../context'
import type { TrimPlan } from '@paila/shared/types'
import { applyTrim, planTrims, trimValue } from '@paila/core/trim'
import { replacedSince } from '@paila/core/replace'
import { paraAplicar } from '@paila/core/aplicar'
import { cant, textos } from '@paila/shared/idioma'

const T = textos({
  buscando: { es: 'Buscando dónde cortar los silencios', en: 'Finding where to trim the silences' },
  listos: { es: (n: number) => `${cant(n, 'tema', 'temas')} para recortar`, en: (n: number) => `${cant(n, 'track', 'tracks')} to trim` },
})

export function registerRecortar(c: Ctx) {
  const db = c.lib.db
  const pathOf = (id: number) => c.lib.trackPath(id)
  // el archivo recortado se arma en la carpeta de datos, se verifica y recién ahí reemplaza al tema
  c.changes.trimmer = (id, value, batch) => applyTrim(db, c.replacer, pathOf, c.ffmpeg, path.join(c.userData, 'recortes'), id, value, batch)
  let last: TrimPlan | null = null, lastAt = ''
  ipcMain.handle('recortar:buscar', () => c.jobs.run('recortar', T.buscando, (h) => c.lib.ops.read(T.buscando, async () => {
    lastAt = new Date().toISOString()
    last = await planTrims(db, pathOf, c.ffmpeg, { onProgress: (done, total, rel) => h.update({ done, total, current: rel }), isCancelled: h.cancelled })
    return last
  }, h), (p) => T.listos(p.items.length)))
  ipcMain.handle('recortar:ultimo', () => last)
  ipcMain.handle('recortar:pasar', (_e, ids: number[]) => {
    // lo reemplazado (o convertido) después de buscar ya es otro audio: su recorte no vale (choques del 27/10, C6)
    const gone = replacedSince(db, lastAt)
    const want = new Set(ids.filter((id) => !gone.has(id)))
    c.changes.stageMany((last?.items ?? []).filter((p) => want.has(p.fileId)).map((p) => ({ id: p.fileId, field: 'trim' as const, value: trimValue(p) })))
    return paraAplicar(db, c.changes)
  })
}
