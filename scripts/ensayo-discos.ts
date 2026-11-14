// Ensayo general del punto 1 (scripts/ensayo.ts), pasos 4 y la cuenta de BPM y tono: Discos completos (solo informa), Tapas y
// Volumen parejo (con --aplicar, en una sola tanda de Cambios pendientes, como mañana), sobre la copia de la base que apunta a
// Música-copia. "bpm" solo lee: cuántos temas tienen en el tag un BPM o un tono distinto del que mide PAILA.
//
//   node scripts/run-ts.mjs scripts/ensayo-discos.ts discos|tapas|volumen|bpm --datos <carpeta> [--aplicar] [--claves <json>]
// tapas y volumen guardan su vista previa; `tapas --aplicar` arma las tapas y el volumen parejo juntos y los aplica.
import fs from 'node:fs'
import { AlbumSources } from '@paila/core/albumsources'
import { AlbumCheck } from '@paila/core/albumrun'
import { Covers } from '@paila/core/covers'
import { gainChanges, gainPlan } from '@paila/core/replaygain'
import { readSeratoTag } from '@paila/core/seratotag'
import { arg, fail, log, mode } from './corte-base'
import { abrir, ahora, aplicarPendientes, escribir, tiempo, type Abierta } from './ensayo-base'

const aplicar = process.argv.includes('--aplicar')
const ua = 'PAILA/ensayo-punto-1 (https://github.com/epitelio-ar/PAILA)'
// la clave de Discogs del archivo de desarrollo (en la app sale de las claves guardadas); nunca se escribe ni se muestra
const claves = arg('--claves') ? JSON.parse(fs.readFileSync(arg('--claves'), 'utf8')) as { discogs_consumer_key?: string; discogs_consumer_secret?: string } : {}
const discogs = claves.discogs_consumer_key && claves.discogs_consumer_secret ? { key: claves.discogs_consumer_key, secret: claves.discogs_consumer_secret } : null
const check = (a: Abierta) => new AlbumCheck(a.lib.db, new AlbumSources(a.lib.db, { ua, discogs }))
const avance = (que: string) => { let last = -1; return (p: { done: number; total: number; current?: string }) => { if (p.done - last >= 50 || p.done === p.total) { last = p.done; log(`  ${que} ${p.done}/${p.total} ${p.current ?? ''}`) } } }

async function discos(a: Abierta) {
  const ch = check(a)
  log(`Discos por buscar en internet: ${ch.pending()}`)
  const t0 = Date.now()
  await ch.run(avance('discos'), () => false)
  tiempo('discos completos: buscar las listas', Date.now() - t0, { buscados: ch.pending() })
  const rep = ch.report()
  const by = (s: string) => rep.reports.filter((r) => r.status === s)
  const line = (r: (typeof rep.reports)[number]) => `- **${r.artist} — ${r.album}** (${r.tracks} temas) · \`${r.dir}\`${r.edition ? ` · edición ${r.edition.source} ${r.edition.date ?? ''} ${r.edition.country ?? ''} ${r.edition.tracks} temas` : ''}${r.missing.length ? `\n  - faltan ${r.missing.length}: ${r.missing.map((m) => m.title).join(' | ')}` : ''}${r.repeated.length ? `\n  - repetidos: ${r.repeated.map((x) => x.title).join(' | ')}` : ''}${r.extra.length ? `\n  - no están en la edición: ${r.extra.length}` : ''}`
  escribir('4-discos-vista.md', [
    `# Discos completos (${ahora()})`, '',
    `${rep.reports.length} discos revisados (${rep.skipped} no se revisan: carpetas-playlist o con menos de 3 temas). Discogs: ${rep.discogs ? 'sí' : 'no'}.`,
    ...['completo', 'faltan', 'elegir', 'no_encontrado', 'sin_buscar', 'ignorado'].map((s) => `- ${s}: ${by(s).length}`), '',
    ...['elegir', 'faltan', 'no_encontrado'].flatMap((s) => [`## ${s} (${by(s).length})`, '', ...by(s).map(line), '']),
  ].join('\n'))
}

async function tapas(a: Abierta) {
  const cv = new Covers(a.lib.db, a.c.changes, (id) => a.lib.trackPath(id), check(a), { ua, useDeezer: () => true })
  const t0 = Date.now()
  const props = await cv.scan(avance('tapas'), () => false)
  tiempo('tapas: buscar', Date.now() - t0, { discos: props.length, nuevas: props.filter((p) => p.proposed).length })
  escribir('4-tapas-vista.md', [`# Tapas (${ahora()})`, '', `${props.filter((p) => p.proposed).length} tapas nuevas de ${props.length} discos.`, '',
    ...props.map((p) => `- ${p.proposed ? 'NUEVA' : '·····'} · ${p.artist} — ${p.album} (${p.tracks}) · hoy ${p.current ? `${p.current.width}×${p.current.height}` : `sin tapa en ${p.without}`}${p.proposed ? ` → ${p.proposed.source} ${p.proposed.width}×${p.proposed.height}, en ${p.embed} temas${p.folderFile ? ' + cover.jpg' : ''}` : ` · ${p.why}`} · \`${p.dir}\``)].join('\n'))
  const plan = await volumenVista(a)
  if (!aplicar) return
  const st = cv.stage(props.filter((p) => p.proposed).map((p) => p.key))
  a.c.changes.stageMany(gainChanges(plan))
  const pend = a.c.changes.list()
  log(`Armado: tapa en ${st.tracks} temas, ${st.folders} cover.jpg, volumen parejo en ${plan.ready} · ${pend.length} cambios en ${new Set(pend.map((x) => x.fileId)).size} temas`)
  await aplicarPendientes(a, 'tapas-y-volumen')
}

async function volumenVista(a: Abierta) {
  const t0 = Date.now()
  const plan = await gainPlan(a.lib.db, (id) => a.lib.trackPath(id), { readCurrent: true, onProgress: avance('volumen') })
  tiempo('volumen parejo: calcular', Date.now() - t0, { listos: plan.ready })
  const tracks = plan.albums.flatMap((x) => x.tracks)
  const whys = new Map<string, number>()
  for (const t of tracks) if (t.why) whys.set(t.why, (whys.get(t.why) ?? 0) + 1)
  escribir('4-volumen-vista.md', [`# Volumen parejo (${ahora()})`, '',
    `Listos ${plan.ready}, iguales ${plan.same}, de otro programa y bien ${plan.other}, de otro programa y mal (se corrigen) ${plan.wrong}, sin analizar ${plan.notAnalyzed}, no se pueden escribir ${plan.cantWrite}.`, '',
    '## Por qué no se escriben', ...[...whys].sort((x, y) => y[1] - x[1]).map(([w, n]) => `- ${n} · ${w}`), '',
    '## Los que se corrigen (de otro programa, mal)', ...tracks.filter((t) => t.wrong != null).map((t) => `- ${t.current} → ${t.gain} dB (diferencia ${t.wrong} dB) · \`${t.rel}\``), '',
    '## Los más fuertes y los más bajos', ...[...tracks].filter((t) => t.gain != null).sort((x, y) => x.gain! - y.gain!).filter((_, i, l) => i < 10 || i >= l.length - 10).map((t) => `- ${t.gain} dB (${t.lufs} LUFS) · \`${t.rel}\``)].join('\n'))
  return plan
}

/** Un tono escrito de cualquier forma (Am, C#m, Dbm, A minor, 8A, 1d de Open Key) en Camelot, o null si no se entiende. */
function camelot(s: string): string | null {
  const v = s.trim().replace(/\s+/g, '').replace(/major|maj/i, '').replace(/minor|min/i, 'm')
  const cam = /^(\d{1,2})([ABab])$/.exec(v)
  if (cam && +cam[1] >= 1 && +cam[1] <= 12) return `${+cam[1]}${cam[2].toUpperCase()}`
  const ok = /^(\d{1,2})([dmDM])$/.exec(v) // Open Key: 1d = C mayor = 8B, 1m = La menor = 8A
  if (ok && +ok[1] >= 1 && +ok[1] <= 12) return `${((+ok[1] + 6) % 12) + 1}${ok[2].toLowerCase() === 'd' ? 'B' : 'A'}`
  const n = /^([A-Ga-g])([#b♯♭]?)(m?)$/.exec(v)
  if (!n) return null
  const pc = ({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 } as Record<string, number>)[n[1].toLowerCase()] + (n[2] === '#' || n[2] === '♯' ? 1 : n[2] ? -1 : 0)
  const p = (pc + 12) % 12
  // Camelot: C mayor = 8B y cada quinta suma 1; La menor = 8A
  const steps = (x: number) => ((x * 7) % 12)
  return n[3] ? `${((steps((p + 3) % 12) + 7) % 12) + 1}A` : `${((steps(p) + 7) % 12) + 1}B`
}

/** Solo lee: el BPM y el tono del tag (TBPM, TKEY) contra lo que mide PAILA. */
async function bpm(a: Abierta) {
  const rows = a.lib.db.prepare("SELECT f.id, f.rel_path AS rel, a.bpm, a.music_key AS k, a.camelot FROM files f JOIN analysis a ON a.file_id = f.id WHERE f.kind = 'musica' AND f.trashed_at IS NULL AND f.missing_at IS NULL AND a.bpm IS NOT NULL").all() as { id: number; rel: string; bpm: number; k: string | null; camelot: string | null }[]
  const t0 = Date.now()
  let conBpm = 0, conTono = 0
  const bpmMal: string[] = [], dobleMitad: string[] = [], tonoMal: string[] = [], tonoRaro: string[] = []
  for (const r of rows) {
    const p = a.lib.trackPath(r.id)
    let t: { bpm?: string; key?: string } = {}
    try { t = JSON.parse(p ? readSeratoTag(p) ?? '{}' : '{}') } catch { continue }
    const b = Number(String(t.bpm ?? '').replace(',', '.'))
    if (b > 0) {
      conBpm++
      const d = Math.abs(b - r.bpm)
      if (d > 1.5 && (Math.abs(b * 2 - r.bpm) <= 1.5 || Math.abs(b / 2 - r.bpm) <= 1.5)) dobleMitad.push(`${b} → ${r.bpm} · \`${r.rel}\``)
      else if (d > 1.5) bpmMal.push(`${b} → ${r.bpm} · \`${r.rel}\``)
    }
    if (t.key?.trim()) {
      conTono++
      const ck = camelot(t.key)
      if (r.camelot && ck && ck !== r.camelot.toUpperCase()) tonoMal.push(`${t.key} (${ck}) → ${r.k} (${r.camelot}) · \`${r.rel}\``)
      else if (!ck) tonoRaro.push(`${t.key} · \`${r.rel}\``)
    }
  }
  tiempo('bpm y tono: leer los tags', Date.now() - t0, { temas: rows.length })
  escribir('2-bpm-tono.md', [`# BPM y tono del tag contra lo que mide PAILA (${ahora()})`, '',
    `${rows.length} temas de Música con BPM de PAILA. Con BPM en el tag: ${conBpm}; con tono en el tag: ${conTono}.`,
    `- BPM distinto (más de 1,5): ${bpmMal.length}; el doble o la mitad: ${dobleMitad.length}`, `- Tono distinto (comparado en Camelot): ${tonoMal.length}; tono del tag que no se entiende: ${tonoRaro.length}`, '',
    '## Tono que no se entiende', ...tonoRaro.map((x) => `- ${x}`), '',
    '## BPM distinto', ...bpmMal.map((x) => `- ${x}`), '', '## El doble o la mitad', ...dobleMitad.map((x) => `- ${x}`), '', '## Tono distinto', ...tonoMal.map((x) => `- ${x}`)].join('\n'))
}

const PASOS: Record<string, (a: Abierta) => Promise<unknown>> = { discos, tapas, volumen: volumenVista, bpm }
if (!PASOS[mode]) fail(`Paso desconocido: ${mode}. Pasos: ${Object.keys(PASOS).join(', ')}`)
const a = abrir()
try { await PASOS[mode](a) } finally { a.lib.close() }
