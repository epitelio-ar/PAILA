// Tags en WMA (ASF). La librería de tags los rompía al guardar; se escriben re-empaquetando con el ffmpeg de PAILA, sin
// recodificar (-c copy), con el mismo tamaño de paquete que el original (así el archivo queda casi igual: 646 paquetes en "Día de
// sol" de La Renga, como antes) y sin agregar el tag del programa. Probado el 24/10 con un WMA de la Música (MP4 4B.7): el audio
// decodificado queda idéntico (misma huella) y los tags nuevos los leen ffprobe, la librería de PAILA y Windows (el Explorador).
// Solo los datos de texto y el volumen parejo, con las claves que lee la librería ("WM/Year", "ReplayGain/Track"…). Un WMA con la
// tapa adentro no: ffmpeg la reescribe como un "video" dentro del archivo (tagio.ts, cantWrite). Lo usa core/changes-write.ts
// dentro del motor de siempre: temporal, verificación de tags y de la huella, respaldo y deshacer.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { readCover, type ReplayGain } from './tagio'
import { T } from './tagio.textos'

/** Lo que se le puede escribir a un WMA. */
export const ASF_FIELDS = new Set(['title', 'artist', 'albumArtist', 'album', 'genre', 'track', 'year', 'comment', 'replaygain'])

/** El tamaño de paquete del archivo (File Properties Object del encabezado ASF), para re-empaquetar igual; null si no se lee. */
export function asfPacketSize(file: string): number | null {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(65536)
    const n = fs.readSync(fd, head, 0, head.length, 0)
    const i = head.subarray(0, n).indexOf(Buffer.from('a1dcab8c47a9cf118ee400c00c205365', 'hex')) // 8CABDCA1-A947-11CF-8EE4-00C00C205365
    if (i < 0 || i + 24 + 76 > n) return null
    const min = head.readUInt32LE(i + 24 + 68), max = head.readUInt32LE(i + 24 + 72)
    return min === max && min >= 100 && min <= 65536 ? min : null
  } finally { fs.closeSync(fd) }
}

/** Los argumentos de ffmpeg para cada cambio ("-metadata clave=valor"; vacío = se saca). */
function metadataArgs(changes: Partial<Record<string, string | null>>): string[] {
  const out: string[] = []
  const put = (k: string, v: string | null | undefined) => out.push('-metadata', `${k}=${v ?? ''}`)
  const fix = (v: number | null | undefined, d: number, unit = '') => (v == null || !Number.isFinite(v) ? '' : `${v.toFixed(d)}${unit}`)
  for (const [k, v] of Object.entries(changes)) {
    if (!ASF_FIELDS.has(k)) throw new Error(T.wmaCampo(k))
    switch (k) {
      case 'title': case 'artist': case 'album': case 'genre': case 'comment': put(k, v); break
      case 'albumArtist': put('album_artist', v); break
      // el número de tema, y el viejo "WM/Track" (empieza en 0) para que no quede diciendo otro
      case 'track': { const t = parseInt(v ?? '', 10) || 0; put('track', t ? String(t) : ''); put('WM/Track', t ? String(t - 1) : ''); break }
      case 'year': { const y = parseInt(v ?? '', 10) || 0; put('WM/Year', y ? String(y) : ''); put('date', ''); break }
      case 'replaygain': {
        const g = (v ? JSON.parse(v) : {}) as Partial<ReplayGain>
        put('ReplayGain/Track', fix(g.tg, 2, ' dB')); put('ReplayGain/Track Peak', fix(g.tp, 6))
        put('ReplayGain/Album', fix(g.ag, 2, ' dB')); put('ReplayGain/Album Peak', fix(g.ap, 6))
        break
      }
    }
  }
  return out
}

/** Escribe los tags de un WMA re-empaquetándolo (sobre `file`, que es el temporal del motor: el original no se toca acá). */
export async function writeAsfTags(ffmpeg: string, file: string, changes: Partial<Record<string, string | null>>): Promise<void> {
  if (readCover(file)) throw new Error(T.wmaConTapa)
  const args = ['-v', 'error', '-nostdin', '-y', '-i', file, '-map', '0:a', '-c', 'copy', '-map_metadata', '0', '-fflags', '+bitexact']
  const size = asfPacketSize(file)
  if (size) args.push('-packet_size', String(size))
  const out = `${file}.reempaquetado.wma`
  args.push(...metadataArgs(changes), '-f', 'asf', out)
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, args, { windowsHide: true }, (err, _o, stderr) => {
      if (err) { fs.rmSync(out, { force: true }); reject(new Error(T.wmaFfmpeg(String(stderr).trim().split(/\r?\n/).pop() || err.message))); return }
      try { fs.copyFileSync(out, file); resolve() } catch (e) { reject(e) } finally { fs.rmSync(out, { force: true }) }
    })
  })
}
