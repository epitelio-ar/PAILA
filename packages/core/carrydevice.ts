// "Llevar la música" directo a un celular conectado por cable: lo que PhoneCopier (carry.ts) preparó en una carpeta
// temporal se pasa al celular de a un archivo, con el puente de Windows (mtp.ts), verificando que llegue entero.
import fs from 'node:fs'
import path from 'node:path'
import { folderParts } from './carry'
import type { PhonePlan, PhoneResult, PhoneTarget } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

const T = textos({
  alCelular: { es: (e: string) => `Al celular: ${e}`, en: (e: string) => `To the phone: ${e}` },
  seCorto: { es: 'Se cortó la conexión con el celular: lo que falta se pasa la próxima vez (sigue donde quedó)', en: 'The connection to the phone was lost: what is left goes over next time (it picks up where it stopped)' },
})

/** Lo que hace falta del celular (en la app, el puente de core/mtp.ts; en los tests, uno de mentira). */
export interface DeviceSink {
  copy(root: string, parts: string[], local: string, name: string, size: number): Promise<'sent' | 'already'>
}

/**
 * Segunda etapa al celular por cable: pasa lo que quedó listo en la carpeta temporal (y el .m3u8) a
 * almacenamiento/carpeta/playlist en el celular, de a un archivo, verificando que llegue con el mismo tamaño. Se puede
 * cancelar entre archivo y archivo; lo que ya estaba igual se saltea, así la próxima vez sigue donde quedó. Si todo
 * llegó, borra la carpeta temporal (es una copia: los originales y lo del celular no se tocan).
 */
export async function sendToDevice(plan: PhonePlan, res: PhoneResult, sink: DeviceSink, t: PhoneTarget, opts: {
  onProgress?: (p: { done: number; total: number; current: string; errors: number }) => void
  isCancelled?: () => boolean
  /** Llegó entero al celular (o ya estaba igual): para anotarlo en el Historial. */
  onSent?: (rel: string, size: number) => void
} = {}): Promise<void> {
  const base = [t.storage, ...folderParts(t.folder), plan.name]
  const files = plan.items.map((it) => it.outRel).filter((rel) => fs.existsSync(path.join(plan.folder, ...rel.split('/'))))
  if (res.m3u && fs.existsSync(res.m3u)) files.push(path.basename(res.m3u))
  const out = { sent: 0, already: 0, folder: plan.deviceFolder ?? base.join(' › ') }
  res.device = out
  let done = 0, errors = 0, inARow = 0
  const report = (current: string) => opts.onProgress?.({ done, total: files.length, current, errors })
  for (const rel of files) {
    if (opts.isCancelled?.()) { res.cancelled = true; break }
    report(rel)
    const local = path.join(plan.folder, ...rel.split('/'))
    const segs = rel.split('/')
    try {
      const size = fs.statSync(local).size
      const r = await sink.copy(t.id, [...base, ...segs.slice(0, -1)], local, segs[segs.length - 1], size)
      if (r === 'sent') out.sent++; else out.already++
      if (r === 'sent') opts.onSent?.(rel, size)
      inARow = 0
    } catch (e) {
      errors++; inARow++
      res.failed.push({ name: rel, error: T.alCelular((e as Error).message) })
      // tres seguidos: casi seguro se desconectó o se bloqueó; no tiene sentido seguir probando uno por uno
      if (inARow >= 3) { res.failed.push({ name: '…', error: T.seCorto }); break }
    }
    done++
  }
  report('')
  if (!res.cancelled && !res.failed.length && out.sent + out.already === files.length) {
    try { fs.rmSync(plan.folder, { recursive: true, force: true }) } catch { /* se limpia la próxima vez */ }
    try { fs.rmdirSync(path.dirname(plan.folder)) } catch { /* quedan otras playlists a medias para este celular */ }
  }
}
