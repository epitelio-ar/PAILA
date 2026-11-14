// IPC de orden y limpieza: duplicados, papelera, organizador de carpetas, espacio. Mandar a la papelera y mover se suman a la lista
// única y se aplican con todo lo demás (ipc/aplicar.ts).
import path from 'node:path'
import { ipcMain } from 'electron'
import { findDuplicates } from '@paila/core/duplicates'
import { spaceTree } from '@paila/core/space'
import { purgeTrash, trashSummary, trashUsage } from '@paila/core/purge'
import type { Ctx } from '../context'
import { registerEstado } from './estado'
import { guardarRepetidos } from '@paila/core/repetidos-guardados'
import type { OrganizeOptions } from '@paila/shared/types'
import { cant, textos } from '@paila/shared/idioma'

// Nombres de las tareas y lo que dicen al terminar (se ven en la barra de tareas). Se leen al correr cada una.
const T = textos({
  buscandoDup: { es: 'Buscando duplicados', en: 'Looking for duplicates' },
  grupos: {
    es: (g: number, v: number) => `${g} grupos de duplicados${v ? ` y ${v} de versiones` : ''}`,
    en: (g: number, v: number) => `${cant(g, 'group', 'groups')} of duplicates${v ? ` and ${v} of versions` : ''}`,
  },
  aFlac: { es: 'Pasando WAV y AIFF a FLAC', en: 'Turning WAV and AIFF into FLAC' },
  convertidos: {
    es: (c: number, gb: string, f: number) => `${c} convertidos${c ? `; liberás ${gb} GB cuando vacíes la papelera (los WAV y AIFF originales quedan ahí)` : ''}${f ? `; ${f} no se convirtieron` : ''}`,
    en: (c: number, gb: string, f: number) => `${c} converted${c ? `; you free up ${gb} GB when you empty the trash (the original WAV and AIFF files stay there)` : ''}${f ? `; ${f} weren't converted` : ''}`,
  },
})

export function registerCleanup(c: Ctx) {
  const { lib, trash, organizer, space, replacer } = c
  const estado = registerEstado(c) // el estado de la colección: Duplicados le pasa lo que encontró

  // Duplicados y papelera
  ipcMain.handle('dup:find', () => c.jobs.run('dups', T.buscandoDup,
    // lee los archivos un rato: lo que mueve archivos espera a que termine (un par movido en el medio se perdía: choques del 27/10, C7)
    (h) => lib.ops.read(T.buscandoDup, async () => {
      const g = await findDuplicates(lib.db, (id) => lib.trackPath(id), (msg, done, total) => h.update({ current: msg, ...(done != null ? { done, total } : {}) }), h.cancelled)
      h.update({ done: 0, total: 0, current: '' }) // que la barra no quede en "0 de N" al terminar
      estado.recordarRepetidos(g); guardarRepetidos(lib.db, g) // quedan en la base: salís y volvés, y siguen ahí
      return g
    }, h),
    (g) => { const v = g.filter((x) => x.level === 'version').length; return T.grupos(g.length - v, v) }))
  ipcMain.handle('trash:batches', () => trash.batches())
  ipcMain.handle('trash:items', () => trash.items())
  ipcMain.handle('trash:restore', (_e, id: number) => c.withPaused(() => trash.restore(id)))
  // Vaciar papelera: lo único que borra de verdad. Se borran solo las tandas que el usuario vio y confirmó (se recalcula acá).
  ipcMain.handle('trash:usage', () => trashUsage(lib.db, () => lib.roots()))
  // cuánto ocupa, de qué, y si conviene avisar (barra lateral, Inicio): que nadie junte GB sin darse cuenta
  ipcMain.handle('trash:summary', () => trashSummary(lib.db, () => lib.roots()))
  ipcMain.handle('trash:purge', (_e, keys: string[]) => c.withPaused(() => purgeTrash(lib.db, () => lib.roots(), keys)))

  // Organizador de carpetas: la vista previa mira los temas como van a quedar después de aplicar lo que ya está para aplicar
  // (core/organizer-futuro.ts). Lo que mueve se suma a la lista única y se aplica con todo lo demás (ipc/aplicar.ts).
  ipcMain.handle('org:plan', (_e, o: OrganizeOptions) => organizer.plan(o, true))
  ipcMain.handle('org:batches', () => organizer.batches())
  ipcMain.handle('org:undo', (_e, id: number) => c.withPaused(() => organizer.undo(id)))

  // Espacio
  ipcMain.handle('space:tree', () => spaceTree(lib.db))
  ipcMain.handle('space:junk', () => space.junk())
  ipcMain.handle('space:trash', (_e, items: { rootId: number; rel: string }[]) => c.withPaused(() => space.trashFiles(items)))
  ipcMain.handle('space:empty', (_e, items: { rootId: number; rel: string }[]) => space.empty.remove(items))
  ipcMain.handle('space:savings', () => space.savings())
  ipcMain.handle('space:dups', () => space.duplicateSavings((id) => lib.trackPath(id)))
  ipcMain.handle('space:shrink', () => c.jobs.run('shrink', T.aFlac,
    (h) => c.withPaused(() => space.wavToFlac(space.convertibles().map((x) => x.id), (id) => lib.trackPath(id), replacer, c.ffmpeg, path.join(c.userData, 'shrink'),
      (p) => h.update({ done: p.done, total: p.total, current: p.current }), h.cancelled), h),
    (r) => T.convertidos(r.converted, (r.savedBytes / 1e9).toFixed(2), r.failed.length)))
}
