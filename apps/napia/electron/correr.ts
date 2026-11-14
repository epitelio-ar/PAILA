// Correr sockseek desde NAPIA (lo usa ipc.ts): el proceso (o, solo para ver la pantalla sin Soulseek, el sockseek de mentira de
// los tests) y la corrida de "otra fuente": cuando algo llegó trucho (core/sockseek/control.ts), el mismo tema de nuevo, sin los
// usuarios que lo compartían así (--banned-users), con su propia lista e índice (el índice se borra al terminar: lo que llega
// pasa a la carpeta de la lista y el índice de la lista apunta ahí). Las dos se vigilan: una fuente muy lenta no frena la lista
// (core/sockseek/lentitud.ts; con NAPIA_LENTO_ESCALA=0.05, los tiempos son más cortos, para la prueba con el sockseek de mentira),
// y lo que ya suena trucho en un pedazo mientras baja tampoco (core/sockseek/muestra.ts).
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { sockseekCsv, type ExportTrack } from '@paila/core/listexport'
import { SockseekRun } from '@paila/core/sockseek/run'
import { LENTITUD, escalar, vigilar } from '@paila/core/sockseek/lentitud'
import { VigiaMuestras, sacarMuestra } from '@paila/core/sockseek/muestra'
import { rutasTrabajo } from '@paila/core/sockseek/carpetas'
import type { ControlCalidad, CorridaOtraFuente } from '@paila/core/sockseek/control'
import type { Revisor } from './calidad'
import type { Calidad } from '@paila/shared/napia'
import type { Row } from '@paila/core/sockseek/progress'
import type { TrackProgress } from '@paila/shared/napia'
import { T } from './ipc.textos'

/** Partir NAPIA_EXTRA_ARGS (solo para probar, por ejemplo con --mock-files-dir) respetando las comillas. */
export const extraArgs = () => [...(process.env.NAPIA_EXTRA_ARGS ?? '').matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])

/** Cuándo una fuente es muy lenta (core/sockseek/lentitud.ts). */
export const lentitud = () => escalar(LENTITUD, Number(process.env.NAPIA_LENTO_ESCALA) || 1)

/** Un pedazo de cada tema mientras baja, con la revisión de siempre (`carpeta`: donde sockseek deja los pedazos de esa corrida). */
export const muestrasDe = (carpeta: string, ffmpeg: string | null, revisor: Revisor, calidad: Calidad) => (ffmpeg && revisor.revisar
  ? new VigiaMuestras({ carpeta, sacar: (f, ext) => sacarMuestra(ffmpeg, f, ext), revisar: (f) => revisor.revisar!(f, calidad).catch(() => null) }) : null)

/**
 * Vigila una corrida: si lo único que queda son fuentes muy lentas o temas que ya suenan truchos en el pedazo, los anota (como
 * lentos o como truchos por la muestra) y la corta. `deOtraFuente`: es una vuelta de otra fuente. Devuelve cómo dejar de vigilar.
 */
export const vigilarCorrida = (r: SockseekRun, control: ControlCalidad, deOtraFuente: boolean, anotar: (l: string) => void, onCambio: () => void, muestras: VigiaMuestras | null) =>
  vigilar(() => r.progress.tracks, (ts) => {
    const lentas: string[] = [], truchas: string[] = []
    for (const t of ts) {
      const m = muestras?.trucha(t)
      if (m) { control.porMuestra(t, m, deOtraFuente); truchas.push(t.title) } else { control.lenta(t, deOtraFuente); lentas.push(t.title) }
    }
    if (lentas.length) anotar(T.lentas(lentas))
    if (truchas.length) anotar(T.truchasMuestra(truchas))
    onCambio()
  }, (ls) => r.cortar(ls), lentitud(), muestras ?? undefined)

/** Corre sockseek (o, solo para ver la pantalla sin Soulseek, NAPIA_SOCKSEEK_FALSO=tests/fixtures/sockseek-falso.mjs con sus FALSO_…). */
export const correr = (exe: string, args: string[], rows: Row[], onChange: () => void) => {
  const falso = process.env.NAPIA_SOCKSEEK_FALSO
  return new SockseekRun(falso
    ? { command: process.execPath, args: [falso, ...args], cwd: app.getPath('userData'), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
    : { command: exe, args, cwd: app.getPath('userData') }, rows, onChange)
}

export interface OtraFuente {
  /** El nombre de la lista (la de otra fuente se llama igual, con " - otra fuente"). */
  nombre: string
  /** Los temas de la lista como se le pasaron a sockseek (con álbum y duración, que mejoran la búsqueda). */
  rows: ExportTrack[]
  /** Dónde van las listas y los índices de sockseek (en los datos de NAPIA). */
  listas: string
  indices: string
  exe: string
  /** Los argumentos de sockseek para una lista, su índice y los usuarios vetados. */
  argsDe: (csv: string, indice: string, vetados: string[]) => string[]
  control: ControlCalidad
  /** Anota en el registro de la lista ("Ver el detalle"): ahí se dice cada vuelta. */
  anotar: (l: string) => void
  /** Los datos de NAPIA (de ahí sale la carpeta de trabajo de otra fuente, para la muestra). */
  datos: string
  /** El vigía de la muestra para una carpeta de trabajo (null: sin revisión). */
  muestras: (carpeta: string) => VigiaMuestras | null
  onCambio: () => void
  /** Arrancó: es el sockseek que está corriendo (para cortarlo). */
  alArrancar: (r: SockseekRun) => void
}

/** La función que corre cada vuelta de otra fuente (para buscarOtrasFuentes de core/sockseek/control.ts). */
export const otraFuente = (o: OtraFuente) => (filas: TrackProgress[], vetados: string[], ronda: number): CorridaOtraFuente => {
  const nombre = `${o.nombre} - otra fuente`
  const porClave = new Map(o.rows.map((r) => [`${r.artist}|${r.title}`.toLowerCase(), r]))
  const temas = filas.map((f) => porClave.get(`${f.artist}|${f.title}`.toLowerCase()) ?? { artist: f.artist, title: f.title, album: null, duration: null })
  const csv = path.join(o.listas, `${nombre}.csv`), indice = path.join(o.indices, `${nombre}.csv`)
  fs.writeFileSync(csv, sockseekCsv(temas)); fs.rmSync(indice, { force: true })
  o.anotar(T.otraFuente(ronda, filas.length, vetados.length))
  const r: SockseekRun = correr(o.exe, o.argsDe(csv, indice, vetados), temas, () => { o.control.verOtraFuente(r.progress.tracks); o.onCambio() })
  o.alArrancar(r)
  const dejar = vigilarCorrida(r, o.control, true, o.anotar, o.onCambio, o.muestras(rutasTrabajo(o.datos, nombre).carpeta))
  return { tracks: () => r.progress.tracks, done: r.done.then((e) => { dejar(); fs.rmSync(indice, { force: true }); return e }) }
}
