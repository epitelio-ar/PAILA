// IPC de Sonido, una sola historia (MASTERPLAN-5, 2.4 y etapa 5): suena mal → buscar mejor con NAPIA → llegó (la Bandeja lo reconoce y lo
// verifica) → aplicar, sin cambiar de ventana. El estado de NAPIA sale de su enlace (enlacenapia.ts, cada 3 s) y se le manda a la pantalla
// cuando cambia; "Buscar con NAPIA" abre NAPIA con `--bajar` (baja sola, minimizada); lo que llega y es mejor queda propuesto en el Aplicar
// único (core/sonido-reemplazos.ts). Lo registra ipc/inbox.ts, que tiene la Bandeja.
import path from 'node:path'
import { ipcMain } from 'electron'
import { ENLACE_VENCE_MS, vigente, type EnlaceNapia } from '@paila/core/sockseek/enlace'
import { aplicarReemplazos, proponerDeLaBandeja } from '@paila/core/sonido-reemplazos'
import type { InboxFlow } from '@paila/core/inboxflow'
import { propuestas } from '@paila/core/propuestas'
import { peorPrimero } from '@paila/core/peor-primero'
import { apagados, apagar, claveProp } from '@paila/core/revision-apagados'
import { fraseCalidad, fraseLlegada, fraseNoEsta, fraseOtraCopia, fraseTrucho } from '@paila/shared/frases-calidad'
import type { EjemploSonido, EstadoNapia, InboxResult, InboxWatchState, QueMandar, ResumenSonido, WantedItem } from '@paila/shared/types'
import { abrirNapia } from '../abrirnapia'
import type { Ctx } from '../context'
import { textos } from '@paila/shared/idioma'

const T = textos({
  llego: { es: 'Llegó: la Bandeja lo revisa', en: 'Arrived: the Inbox checks it' },
})

const EJEMPLOS = 6
// lo que llegó ("llego") ya está en Llegaron: no se cuenta dos veces
const fuera = new Set(['reemplazado', 'ignorar', 'llego'])

/** Lo que dijo NAPIA, para la pantalla (null: NAPIA nunca escribió nada). */
export function estadoDe(e: EnlaceNapia | null, ahora = Date.now()): EstadoNapia | null {
  if (!e) return null
  return {
    abierta: ahora - e.hora < ENLACE_VENCE_MS, corriendo: vigente(e, ahora), lista: e.lista, hechos: e.hechos, total: e.total, bajados: e.bajados,
    truchos: e.truchos ?? 0, noEncontrados: e.noEncontrados ?? 0, enEspera: e.enEspera ?? 0, falta: e.falta ?? null,
    ultimos: (e.ultimos ?? []).map((u) => ({ artist: u.artist, title: u.title, estado: u.estado, frase: u.estado === 'trucho' ? fraseTrucho(u.es) : u.estado === 'noEsta' ? fraseNoEsta() : u.otraCopia ? fraseOtraCopia() : T.llego })),
    fin: e.fin ? { lista: e.fin.lista, bajados: e.fin.bajados, noConseguidos: e.fin.noConseguidos.length, hora: e.fin.hora, cortada: e.fin.cortada } : null,
  }
}

export interface SonidoDeps {
  flow: InboxFlow
  /** La carpeta de la Bandeja, si existe. */
  carpeta: () => string | null
  bandeja: () => InboxWatchState
  /** Lo que se le manda a NAPIA (la misma lista de "Bajar con NAPIA"): el archivo y cuántos temas. */
  lista: (que: QueMandar) => Promise<{ path: string; count: number; bandeja: string | null } | null>
  /** «Faltan o suenan mal», con las casillas de siempre. */
  wanted: () => WantedItem[]
  /** Los resultados de la Bandeja, sin lo ignorado. */
  resultados: () => InboxResult[]
}

export function registerSonido(c: Ctx, d: SonidoDeps) {
  const db = c.lib.db
  let ultimo: EstadoNapia | null = null, visto = ''
  // el Aplicar único aplica los reemplazos con la Bandeja de ahora
  c.reemplazar = (props, avance, cancel) => aplicarReemplazos({ db, flow: d.flow, replacer: c.replacer, wanted: c.wanted, carpeta: d.carpeta }, props, avance, cancel)

  const ejemplo = (i: WantedItem, kbps: Map<number, number | null>): EjemploSonido => ({ key: i.key, fileId: i.fileId, artist: i.artist, title: i.title, grade: i.grade,
    frase: fraseCalidad({ ext: i.ext, kbps: i.fileId != null ? kbps.get(i.fileId) ?? null : null, effKbps: i.effKbps, grade: i.grade, reasons: i.reasons, requests: i.requests, fileId: i.fileId }) })
  function resumen(): ResumenSonido {
    const ws = d.wanted().filter((i) => !fuera.has(i.status))
    // de peor a mejor sonido (el autor, 13/11), sin mirar si ya se había pedido
    const mal = ws.filter((i) => i.fileId != null).sort(peorPrimero), faltan = ws.filter((i) => i.fileId == null)
    const ids = mal.slice(0, EJEMPLOS).map((i) => i.fileId!)
    const kbps = new Map(ids.map((id) => [id, (db.prepare('SELECT kbps FROM files WHERE id = ?').get(id) as { kbps: number | null } | undefined)?.kbps ?? null]))
    // PAILA propone: lo que llegó y es mejor queda en lo que vas a aplicar
    try { proponerDeLaBandeja(db, d.flow, d.carpeta()) } catch { /* la Bandeja se está moviendo: la próxima vez */ }
    const off = apagados(db)
    const reps = propuestas(db, 'reemplazo')
    const res = d.resultados()
    const llegada = (r: InboxResult) => ({ path: r.path, name: r.name, decision: r.decision, frase: fraseLlegada(r), artist: r.artist, title: r.title })
    const b = d.bandeja()
    return {
      suenanMal: { n: mal.length, ejemplos: mal.slice(0, EJEMPLOS).map((i) => ejemplo(i, kbps)) },
      faltan: { n: faltan.length, ejemplos: faltan.slice(0, EJEMPLOS).map((i) => ejemplo(i, kbps)) },
      llegaron: {
        enLista: reps.filter((p) => !p.error && !off.has(claveProp(p.fileId, 'reemplazo'))).length,
        apagadas: reps.filter((p) => p.error || off.has(claveProp(p.fileId, 'reemplazo'))).length,
        nuevos: res.filter((r) => r.decision === 'falta' || r.decision === 'sin-pareja').length,
        otros: res.filter((r) => r.decision === 'no-sirve' || r.decision === 'mirar' || r.decision === 'error').slice(0, 12).map(llegada),
        mejores: reps.map((p) => ({ path: p.dato.archivo ?? '', name: path.basename(p.dato.archivo ?? ''), decision: off.has(claveProp(p.fileId, 'reemplazo')) ? 'apagado' : 'reemplazar',
          frase: p.error ?? p.dato.frase ?? '', artist: null, title: null, fileId: p.fileId, rel: p.rel })),
        revisando: b.queue,
      },
      bandeja: b.folder,
    }
  }

  ipcMain.handle('sonido:resumen', () => resumen())
  ipcMain.handle('sonido:napia', () => ultimo)
  ipcMain.handle('sonido:mandar', async (_e, que: QueMandar) => {
    const l = await d.lista(que)
    if (!l) return null
    abrirNapia([l.path, '--bajar'])
    return { count: l.count, bandeja: l.bandeja }
  })
  ipcMain.handle('sonido:verNapia', () => abrirNapia())
  // tildar o destildar una copia mejor (sigue en la lista, a la vista; Aplicar la saltea)
  ipcMain.handle('sonido:tildar', (_e, fileIds: number[], on: boolean) => { apagar(db, fileIds.map((id) => claveProp(id, 'reemplazo')), !on); return resumen() })

  return {
    /** Lo que dijo NAPIA (lo llama enlacenapia.ts cada vez que mira): a la pantalla, solo si cambió. */
    enlace(e: EnlaceNapia | null) {
      const x = estadoDe(e)
      const k = JSON.stringify(x && { ...x, abierta: x.abierta, fin: x.fin?.hora })
      if (k === visto) return
      visto = k; ultimo = x
      c.send('sonido:napia', x)
    },
  }
}
