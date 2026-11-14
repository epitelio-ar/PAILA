// Guarda el espectro promedio (como lo acumula PAILA: mono, 4096 puntos, un cuadro de cada dos, sin silencios) de cada tema de la muestra.
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { SpectrumAccumulator } from '@paila/core/analysis/fft'
const [ffmpeg, muestra, out, hilos] = process.argv.slice(2)
const rows = fs.readFileSync(muestra, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split('\t'))
const res: Record<string, { frames: number; db: number[]; log: number[] }> = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {}
const N = 4096
function one(file: string): Promise<{ frames: number; db: number[]; log: number[] }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-threads', '1', '-i', file, '-af', 'aresample=44100,aformat=sample_fmts=flt:channel_layouts=stereo', '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] })
    const acc = new SpectrumAccumulator(N); const frame = new Float32Array(N); let fpos = 0, fc = 0; let left: Buffer = Buffer.alloc(0)
    p.stdout.on('data', (c: Buffer) => {
      const buf = left.length ? Buffer.concat([left, c]) : c; const u = buf.length - (buf.length % 8)
      const f = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + u))
      for (let o = 0; o < f.length; o += 2) { frame[fpos++] = (f[o] + f[o + 1]) * 0.5; if (fpos === N) { if ((fc++ & 1) === 0) acc.add(frame); fpos = 0 } }
      left = buf.subarray(u)
    })
    p.on('error', reject)
    p.on('close', () => resolve({ frames: acc.frames, db: Array.from(acc.power, (x) => Math.round(Math.max(-160, 10 * Math.log10(x / Math.max(1, acc.frames) + 1e-30)) * 100) / 100), log: Array.from(acc.logPower, (x) => Math.round((x / Math.max(1, acc.frames)) * 100) / 100) }))
  })
}
let next = 0
await Promise.all(Array.from({ length: Number(hilos) || 2 }, async () => { while (next < rows.length) { const r = rows[next++]; if (!res[r[0]]) res[r[0]] = await one(r[13]) } }))
fs.writeFileSync(out, JSON.stringify(res)); console.log('listo', Object.keys(res).length)
