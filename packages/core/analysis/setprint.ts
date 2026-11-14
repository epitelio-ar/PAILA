// Huella acústica de un set entero (un enganchado, un recital): la misma de Chromaprint que tiene cada tema, pero sin el
// tope de 120 s. Una sola lectura del archivo con ffmpeg en prioridad baja; ~10 s para una hora de WAV.
import { spawn } from 'node:child_process'
import { lowPriority } from '../lowpriority'
import { T } from './errores.textos'
import { CHROMA_SAMPLE_RATE, Chromaprinter, chromaFilter } from './chromaprint'

export interface SetPrintJob {
  ffmpeg: string
  file: string
  channels: number | null
  /** Duración que dice la base (para el avance). */
  duration: number | null
  /** Desde qué segundo y cuántos segundos (para escuchar solo un tramo; por defecto, todo). */
  from?: number
  seconds?: number
  /** Velocidad a la que se lee (1 = como está; 1,04 = un 4 % más rápido y más agudo, como un disco de vinilo). */
  speed?: number
  onProgress?: (fraction: number) => void
  isCancelled?: () => boolean
}

/** La huella del set (sin tope de largo) y cuántos segundos de audio se leyeron. Rechaza si ffmpeg no pudo leerlo. */
export function setPrint(job: SetPrintJob): Promise<{ fp: Uint32Array; seconds: number }> {
  const speed = job.speed ?? 1
  // cambiar la velocidad como un tocadiscos: se reinterpreta la frecuencia de muestreo y se vuelve a la de la huella
  const pre = speed !== 1 ? `aresample=44100,asetrate=${Math.round(44100 * speed)},` : ''
  const args = ['-threads', '1', '-v', 'error', '-nostdin',
    ...(job.from ? ['-ss', String(job.from)] : []), ...(job.seconds ? ['-t', String(job.seconds)] : []),
    '-i', job.file, '-filter_complex', `[0:a:0]${pre}${chromaFilter(job.channels)}[o]`, '-map', '[o]', '-f', 's16le', 'pipe:1']
  return new Promise((resolve, reject) => {
    const p = spawn(job.ffmpeg, args, { windowsHide: true })
    lowPriority(p.pid)
    const cp = new Chromaprinter(Number.MAX_SAFE_INTEGER / CHROMA_SAMPLE_RATE)
    const expected = ((job.seconds ?? job.duration ?? 0) / speed) * CHROMA_SAMPLE_RATE
    let samples = 0, odd: number | null = null, lastTick = 0, stderr = '', cancelled = false
    p.stdout.on('data', (chunk: Buffer) => {
      if (cancelled) return
      if (job.isCancelled?.()) { cancelled = true; p.kill(); return }
      let b = chunk
      if (odd !== null) { b = Buffer.concat([Buffer.from([odd]), chunk]); odd = null }
      if (b.length & 1) { odd = b[b.length - 1]; b = b.subarray(0, b.length - 1) }
      // copia alineada: el Buffer puede empezar en una posición impar
      const s = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))
      cp.feed(s)
      samples += s.length
      if (expected > 0 && samples - lastTick > CHROMA_SAMPLE_RATE * 30) { lastTick = samples; job.onProgress?.(Math.min(1, samples / expected)) }
    })
    p.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20_000) stderr = stderr.slice(-10_000) })
    p.on('error', reject)
    p.on('close', (code) => {
      if (cancelled) return reject(new Error('Cancelado'))
      const fp = cp.finish()
      if (code !== 0 && !fp.length) return reject(new Error(stderr.trim().split('\n').pop() || T.ffmpegCodigo(code)))
      resolve({ fp, seconds: samples / CHROMA_SAMPLE_RATE })
    })
  })
}
