// Corrida supervisada de "Llevar la música" (MASTERPLAN-2, 0.1), siempre sobre una COPIA de la base: lee la Música real
// (solo lectura) y escribe en una carpeta de prueba fuera de ella. Copia playlists reales al celular con distintas opciones,
// revisa cada archivo de salida (que se lea entero, formato, kbps, duración, tags, tapa, nombre y tamaño), los .m3u8, que
// los originales no cambien, y corre el chequeo "listo para tu servidor".
//
//   node scripts/run-ts.mjs scripts/llevar.ts --base <copia.db> --salida <carpeta de prueba> --listas 10:aac:normal:lista,28:mp3:alta:discos
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Library } from '@paila/core/library'
import { findFfmpeg, findFfprobe, probe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { PhoneCopier } from '@paila/core/carry'
import { exportM3uLists } from '@paila/core/m3uexport'
import { serverCheck } from '@paila/core/serverready'
import { readCover, readTags } from '@paila/core/tagio'
import { FOLDER_NAMES, findFile } from '@paila/core/foldercover'
import type { CarryLayout, PhoneFormat, PhoneQuality } from '@paila/shared/types'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--base'), outDir = arg('--salida'), lists = arg('--listas')
if (!base || !outDir || !lists) { console.error('Uso: --base <copia.db> --salida <carpeta> --listas id:formato:calidad:carpetas,…'); process.exit(2) }
if (/[\\/]PAILA[\\/]paila\.db$/i.test(base)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }
const ffmpeg = findFfmpeg()!, ffprobe = findFfprobe()!
const lib = new Library(base, ffprobe)
const roots = lib.roots().filter((r) => r.available).map((r) => r.path)
if (roots.some((r) => path.resolve(outDir).toLowerCase().startsWith(path.resolve(r).toLowerCase()))) { console.error('La salida no puede estar dentro de la Música.'); process.exit(2) }
fs.mkdirSync(outDir, { recursive: true })
const report = path.join(outDir, '_informe')
fs.mkdirSync(report, { recursive: true })
const log = (s: string) => { console.log(s); fs.appendFileSync(path.join(report, 'corrida.log'), `${new Date().toISOString()} ${s}\n`) }
const pl = new Playlists(lib.db, (i) => lib.trackPath(i))
const phone = new PhoneCopier(lib.db, (i) => lib.trackPath(i), ffmpeg, ffprobe, () => roots)
const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
const decodeErrors = (f: string) => new Promise<string>((resolve) => {
  execFile(ffmpeg, ['-v', 'error', '-nostdin', '-i', f, '-f', 'null', '-'], { windowsHide: true, maxBuffer: 8e6 }, (err, _o, stderr) => resolve((stderr || (err ? err.message : '')).trim().split(/\r?\n/).filter(Boolean).slice(0, 2).join(' | ')))
})
const folderCover = (src: string) => FOLDER_NAMES.some((n) => findFile(path.dirname(src), n))
const norm = (v: string | null | undefined) => (v ?? '').trim()

async function main() {
  const rows: string[] = ['lista\taccion\tsalida\tformato\tkbps\tkHz\tdur_orig\tdur_copia\tbytes_orig\tbytes_copia\tlee_entero\ttags\ttapa\tnombre\tporque']
  const stamp = new Map<number, string>()
  const problems: string[] = []
  for (const spec of lists.split(',')) {
    const [id, format, quality, layout] = spec.split(':') as [string, PhoneFormat, PhoneQuality, CarryLayout]
    const node = pl.tree().find((n) => n.id === Number(id))
    if (!node) { log(`no existe la playlist ${id}`); continue }
    const ids = pl.trackIds(node.id)
    for (const i of ids) { const p = lib.trackPath(i); if (p && fs.existsSync(p) && !stamp.has(i)) { const s = fs.statSync(p); stamp.set(i, `${s.size}|${s.mtimeMs}`) } }
    const plan = phone.plan(node.name, ids, { dest: path.join(outDir, `${format}-${quality}-${layout}`), format, quality, layout, numbered: true })
    log(`${node.name}: ${plan.items.length} temas (${plan.convertCount} a convertir, ${plan.copyCount} tal cual, ${plan.skipped.length} salteados) · ${(plan.srcBytes / 1e6).toFixed(0)} MB → ~${(plan.totalBytes / 1e6).toFixed(0)} MB · ${plan.warnings.join(' / ')}`)
    for (const s of plan.skipped) problems.push(`${node.name}: salteado ${s.rel} (${s.reason})`)
    const t0 = Date.now()
    const r = await phone.run(plan, { concurrency: () => 2, onProgress: (p) => { if (p.current && p.done % 10 === 0) log(`  ${p.done}/${p.total} ${p.current}`) } })
    log(`  listo en ${((Date.now() - t0) / 1000).toFixed(0)} s: ${r.converted} convertidos, ${r.copied} copiados, ${r.skippedExisting} ya estaban, ${r.failed.length} fallaron`)
    for (const f of r.failed) problems.push(`${node.name}: falló ${f.name}: ${f.error}`)
    for (const x of r.notes) log(`  aviso: ${x.name}: ${x.note}`)
    // cada archivo de salida
    for (const it of plan.items) {
      const src = lib.trackPath(it.fileId)!
      const out = path.join(plan.folder, ...it.outRel.split('/'))
      if (!fs.existsSync(out)) { rows.push(`${node.name}\t${it.action}\t${it.outRel}\tFALTA`); continue }
      const [a, b] = await Promise.all([probe(ffprobe, src), probe(ffprobe, out)])
      const dec = await decodeErrors(out)
      const known = lib.db.prepare('SELECT artist, title, album, year, track FROM files WHERE id = ?').get(it.fileId) as Record<string, string | null>
      const t = readTags(out)
      const tagDiff = (['artist', 'title', 'album', 'year', 'track'] as const).filter((k) => {
        const want = norm(known[k]), got = norm(t[k])
        if (!want) return false
        if (k === 'year') return got !== want.slice(0, 4)
        if (k === 'track') return /^\d/.test(want) ? parseInt(got, 10) !== parseInt(want, 10) : false // "B1": en M4A no entra; en MP3 lo pasa ffmpeg
        return got !== want
      }).map((k) => `${k}: «${known[k]}» → «${t[k] ?? ''}»`)
      let srcCover = false
      try { srcCover = !!readCover(src) } catch { /* sin tags legibles */ }
      srcCover ||= folderCover(src)
      let outCover = false
      try { outCover = !!readCover(out) } catch { /* sigue */ }
      const coverState = srcCover ? (outCover ? 'sí' : 'SE PERDIÓ') : outCover ? 'sí (extra)' : 'no tenía'
      const nameBad = /[<>:"\\|?*\x00-\x1f]/.test(it.outRel) || it.outRel.split('/').some((s) => s.length > 130 || /[ .]$/.test(s))
      const sameCopy = it.action === 'copy' ? (md5(out) === md5(src) ? 'idéntico' : 'DISTINTO') : ''
      const durDiff = a.duration != null && b.duration != null ? Math.abs(a.duration - b.duration) : null
      rows.push([node.name, it.action, it.outRel, b.codec, b.kbps, b.sampleRate ? b.sampleRate / 1000 : '', a.duration?.toFixed(2), b.duration?.toFixed(2), it.srcBytes, fs.statSync(out).size,
        dec ? `ERROR ${dec}` : 'ok', tagDiff.length ? tagDiff.join('; ') : 'ok', coverState, nameBad ? 'RARO' : 'ok', `${it.why}${sameCopy ? ` (${sameCopy})` : ''}`].join('\t'))
      if (dec) problems.push(`${it.outRel}: no se lee entero (${dec})`)
      if (tagDiff.length) problems.push(`${it.outRel}: tags distintos: ${tagDiff.join('; ')}`)
      if (coverState === 'SE PERDIÓ') problems.push(`${it.outRel}: se perdió la tapa`)
      if (nameBad) problems.push(`${it.outRel}: nombre raro`)
      if (sameCopy === 'DISTINTO') problems.push(`${it.outRel}: la copia no es idéntica`)
      if (durDiff != null && durDiff > 1) problems.push(`${it.outRel}: dura distinto (${durDiff.toFixed(2)} s)`)
      if (it.action === 'convert' && it.why.includes('ocupa') && fs.statSync(out).size > it.srcBytes) problems.push(`${it.outRel}: la copia convertida pesa más que el original`)
    }
    // la playlist: cada renglón tiene que apuntar a un archivo que existe
    if (r.m3u) {
      const refs = fs.readFileSync(r.m3u, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
      const bad = refs.filter((l) => !fs.existsSync(path.join(path.dirname(r.m3u!), l)))
      log(`  ${path.basename(r.m3u)}: ${refs.length} renglones, ${bad.length} rotos`)
      for (const b of bad) problems.push(`${r.m3u}: no existe ${b}`)
    }
  }
  fs.writeFileSync(path.join(report, 'archivos.tsv'), rows.join('\n'))
  // los originales no cambiaron
  let changed = 0
  for (const [i, s0] of stamp) { const p = lib.trackPath(i)!; const s = fs.statSync(p); if (`${s.size}|${s.mtimeMs}` !== s0) { changed++; problems.push(`ORIGINAL CAMBIADO: ${p}`) } }
  log(`originales revisados: ${stamp.size}, cambiados: ${changed}`)
  // playlists para la PC: todas, con rutas completas y relativas; cada ruta tiene que existir
  const all = pl.tree().filter((n) => n.kind !== 'folder').map((n) => n.id)
  for (const relative of [false, true]) {
    const dir = path.join(outDir, relative ? 'pc-relativas' : 'pc-completas')
    const m = exportM3uLists(lib.db, pl, (i) => lib.trackPath(i), all, { dir, relative })
    let refs = 0, broken = 0
    for (const f of m.files) {
      for (const l of fs.readFileSync(path.join(dir, f.name), 'utf8').split(/\r?\n/).filter((x) => x && !x.startsWith('#'))) {
        refs++
        if (!fs.existsSync(path.resolve(dir, l))) { broken++; if (broken <= 10) problems.push(`${f.name}: no existe ${l}`) }
      }
    }
    log(`pc (${relative ? 'relativas' : 'completas'}): ${m.files.length} playlists, ${refs} temas, ${broken} rotos, ${m.files.reduce((a, f) => a + f.missing, 0)} sin disco o sin archivo, ${m.absoluteFallback} con ruta completa por estar en otro disco`)
  }
  // listo para tu servidor
  const t0 = Date.now()
  const sc = await serverCheck(lib.db, { pathOf: (i) => lib.trackPath(i) })
  log(`servidor (${((Date.now() - t0) / 1000).toFixed(1)} s): ${sc.okTracks} de ${sc.tracks} temas listos, ${sc.albums} discos`)
  fs.writeFileSync(path.join(report, 'servidor.txt'), sc.issues.map((i) => `## [${i.level}] ${i.label}: ${i.count} ${i.unit} → ${i.goLabel}\n${i.examples.map((e) => `   ${e}`).join('\n')}`).join('\n'))
  fs.writeFileSync(path.join(report, 'problemas.txt'), problems.join('\n'))
  log(`problemas: ${problems.length}`)
  lib.close()
}
void main()
