// IPC de Ordenar, la revisión única (MASTERPLAN-5, etapa 3; core/revision.ts y core/revision-armar.ts): leerla, que PAILA la arme
// sola, tildar y destildar, contestar lo dudoso y elegir cómo van las carpetas. Nada de esto toca archivos: escribe Aplicar
// (ipc/aplicar.ts). Lo registra ipc/tags.ts.
// Armar llevaba 4 s con 5.000 temas y trababa la ventana (13/11): ahora va en partes, los nombres en un hilo aparte
// (core/tidyworker.ts) y la cuenta de las carpetas se hace una sola vez por pedido.
import path from 'node:path'
import { ipcMain } from 'electron'
import { leerRevision } from '@paila/core/revision'
import { armarCarpetas, armarRepetidos, movesDeEjemplo, cerrarArmado, decidir, elegirCarpetas, proponerNombres, sumarNombres } from '@paila/core/revision-armar'
import { apagar } from '@paila/core/revision-apagados'
import { elegirInternet } from '@paila/core/revision-internet'
import { reglasGuardadas } from '@paila/core/tidy-reglas'
import { TidyArmarRunner } from '@paila/core/tidyserver'
import { idioma } from '@paila/shared/idioma'
import type { EleccionRevision, OrganizeOptions, OrganizePlan, RevisionOrdenar } from '@paila/shared/types'
import type { Ctx } from '../context'
import { internetDeOrdenar } from './ordenar-internet'

/** Le da paso a lo demás (la ventana, otros pedidos) entre una parte y otra. */
const respirar = () => new Promise<void>((r) => setImmediate(r))

export function registerOrdenar(c: Ctx) {
  const { lib, changes } = c
  const db = lib.db
  const deps = () => ({ db, changes, organizer: c.organizer, pathOf: (i: number) => lib.trackPath(i), reglas: reglasGuardadas((k) => c.setting(k)) })
  const leer = (plan?: OrganizePlan | null): RevisionOrdenar => { const r = leerRevision(db, changes, c.organizer, plan); return { ...r, internet: { ...r.internet, buscando: net.corriendo() } } }
  const hilo = new TidyArmarRunner(path.join(__dirname, 'tidy-worker.js'))
  /** Los nombres, en el hilo; si el hilo no puede (o se cortó), acá mismo. */
  const nombres = async () => {
    const d = deps()
    const roots = Object.fromEntries(lib.roots().filter((r) => r.available).map((r) => [r.id, r.path]))
    const p = await hilo.run({ file: path.join(c.userData, 'paila.db'), roots, idioma: idioma(), rules: d.reglas, armar: true }).catch(() => null)
    return p ?? proponerNombres(d)
  }
  // dos pedidos de armar a la vez (entrar y volver a entrar rápido) esperan al mismo
  let armando: Promise<RevisionOrdenar> | null = null
  const armar = () => (armando ??= (async () => {
    armarRepetidos(db)
    const p = await nombres()
    sumarNombres(deps(), p)
    await respirar()
    const plan = cerrarArmado(deps())
    await respirar()
    return leer(plan)
  })().finally(() => { armando = null }))
  const net = internetDeOrdenar(c, armar, () => c.send('ordenar:listo', null))

  ipcMain.handle('ordenar:leer', () => leer())
  // al entrar: se arma y, con el OK de internet, busca sola lo nuevo (una vez por día)
  ipcMain.handle('ordenar:armar', async () => { const r = await armar(); if (!net.corriendo()) net.correr(true); return { ...r, internet: { ...r.internet, buscando: net.corriendo() } } })
  // destildar un nombre cambia adónde va el tema: las carpetas se vuelven a calcular
  ipcMain.handle('ordenar:tildar', (_e, claves: string[], on: boolean) => { apagar(db, claves, !on); return leer(armarCarpetas(deps())) })
  ipcMain.handle('ordenar:decidir', (_e, clave: string, e: EleccionRevision) => leer(decidir(deps(), clave, e)))
  ipcMain.handle('ordenar:decidirVarias', (_e, lista: [string, EleccionRevision][]) => {
    for (const [k, e] of lista) try { decidir(deps(), k, e, false) } catch { /* esa carta cambió: queda para decidir */ }
    return leer(armarCarpetas(deps()))
  })
  ipcMain.handle('ordenar:internet', (_e, si: boolean) => { elegirInternet(db, si); if (si) net.correr(); return leer() })
  ipcMain.handle('ordenar:ejemplos', (_e, o: OrganizeOptions) => movesDeEjemplo(deps(), o))
  ipcMain.handle('ordenar:carpetas', (_e, o: OrganizeOptions | null) => leer(elegirCarpetas(deps(), o)))
}
