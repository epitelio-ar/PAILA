// Motor de la grilla en la app (Fase F): el proceso que lee el audio (out/main/grid-worker.js, aparte del principal, con
// prioridad baja) y, si hay, la placa de video para Beat This! (beatgpu.ts). Elige solo: placa de video → Beat This! en
// el procesador (lento) → degara (rápido). Antes era un hilo del proceso principal: con un mix de 77 minutos (más de 1 GB de
// audio en memoria) la app dejaba de responder y las escrituras que estaban en curso no terminaban (punto 1 real del 24/10).
// Cómo se le habla al proceso (y qué pasa si se cierra o se traba): core/analysis/gridproc.ts.
import path from 'node:path'
import { app, utilityProcess } from 'electron'
import { beatThisMissing } from '@paila/core/analysis/beatrun'
import type { GridAnalysis } from '@paila/core/analysis/gridscan'
import type { GridEngineKind, GridWorkerIn, GridWorkerOut } from '@paila/core/analysis/gridworker'
import { GridRunner, type GridPort } from '@paila/core/analysis/gridproc'
import { SECONDS_PER_TRACK } from '@paila/core/gridrun'
import { lowPriority } from '@paila/core/lowpriority'
import type { GridEngineInfo } from '@paila/shared/types'
import { idioma } from '@paila/shared/idioma'
import { BeatGpu } from './beatgpu'

export const MODELS_SETTING = 'models_dir'

/** La carpeta de Beat This! que viaja con PAILA (resources/modelos, en el instalador y en la portable). En desarrollo no hay. */
export function installedModels(): string | null {
  if (!app.isPackaged) return null
  const dir = path.join(process.resourcesPath, 'modelos')
  return beatThisMissing(dir) ? null : dir
}

/** Qué carpeta de modelos se usa: la que eligió la persona si anda; si no, la que viaja con PAILA; si ninguna, la elegida (para decir qué le falta). */
export function modelsFolder(chosen: string | null): string | null {
  return chosen && !beatThisMissing(chosen) ? chosen : installedModels() ?? chosen
}

/** El proceso de la grilla como proceso de Electron aparte, con prioridad baja (lo que se le manda antes de que arranque, espera). */
const utilityPort = (script: string): GridPort => {
  // el idioma de ahora, para los errores que se ven
  const p = utilityProcess.fork(script, [], { serviceName: 'PAILA - grilla', stdio: 'ignore', env: { ...process.env, PAILA_IDIOMA_PROCESO: idioma() } })
  const queue: GridWorkerIn[] = []
  let ready = false, gone = false
  p.once('spawn', () => { lowPriority(p.pid); ready = true; for (const m of queue.splice(0)) p.postMessage(m) })
  p.once('exit', () => { gone = true })
  return {
    // lo que llega para un proceso ya cerrado (un pedazo de la placa de video, después de «Saltear este») se descarta
    post: (m) => { if (gone) return; if (ready) p.postMessage(m); else queue.push(m) },
    onMessage: (cb) => p.on('message', (m: GridWorkerOut) => cb(m)),
    onExit: (cb) => p.once('exit', cb),
    kill: () => { if (!gone) p.kill() },
  }
}

export class GridEngine {
  readonly gpu: BeatGpu
  private runner: GridRunner
  /** Hay una pasada de grilla en curso: el análisis no arranca solo mientras tanto. */
  active = false

  constructor(script: string, private ffmpeg: string, private modelsDir: () => string | null) {
    this.gpu = new BeatGpu(modelsDir)
    this.runner = new GridRunner(() => utilityPort(script), (spect) => this.gpu.model(spect))
  }

  /** Qué motor hay: prueba la placa de video la primera vez (carga el modelo, unos segundos). */
  async info(probe: boolean): Promise<GridEngineInfo> {
    const dir = this.modelsDir()
    const missing = beatThisMissing(dir)
    if (!missing && probe && !this.gpu.gpu && !this.gpu.failure) await this.gpu.start().catch(() => null)
    const engine: GridEngineKind = missing ? 'degara' : this.gpu.gpu ? 'gpu' : this.gpu.failure ? 'cpu' : 'gpu'
    return { beatThis: !missing, gpu: this.gpu.gpu, missing: missing ?? this.gpu.failure, modelsDir: dir, secondsPerTrack: SECONDS_PER_TRACK[engine] }
  }

  /** El motor que se va a usar (después de `info(true)`). */
  kind(): GridEngineKind {
    if (beatThisMissing(this.modelsDir())) return 'degara'
    return this.gpu.gpu ? 'gpu' : 'cpu'
  }

  /** La grilla de un archivo con el motor elegido. Con la placa de video, 3 pedazos; con el procesador, 2 (tarda ~13 s cada uno). */
  run(file: string, engine: GridEngineKind = this.kind()): Promise<GridAnalysis> {
    return this.runner.run({ ffmpeg: this.ffmpeg, file, engine, modelsDir: this.modelsDir(), windows: engine === 'gpu' ? 3 : 2 })
  }

  /** «Saltear este»: el tema en curso queda sin grilla y la pasada sigue con el próximo. */
  skip(): boolean {
    return this.runner.skip()
  }

  close() {
    this.gpu.close()
    this.runner.close()
  }
}

export const gridWorkerScript = (dir: string) => path.join(dir, 'grid-worker.js')
