// Muestra elegida a propósito para la prueba de punta a punta de la pantalla Discos (scripts/discos.ts aplicar --muestra):
// en vez de escribir los ~3.000 temas, unos 400 que cubren todos los formatos, los archivos raros del laboratorio, los
// WAV con dos zonas de tags, los temas sin tags, discos con tapa nueva (con cover.jpg y Folder.jpg de Windows) y con tapa
// vieja, y volumen parejo de disco y de temas sueltos.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '@paila/core/db'
import type { CoverProposal, GainPlan, PendingChange } from '@paila/shared/types'

export interface SampleInfo { ids: Set<number>; why: Map<string, number> }

/** ¿Un WAV con dos zonas de tags (un chunk ID3 y un LIST/INFO)? Se mira la lista de bloques, sin leer el audio. */
function wavTwoZones(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const head = Buffer.alloc(12); fs.readSync(fd, head, 0, 12, 0)
      if (head.toString('latin1', 0, 4) !== 'RIFF') return false
      const size = fs.fstatSync(fd).size
      let pos = 12, id3 = false, info = false
      const h = Buffer.alloc(12)
      while (pos + 8 <= size) {
        fs.readSync(fd, h, 0, 12, pos)
        const id = h.toString('latin1', 0, 4).toLowerCase(), len = h.readUInt32LE(4)
        if (id === 'id3 ') id3 = true
        if (id === 'list' && h.toString('latin1', 8, 12) === 'INFO') info = true
        pos += 8 + len + (len % 2)
      }
      return id3 && info
    } finally { fs.closeSync(fd) }
  } catch { return false }
}

export function pickSample(db: Db, pending: PendingChange[], plan: GainPlan, props: CoverProposal[], pathOf: (id: number) => string | null, max = 400): SampleInfo {
  const ids = new Set<number>(), why = new Map<string, number>()
  const add = (reason: string, list: number[]) => { let n = 0; for (const id of list) if (!ids.has(id)) { ids.add(id); n++ } why.set(reason, (why.get(reason) ?? 0) + n) }
  const byFile = new Map<number, PendingChange[]>()
  for (const c of pending) byFile.set(c.fileId, [...(byFile.get(c.fileId) ?? []), c])
  const withChanges = [...byFile.keys()]
  const rel = new Map((db.prepare('SELECT id, rel_path AS rel, ext, artist, title FROM files').all() as { id: number; rel: string; ext: string; artist: string | null; title: string | null }[]).map((r) => [r.id, r]))
  // un orden fijo pero mezclado (la misma muestra si se repite)
  const mix = (xs: number[]) => [...xs].sort((a, b) => ((a * 2654435761) % 1000003) - ((b * 2654435761) % 1000003))
  // 1) los archivos raros del laboratorio que están en la Música
  const corpus = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests', 'corpus.json'), 'utf8')).archivos as { archivo: string; caso: string }[]
  const byRel = new Map([...rel.values()].map((r) => [r.rel, r.id]))
  for (const c of corpus) { const id = byRel.get(c.archivo); if (id != null && byFile.has(id)) add(`laboratorio: ${c.caso}`, [id]) }
  // 2) WAV con dos zonas de tags
  add('WAV con dos zonas de tags', mix(withChanges.filter((id) => rel.get(id)?.ext === 'wav' && wavTwoZones(pathOf(id) ?? ''))).slice(0, 25))
  // 3) temas sin tags
  add('sin artista o sin título en el tag', mix(withChanges.filter((id) => !rel.get(id)?.artist || !rel.get(id)?.title)).slice(0, 25))
  // 4) discos con tapa nueva: con Folder.jpg de Windows, con cover.jpg nuevo y con tapa vieja adentro
  const groupIds = (p: CoverProposal) => withChanges.filter((id) => { const r = rel.get(id); return r && (r.rel.startsWith(`${p.dir}/`)) })
  const withNew = props.filter((p) => p.proposed)
  for (const p of withNew.filter((x) => x.windowsFolder).slice(0, 6)) add('disco con Folder.jpg de Windows', groupIds(p))
  for (const p of withNew.filter((x) => x.folderFile && !x.windowsFolder).slice(0, 6)) add('disco con cover.jpg nuevo', groupIds(p))
  for (const p of withNew.filter((x) => x.current && !x.folderFile).slice(0, 6)) add('disco que ya tenía tapa (más chica)', groupIds(p))
  for (const p of withNew.filter((x) => x.proposed!.source.startsWith('la carpeta')).slice(0, 3)) add('tapa tomada de la carpeta', groupIds(p))
  // 5) volumen parejo: temas sueltos (sin disco)
  add('volumen parejo de un tema suelto', mix(plan.albums.filter((a) => !a.key).flatMap((a) => a.tracks).filter((t) => byFile.has(t.id)).map((t) => t.id)).slice(0, 30))
  // 6) todos los formatos, hasta completar
  const exts = [...new Set(withChanges.map((id) => rel.get(id)!.ext))]
  for (let round = 0; ids.size < max && round < 200; round++) {
    let added = false
    for (const e of exts) {
      const next = mix(withChanges.filter((id) => rel.get(id)!.ext === e && !ids.has(id)))[0]
      if (next != null && ids.size < max) { add(`formato .${e}`, [next]); added = true }
    }
    if (!added) break
  }
  return { ids, why }
}
