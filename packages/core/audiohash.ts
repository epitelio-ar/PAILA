// Huella del sonido: MD5 del audio ya decodificado (no del archivo). Si dos archivos tienen la misma huella, suenan
// idéntico bit a bit, aunque cambien los tags, la tapa o el contenedor. Es la prueba de que PAILA no tocó el audio.
import { spawn } from 'node:child_process'
import { lowPriority } from './lowpriority'

/**
 * Decodifica el primer audio del archivo a PCM de 32 bits (no recorta los de 24 bits) y devuelve su MD5.
 * Corre con prioridad baja. Si el archivo no se puede decodificar, tira un error con el último mensaje de ffmpeg.
 */
export function pcmHash(ffmpeg: string, file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-c:a', 'pcm_s32le', '-f', 'md5', '-'], { windowsHide: true })
    lowPriority(p.pid)
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => {
      const md5 = out.match(/MD5=([0-9a-f]+)/i)?.[1]
      if (code === 0 && md5) resolve(md5)
      else reject(new Error(err.trim().split(/\r?\n/).pop() || `ffmpeg terminó con código ${code}`))
    })
  })
}
