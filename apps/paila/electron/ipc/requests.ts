// IPC de "Traer una lista de otro lado" (core/requests.ts): elegir el archivo o pegar el texto, la vista previa, crear la
// playlist, confirmar los probables, exportar lo que falta y deshacer. Solo cambia la base: no pasa por el candado de archivos.
import fs from 'node:fs'
import path from 'node:path'
import { clipboard, dialog, ipcMain, shell } from 'electron'
import { parseList, spotifyLink } from '@paila/core/listparse'
import { isrcsToAsk, lookupIsrcs } from '@paila/core/listdeezer'
import { Deezer } from '@paila/core/online/sources'
import { DEFAULT_CRITERIA } from '@paila/core/wanted'
import { previewInWorker } from '@paila/core/requestserver'
import { sameName } from '@paila/core/requests-update'
import type { RequestDecision, RequestItem, RequestPreview, WantedFormat } from '@paila/shared/types'
import type { Ctx } from '../context'
import { cant, num, textos } from '@paila/shared/idioma'

/** Lo que se ve (tareas, ventanas de elegir y guardar). Los nombres de archivo que se proponen ("… - para conseguir") no se traducen. */
const T = textos({
  texto: { es: 'Texto', en: 'Text' },
  planilla: { es: 'Planilla (CSV)', en: 'Spreadsheet (CSV)' },
  leyendoIsrc: { es: 'Leyendo los códigos ISRC de tu biblioteca (la primera vez tarda un poco)', en: 'Reading the ISRC codes in your library (the first time takes a while)' },
  leidos: { es: (n: number, f: number) => `${n} temas leídos, ${f} con ISRC`, en: (n: number, f: number) => `${cant(n, 'track', 'tracks')} read, ${num(f)} with ISRC` },
  deezer: { es: 'Buscando los códigos ISRC del pedido en Deezer', en: "Looking up the request's ISRC codes on Deezer" },
  preguntados: { es: (a: number, f: number) => `${a} preguntados, ${f} encontrados`, en: (a: number, f: number) => `${num(a)} asked, ${num(f)} found` },
  elegiLista: { es: 'Elegí la lista (.csv, .m3u o texto)', en: 'Choose the list (.csv, .m3u or text)' },
  listas: { es: 'Listas', en: 'Lists' },
  todos: { es: 'Todos los archivos', en: 'All files' },
  pedidoNoEsta: { es: 'Ese pedido ya no está', en: 'That request is no longer there' },
  guardarFalta: { es: 'Guardar lo que falta del pedido', en: "Save what's missing from the request" },
})

/** El diálogo de guardar según el formato (también los de sockseek). */
export function saveOpts(title: string, base: string, format: WantedFormat) {
  const ext = format.endsWith('txt') ? 'txt' : 'csv'
  const name = format.startsWith('sockseek') ? `${base} (sockseek).${ext}` : `${base}.${ext}`
  return { title, defaultPath: name, filters: ext === 'txt' ? [{ name: T.texto, extensions: ['txt'] }] : [{ name: T.planilla, extensions: ['csv'] }] }
}

export function registerRequests(c: Ctx) {
  const { requests, isrc, wanted } = c

  /** La primera vez lee los ISRC de toda la biblioteca (~1 min cada 4.000 temas); después, solo lo nuevo. */
  const readIsrc = async () => {
    if (!isrc.pending()) return
    await c.jobs.run('isrc', T.leyendoIsrc,
      (h) => isrc.refresh((done, total) => h.update({ done, total }), h.cancelled),
      (r) => T.leidos(r.read, r.found))
  }
  /** Los ISRC del pedido, en Deezer (sin clave; si Deezer está prendido en Configuración). Lo ya preguntado queda guardado. */
  const askDeezer = async (text: string, fileName?: string) => {
    if (c.setting('online.deezer') === '0') return
    const isrcs = parseList(text, fileName).entries.map((e) => e.isrc).filter((x): x is string => !!x)
    if (!isrcsToAsk(c.lib.db, isrcs).length) return
    const dz = new Deezer()
    await c.jobs.run('isrc-deezer', T.deezer,
      (h) => lookupIsrcs(c.lib.db, isrcs, dz, (done, total) => h.update({ done, total }), h.cancelled),
      (r) => T.preguntados(r.asked, r.found)).catch(() => { /* sin internet: se empareja por nombre */ })
  }
  // el emparejamiento corre en un hilo aparte (core/requestworker.ts): con 100.000 temas tarda unos segundos y la ventana sigue andando
  const preview = async (text: string, fileName?: string, name?: string): Promise<RequestPreview> => {
    await readIsrc(); await askDeezer(text, fileName)
    const roots = Object.fromEntries(c.lib.roots().filter((r) => r.available).map((r) => [r.id, r.path]))
    return previewInWorker(path.join(__dirname, 'request-worker.js'), { file: path.join(c.userData, 'paila.db'), roots, text, fileName, name })
  }

  ipcMain.handle('req:pick', async () => {
    const r = await dialog.showOpenDialog(c.win()!, {
      title: T.elegiLista, properties: ['openFile'],
      filters: [{ name: T.listas, extensions: ['csv', 'tsv', 'm3u', 'm3u8', 'txt'] }, { name: T.todos, extensions: ['*'] }],
    })
    if (r.canceled || !r.filePaths[0]) return null
    return preview(fs.readFileSync(r.filePaths[0], 'utf8'), r.filePaths[0])
  })
  ipcMain.handle('req:preview', (_e, text: string, name?: string) => preview(text, undefined, name))
  ipcMain.handle('req:file', (_e, file: string) => preview(fs.readFileSync(file, 'utf8'), file))
  // un link de Spotify: se abre la página para bajar el CSV (solo estas dos, nunca una dirección que venga de afuera); el link queda copiado para pegarlo ahí
  ipcMain.handle('req:site', (_e, site: 'chosic' | 'exportify', link: string | null) => {
    const ok = link ? spotifyLink(link) : null
    if (ok) clipboard.writeText(ok)
    return shell.openExternal(site === 'chosic' ? 'https://www.chosic.com/spotify-playlist-exporter/' : 'https://exportify.net/')
  })
  ipcMain.handle('req:create', (_e, p: { name: string; source: string; items: RequestItem[] }) =>
    requests.create({ name: p.name, source: p.source, items: p.items.map((i) => ({ ...i, fileId: i.file?.id ?? null })) }))
  ipcMain.handle('req:update', (_e, id: number, items: RequestItem[]) => requests.update(id, items.map((i) => ({ ...i, fileId: i.file?.id ?? null }))))
  ipcMain.handle('req:named', (_e, name: string) => sameName(c.lib.db, name))
  ipcMain.handle('req:decide', (_e, itemId: number, d: RequestDecision | null) => requests.decide(itemId, d))
  ipcMain.handle('req:list', () => { requests.sync(); return requests.list() })
  ipcMain.handle('req:detail', (_e, id: number) => requests.detail(id))
  ipcMain.handle('req:undo', (_e, id: number) => requests.undo(id))
  ipcMain.handle('req:export', async (_e, id: number, format: WantedFormat) => {
    const req = requests.detail(id)
    if (!req) throw new Error(T.pedidoNoEsta)
    const r = await dialog.showSaveDialog(c.win()!, saveOpts(T.guardarFalta, `${req.name} - para conseguir`, format))
    if (r.canceled || !r.filePath) return null
    const out = wanted.export(format, { ...DEFAULT_CRITERIA, fair: true }, { request: req.name })
    fs.writeFileSync(r.filePath, out.text, 'utf8')
    return { path: r.filePath, count: out.count, marked: out.marked }
  })
}
