// Del lado del proceso principal: lo que "Arreglar nombres" calcula en un hilo aparte (core/tidyworker.ts), para no trabar
// la ventana. Tres pedidos: los números de los perfiles (la pantalla se abre con el perfil elegido y los demás llegan después),
// los nombres limpios de la lista «Faltan o suenan mal» (core/wanted.ts: primero la lista con los tags, después se limpian) y
// los nombres que Ordenar suma sola (core/revision-armar.ts).
// Vale solo el último pedido de cada uno: si se pide otro (se eligió otro perfil o se tocó una regla), el anterior se corta
// y contesta null.
import { Worker } from 'node:worker_threads'
import { textos, type Idioma } from '@paila/shared/idioma'
import type { TidyRule } from '@paila/shared/tidy-profiles'
import type { TidyProfileCount } from '@paila/shared/types'
import type { TidyChange } from './tidy'
import type { Proposal } from './tagactions'

const T = textos({ cortado: { es: 'La cuenta de los perfiles se cortó', en: 'Counting the profiles stopped' } })

/** Lo que recibe el hilo: la base, la carpeta de cada raíz (por id), el idioma, las reglas elegidas y lo que ya proponen. */
export interface ProfilesJob { file: string; roots: Record<number, string>; idioma: Idioma; rules: TidyRule[]; changes?: TidyChange[]; nombres?: false }
/** Los nombres de la lista «Faltan o suenan mal»: lo que "Arreglar nombres" propone para artista y título, con esas reglas. */
export interface NamesJob { file: string; idioma: Idioma; rules?: TidyRule[]; nombres: true }
/** Ordenar (core/revision-armar.ts): los nombres que proponen las reglas elegidas, listos para Cambios pendientes. */
export interface ArmarJob { file: string; roots: Record<number, string>; idioma: Idioma; rules: TidyRule[]; armar: true; nombres?: false }

class TidyRunner<J, R> {
  private current: { worker: Worker; stop: () => void } | null = null

  /** `script`: el hilo ya armado (out/main/tidy-worker.js). */
  constructor(private script: string) {}

  run(job: J): Promise<R | null> {
    this.cancel()
    return new Promise((resolve, reject) => {
      const w = new Worker(this.script, { workerData: job })
      let done = false
      const end = () => { done = true; if (this.current?.worker === w) this.current = null; void w.terminate() }
      this.current = { worker: w, stop: () => { if (!done) { end(); resolve(null) } } }
      w.once('message', (m: { ok: boolean; result?: R; error?: string }) => {
        if (done) return
        end()
        if (m.ok) resolve(m.result!); else reject(new Error(m.error))
      })
      w.once('error', (e) => { if (!done) { end(); reject(e) } })
      w.once('exit', () => { if (!done) { end(); reject(new Error(T.cortado)) } })
    })
  }

  /** Corta el pedido en curso (contesta null). */
  cancel() { this.current?.stop() }
}

export class TidyProfilesRunner extends TidyRunner<ProfilesJob, TidyProfileCount[]> {}
export class TidyNamesRunner extends TidyRunner<NamesJob, TidyChange[]> {}
export class TidyArmarRunner extends TidyRunner<ArmarJob, { p: Proposal[]; dudosos: Proposal[] }> {}
