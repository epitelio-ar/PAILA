// IPC de Separar voz (masterplan 4, 4B.6): la sección de DJ y producción. Una cola de temas que se separan de a uno en un
// proceso aparte con prioridad baja (core/stems/worker.ts, 4 hilos como mucho). Mientras dura, el análisis espera; al final
// cada tema se guarda con el candado tomado, por el motor (core/stems/separar.ts). El modelo se baja aparte, verificado.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dialog, ipcMain, net, shell, utilityProcess, type UtilityProcess } from 'electron'
import type { Ctx } from '../context'
import type { StemsInfo, StemsModo, StemsTema } from '@paila/shared/types'
import { CUATRO_FILES, MAX_FILES, STEMS_BYTES, STEMS_DIR, bajarStems, faltaBajar, quitarCuatro, quitarMax, quitarStems, stemsToDownload, type FetchLike } from '@paila/core/stems/modelo'
import { STEMS_WARN, bajaCalidad as esBaja, type StemsPart } from '@paila/core/stems/separar'
import type { StemsIn, StemsOut } from '@paila/core/stems/worker'
import { PARTES_DE, type StemsJob } from '@paila/core/stems/correr'
import { lowPriority } from '@paila/core/lowpriority'
import { cant, idioma, textos } from '@paila/shared/idioma'

const T = textos({
  bajando: { es: 'Bajando el modelo para separar voz', en: 'Downloading the voice separation model' },
  listo: { es: 'El modelo para separar voz está listo', en: 'The voice separation model is ready' },
  separando: { es: 'Separando voz e instrumental', en: 'Separating vocals and instrumental' },
  bajando4: { es: 'Bajando el modelo para separar en 4', en: 'Downloading the 4-part separation model' },
  bajandoMax: { es: 'Bajando los modelos de máxima calidad', en: 'Downloading the maximum quality models' },
  listoMax: { es: 'Los modelos de máxima calidad están listos', en: 'The maximum quality models are ready' },
  faltaMax: { es: 'Primero bajá los modelos de máxima calidad', en: 'Download the maximum quality models first' },
  listo4: { es: 'El modelo para separar en 4 está listo', en: 'The 4-part separation model is ready' },
  sinDisco: { es: 'El disco de la carpeta de destino no está conectado: enchufalo y probá de nuevo', en: "The destination folder's disk isn't connected: plug it in and try again" },
  temaNoEsta: { es: (n: string) => `No se encuentra «${n}»: ¿está conectado el disco donde está?`, en: (n: string) => `Can't find «${n}»: is the disk it's on connected?` },
  falta4: { es: 'Primero bajá el modelo para separar en 4', en: 'Download the 4-part separation model first' },
  separados: { es: (n: number, f: number) => `${cant(n, 'tema separado', 'temas separados')}${f ? ` · ${cant(f, 'no se pudo', 'no se pudieron')}` : ''}`, en: (n: number, f: number) => `${cant(n, 'track separated', 'tracks separated')}${f ? ` · ${f} couldn't be` : ''}` },
  faltaModelo: { es: 'Primero bajá el modelo para separar voz', en: 'Download the voice separation model first' },
  elegir: { es: 'Carpeta para lo que separes', en: 'Folder for what you separate' },
  seCerro: { es: 'El proceso de separar se cerró', en: 'The separation process closed' },
  noEsPropio: { es: 'Ese archivo no lo separó PAILA', en: "PAILA didn't separate that file" },
  esperandoCandado: { es: 'Esperando que PAILA termine de cambiar archivos para guardarlo', en: 'Waiting for PAILA to finish changing files to save it' },
})

/** Mientras se separa, el análisis no arranca (lo mira main.ts) y se retoma solo al terminar. */
export const separando = { activo: false }

/** El proceso aparte: se abre al empezar la cola y se cierra al terminarla (devuelve la memoria del modelo). */
class StemsProcess {
  private p: UtilityProcess | null = null
  private pend = new Map<number, { ok: (s: number) => void; mal: (e: Error) => void; avance: (d: number, t: number) => void }>()
  private seq = 0
  constructor(private script: string) {}
  private abrir() {
    const p = utilityProcess.fork(this.script, [], { serviceName: 'PAILA - separar voz', stdio: 'ignore', env: { ...process.env, PAILA_IDIOMA_PROCESO: idioma() } })
    p.once('spawn', () => lowPriority(p.pid))
    p.on('message', (m: StemsOut) => {
      const w = this.pend.get(m.id)
      if (!w) return
      if (m.type === 'avance') return w.avance(m.done, m.total)
      this.pend.delete(m.id)
      if (m.type === 'listo') w.ok(m.seconds); else w.mal(new Error(m.error))
    })
    p.once('exit', () => { this.p = null; for (const w of this.pend.values()) w.mal(new Error(T.seCerro)); this.pend.clear() })
    this.p = p
    return p
  }
  run(job: StemsJob, avance: (d: number, t: number) => void): Promise<number> {
    const p = this.p ?? this.abrir(), id = ++this.seq
    return new Promise((ok, mal) => { this.pend.set(id, { ok, mal, avance }); p.postMessage({ type: 'separar', id, job } satisfies StemsIn) })
  }
  cortar() { this.p?.postMessage({ type: 'cortar' } satisfies StemsIn) }
  cerrar() { this.p?.kill(); this.p = null }
}

export function registerSeparar(c: Ctx, dir: string) {
  const s = c.stems
  const modelDir = path.join(c.userData, 'modelos', STEMS_DIR)
  const proc = new StemsProcess(path.join(dir, 'stems-worker.js'))
  const threads = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)))
  // cada tema con su modo: voz e instrumental, o en 4 (el mismo tema puede ir una vez de cada uno)
  let cola: { id: number; modo: StemsModo }[] = []
  let actual: StemsInfo['actual'] = null
  const ritmo = () => Number(c.setting('stems_ritmo')) || 2.2

  // lo que falta bajar para separar en 4: el modelo, y el motor si todavía no se bajó para Separar voz
  // los modelos de cada modo (el motor es el mismo para los tres)
  const FILES = { voz: undefined, cuatro: CUATRO_FILES, max: MAX_FILES } as const
  const falta = (m: StemsModo) => stemsToDownload(modelDir, FILES[m])
  const info = (): StemsInfo => ({
    modelo: { ready: !stemsToDownload(modelDir), bytes: STEMS_BYTES }, cuatro: { ready: !falta('cuatro'), bytes: faltaBajar(modelDir, CUATRO_FILES) || CUATRO_FILES[0].bytes },
    max: { ready: !falta('max'), bytes: faltaBajar(modelDir, MAX_FILES) || MAX_FILES.slice(0, 4).reduce((n, f) => n + f.bytes, 0) },
    destino: s.destination(), destino4: s.destination(true), actual, avisaEn: [...STEMS_WARN], ritmo: ritmo(),
    cola: cola.flatMap(({ id, modo }) => { const t = s.tema(id); return t ? [{ id: t.id, name: t.name, duration: t.duration, grade: t.grade, bpm: t.bpm, musicKey: t.musicKey, modo }] : [] }),
    esperando: s.esperando(), hechos: s.made(),
  })
  const avisar = () => c.send('separar:cambio', info())

  // espera a que nadie más esté cambiando archivos (el candado no espera: si está tomado, tira error)
  const conCandado = async <R>(fn: () => Promise<R>, cancelled: () => boolean): Promise<R> => {
    while (c.lib.ops.busy && !cancelled()) await new Promise((r) => setTimeout(r, 2000))
    return c.withPaused(fn)
  }

  const correr = () => c.jobs.run('separar', T.separando, async (h) => {
    let hechos = 0
    const errores: { name: string; error: string }[] = []
    const release = c.lib.hold('separar') // el análisis se pausa y lo prende PAILA cuando terminaron todos los que lo pausaron
    separando.activo = true
    s.limpiarTrabajo()
    try {
      while (cola.length && !h.cancelled()) {
        const { id, modo } = cola[0], t = s.tema(id)
        const dest = s.destination(modo !== 'voz', t?.rootId)
        if (!t || !dest.available) { errores.push({ name: t?.name ?? String(id), error: dest.error ?? '' }); cola.shift(); continue }
        actual = { id, done: 0, total: 1 }; avisar()
        h.update({ current: t.name, done: 0, total: 1, errors: errores.length })
        const staging = s.staging(dest)
        const staged: Partial<Record<StemsPart, string>> = Object.fromEntries(PARTES_DE[modo].map((p) => [p, path.join(staging, `${p}.flac`)]))
        try {
          const t0 = Date.now()
          const cancel = setInterval(() => { if (h.cancelled()) proc.cortar() }, 500)
          const seconds = await proc.run({ file: t.abs, modo, salidas: staged, dir: modelDir, ffmpeg: c.ffmpeg, threads },
            (done, total) => { actual = { id, done, total }; h.update({ done, total }); c.send('separar:cambio', { ...info(), actual }) }).finally(() => clearInterval(cancel))
          if (seconds > 30 && modo === 'voz') c.setSetting('stems_ritmo', String(Math.round((ritmo() * 0.5 + ((Date.now() - t0) / 1000 / seconds) * 0.5) * 100) / 100))
          h.update({ current: T.esperandoCandado })
          const r = await conCandado(() => s.place(id, staged, modo), h.cancelled)
          if (r.done) hechos++
          errores.push(...r.failed)
          s.dejarDeEsperar(id)
        } catch (e) {
          if (!h.cancelled()) errores.push({ name: t.name, error: (e as Error).message })
        } finally {
          s.dropStaging(staging)
        }
        cola.shift(); actual = null
        h.update({ errors: errores.length, problems: errores.slice(-20) })
        avisar()
      }
    } finally {
      if (h.cancelled()) cola = []
      actual = null; separando.activo = false
      proc.cerrar()
      release()
      if (!c.lib.status.running && !c.lib.held) c.analyze().catch(() => null)
      avisar()
    }
    return { hechos, fallados: errores.length }
  }, (r) => T.separados(r.hechos, r.fallados))

  ipcMain.handle('separar:info', () => info())
  ipcMain.handle('separar:bajar', (_e, cual: StemsModo = 'voz') => c.jobs.run('separar-modelo', { voz: T.bajando, cuatro: T.bajando4, max: T.bajandoMax }[cual], async (h) => {
    await bajarStems(modelDir, ((url: string) => net.fetch(url)) as FetchLike, { progress: (done, total) => h.update({ done: Math.round(done / 1e6), total: Math.round(total / 1e6) }), cancelled: h.cancelled }, FILES[cual])
    return info()
  }, () => ({ voz: T.listo, cuatro: T.listo4, max: T.listoMax }[cual])))
  // "Quitar" de Separar voz saca todo (también el de 4); el de 4 saca solo su modelo
  ipcMain.handle('separar:quitar', (_e, cual: StemsModo = 'voz') => { if (!c.jobs.isRunning('separar')) ({ voz: quitarStems, cuatro: quitarCuatro, max: quitarMax }[cual])(modelDir); return info() })
  ipcMain.handle('separar:buscar', (_e, q: string) => s.buscar(q))
  ipcMain.handle('separar:sumar', (_e, ids: number[], igual: boolean, modo: StemsModo = 'voz') => {
    if (falta(modo)) throw new Error({ voz: T.faltaModelo, cuatro: T.falta4, max: T.faltaMax }[modo])
    // sin el disco de la carpeta de destino (o el del tema) no se puede: se dice al tocar "Separar", no después en silencio (31/10)
    const bajaCalidad: StemsTema[] = []
    for (const id of ids) {
      const t = s.tema(id)
      if (!t || cola.some((x) => x.id === id && x.modo === modo)) continue
      if (!fs.existsSync(t.abs)) throw new Error(T.temaNoEsta(t.name))
      const dest = s.destination(modo !== 'voz', t.rootId)
      if (!dest.available) throw new Error(dest.error ?? T.sinDisco)
      if (!igual && esBaja(t.grade)) { bajaCalidad.push({ id: t.id, name: t.name, duration: t.duration, grade: t.grade, bpm: t.bpm, musicKey: t.musicKey }); continue }
      cola.push({ id, modo }); s.dejarDeEsperar(id)
    }
    if (cola.length && !c.jobs.isRunning('separar')) void correr().catch(() => null)
    avisar()
    return { info: info(), bajaCalidad }
  })
  ipcMain.handle('separar:esperar', (_e, ids: number[]) => {
    for (const id of ids) c.wanted.setStatus(`f${id}`, 'pendiente')
    s.esperar(ids)
    return info()
  })
  ipcMain.handle('separar:sacar', (_e, id: number) => {
    cola = cola.filter((x, i) => x.id !== id || (i === 0 && actual?.id === id))
    s.dejarDeEsperar(id)
    return info()
  })
  ipcMain.handle('separar:carpeta', async () => {
    const r = await dialog.showOpenDialog(c.win()!, { title: T.elegir, defaultPath: s.destination().abs ?? undefined, properties: ['openDirectory', 'createDirectory'] })
    if (!r.canceled && r.filePaths[0]) s.choose(r.filePaths[0])
    return info()
  })
  ipcMain.handle('separar:deFabrica', () => { s.choose(null); return info() })
  // solo lo que separó PAILA (no cualquier ruta que llegue de la pantalla)
  const propio = (file: string) => { if (!s.made().some((m) => Object.values(m.partes).includes(file))) throw new Error(T.noEsPropio); return file }
  ipcMain.handle('separar:escuchar', (_e, file: string) => `paila://audio/${c.registerCandidate(propio(file))}`)
  ipcMain.handle('separar:mostrar', (_e, file: string) => shell.showItemInFolder(propio(file)))
}
