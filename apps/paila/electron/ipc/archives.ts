// IPC de los ZIP y RAR de la biblioteca (core/archives.ts y core/archive/): la lista, escuchar un tema (se saca solo ese a la
// caché), leer y analizar sin abrirlos enteros (proceso largo, con un worker del análisis) y "Sacar al lado" (candado,
// análisis en pausa, Historial; después escanea para que aparezca en la biblioteca). Descomprimir corre en un hilo aparte.
import path from 'node:path'
import { ipcMain, shell } from 'electron'
import { workerRunner } from '@paila/core/archive/read'
import { readArchives } from '@paila/core/archive/analyze'
import { WorkerPool } from '@paila/core/analysis/pool'
import { utilitySpawner } from '../intensity'
import type { Ctx } from '../context'
import type { ArchiveExtractPlan, ArchiveTrashPlan } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

// Nombres de las tareas y lo que dicen al terminar (se ven en la barra de tareas). Se leen al correr cada una.
const T = textos({
  leyendo: { es: 'Leyendo los temas de los ZIP y RAR', en: 'Reading the tracks inside the ZIP and RAR files' },
  leidos: {
    es: (r: number, e: number) => `${r} ${r === 1 ? 'tema leído' : 'temas leídos'}${e ? `, ${e} no se pudieron` : ''}`,
    en: (r: number, e: number) => `${r} ${r === 1 ? 'track read' : 'tracks read'}${e ? `, ${e} couldn't be read` : ''}`,
  },
  sacando: { es: 'Sacando del comprimido', en: 'Taking files out of the archive' },
  sacados: {
    es: (d: number, f: number) => `${d} ${d === 1 ? 'archivo sacado' : 'archivos sacados'}${f ? `, ${f} no se pudieron` : ''}`,
    en: (d: number, f: number) => `${d} ${d === 1 ? 'file taken out' : 'files taken out'}${f ? `, ${f} couldn't be` : ''}`,
  },
  mandando: { es: 'Mandando el comprimido a la papelera', en: 'Sending the archive to the trash' },
  mandados: {
    es: (d: number, f: number) => `${d} ${d === 1 ? 'archivo mandado' : 'archivos mandados'} a la papelera${f ? `, ${f} no se pudieron` : ''}`,
    en: (d: number, f: number) => `${d} ${d === 1 ? 'file' : 'files'} sent to the trash${f ? `, ${f} couldn't be` : ''}`,
  },
})

export function registerArchives(c: Ctx) {
  const runner = workerRunner(path.join(__dirname, 'archive-worker.js'))
  const cacheDir = path.join(c.userData, 'cache', 'comprimidos')

  ipcMain.handle('zip:list', () => c.archives.list())
  ipcMain.handle('zip:entries', (_e, id: number) => c.archives.entries(id))
  ipcMain.handle('zip:play', async (_e, entryId: number) => `paila://audio/${c.registerCandidate(await c.archives.prepare(entryId, cacheDir, runner))}`)
  ipcMain.handle('zip:read', (_e, ids: number[], again?: boolean) => c.jobs.run('comprimidos', T.leyendo, async (h) => {
    // un solo worker del análisis (en un proceso aparte, con prioridad baja): no compite con el análisis de la biblioteca
    const pool = new WorkerPool(utilitySpawner(path.join(__dirname, 'analysis-worker.js')), 1)
    try {
      return await readArchives(c.archives, ids, { ffprobe: c.ffprobe, ffmpeg: c.ffmpeg, analysis: pool, lib: runner, tmpDir: path.join(c.userData, 'cache', 'comprimidos-leer') },
        { progress: (done, total, current) => h.update({ done, total, current }), cancelled: h.cancelled }, again)
    } finally { await pool.close() }
  }, (r) => T.leidos(r.read, r.errors)))
  ipcMain.handle('zip:plan', (_e, id: number) => c.archiveExtract.plan(id))
  ipcMain.handle('zip:extract', async (_e, plan: ArchiveExtractPlan) => {
    const r = await c.jobs.run('comprimidos-sacar', T.sacando,
      (h) => c.withPaused(() => c.archiveExtract.apply(plan, { progress: (done, total, current) => h.update({ done, total, current }), cancelled: h.cancelled, runner }), h),
      (x) => T.sacados(x.done, x.failed.length))
    if (r.done) void c.scanThenAnalyze()
    return r
  })
  ipcMain.handle('zip:trash-plan', (_e, id: number) => c.archiveTrash.plan(id))
  ipcMain.handle('zip:trash', async (_e, plan: ArchiveTrashPlan) => {
    const r = await c.jobs.run('comprimidos-papelera', T.mandando, (h) => c.withPaused(async () => {
      h.update({ done: 0, total: plan.files.length, current: plan.archiveRel })
      return c.archiveTrash.apply(plan)
    }, h), (x) => T.mandados(x.done, x.failed.length))
    return r
  })
  ipcMain.handle('zip:show', (_e, id: number, folderRel?: string) => {
    const a = c.archives.list().find((x) => x.id === id)
    const root = a ? c.rootPath(a.rootId) : null
    if (!a || !root) return
    if (folderRel) void shell.openPath(path.join(root, ...folderRel.split('/')))
    else shell.showItemInFolder(path.join(root, ...a.rel.split('/')))
  })
}
