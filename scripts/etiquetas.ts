// Prueba de que guardar tags con PAILA no borra etiquetas que PAILA no edita (fecha original, artista para ordenar, ISRC,
// MusicBrainz…), ni al aplicar ni al deshacer. Trabaja sobre una copia aislada: copia <origen> a <carpeta>/trabajo, aplica
// un título nuevo y el volumen parejo con Cambios pendientes, compara, deshace y vuelve a comparar contra el origen.
//   node scripts/run-ts.mjs scripts/etiquetas.ts <origen> <carpeta>
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { Library } from '@paila/core/library'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { pcmHash } from '@paila/core/audiohash'
import { readReplayGain } from '@paila/core/tagio'

const [src, out] = process.argv.slice(2)
if (!src || !out || /M[uú]sica$/i.test(path.resolve(out))) { console.error('Uso: etiquetas.ts <origen> <carpeta> (nunca la Música)'); process.exit(2) }
const work = path.join(out, 'trabajo')
fs.rmSync(work, { recursive: true, force: true })
fs.cpSync(src, work, { recursive: true, preserveTimestamps: true })
const ffprobe = findFfprobe()!, ffmpeg = findFfmpeg()!

/** Todas las etiquetas como las ve ffprobe (archivo y pista), sin las que la prueba cambia a propósito. */
function tags(file: string, skip: RegExp = /^(replaygain|title)/i): Record<string, string> {
  const j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', file]).toString())
  const o: Record<string, string> = {}
  for (const s of [j.format?.tags, ...(j.streams ?? []).map((x: { tags?: object }) => x.tags)]) if (s) for (const [k, v] of Object.entries(s)) if (!skip.test(k)) o[k.toLowerCase()] = String(v)
  return o
}
/** Los cuadros del ID3v2 del principio de un MP3 (nombre y contenido), leídos a mano: lo que ffprobe no muestra (TIPL, UFID…). */
function id3Frames(file: string): string[] {
  const b = fs.readFileSync(file)
  if (b.toString('latin1', 0, 3) !== 'ID3') return []
  const v = b[3], size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]
  const out: string[] = []
  for (let p = 10; p + 10 <= 10 + size;) {
    const id = b.toString('latin1', p, p + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const n = v === 4 ? (b[p + 4] << 21) | (b[p + 5] << 14) | (b[p + 6] << 7) | b[p + 7] : b.readUInt32BE(p + 4)
    const body = b.subarray(p + 10, p + 10 + n)
    out.push(`${id}:${id === 'APIC' ? body.length : body.toString('latin1').replace(/[^\x20-\x7e]/g, '').slice(0, 40)}`)
    p += 10 + n
  }
  return out.sort()
}
const framesDiff = (a: string[], b: string[]) => [...a.filter((x) => !b.includes(x)).map((x) => `- ${x}`), ...b.filter((x) => !a.includes(x)).map((x) => `+ ${x}`)]

const diff = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k] === undefined ? '—' : JSON.stringify(a[k].slice(0, 60))} → ${b[k] === undefined ? '—' : JSON.stringify(b[k].slice(0, 60))}`)

const lib = new Library(path.join(out, 'prueba.db'), ffprobe)
await lib.addRoot(work, [{ rel: '', kind: 'musica' }])
await lib.scan()
const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(out, 'resguardo'))
const ids = (lib.db.prepare('SELECT id FROM files').all() as { id: number }[]).map((r) => r.id)

for (const id of ids) {
  ch.stage([id], 'title', 'Prueba de PAILA')
  // como el volumen parejo de PAILA: tema nuevo, y el del disco que ya tenía queda (core/replaygain.ts, valueFor)
  const cur = JSON.parse(readReplayGain(lib.trackPath(id)!) ?? '{}') as { ag?: number | null; ap?: number | null }
  ch.stage([id], 'replaygain', JSON.stringify({ tg: -3.21, tp: 0.9, ag: cur.ag ?? null, ap: cur.ap ?? null }))
}
const r = await ch.apply()
console.log(`aplicado: ${r.applied} · fallaron ${r.failed.length}${r.failed.map((f) => `\n   ${f.rel}: ${f.error}`).join('')}`)
let lost = 0
for (const id of ids) {
  const f = lib.trackPath(id)!
  const d = diff(tags(path.join(src, path.relative(work, f))), tags(f))
  if (d.length) { lost++; console.log(`AL APLICAR · ${path.relative(work, f)}\n   ${d.join('\n   ')}`) }
}
const u = await ch.undo(r.batchId!)
console.log(`deshecho: ${u.applied} · fallaron ${u.failed.length}`)
let back = 0
for (const id of ids) {
  const f = lib.trackPath(id)!
  const o = path.join(src, path.relative(work, f))
  const d = [...diff(tags(o, /^$/), tags(f, /^$/)), ...framesDiff(id3Frames(o), id3Frames(f))]
  const same = fs.readFileSync(o).equals(fs.readFileSync(f))
  const audio = (await pcmHash(ffmpeg, o)) === (await pcmHash(ffmpeg, f))
  if (d.length || !audio) { back++; console.log(`AL DESHACER · ${path.relative(work, f)}${audio ? '' : ' · ¡SONIDO DISTINTO!'}\n   ${d.join('\n   ')}`) }
  else console.log(`igual al original${same ? ' (byte por byte)' : ' (mismas etiquetas y sonido)'} · ${path.relative(work, f)}`)
}
console.log(`resumen: ${ids.length} temas · pierden etiquetas al aplicar: ${lost} · distintos del original después de deshacer: ${back}`)

lib.close()
