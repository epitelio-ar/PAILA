// Medición de la intensidad del análisis (MASTERPLAN-2, 8.1): analiza la misma carpeta de temas en cada modo (Tranqui,
// Normal, A fondo) con workers en procesos aparte de prioridad baja, como la app, y mide tiempo, CPU, memoria por worker y
// cuánto se frena una tarea del usuario mientras tanto.
//
//   node scripts/run-ts.mjs scripts/intensidad.ts --carpeta <carpeta con copias de temas> [--modos normal,tranqui,fondo]
//
// Usar COPIAS de temas (nunca la biblioteca original). El aviso de medición lo deja y lo saca el propio script (scripts/turnos.mjs).
import { build } from 'esbuild'
import { externos } from './externos.mjs'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { tomarMedicion } from './turnos.mjs'
import { Library } from '@paila/core/library'
import { WorkerPool, forkSpawner } from '@paila/core/analysis/pool'
import { Slots } from '@paila/core/analysis/slots'
import { threadsFor } from '@paila/core/analysis/intensity'
import { findFfprobe } from '@paila/core/probe'
import type { Intensity } from '@paila/shared/types'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const FOLDER = arg('--carpeta', '')
const MODES = arg('--modos', 'normal,tranqui,fondo').split(',') as Intensity[]
if (!FOLDER) {
  console.error('Falta --carpeta (una carpeta con COPIAS de temas, fuera de la biblioteca).')
  process.exit(2)
}

/** Memoria (MB) de cada proceso, por número de proceso, y los ffmpeg que andan (tasklist es rápido y no carga la PC). */
function processes(): { pid: number; name: string; mb: number }[] {
  const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
  return out.split(/\r?\n/).filter(Boolean).map((l) => {
    const c = l.split('","').map((x) => x.replace(/^"|"$/g, ''))
    return { name: c[0], pid: Number(c[1]), mb: Number(c[4].replace(/[^\d]/g, '')) / 1024 }
  })
}

const cpuTimes = () => os.cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a }, { busy: 0, all: 0 })

/** "Tarea del usuario": un cálculo fijo a prioridad normal, cada 2 s, en otro proceso. Cuánto tarda = cuánto se frena la PC. */
function userTask() {
  const code = "setInterval(()=>{const t=performance.now();let x=0;for(let i=0;i<3e7;i++)x+=Math.sqrt(i);process.stdout.write(String(performance.now()-t)+'\\n')},2000)"
  const p = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  const ms: number[] = []
  p.stdout.on('data', (b) => { for (const l of String(b).split('\n')) if (l.trim()) ms.push(Number(l)) })
  return { take: () => ms.splice(0), stop: () => p.kill() }
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }

async function main() {
  await tomarMedicion('intensidad del análisis (Tranqui / Normal / A fondo)') // deja y saca solo el aviso de medición (scripts/turnos.mjs)
  const cache = path.resolve('node_modules/.cache/paila-run')
  fs.mkdirSync(cache, { recursive: true })
  const worker = path.join(cache, `analysis-worker-${process.pid}.mjs`)
  await build({ entryPoints: ['packages/core/analysis/worker.ts'], outfile: worker, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning', plugins: [externos] })
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-intensidad-'))
  const threads = os.availableParallelism()
  const rows: string[] = []
  try {
    let phaseAt = 0
    const lib = new Library(path.join(dbDir, 'paila.db'), findFfprobe(), (s) => { if (!phaseAt && s.phase.startsWith('Calculando BPM preciso')) phaseAt = Date.now() })
    await lib.addRoot(FOLDER, [{ rel: '', kind: 'musica' }])
    await lib.scan()
    const total = lib.trackCount()
    const user = userTask()
    await new Promise((r) => setTimeout(r, 7000))
    const idle = median(user.take())
    console.log(`${os.cpus()[0].model.trim()} · ${threads} hilos · ${total} temas · tarea del usuario sin análisis: ${idle.toFixed(0)} ms\n`)

    for (const mode of MODES) {
      lib.db.exec('DELETE FROM analysis')
      const n = threadsFor(mode, threads)
      const before = new Set(processes().filter((p) => p.name === 'ffmpeg.exe').map((p) => p.pid))
      const pool = new WorkerPool(forkSpawner(worker), n)
      const slots = new Slots(n)
      const mem: { worker: number; ffmpeg: number; workers: number; ffmpegs: number }[] = []
      let c0 = cpuTimes()
      const cpu: number[] = []
      const sampler = setInterval(() => {
        const ps = processes(), pids = new Set(pool.pids)
        const w = ps.filter((p) => pids.has(p.pid)), f = ps.filter((p) => p.name === 'ffmpeg.exe' && !before.has(p.pid))
        if (w.length) mem.push({ worker: w.reduce((a, p) => a + p.mb, 0), ffmpeg: f.reduce((a, p) => a + p.mb, 0), workers: w.length, ffmpegs: f.length })
        const c1 = cpuTimes()
        cpu.push((100 * (c1.busy - c0.busy)) / Math.max(1, c1.all - c0.all))
        c0 = c1
      }, 2000)
      user.take()
      phaseAt = 0
      const t0 = Date.now()
      const s = await lib.analyze(pool, ffmpeg, slots)
      const t1 = Date.now()
      clearInterval(sampler)
      await pool.close()
      const fullS = ((phaseAt || t1) - t0) / 1000, allS = (t1 - t0) / 1000
      const perWorker = mem.length ? median(mem.map((m) => m.worker / m.workers)) : NaN
      const perFfmpeg = mem.filter((m) => m.ffmpegs).length ? median(mem.filter((m) => m.ffmpegs).map((m) => m.ffmpeg / m.ffmpegs)) : NaN
      const peak = mem.length ? Math.max(...mem.map((m) => m.worker + m.ffmpeg)) : NaN
      const task = median(user.take())
      const line = `| ${mode} | ${n} | ${fullS.toFixed(0)} s | ${(total / (fullS / 60)).toFixed(1)} | ${allS.toFixed(0)} s | ${median(cpu).toFixed(0)} % | ${perWorker.toFixed(0)} MB | ${perFfmpeg.toFixed(0)} MB | ${peak.toFixed(0)} MB | ${task.toFixed(0)} ms (${((task / idle - 1) * 100).toFixed(0)} %) | ${s.errors} |`
      console.log(line)
      rows.push(line)
      await new Promise((r) => setTimeout(r, Number(arg("--pausa", "20")) * 1000)) // que se enfríe un poco antes del próximo modo
    }
    user.stop()
    lib.close()
    console.log('\n| Modo | Temas a la vez | Análisis | Temas/min | Con BPM preciso | CPU (mediana) | Memoria por worker | por ffmpeg | Pico total | Tarea del usuario | Errores |')
    console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    for (const r of rows) console.log(r)
  } finally {
    fs.rmSync(dbDir, { recursive: true, force: true })
    fs.rmSync(worker, { force: true })
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
