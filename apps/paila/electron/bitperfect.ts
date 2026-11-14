// IPC de la salida "bit perfect": PAILA maneja mpv por detrás (core/mpv.ts) y le pasa a la pantalla lo que va sonando.
// mpv toma el aparato en exclusiva solo mientras suena algo por ahí; al apagar la salida o cerrar PAILA, lo suelta.
// Dónde está mpv: PAILA_MPV, o al lado del instalador (resources/mpv), o en la copia de desarrollo (apps/paila/recursos/mpv).
// PAILA_MPV_AO=null: mpv toca con la salida nula (pruebas sin sonido).
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import { Mpv, listDevices, sameOut, type AudioParams, type MpvEvent } from '@paila/core/mpv'
import type { BitPerfectEvent } from '@paila/shared/types'
import type { Ctx } from './context'
import { textos } from '@paila/shared/idioma'

// Los avisos de la salida bit perfect (se ven en el reproductor).
const T = textos({
  noReproduce: { es: 'no se pudo reproducir', en: "couldn't play it" },
  seCorto: {
    es: 'La salida bit perfect se cortó (¿se desconectó el aparato?): sigue sonando por la salida normal.',
    en: 'The bit perfect output cut out (was the device disconnected?): it keeps playing through the normal output.',
  },
  sinMpv: { es: 'Falta mpv (esta copia de PAILA no lo trae): sigue sonando por la salida normal.', en: "mpv is missing (this copy of PAILA doesn't include it): it keeps playing through the normal output." },
  sinAparato: {
    es: 'El aparato elegido para "bit perfect" no está conectado: sigue sonando por la salida normal.',
    en: 'The device chosen for "bit perfect" isn\'t connected: it keeps playing through the normal output.',
  },
  sinArchivo: { es: 'El archivo no está (¿el disco está conectado?)', en: "The file isn't there (is the drive connected?)" },
})

/** En Mac, mpv viaja como mpv.app (con sus bibliotecas adentro); en la copia de desarrollo, la de cada procesador. */
const MAC_MPV = ['mpv.app', 'Contents', 'MacOS', 'mpv']

export function mpvExe(): string {
  if (process.env.PAILA_MPV) return process.env.PAILA_MPV
  if (process.platform === 'darwin') return app.isPackaged ? path.join(process.resourcesPath, 'mpv', ...MAC_MPV) : path.join(__dirname, '../../recursos/mpv-mac', process.arch, ...MAC_MPV)
  return app.isPackaged ? path.join(process.resourcesPath, 'mpv', 'mpv.exe') : path.join(__dirname, '../../recursos/mpv/mpv.exe')
}

const OBSERVE = ['time-pos', 'duration', 'pause', 'audio-params', 'audio-out-params'] as const

/** Registra los pedidos. Devuelve con qué cerrar mpv al salir. */
export function registerBitPerfect(c: Ctx): () => Promise<void> {
  const exe = mpvExe()
  let device: string | null = null
  let lastTime = 0
  let params: { in: AudioParams | null; out: AudioParams | null } = { in: null, out: null }
  let stopping = false
  const send = (e: BitPerfectEvent) => c.win()?.webContents.send('bp:evento', e)
  const sendFormat = () => send({ type: 'format', in: params.in, out: params.out, same: sameOut(params.in, params.out) })

  const onEvent = (e: MpvEvent) => {
    if (e.event === 'property-change') {
      const d = e.data as never
      if (e.name === 'time-pos' && typeof d === 'number') {
        // unas 5 veces por segundo alcanza para la barra
        if (Math.abs(d - lastTime) >= 0.2 || d < lastTime) { lastTime = d; send({ type: 'time', time: d }) }
      } else if (e.name === 'duration' && typeof d === 'number') send({ type: 'duration', duration: d })
      else if (e.name === 'pause' && typeof d === 'boolean') send({ type: 'pause', paused: d })
      else if (e.name === 'audio-params') { params = { ...params, in: d ?? null }; sendFormat() }
      else if (e.name === 'audio-out-params') { params = { ...params, out: d ?? null }; sendFormat() }
    } else if (e.event === 'playback-restart') send({ type: 'playing' })
    else if (e.event === 'end-file') {
      if (e.reason === 'eof') send({ type: 'ended' })
      else if (e.reason === 'error') send({ type: 'error', message: e.file_error ?? T.noReproduce })
    }
  }
  const mpv = new Mpv(exe, onEvent, () => {
    if (stopping) return
    device = null
    send({ type: 'lost', message: T.seCorto })
  })

  const ensure = async (dev: string) => {
    if (mpv.running && device === dev) return
    if (!fs.existsSync(exe)) throw new Error(T.sinMpv)
    // el aparato tiene que estar enchufado; si no, se vuelve a la salida normal
    if (!listDevices(exe).some((d) => d.id === dev)) throw new Error(T.sinAparato)
    stopping = true
    // PAILA_MPV_AO=null: para probar todo sin que suene nada
    await mpv.start(dev, { ao: process.env.PAILA_MPV_AO }).finally(() => { stopping = false })
    device = dev
    for (const [i, p] of OBSERVE.entries()) await mpv.command('observe_property', i + 1, p)
  }

  ipcMain.handle('bp:info', () => ({ available: fs.existsSync(exe), devices: listDevices(exe) }))
  ipcMain.handle('bp:load', async (_e, fileId: number, dev: string, at?: number) => {
    const file = c.lib.trackPath(fileId)
    if (!file || !fs.existsSync(file)) throw new Error(T.sinArchivo)
    await ensure(dev)
    lastTime = 0
    params = { in: null, out: null }
    await (at ? mpv.command('loadfile', file, 'replace', -1, `start=${at}`) : mpv.command('loadfile', file, 'replace'))
    await mpv.command('set_property', 'pause', false)
  })
  ipcMain.handle('bp:pause', (_e, paused: boolean) => (mpv.running ? mpv.command('set_property', 'pause', paused) : null))
  ipcMain.handle('bp:seek', (_e, s: number) => (mpv.running ? mpv.command('seek', s, 'absolute') : null))
  const stop = async () => { stopping = true; device = null; await mpv.stop(); stopping = false }
  ipcMain.handle('bp:stop', stop)
  return stop
}
