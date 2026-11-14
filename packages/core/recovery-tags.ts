// Recuperación al abrir de una escritura de tags que quedó a medias (core/recovery.ts). Desde el 24/10 se escribe en un
// temporal al lado y el original no se toca hasta el final (core/changes-write.ts): si el temporal sigue ahí, el original está
// intacto; si ya lo había reemplazado, vuelve a como estaba desde su respaldo liviano, comparando la huella con la del original.
// También resuelve lo que dejó a medias la 0.5.3, que escribía encima del original con una copia entera de resguardo.
import fs from 'node:fs'
import path from 'node:path'
import { pcmHash } from './audiohash'
import type { JournalEntry, RecoveryResult } from './journal'
import { moveNoClobber } from './safefs'
import { restoreFrom, whichVersion } from './changes-write'
import { workDir } from './changes-file'
import { workName } from './ops/backup'
import { T } from './recovery.textos'

interface Outcome { result: RecoveryResult; message: string; after?: () => void }

/** ¿Existe exactamente con ese nombre? (Windows no distingue mayúsculas.) */
function existsExact(p: string): boolean {
  try { return fs.readdirSync(path.dirname(p)).includes(path.basename(p)) } catch { return false }
}

export async function recoverTags(e: JournalEntry, root: string, ffmpeg: string): Promise<Outcome> {
  // La base no se toca hasta el final de la operación: alcanza con dejar el archivo como estaba (contenido y nombre).
  const abs = (rel: string) => path.join(root, ...rel.split('/'))
  const name = (e.src ?? '').split(/[\\/]/).pop() ?? ''
  const src = abs(e.src!), dst = abs(e.dst!)
  const renamed = e.dst !== e.src && !existsExact(src) && existsExact(dst)
  const cur = renamed ? dst : src
  if (!existsExact(cur)) return { result: 'revisar', message: `${T.noSeEncuentra(name)}${e.phase === 'resguardo' && e.backup && fs.existsSync(e.backup) ? T.hayCopia(e.backup) : ''}` }
  const again = e.op === 'tags' ? T.otraVezPendientes : T.otraVezHistorial
  if (e.phase === 'resguardo') {
    // 0.5.3: pudo haber quedado a medio escribir encima del original. Se restaura la copia, verificando que sea el original completo.
    const b = e.backup
    if (!b || !fs.existsSync(b)) return { result: 'revisar', message: T.sinCopia(name) }
    if (e.origSize != null && fs.statSync(b).size !== e.origSize) return { result: 'revisar', message: T.copiaIncompleta(name, b) }
    let ref: string | null = null
    try { ref = await pcmHash(ffmpeg, b) } catch { /* original ilegible: se compara byte a byte abajo */ }
    if (e.hash && ref !== e.hash) return { result: 'revisar', message: T.copiaDistinta(name, b) }
    fs.copyFileSync(b, cur)
    let ok: boolean
    if (ref) { let now = ''; try { now = await pcmHash(ffmpeg, cur) } catch { /* no coincide */ } ok = now === ref }
    else ok = fs.readFileSync(cur).equals(fs.readFileSync(b))
    if (!ok) return { result: 'revisar', message: T.sonidoDistinto(name, b) }
    if (renamed) moveNoClobber(dst, src)
    return { result: 'vuelto-atras', message: T.tagsVuelto(name, again), after: () => fs.rmSync(b, { force: true }) }
  }
  const d = e.data as { tmp?: string | null; pos?: number } | null
  const tmp = d?.tmp ?? null, pos = d?.pos ?? 0
  const delta = e.backup
  let back = false
  // el temporal ya no está: pudo haber reemplazado al original justo antes del corte
  if (e.phase === 'respaldo' && delta && !(tmp && fs.existsSync(tmp))) {
    if (!fs.existsSync(delta)) return { result: 'revisar', message: T.sinCopia(name) }
    const v = await whichVersion(delta, pos, cur)
    if (v === 'despues') {
      if (!(await restoreFrom(delta, pos, cur, path.join(workDir(root), workName(e.fileId ?? 0, path.extname(cur)))))) return { result: 'revisar', message: T.ningunaVersion(name, delta) }
      back = true
    } else if (v !== 'antes') return { result: 'revisar', message: T.ningunaVersion(name, delta) }
  }
  if (renamed) moveNoClobber(dst, src)
  return {
    // el temporal es de PAILA (lo de antes guardado para un cambio que no quedó se queda en cambios.paila, sin anotar)
    after: () => { if (tmp) fs.rmSync(tmp, { force: true }) },
    result: back || renamed ? 'vuelto-atras' : 'no-hecho',
    message: back ? T.tagsVueltoExacto(name, again) : T.noCambio(name, renamed, again),
  }
}
