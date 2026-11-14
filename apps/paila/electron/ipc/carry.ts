// IPC de "Llevar la música": al celular (copiar convirtiendo, en segundo plano, con el candado y la intensidad del
// análisis; a una carpeta o directo a un celular conectado por cable), playlists .m3u8 para reproductores de PC y el
// chequeo "listo para tu servidor".
import fs from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import { PhoneCopier } from '@paila/core/carry'
import { sendToDevice } from '@paila/core/carrydevice'
import { CopyOut } from '@paila/core/ops/copy'
import { MtpBridge } from '@paila/core/mtp'
import { exportM3uLists } from '@paila/core/m3uexport'
import { serverCheck } from '@paila/core/serverready'
import type { CarrySource, M3uOptions, PhoneDevice, PhoneOptions, PhonePlan } from '@paila/shared/types'
import type { Ctx } from '../context'
import { num, textos } from '@paila/shared/idioma'

const fmt = (x: number) => num(x)

// Lo que se ve. Los nombres de la carpeta en el destino ("Playlist", "Selección") no se traducen: se escriben en el celular.
const T = textos({
  sinLugarCel: {
    es: (falta: number, hay: number) => `No alcanza el lugar en el celular: hacen falta ${(falta / 1e9).toFixed(2)} GB y hay ${(hay / 1e9).toFixed(2)} GB libres`,
    en: (falta: number, hay: number) => `There isn't enough space on the phone: ${num(falta / 1e9, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB are needed and there are ${num(hay / 1e9, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB free`,
  },
  llevando: { es: 'Llevando al celular', en: 'Taking it to the phone' },
  copiando: { es: 'Copiando para el celular', en: 'Copying for the phone' },
  candado: { es: 'copiando música para el celular', en: 'copying music for the phone' },
  preparando: { es: (x: string) => `Preparando: ${x}`, en: (x: string) => `Getting ready: ${x}` },
  alCelular: { es: (x: string) => `Al celular: ${x}`, en: (x: string) => `To the phone: ${x}` },
  resumen: {
    es: (conv: number, cop: number, ya: number, llegaron: number | null, fallaron: number) => `${fmt(conv)} convertidos y ${fmt(cop)} copiados tal cual${ya ? `, ${ya} ya estaban` : ''}${llegaron != null ? `; ${fmt(llegaron)} llegaron al celular` : ''}${fallaron ? `, ${fallaron} no se pudieron` : ''}`,
    en: (conv: number, cop: number, ya: number, llegaron: number | null, fallaron: number) => `${fmt(conv)} converted and ${fmt(cop)} copied as is${ya ? `, ${fmt(ya)} were already there` : ''}${llegaron != null ? `; ${fmt(llegaron)} reached the phone` : ''}${fallaron ? `, ${fmt(fallaron)} couldn't be done` : ''}`,
  },
  revisando: { es: 'Revisando para tu servidor', en: 'Checking for your server' },
  servidor: { es: (bien: number, total: number) => `${fmt(bien)} de ${fmt(total)} temas se ven bien en un servidor`, en: (bien: number, total: number) => `${fmt(bien)} of ${fmt(total)} tracks look good on a server` },
})

/**
 * Para desarrollo: PAILA_FAKE_PHONE=<carpeta> muestra esa carpeta como un celular conectado (cada subcarpeta, un
 * almacenamiento) y recorre el mismo puente de Windows que un Android de verdad. Sirve para probar sin celular.
 */
function fakePhone(): PhoneDevice[] {
  const dir = process.env.PAILA_FAKE_PHONE
  if (!dir || !fs.existsSync(dir)) return []
  const storages = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ name: d.name, freeBytes: null, totalBytes: null }))
  return [{ id: path.resolve(dir), name: 'Celular de prueba', storages, apple: false }]
}

export function registerCarry(c: Ctx) {
  const { lib, playlists } = c
  const phone = new PhoneCopier(lib.db, (id) => lib.trackPath(id), c.ffmpeg, c.ffprobe, () => lib.roots().filter((r) => r.available).map((r) => r.path))
  const mtp = new MtpBridge()
  app.on('will-quit', () => mtp.close())
  const source = (s: CarrySource) => {
    if ('playlistId' in s) return { name: playlists.tree().find((n) => n.id === s.playlistId)?.name ?? 'Playlist', ids: playlists.trackIds(s.playlistId) }
    return { name: s.name || 'Selección', ids: s.ids }
  }
  // De a varios temas a la vez según la intensidad elegida para el análisis (la mitad: el análisis puede estar andando)
  const concurrency = () => Math.max(1, Math.min(4, Math.ceil(c.intensity.workers() / 2)))

  // La lista de celulares se pide seguido (cada vez que cambia una opción): se guarda unos segundos
  let devCache: { at: number; list: Promise<PhoneDevice[]> } | null = null
  const devices = (fresh = false) => {
    if (fresh || !devCache || Date.now() - devCache.at > 5000) devCache = { at: Date.now(), list: mtp.devices().catch(() => []).then((l) => [...l, ...fakePhone()]) }
    return devCache.list
  }
  /** Al celular: el lugar libre que cuenta es el del celular (el de la compu ya lo revisó el plan para la carpeta temporal). */
  const withDevice = async (plan: PhonePlan, o: PhoneOptions) => {
    if (!o.device) return plan
    const st = (await devices()).find((d) => d.id === o.device!.id)?.storages.find((s) => s.name === o.device!.storage)
    plan.freeBytes = st?.freeBytes ?? null
    if (plan.freeBytes != null && plan.totalBytes > plan.freeBytes) plan.warnings.unshift(T.sinLugarCel(plan.totalBytes, plan.freeBytes))
    return plan
  }

  ipcMain.handle('carry:pick', async (_e, title: string) => {
    const r = await dialog.showOpenDialog(c.win()!, { title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle('carry:devices', () => devices(true))
  ipcMain.handle('carry:phonePlan', (_e, s: CarrySource, o: PhoneOptions) => { const x = source(s); return withDevice(phone.plan(x.name, x.ids, o), o) })
  ipcMain.handle('carry:phoneRun', (_e, s: CarrySource, o: PhoneOptions) => c.jobs.run('carry-phone', o.device ? T.llevando : T.copiando, (h) =>
    // solo lee la biblioteca, pero nada de moverla mientras tanto: va con el candado de operaciones
    lib.ops.run(T.candado, async () => {
      const x = source(s)
      const plan = phone.plan(x.name, x.ids, o)
      // al celular son dos pasos (preparar y mandar): una sola barra que avanza de corrido, no dos que arrancan de cero
      const k = plan.items.length, pasos = o.device ? 2 : 1
      h.update({ total: k * pasos })
      // al celular por cable, la carpeta temporal de la compu es un paso intermedio: al Historial va lo que llega al celular
      const copies = o.device ? new CopyOut(lib.db, 'celular', plan.deviceFolder ?? plan.name, { log: false }) : undefined
      const r = await phone.run(plan, {
        onProgress: (p) => h.update({ done: p.done, total: k * pasos, current: o.device && p.current ? T.preparando(p.current) : p.current, errors: p.errors, found: 0 }),
        isCancelled: h.cancelled, concurrency, paused: () => c.intensity.info().paused, copies,
      })
      // al celular: lo preparado en la carpeta temporal se pasa de a un archivo, verificando el tamaño
      if (o.device && !r.cancelled) {
        await sendToDevice(plan, r, mtp, o.device, {
          onProgress: (p) => h.update({ done: k + p.done, total: k * pasos, current: p.current ? T.alCelular(p.current) : '', errors: p.errors }),
          isCancelled: h.cancelled,
          onSent: (rel, size) => {
            const it = plan.items.find((x) => x.outRel === rel)
            copies!.note({ fileId: it?.fileId ?? null, src: it ? lib.trackPath(it.fileId) : null, dst: `${plan.deviceFolder ?? plan.name}/${rel}`, size })
          },
        })
      }
      h.update({ problems: r.failed })
      return r
    }),
  (r) => T.resumen(r.converted, r.copied, r.skippedExisting, r.device ? r.device.sent : null, r.failed.length)))

  // escribe las listas por el motor: va con el candado de operaciones
  ipcMain.handle('carry:m3u', (_e, ids: number[], o: M3uOptions) => lib.ops.run(T.candado, async () => exportM3uLists(lib.db, playlists, (id) => lib.trackPath(id), ids, o)))

  ipcMain.handle('carry:server', () => c.jobs.run('carry-server', T.revisando, (h) =>
    serverCheck(lib.db, { pathOf: (id) => lib.trackPath(id), isCancelled: h.cancelled, onProgress: (done, total) => h.update({ done, total }) }),
  (r) => T.servidor(r.okEssential, r.tracks)))
}
