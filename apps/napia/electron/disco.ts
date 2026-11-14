// "Un disco" en NAPIA (DECISIONES 07/11): buscar la lista oficial (MusicBrainz y Deezer, con el nombre de PAILA) y, cuando la lista de un
// disco llega a su turno en la tanda, el primer intento: la carpeta entera de una sola persona (core/sockseek/disco-correr.ts). Después la
// tanda la baja como cualquier lista, tema por tema, y sockseek saltea lo que ya llegó. Lo registra ipc.ts.
import { app, ipcMain } from 'electron'
import { buildArgs } from '@paila/core/sockseek/args'
import { ARGS_CARPETA, buscarDisco, temasDe, type Pedir } from '@paila/core/sockseek/disco'
import { bajarCarpetaEntera } from '@paila/core/sockseek/disco-correr'
import { carpetaLista } from '@paila/core/sockseek/carpetas'
import { arreglarArchivo } from '@paila/core/sockseek/nombres'
import { findFfmpeg } from '@paila/core/probe'
import type { SockseekRun } from '@paila/core/sockseek/run'
import type { Destino, EdicionDisco, NapiaOptions, SockseekInfo, TandaItem } from '@paila/shared/napia'
import type { Revisor } from './calidad'
import { correr, extraArgs } from './correr'
import path from 'node:path'

/** MusicBrainz pide un nombre de programa y no más de un pedido por segundo. */
let ultimo = 0
const pedir: Pedir = async (url) => {
  const espera = 1100 - (Date.now() - ultimo)
  if (url.includes('musicbrainz.org') && espera > 0) await new Promise((r) => setTimeout(r, espera))
  ultimo = Date.now()
  const r = await fetch(url, { headers: { 'User-Agent': `NAPIA/${app.getVersion()} ( https://github.com/epitelio-ar/PAILA )`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export interface DiscoDeps { info: () => SockseekInfo; destino: () => Destino; opciones: () => NapiaOptions; revisor: Revisor; onCambio: () => void }

export function registerDisco(d: DiscoDeps) {
  ipcMain.handle('napia:buscarDisco', (_e, artista: string, titulo: string) => buscarDisco(artista.trim(), titulo.trim(), pedir))
  ipcMain.handle('napia:temasDisco', (_e, e: EdicionDisco) => temasDe(e, pedir))
  let run: SockseekRun | null = null, cortado = false
  return {
    /** ¿Es un disco al que todavía no se le probó la carpeta entera? */
    pendiente: (it: TandaItem) => !!it.list.disco && !it.carpeta,
    /** La carpeta entera de una persona; al terminar, la lista vuelve a esperar su turno para bajar tema por tema lo que falta. false: se cortó. */
    async correr(it: TandaItem, empezar: (folder: string) => void): Promise<boolean> {
      const i = d.info(), o = d.opciones()
      const folder = path.join(d.destino().folder, carpetaLista(it.list.name))
      empezar(folder); cortado = false
      const ffmpeg = findFfmpeg()
      try {
        it.carpeta = await bajarCarpetaEntera(it.list, {
          datos: app.getPath('userData'), carpeta: folder,
          correr: (csv, trabajo, indice) => (run = correr(i.exe!, [...buildArgs({ csvPath: csv, outputDir: trabajo, options: o, freno: i.freno, indexPath: indice, sinAcciones: true }), ...ARGS_CARPETA, ...extraArgs()], [], () => {})),
          revisar: d.revisor.revisar ? (f) => d.revisor.revisar!(f, o.calidad) : null,
          arreglar: o.arreglarNombres !== false ? (p, f) => arreglarArchivo(ffmpeg, p, f) : undefined,
          cortado: () => cortado,
          onCambio: (x) => { it.carpeta = { ...x }; d.onCambio() },
        })
      } catch { it.carpeta = { llegaron: 0, truchos: 0, de: it.list.tracks.length } } finally { run = null }
      if (cortado) it.carpeta = null // se retoma la próxima vez
      it.estado = 'espera'
      d.onCambio()
      return !cortado
    },
    cortar: async () => { cortado = true; await run?.cancel() },
  }
}
