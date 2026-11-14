// La comparación de la corrida supervisada del motor único (scripts/motor-corrida.ts): la copia de la Música contra el original.
// Lo que falta, sobra o cambió, aparte lo de _PAILA (papelera y respaldos de PAILA); lo que cambió se mira por bytes y, si no son
// iguales, por sonido (huella) y tags. Solo lee. Y los respaldos de la corrida contra el original (y borrarlos a mano).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { findFfmpeg } from '@paila/core/probe'
import { pcmHash } from '@paila/core/audiohash'
import { readTags } from '@paila/core/tagio'
import { AUDIO_EXT } from '@paila/core/files'
import { listBackups, trashBackups } from '@paila/core/ops/backup'
import { readDelta } from '@paila/core/ops/delta'
import { arg, fail, log, open } from './corte-base'

/** La copia contra el original (`startedAt`: cuándo empezó la corrida; lo que cambió en el original después no es de ella). */
export async function comparar(original: string, startedAt: string) {
  if (!original) fail('Uso: comparar --datos <carpeta> --original <Música>')
  const copia = 'D:\\PAILA-trabajo\\Música-copia'
  const ffmpeg = findFfmpeg()!
  const list = (root: string) => {
    const files = new Map<string, fs.Stats>(), dirs = new Set<string>()
    for (const f of fs.readdirSync(root, { recursive: true }) as string[]) {
      const st = fs.statSync(path.join(root, f))
      const rel = f.split(path.sep).join('/')
      if (st.isDirectory()) dirs.add(rel); else files.set(rel, st)
    }
    return { files, dirs }
  }
  const a = list(original), b = list(copia)
  const desde = Date.parse(startedAt)
  const isPaila = (r: string) => /^_paila\//i.test(r)
  const faltan = [...a.files.keys()].filter((r) => !b.files.has(r))
  const sobran = [...b.files.keys()].filter((r) => !a.files.has(r))
  const cambiados = [...a.files.keys()].filter((r) => b.files.has(r) && (a.files.get(r)!.size !== b.files.get(r)!.size || Math.abs(a.files.get(r)!.mtimeMs - b.files.get(r)!.mtimeMs) > 2000))
  // lo que cambió en el ORIGINAL después de empezar (y la copia tiene la fecha de antes) no es de la corrida: lo cambió otro
  const delOriginal = cambiados.filter((r) => a.files.get(r)!.mtimeMs > desde && b.files.get(r)!.mtimeMs < desde)
  const carpetas = [...b.dirs].filter((d) => !a.dirs.has(d))
  const sinPaila = (l: string[]) => [l.filter((r) => !isPaila(r)), l.filter(isPaila)] as const
  const [fa, faP] = sinPaila(faltan), [so, soP] = sinPaila(sobran), [ca] = sinPaila(cambiados.filter((r) => !delOriginal.includes(r))), [cd, cdP] = sinPaila(carpetas)
  log(`Original ${a.files.size} archivos, copia ${b.files.size}.`)
  log(`Fuera de _PAILA: faltan ${fa.length}, sobran ${so.length}, cambiaron ${ca.length}, carpetas de más ${cd.length}. Dentro de _PAILA: faltan ${faP.length}, sobran ${soP.length}, carpetas de más ${cdP.length}${delOriginal.length ? `. Aparte, ${delOriginal.length} cambiaron en el original después de empezar (no son de la corrida)` : ''}`)
  for (const [t, l] of [['falta', fa], ['sobra', so], ['carpeta de más', cd], ['sobra en _PAILA', soP], ['falta en _PAILA', faP]] as const) for (const r of l.slice(0, 20)) log(`  ${t}: ${r}`)
  const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
  const tagsOf = (f: string) => { try { return JSON.stringify(readTags(f, { exact: true })) } catch (e) { return `ilegible: ${(e as Error).message}` } }
  const clases = { bytes: 0, fecha: 0, sonidoYTags: 0, distinto: 0 }
  for (const r of ca) {
    const A = path.join(original, ...r.split('/')), B = path.join(copia, ...r.split('/'))
    if (md5(A) === md5(B)) { clases.fecha++; continue } // mismos bytes, solo la fecha
    if (!AUDIO_EXT.has(path.extname(r).slice(1).toLowerCase())) { clases.distinto++; log(`  DISTINTO (no es audio): ${r}`); continue }
    let same = false
    try { same = (await pcmHash(ffmpeg, A)) === (await pcmHash(ffmpeg, B)) } catch { /* ilegible: distinto */ }
    const tA = tagsOf(A), tB = tagsOf(B)
    if (same && tA === tB) { clases.sonidoYTags++; continue }
    clases.distinto++
    log(`  DISTINTO: ${r} (${same ? 'mismo sonido' : 'OTRO SONIDO'}${tA === tB ? '' : `, tags: ${tA.slice(0, 160)} → ${tB.slice(0, 160)}`})`)
  }
  log(`De los ${ca.length} que cambiaron: ${clases.fecha} solo la fecha (mismos bytes), ${clases.sonidoYTags} con bytes distintos pero mismo sonido y mismos tags, ${clases.distinto} distintos de verdad`)
  void clases.bytes
}

/** Cada archivo respaldado tiene que ser idéntico al de la Música original (la copia estaba igual antes de la corrida). */
export async function respaldos(startedAt: string) {
  const original = arg('--original')
  if (!original) fail('Uso: respaldos --datos <carpeta> --original <Música> [--borrar]')
  const { lib } = open()
  const md5 = (p: string) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')
  const sha1 = (p: string) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')
  const mine = listBackups(lib.db).filter((b) => b.createdAt >= startedAt)
  let ok = 0, bad = 0
  for (const b of mine) {
    if (b.op === 'tags' && b.light) {
      // respaldo liviano: lo anotado de cada tema (la huella del de antes) tiene que ser la del original; un cover.jpg, igual byte a byte
      const rows = lib.db.prepare('SELECT rel, path, pos, kind FROM backup_files WHERE backup_id = ?').all(b.id) as { rel: string; path: string; pos: number | null; kind: string }[]
      for (const r of rows) {
        const o = path.join(original, ...r.rel.split('/')), at = path.join(b.dir, ...r.path.split('/'))
        if (fs.existsSync(o) && (r.kind === 'copia' ? md5(o) === md5(at) : readDelta(at, r.pos ?? 0).header.old.sha1 === sha1(o))) ok++
        else { bad++; log(`  RESPALDO DISTINTO del original: ${r.rel}`) }
      }
    } else if (b.op === 'tags') {
      for (const x of (fs.readdirSync(b.dir, { recursive: true }) as string[]).filter((y) => fs.statSync(path.join(b.dir, y)).isFile())) {
        const o = path.join(original, x)
        if (fs.existsSync(o) && md5(o) === md5(path.join(b.dir, x))) ok++
        else { bad++; log(`  RESPALDO DISTINTO del original: ${x}`) }
      }
    }
    log(`${b.op} ${b.createdAt} · ${b.files} archivos · ${(b.bytes / 1e6).toFixed(0)} MB · ${b.complete ? 'completo' : 'INCOMPLETO'} · ${b.dir}`)
  }
  log(`Respaldos de la corrida: ${mine.length}. Antes de aplicar, idénticos al original: ${ok}; distintos: ${bad} (los de antes de deshacer no se comparan: tienen lo que escribió la corrida)`)
  if (process.argv.includes('--borrar')) {
    const r = await lib.ops.run('borrando respaldos', () => trashBackups(lib.db, mine.map((b) => b.id), lib.roots().map((r) => ({ id: r.id, path: r.path }))))
    log(`A la papelera ${r.moved} (${(r.bytes / 1e6).toFixed(0)} MB)${r.failed.length ? `; fallas: ${r.failed.map((f) => `${f.rel} (${f.error})`).join('; ')}` : ''}`)
  }
  lib.close()
}
