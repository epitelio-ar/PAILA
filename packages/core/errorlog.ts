// Registro de errores (Fase H): una línea JSON por error en `<datos>/registro/errores.log`, con tope de tamaño (el viejo
// pasa a errores.1.log). Lo lee "Exportar diagnóstico", siempre pasado por `scrub`, que saca rutas, nombres de temas,
// usuario de Windows, correos y cosas con forma de clave. Escribir nunca falla hacia afuera: si no se puede, se pierde.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface LogLine { at: string; where: string; msg: string }

const MAX_BYTES = 512 * 1024

/**
 * Saca de un texto todo lo que puede ser personal: rutas (C:\…, \\servidor\…, /Users/…), lo que va entre comillas o «»
 * (nombres de temas, carpetas, playlists), nombres de archivo de audio, el usuario de Windows, correos, direcciones con
 * datos y cadenas largas con forma de clave. Lo que queda: el tipo de error y los números.
 */
export function scrub(text: string, extra: string[] = []): string {
  let t = String(text)
  const user = (() => { try { return os.userInfo().username } catch { return '' } })()
  for (const s of [os.homedir(), ...extra].filter((x) => x && x.length > 2)) t = t.split(s).join('<carpeta>')
  t = t
    // en las pilas de error, el código de PAILA queda como out/main/main.js:12:3 (sin la carpeta donde está instalada)
    .replace(/[^\s(]*[\\/](out[\\/](?:main|preload|renderer)[\\/][^\s):]+(?::\d+){0,2})/g, (_, p: string) => p.replace(/\\/g, '/'))
    .replace(/(?:[A-Za-z]:|\\\\[^\\\s]+)[\\/][^\n"'«»<>|]*/g, '<ruta>')
    .replace(/(?<![\w.])\/(?:Users|home|mnt|media|Volumes|tmp|var)\/[^\n"'«»<>|]*/g, '<ruta>')
    .replace(/file:\/\/\S+/g, '<ruta>')
    .replace(/«[^»\n]*»/g, '«…»')
    .replace(/"[^"\n]{1,300}"/g, '"…"')
    .replace(/(^|[\s(\[:=])'[^'\n]{1,300}'/g, '$1\'…\'')
    .replace(/[^\s"'«»<>/\\]+\.(mp3|flac|wav|aiff?|m4a|aac|ogg|opus|wma|alac|ape|wv|mp4|zip|rar|m3u8?|csv|xml|txt|json|db)\b/gi, '<archivo>.$1')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<correo>')
    .replace(/https?:\/\/[^\s?#]+\?\S*/g, (u) => `${u.split('?')[0]}?<datos>`)
    .replace(/\b[A-Za-z0-9_\-+/=]{28,}\b/g, '<dato>')
  if (user.length > 2) t = t.replace(new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<usuario>')
  return t
}

export class ErrorLog {
  readonly file: string
  /** Cada error anotado (sin limpiar): lo usa el Chequeo para avisar si es de los que se arreglan (un disco lleno, la base dañada). */
  alAnotar: ((where: string, msg: string) => void) | null = null
  constructor(dir: string) { this.file = path.join(dir, 'errores.log') }

  /** Anota un error (`where`: de qué parte vino, por ejemplo "principal" o "interfaz"). */
  add(where: string, err: unknown) {
    try {
      const msg = err instanceof Error ? `${err.message}${err.stack ? `\n${err.stack.split('\n').slice(1, 6).join('\n')}` : ''}` : String(err)
      try { this.alAnotar?.(where, msg) } catch { /* el aviso tampoco */ }
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > MAX_BYTES) fs.renameSync(this.file, this.file.replace(/\.log$/, '.1.log'))
      fs.appendFileSync(this.file, `${JSON.stringify({ at: new Date().toISOString(), where, msg: msg.slice(0, 4000) } satisfies LogLine)}\n`)
    } catch { /* el registro nunca rompe nada */ }
  }

  /** Las últimas `max` líneas (del viejo y el actual), ya sin datos personales. */
  read(max = 500, extra: string[] = []): LogLine[] {
    const lines = [this.file.replace(/\.log$/, '.1.log'), this.file].flatMap((f) => { try { return fs.readFileSync(f, 'utf8').split('\n') } catch { return [] } })
    return lines.filter(Boolean).slice(-max).flatMap((l) => {
      try { const x = JSON.parse(l) as LogLine; return [{ at: x.at, where: scrub(x.where, extra), msg: scrub(x.msg, extra) }] } catch { return [] }
    })
  }
}
