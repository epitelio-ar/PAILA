// IPC del Aplicar único (MASTERPLAN-5, etapa 2; core/aplicar.ts y core/propuestas.ts): la lista de lo que vas a aplicar (cambios de
// tags y tapas, papelera y mover), sumarle repetidos o lo de Organizar, descartar y aplicar todo en orden. Lo registra ipc/tags.ts.
import { ipcMain } from 'electron'
import { aplicarTodo, descartar, paraAplicar } from '@paila/core/aplicar'
import { proponerMover, proponerPapelera, sacarPropuestas } from '@paila/core/propuestas'
import { repetidosAlDia } from '@paila/core/repetidos-guardados'
import { guardarRegla } from '@paila/core/estado-dejar'
import type { OrganizeOptions } from '@paila/shared/types'
import type { Ctx } from '../context'
import { cant, textos } from '@paila/shared/idioma'

const T = textos({
  aplicando: { es: 'Aplicando', en: 'Applying' },
  aplicados: {
    es: (n: number, fallaron: number) => `${cant(n, 'cambio aplicado', 'cambios aplicados')}${fallaron ? `, ${cant(fallaron, 'no se pudo', 'no se pudieron')}` : ''}`,
    en: (n: number, fallaron: number) => `${cant(n, 'change', 'changes')} applied${fallaron ? `, ${cant(fallaron, "couldn't be done", "couldn't be done")}` : ''}`,
  },
})

export function registerAplicar(c: Ctx) {
  const { lib, changes } = c
  const db = lib.db
  ipcMain.handle('changes:list', () => paraAplicar(db, changes))
  ipcMain.handle('changes:discard', (_e, ids?: number[]) => { descartar(db, changes, ids); return paraAplicar(db, changes) })
  // un solo Aplicar: papelera → nombres y tags → mover → tapas → reemplazos (Sonido), con el análisis en pausa y el candado de operaciones tomado
  ipcMain.handle('changes:apply', (_e, ids?: number[]) => c.jobs.run('apply', T.aplicando,
    async (h) => {
      const r = await c.withPaused(() => aplicarTodo({ db, changes, trash: c.trash, organizer: c.organizer, reemplazar: c.reemplazar }, { ids, onProgress: (p) => h.update(p), isCancelled: h.cancelled }), h)
      h.update({ errors: r.failed.length, problems: r.failed.map((f) => ({ name: f.rel, error: f.error })) })
      return r
    },
    (r) => T.aplicados(r.applied, r.failed.length)))

  // Duplicados: lo último encontrado (sin buscar de nuevo) y sumar a la lista las copias que sobran de cada grupo
  ipcMain.handle('dup:ultimo', () => repetidosAlDia(db))
  ipcMain.handle('propuestas:repetidos', (_e, items: [number, number | null][], grupo: number[]) => {
    proponerPapelera(db, items.map(([id, kept]) => ({ id, kept })), 'Duplicados', grupo) // idioma-ok: el motivo de la tanda
    return paraAplicar(db, changes)
  })
  // Organizar: lo que mueve la regla (sobre cómo van a quedar los temas). Los que chocan con otro solo entran si aceptaste el "(2)".
  ipcMain.handle('propuestas:mover', (_e, o: OrganizeOptions, conChoques: boolean) => {
    const plan = c.organizer.plan(o, true)
    const choque = new Map((plan.clashes ?? []).map((x) => [x.fileId, x.with]))
    guardarRegla(db, o) // al aplicar, el lugar se vuelve a calcular con esta regla
    sacarPropuestas(db, { tipo: 'mover' })
    proponerMover(db, plan.moves.filter((m) => conChoques || !choque.has(m.fileId)).map((m) => ({ ...m, ...(choque.has(m.fileId) ? { choque: choque.get(m.fileId) } : {}) })))
    return paraAplicar(db, changes)
  })
  ipcMain.handle('propuestas:sacar', (_e, tipo: 'papelera' | 'mover' | 'reemplazo', fileIds?: number[]) => { sacarPropuestas(db, { tipo, ...(fileIds ? { fileIds } : {}) }); return paraAplicar(db, changes) })
}
