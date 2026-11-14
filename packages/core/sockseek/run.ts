// NAPIA: correr sockseek como proceso hijo, leer su avance línea por línea y cancelarlo sin dejar procesos colgados.
// En Windows se corta el árbol entero (taskkill /T /F): sockseek puede haber lanzado acciones al terminar (on-complete).
// También: saber si SoulseekQt está abierto (con la misma cuenta, sockseek no puede entrar). El firewall de Windows (si deja
// entrar conexiones a sockseek en la red de ahora) está en firewall.ts.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import readline from 'node:readline'
import { Progress, type Row } from './progress'
import type { TrackProgress } from '@paila/shared/napia'
import { textos } from '@paila/shared/idioma'

const T = textos({
  noAbre: { es: (m: string) => `No se pudo abrir sockseek: ${m}`, en: (m: string) => `Couldn't open sockseek: ${m}` },
})

export interface RunSpec {
  command: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface RunEnd { exitCode: number | null; cancelled: boolean }

/** Corta un proceso y todos los que lanzó. */
export function killTree(pid: number) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  else { try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* ya terminó */ } } }
}

export class SockseekRun {
  readonly progress: Progress
  private child: ChildProcess | null = null
  private cancelled = false
  /** La cortó NAPIA porque solo quedaban fuentes muy lentas (lentitud.ts): no es un "Cortar" de la persona. */
  private cortada: Set<TrackProgress> | null = null
  /** Se resuelve cuando sockseek terminó (bien, mal o cancelado). */
  readonly done: Promise<RunEnd>

  constructor(spec: RunSpec, rows: Row[], onChange: () => void) {
    this.progress = new Progress(rows)
    this.done = new Promise<RunEnd>((resolve) => {
      let child: ChildProcess
      try {
        child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env ?? process.env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) {
        this.progress.problem = { kind: 'noArranco', text: T.noAbre((e as Error).message) }
        resolve({ exitCode: null, cancelled: false })
        return
      }
      this.child = child
      const lines = (s: NodeJS.ReadableStream, fn: (l: string) => boolean) => readline.createInterface({ input: s }).on('line', (l) => { if (fn(l)) onChange() })
      const out = new Promise((r) => lines(child.stdout!, (l) => this.progress.stdout(l)).on('close', r))
      const err = new Promise((r) => lines(child.stderr!, (l) => this.progress.stderr(l)).on('close', r))
      child.on('error', (e) => { this.progress.problem = { kind: 'noArranco', text: T.noAbre(e.message) } })
      child.on('close', (code) => {
        void Promise.all([out, err]).then(() => {
          this.child = null
          if (this.cancelled || this.cortada) this.progress.cancelPending(this.cortada ?? undefined)
          resolve({ exitCode: code, cancelled: this.cancelled })
        })
      })
    })
  }

  get pid() { return this.child?.pid ?? null }

  /** Corta sockseek y lo que haya lanzado. Lo que estaba a medio bajar queda como .incomplete y se retoma la próxima vez. */
  async cancel(): Promise<RunEnd> {
    if (this.child?.pid) { this.cancelled = true; killTree(this.child.pid) }
    return this.done
  }

  /**
   * Corta sockseek porque lo único que queda son fuentes muy lentas (lentitud.ts; quien llama ya anotó esos temas para buscarlos
   * en otro usuario: no quedan como cancelados). Termina como si hubiera terminado sola (`cancelled` false): la lista sigue.
   */
  cortar(lentas: TrackProgress[] = []) {
    if (this.child?.pid && !this.cancelled) { this.cortada = new Set(lentas); killTree(this.child.pid) }
  }
}

/** ¿Hay un programa con ese nombre abierto? (por ejemplo SoulseekQt.exe; en Mac, SoulseekQt). En otros sistemas, false. */
export function isProgramOpen(image: string): boolean {
  if (process.platform === 'darwin') {
    const want = image.replace(/\.exe$/i, '').toLowerCase()
    const r = spawnSync('ps', ['-axo', 'comm='], { encoding: 'utf8', timeout: 15_000 })
    return (r.stdout ?? '').split(/\r?\n/).some((l) => (l.trim().split('/').pop() ?? '').toLowerCase() === want)
  }
  if (process.platform !== 'win32') return false
  const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
  return (r.stdout ?? '').toLowerCase().includes(`"${image.toLowerCase()}"`)
}

/** ¿Hay una ventana con ese título abierta? (para no abrir PAILA dos veces). Solo Windows. */
export function isWindowOpen(title: string): boolean {
  if (process.platform !== 'win32') return false
  const r = spawnSync('tasklist', ['/FI', `WINDOWTITLE eq ${title}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
  return /^"/m.test(r.stdout ?? '')
}
