// Para los tests de la calidad real de NAPIA (napia-calidad.test.ts y napia-reemplazo.test.ts): audios de prueba hechos con
// ffmpeg y bajar una lista con el sockseek de mentira (sockseek-falso.mjs, con FALSO_FUENTES) como lo hace NAPIA
// (apps/napia/electron/ipc.ts): en tramos, la revisión de cada tema, las vueltas de otra fuente, el corte de las fuentes muy lentas
// y el de lo que ya suena trucho en un pedazo mientras baja.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { findFfprobe } from '@paila/core/probe'
import { revisarArchivo } from '@paila/core/sockseek/calidad'
import { ControlCalidad, type ControlOpciones } from '@paila/core/sockseek/control'
import { ListaEnTramos } from '@paila/core/sockseek/tramos'
import { VigiaMuestras, sacarMuestra } from '@paila/core/sockseek/muestra'
import { anotarBajados, carpetaLista, rutasTrabajo } from '@paila/core/sockseek/carpetas'
import { vigilar, type Lentitud } from '@paila/core/sockseek/lentitud'
import { buildArgs } from '@paila/core/sockseek/args'
import { SockseekRun } from '@paila/core/sockseek/run'
import { sockseekCsv } from '@paila/core/listexport'
import type { Calidad, CopiaTuya, NapiaOptions, TrackProgress } from '@paila/shared/napia'

const require = createRequire(import.meta.url)
export const ffmpeg: string = require('ffmpeg-static')
export const deps = { ffmpeg, ffprobe: findFfprobe()! }
const FALSO = path.join(__dirname, 'sockseek-falso.mjs')

/**
 * Los audios de prueba en <dir>/audio: real.flac (A), m128.mp3 (D), falso.flac (FLAC de un MP3 de 128: F), inflado.mp3 (un 128
 * re-codificado a 320: F), m320.mp3 (B), tropiezos.mp3 (el 320 con 2 pedazos pisados al principio, como el de Bad Bunny de la
 * prueba real del 24/10) y roto.mp3 (pisado en 40 lugares). Devuelve la ruta de cada uno por su nombre.
 */
export function hacerAudios(dir: string): (n: string) => string {
  const a = (n: string) => path.join(dir, 'audio', n)
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true })
  const ff = (...args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args])
  ff('-f', 'lavfi', '-i', 'anoisesrc=d=30:c=pink:r=44100:a=0.3', '-ac', '2', '-sample_fmt', 's16', '-c:a', 'flac', a('real.flac'))
  ff('-i', a('real.flac'), '-c:a', 'libmp3lame', '-b:a', '128k', a('m128.mp3'))
  ff('-i', a('m128.mp3'), '-c:a', 'flac', a('falso.flac'))
  ff('-i', a('m128.mp3'), '-c:a', 'libmp3lame', '-b:a', '320k', a('inflado.mp3'))
  ff('-i', a('real.flac'), '-c:a', 'libmp3lame', '-b:a', '320k', a('m320.mp3'))
  const b = fs.readFileSync(a('m320.mp3'))
  const p = b.toString('latin1', 0, 3) === 'ID3' ? 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) : 0
  const pocos = Buffer.from(b); for (const o of [p + 3000, p + 9000]) pocos.fill(0x41, o, o + 600)
  fs.writeFileSync(a('tropiezos.mp3'), pocos)
  const roto = Buffer.from(b); for (let i = 0; i < 40; i++) { const o = Math.floor(b.length * (0.1 + 0.8 * i / 40)); roto.fill(0x41, o, o + 600) }
  fs.writeFileSync(a('roto.mp3'), roto)
  return a
}

export const OPCIONES = (calidad: Calidad): NapiaOptions => ({ calidad, sacarRemaster: false, primeros: null, saltearTenes: false })

/**
 * Baja una lista con el sockseek de mentira como lo hace NAPIA (en tramos: core/sockseek/tramos.ts). `fuentes`: por título, los
 * usuarios que lo comparten y su archivo (con un tercer dato 'lenta', ese usuario nunca termina; con 'como:<nombre>', su archivo se
 * llama así). `arreglar`: el nombre y los tags (nombres.ts); `artista`: el de todos los temas (si no, "A"). `revisar: false`: sin
 * revisión (como sin ffmpeg). `tuyas`: por título, la copia que ya tenés (viene a reemplazarse). `jobs`: cuántos baja a la vez.
 * `lentitud`: vigila las fuentes lentas; con `muestra`, también un pedazo de cada tema mientras baja (muestra.ts). `tramo`: de a
 * cuántos temas (si no, 25); `frenar`: si hay que frenar antes de cada tramo. Devuelve, además, el estado de cada tema cuando arrancó cada tramo (`alArrancar`).
 */
export async function bajarLista(base: string, calidad: Calidad, fuentes: Record<string, ([string, string] | [string, string, 'lenta' | `como:${string}`])[]>, o: { revisar?: boolean; tuyas?: Record<string, CopiaTuya>; jobs?: number; lentitud?: Lentitud; arreglar?: ControlOpciones['arreglar']; artista?: string; tramo?: number; muestra?: boolean; frenar?: () => boolean } = {}) {
  const datos = path.join(base, 'datos'), destino = path.join(base, 'NAPIA')
  const trabajo = rutasTrabajo(datos, 'Lista')
  const carpeta = path.join(destino, carpetaLista('Lista'))
  const rows = Object.keys(fuentes).map((title) => ({ artist: o.artista ?? 'A', title, album: null, duration: null }))
  const env = { ...process.env, FALSO_FUENTES: JSON.stringify(fuentes), FALSO_JOBS: String(o.jobs ?? 1) }
  /** Cuándo llegó cada tema de la lista (bajado de sockseek) y cuándo se cortó cada fuente lenta: para ver que nadie esperó. */
  const llego = new Map<string, number>(), cortes: { titulos: string[]; at: number; muestra: string[] }[] = []
  const revisar = o.revisar === false ? null : (f: string, c: Calidad) => revisarArchivo(f, c, deps)
  const muestras: VigiaMuestras[] = []
  const vigilarDe = (r: SockseekRun, deOtra: boolean, dir: string) => {
    if (!o.lentitud) return () => {}
    const m = o.muestra && revisar ? new VigiaMuestras({ carpeta: dir, sacar: (f, ext) => sacarMuestra(ffmpeg, f, ext, path.join(base, 'muestras')), revisar: (f) => revisar(f, calidad), umbral: { fraccion: 0.3, minimo: 0 } }) : null
    if (m) muestras.push(m)
    return vigilar(() => r.progress.tracks, (ts) => {
      const truchas = ts.filter((t) => m?.trucha(t))
      cortes.push({ titulos: ts.map((t) => t.title), at: Date.now(), muestra: truchas.map((t) => t.title) })
      for (const t of ts) { const x = m?.trucha(t); if (x) control.porMuestra(t, x, deOtra); else control.lenta(t, deOtra) }
    }, (ls) => r.cortar(ls), o.lentitud, m ?? undefined)
  }
  const correr = (nombre: string, temas: Parameters<typeof sockseekCsv>[0], tracks: TrackProgress[] | null, indice: string, vetados: string[], onChange: (r: SockseekRun) => void) => {
    const csv = path.join(datos, 'listas', `${nombre}.csv`)
    fs.mkdirSync(path.dirname(csv), { recursive: true }); fs.writeFileSync(csv, sockseekCsv(temas))
    const args = buildArgs({ csvPath: csv, outputDir: trabajo.trabajo, options: OPCIONES(calidad), indexPath: indice, sinAcciones: true, vetados })
    const r: SockseekRun = new SockseekRun({ command: process.execPath, args: [FALSO, ...args], env }, tracks ?? temas, () => onChange(r))
    return r
  }
  const control = new ControlCalidad({ trabajo: trabajo.trabajo, carpeta, calidad, revisar, tuya: (f) => o.tuyas?.[f.title] ?? null, arreglar: o.arreglar })
  const vetadosPorRonda: string[][] = []
  const alArrancar: { at: number; temas: string[]; estados: Record<string, string | undefined> }[] = []
  const lista: ListaEnTramos<(typeof rows)[number]> = new ListaEnTramos({
    rows, indice: trabajo.indice, control, tamano: o.tramo, frenar: o.frenar ?? (() => false),
    correr: (filas, tracks) => {
      alArrancar.push({ at: Date.now(), temas: filas.map((f) => f.title), estados: Object.fromEntries(lista.tracks.map((t) => [t.title, t.calidad?.estado])) })
      return correr('Lista', filas, tracks, trabajo.indice, [], () => {
        for (const t of lista.tracks) if (t.state === 'bajado' && !llego.has(t.title)) llego.set(t.title, Date.now())
        control.ver(lista.tracks)
      })
    },
    vigilar: (r) => vigilarDe(r, false, trabajo.carpeta),
    otra: (filas, vetados) => {
      vetadosPorRonda.push(vetados)
      const indiceO = path.join(path.dirname(trabajo.indice), 'Lista - otra fuente.csv')
      fs.rmSync(indiceO, { force: true })
      const otra = correr('Lista - otra fuente', rows.filter((r) => filas.some((f) => f.title === r.title)), null, indiceO, vetados, (r) => control.verOtraFuente(r.progress.tracks))
      const dejarOtra = vigilarDe(otra, true, rutasTrabajo(datos, 'Lista - otra fuente').carpeta)
      return { tracks: () => otra.progress.tracks, done: otra.done.then((e) => { dejarOtra(); return e }) }
    },
  })
  await lista.bajar()
  control.reparto.cerrar(lista.tracks, trabajo.indice)
  anotarBajados(trabajo.indice, control.rescatados.map((f) => ({ artist: f.artist, title: f.title, path: f.path! })))
  const porTitulo = (t: string) => lista.tracks.find((x) => x.title === t)!
  return { control, lista, tracks: lista.tracks, porTitulo, carpeta, destino, trabajo, vetadosPorRonda, llego, cortes, alArrancar, muestras }
}
