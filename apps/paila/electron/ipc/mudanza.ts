// "Pasar a otra compu" (core/mudanza.ts y core/mudanza-traer.ts): Exportar todo, Traer de otra compu (elegir el archivo,
// buscar cada carpeta, armar la base y reabrir PAILA) y, al abrir, poner la base traída y lo que recordaba la ventana.
import fs from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import type { MudanzaAbierto } from '@paila/shared/types/mudanza'
import { exportarTodo, leerMudanza, MUDANZA_EXT } from '@paila/core/mudanza'
import { armarTraida, destinoDe, emparejarCarpeta, ponerTraida, TRAIDA, TRAIDA_VENTANA, type Plan } from '@paila/core/mudanza-traer'
import { backupNow } from '@paila/core/backup'
import type { Ctx } from '../context'

const p2 = (n: number) => String(n).padStart(2, '0')
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }
/** Lo que la ventana guarda en su almacenamiento (columnas, volumen, el recorrido visto…): las claves "paila…". */
/** Para las pruebas que manejan la app desde afuera (scripts/mudanza.ts): los diálogos eligen estas rutas, en orden, sin preguntar. */
const ELEGIR = (process.env.PAILA_ELEGIR ?? '').split(';').filter(Boolean)
const elegir = async (dialogo: () => Promise<string | null | undefined>) => (ELEGIR.length ? ELEGIR.shift()! : (await dialogo()) ?? null)
const LEER_VENTANA = "Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('paila')).map((k) => [k, localStorage.getItem(k)]))"

export function registerMudanza(c: Ctx) {
  let abierto: string | null = null
  const planes = new Map<number, Plan>()
  const leerEstilo = () => { try { return (JSON.parse(fs.readFileSync(path.join(c.userData, 'estilo.json'), 'utf8')) as { estilo?: string }).estilo ?? null } catch { return null } }

  ipcMain.handle('mudanza:exportar', async () => {
    const win = c.win()
    const destino = await elegir(async () => (await dialog.showSaveDialog(win!, {
      title: 'Exportar todo', defaultPath: path.join(app.getPath('documents'), `PAILA-todo-${hoy()}.${MUDANZA_EXT}`),
      filters: [{ name: 'Todo de PAILA', extensions: [MUDANZA_EXT] }],
    })).filePath)
    if (!destino) return null
    const ventana = win ? await win.webContents.executeJavaScript(LEER_VENTANA) as Record<string, string> : {}
    return exportarTodo(c.lib.db, destino, { version: app.getVersion(), ventana, estilo: leerEstilo(), tapas: path.join(c.userData, 'tapas') })
  })

  ipcMain.handle('mudanza:abrir', async (): Promise<MudanzaAbierto | null> => {
    const file = await elegir(async () => (await dialog.showOpenDialog(c.win()!, { title: 'Traer de otra compu', properties: ['openFile'], filters: [{ name: 'Todo de PAILA', extensions: [MUDANZA_EXT] }] })).filePaths[0])
    if (!file) return null
    const resumen = leerMudanza(file)
    abierto = file
    planes.clear()
    return { resumen, destino: destinoDe(c.lib.db) }
  })

  ipcMain.handle('mudanza:carpeta', async (_e, rootId: number, carpeta?: string) => {
    if (!abierto) throw new Error('Primero elegí el archivo que armaste en la otra compu.')
    const dir = carpeta ?? await elegir(async () => (await dialog.showOpenDialog(c.win()!, { title: '¿Dónde está ahora esa carpeta de música?', properties: ['openDirectory'] })).filePaths[0])
    if (!dir) return null
    const plan = await emparejarCarpeta(abierto, rootId, dir)
    planes.set(rootId, plan)
    return plan.resumen
  })

  ipcMain.handle('mudanza:traer', async (_e, rootIds: number[]) => {
    if (!abierto) throw new Error('Primero elegí el archivo que armaste en la otra compu.')
    if (c.lib.ops.busy) throw new Error(`PAILA está ${c.lib.ops.busy}. Esperá a que termine y probá de nuevo.`)
    const elegidos = rootIds.map((id) => planes.get(id)).filter((p): p is Plan => !!p)
    const conservar = c.lib.db.prepare("SELECT key, value FROM settings WHERE key LIKE 'claves.%'").all() as { key: string; value: string }[]
    // lo que había en esta PAILA no se pisa sin copia: un respaldo completo, además de la base que queda en respaldos al abrir
    const d = destinoDe(c.lib.db)
    if (d.temas || d.playlists || d.historial) backupNow(c.lib.db, path.join(c.userData, 'respaldos'), 'antes-de-traer', 50)
    const t = await armarTraida(abierto, path.join(c.userData, TRAIDA), elegidos, { conservar, tapas: path.join(c.userData, 'tapas') })
    fs.writeFileSync(path.join(c.userData, TRAIDA_VENTANA), JSON.stringify(t.ventana))
    if (t.estilo) try { fs.writeFileSync(path.join(c.userData, 'estilo.json'), JSON.stringify({ estilo: t.estilo })) } catch { /* sin disco: queda el de esta compu */ }
    c.lib.stop()
    app.relaunch()
    setTimeout(() => app.quit(), 300) // que la ventana reciba la respuesta antes de cerrarse
  })
}

/** Al abrir, antes de la base: si se trajo algo de otra compu, va a su lugar (la base de antes queda en respaldos). */
export function ponerLoTraido(userData: string) {
  try { ponerTraida(userData) } catch (e) { console.error('No se pudo poner la base traída de otra compu:', e) }
}

/** Con la ventana cargada: lo que recordaba la ventana de la otra compu, una sola vez, y recarga. */
export function restaurarVentana(win: BrowserWindow, userData: string) {
  const file = path.join(userData, TRAIDA_VENTANA)
  if (!fs.existsSync(file)) return
  win.webContents.once('did-finish-load', async () => {
    try {
      const datos = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>
      fs.rmSync(file, { force: true })
      await win.webContents.executeJavaScript(`(() => { const d = ${JSON.stringify(datos)}; for (const [k, v] of Object.entries(d)) if (k.startsWith('paila') && typeof v === 'string') localStorage.setItem(k, v) })()`)
      win.webContents.reload()
    } catch (e) { console.error('No se pudo poner lo que recordaba la ventana:', e) }
  })
}
