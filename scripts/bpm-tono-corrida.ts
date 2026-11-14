// Corrida supervisada del paso "BPM y tono" de Arreglar nombres (core/tidy-djtag.ts) sobre Música-copia, con una copia de la base
// real (pedido del autor, 24/10; AGENTS.es.md, "Corridas supervisadas"). Escribe en <datos>/salidas; los archivos de música solo se
// tocan en aplicar y deshacer, y solo en la copia (con el aviso copia-en-uso.lock de esta sesión).
//   preparar --base <paila.db real> --datos <carpeta> --copia <Música-copia>: copia la base (VACUUM INTO) y la apunta a la copia.
//   vista --datos <carpeta>: lee el BPM y el tono de los tags (solo lee) y escribe la vista previa completa, con el motivo de cada
//     propuesta y lo que queda sin tocar que conviene mirar (discos con el mismo BPM que no se borran, tonos raros que se leen).
//   aplicar --datos <carpeta>: arma los cambios como el botón "Proponer" y los aplica como la app; controla cada archivo.
//   deshacer --datos <carpeta>: deshace la tanda desde el Historial y controla que cada tema volvió a como estaba.
//   node scripts/run-ts.mjs scripts/bpm-tono-corrida.ts <modo> --datos D:\PAILA-trabajo\bpm-tono\datos [...]
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseKey } from '@paila/core/analysis/bench'
import { pendingDjTags, readDjTag, refreshDjTags } from '@paila/core/djtag'
import { readTags } from '@paila/core/tagio'
import { tidy, toProposals } from '@paila/core/tidy'
import { djTagJunk, junkKey, tagBpm } from '@paila/core/tidy-djtag'
import { folderOf } from '@paila/core/tidy-steps'
import { visible } from '@paila/core/db'
import { arg, datos, fail, log, mode } from './corte-base'
import { abrir, ahora, controlarRespaldos, escribir, historialDe, huellasAntes, salidas, tiempo, type Abierta } from './ensayo-base'

const vistaJson = path.join(salidas, 'bpm-tono-vista.json'), aplicadoJson = path.join(salidas, 'bpm-tono-aplicado.json')
const lock = (a: Abierta) => path.join(path.dirname(a.root), 'copia-en-uso.lock')

function preparar() {
  const base = arg('--base'), copia = arg('--copia')
  if (!base || !copia || !datos) fail('Uso: preparar --base <paila.db> --datos <carpeta> --copia <Música-copia>')
  const db = path.join(datos, 'paila.db')
  if (fs.existsSync(db)) fail(`Ya hay una base en ${db}: borrala a mano si querés empezar de nuevo`)
  fs.mkdirSync(salidas, { recursive: true })
  const src = new DatabaseSync(base, { readOnly: true })
  src.exec(`VACUUM INTO '${db.replace(/'/g, "''")}'`)
  src.close()
  const raw = new DatabaseSync(db)
  raw.prepare('UPDATE roots SET rel_path = ? WHERE id = 1').run(path.relative(path.parse(copia).root, copia).split(path.sep).join('/'))
  raw.close()
  fs.writeFileSync(path.join(datos, 'corrida.json'), JSON.stringify({ startedAt: ahora() }))
  const a = abrir()
  log(`Base lista, apuntando a ${a.root}`)
  a.lib.close()
}

const rowsOf = (a: Abierta) => a.lib.db.prepare(`SELECT id, rel_path AS rel, ext FROM files WHERE ${visible()} AND error IS NULL AND kind = 'musica' ORDER BY rel_path`).all() as { id: number; rel: string; ext: string }[]
const pailaOf = (a: Abierta, id: number) => a.lib.db.prepare('SELECT bpm, bpm_base AS base FROM analysis WHERE file_id = ? AND error IS NULL').get(id) as { bpm: number | null; base: number | null } | undefined
const fmt = (n: number | null | undefined) => (n == null ? 'sin medir' : String(Math.round(n * 10) / 10))

async function vista() {
  const a = abrir()
  const pathOf = (i: number) => a.lib.trackPath(i)
  const t0 = Date.now(), pend = pendingDjTags(a.lib.db, pathOf)
  const r = await refreshDjTags(a.lib.db, pathOf)
  tiempo('bpm y tono: leer los tags', Date.now() - t0, { pendientes: pend, leidos: r.read, conAlgo: r.found })
  const rows = rowsOf(a)
  const t1 = Date.now()
  const report = tidy(a.lib.db, ['djtags'])
  tiempo('bpm y tono: el paso (tidy)', Date.now() - t1, { propuestas: report.changes.length })
  const junk = djTagJunk(a.lib.db, rows)
  if (junk.length !== report.changes.length) fail(`El paso propone ${report.changes.length} y djTagJunk dice ${junk.length}`)
  // todo lo que tiene escrito la Música, para mirar lo que NO se borra
  const all = (a.lib.db.prepare(`SELECT d.file_id AS id, f.rel_path AS rel, d.bpm, d.music_key AS key FROM file_djtag d JOIN files f ON f.id = d.file_id
    WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica' AND d.size = f.size AND d.mtime = f.mtime`).all() as { id: number; rel: string; bpm: string | null; key: string | null }[])
  const conBpm = all.filter((x) => x.bpm != null), conTono = all.filter((x) => x.key != null)
  const gone = new Set(junk.map((j) => `${j.id}|${j.field}`))
  const line = (j: (typeof junk)[number]) => `- \`${j.from}\` → se borra · PAILA ${fmt(pailaOf(a, j.id)?.bpm)} · \`${j.rel}\``
  // discos con el mismo BPM en 4 o más que NO se borran (para mirar que no se escape ninguno)
  const groups = new Map<string, { bpm: number; ids: number[] }>()
  for (const x of conBpm) { const b = tagBpm(x.bpm!); if (typeof b !== 'number') continue; const k = `${folderOf(x.rel)}|${Math.round(b * 100) / 100}`; const g = groups.get(k) ?? { bpm: b, ids: [] }; g.ids.push(x.id); groups.set(k, g) }
  const kept = [...groups].filter(([, g]) => g.ids.length >= 4 && !g.ids.some((id) => gone.has(`${id}|bpm`)))
  const rarosBpm = conBpm.filter((x) => tagBpm(x.bpm!) === null)
  const fuera = conBpm.filter((x) => { const b = tagBpm(x.bpm!); return typeof b === 'number' && (b < 40 || b > 250) && !gone.has(`${x.id}|bpm`) })
  const tonosRaros = conTono.filter((x) => !parseKey(x.key!.trim()) && !junkKey(x.key))
  const formas = new Map<string, number>()
  for (const x of conTono) { const k = x.key!.trim().replace(/[A-G]/g, 'N').replace(/\d+/g, '9'); formas.set(k, (formas.get(k) ?? 0) + 1) }
  const step = report.steps.find((s) => s.key === 'djtags')!
  escribir('bpm-tono-vista.md', [`# BPM y tono basura: vista previa completa (${ahora()})`, '',
    `${rows.length} temas de Música. Lectura de los tags: ${r.read} leídos ahora (${pend} pendientes), ${r.found} con BPM o tono. Con BPM en el tag: ${conBpm.length}; con tono: ${conTono.length}.`,
    `El paso propone **${report.changes.length} cambios en ${step.tracks} temas**. En la pantalla dice: ${step.detail ?? '(nada)'}`, '',
    '## Se borran: BPM imposible', ...junk.filter((j) => j.why === 'rango').map(line), '',
    '## Se borran: el mismo BPM en todo un disco que PAILA mide distinto',
    ...[...new Map(junk.filter((j) => j.why === 'carpeta').map((j) => [folderOf(j.rel), j])).values()].flatMap((g) => [
      `### \`${folderOf(g.rel)}\`: ${g.group!.tracks} temas con ${g.group!.bpm}; PAILA midió ${g.group!.measured} y se le parece en ${g.group!.like}`,
      ...junk.filter((j) => j.why === 'carpeta' && folderOf(j.rel) === folderOf(g.rel)).map(line)]), '',
    '## Se borran: tono que no se puede leer', ...junk.filter((j) => j.why === 'tono').map((j) => `- \`${j.from}\` → se borra · \`${j.rel}\``), '',
    '## Quedan (para mirar que no se escape nada)',
    `### Discos con el mismo BPM en 4 temas o más que no se tocan: ${kept.length}`,
    ...kept.map(([k, g]) => { const ps = g.ids.map((id) => pailaOf(a, id)?.bpm).filter((x): x is number => x != null); return `- ${g.ids.length} con ${g.bpm} · PAILA: ${ps.length ? ps.map(fmt).join(', ') : 'sin medir'} · \`${k.slice(0, k.lastIndexOf('|'))}\`` }),
    `### BPM fuera de 40–250 que quedan (PAILA mide eso, el doble o la mitad): ${fuera.length}`, ...fuera.map((x) => `- \`${x.bpm}\` · PAILA ${fmt(pailaOf(a, x.id)?.bpm)} · \`${x.rel}\``),
    `### BPM escritos raro (con números): ${rarosBpm.length}`, ...rarosBpm.map((x) => `- \`${x.bpm}\` · \`${x.rel}\``),
    `### Tonos que PAILA no entiende pero se leen (quedan): ${tonosRaros.length}`, ...tonosRaros.map((x) => `- \`${x.key}\` · \`${x.rel}\``),
    '### Cómo están escritos los tonos (N = nota, 9 = número)', ...[...formas].sort((x, y) => y[1] - x[1]).map(([k, n]) => `- \`${k}\`: ${n}`)].join('\n'))
  fs.writeFileSync(vistaJson, JSON.stringify(junk))
  a.lib.close()
}

/** La foto de cada tema que se toca: BPM y tono del tag, los demás tags tal cual, y lo que mide PAILA (que no se toca). */
const foto = (a: Abierta, ids: number[]) => Object.fromEntries([...new Set(ids)].map((id) => { const p = a.lib.trackPath(id)!; return [id, { rel: path.relative(a.root, p).split(path.sep).join('/'), dj: readDjTag(p), tags: readTags(p, { exact: true }), paila: pailaOf(a, id) ?? null }] }))

async function aplicar() {
  const a = abrir()
  if (!fs.existsSync(lock(a)) || !/bpm y tono/i.test(fs.readFileSync(lock(a), 'utf8'))) fail(`Falta el aviso ${lock(a)} de esta corrida`)
  await refreshDjTags(a.lib.db, (i) => a.lib.trackPath(i))
  const changes = tidy(a.lib.db, ['djtags']).changes
  const vistos = JSON.parse(fs.readFileSync(vistaJson, 'utf8')) as { id: number; field: string; from: string }[]
  const key = (x: { id: number; field: string; from: string | null }) => `${x.id}|${x.field}|${x.from}`
  if (JSON.stringify(changes.map(key).sort()) !== JSON.stringify(vistos.map(key).sort())) fail('Lo que se propone ahora no es lo de la vista previa')
  if (a.c.changes.list().length) fail('Hay Cambios pendientes de antes en la copia de la base')
  a.c.changes.stageMany(toProposals(changes))
  const pend = a.c.changes.list()
  log(`Cambios pendientes: ${pend.length} (${pend.filter((x) => x.after === null).length} se borran)`)
  const ids = pend.map((x) => x.fileId)
  const antes = foto(a, ids)
  const huellas = huellasAntes(a, ids)
  const desde = ahora(), t0 = Date.now()
  const r = await a.lib.ops.run('corrida: bpm y tono', () => a.c.changes.apply())
  tiempo('bpm y tono: aplicar', Date.now() - t0, { cambios: r.applied, temas: Object.keys(antes).length, fallas: r.failed.length })
  const mal: string[] = []
  for (const c of pend) {
    const p = a.lib.trackPath(c.fileId)!, now = readDjTag(p), was = antes[c.fileId]
    if (now[c.field as 'bpm' | 'key'] !== null) mal.push(`${c.rel}: ${c.field} sigue ${now[c.field as 'bpm' | 'key']}`)
    const otro = c.field === 'bpm' ? 'key' : 'bpm'
    if (!pend.some((x) => x.fileId === c.fileId && x.field === otro) && now[otro] !== was.dj[otro]) mal.push(`${c.rel}: cambió ${otro}`)
    if (JSON.stringify(readTags(p, { exact: true })) !== JSON.stringify(was.tags)) mal.push(`${c.rel}: cambiaron otros tags`)
    if (JSON.stringify(pailaOf(a, c.fileId) ?? null) !== JSON.stringify(was.paila)) mal.push(`${c.rel}: cambió lo que mide PAILA`)
  }
  // Pet Sounds, uno por uno (pedido del autor): se borra el 192 copiado; lo que mide PAILA queda
  const pet = Object.entries(antes).filter(([, x]) => x.rel.startsWith('Carpeta X/Pet Sounds/')).map(([id, x]) => `| ${path.posix.basename(x.rel)} | ${x.dj.bpm ?? '—'} | ${readDjTag(a.lib.trackPath(Number(id))!).bpm ?? '(vacío)'} | ${fmt(x.paila?.bpm)} | ${fmt(pailaOf(a, Number(id))?.bpm)} |`)
  const resp = controlarRespaldos(a, desde, huellas)
  const hist = historialDe(a).list().filter((e) => e.at >= desde)
  fs.writeFileSync(aplicadoJson, JSON.stringify({ batchId: r.batchId, antes }))
  escribir('bpm-tono-aplicar.md', [`# BPM y tono basura: aplicar (${desde})`, '',
    `${r.applied} cambios aplicados en ${Object.keys(antes).length} temas, ${r.failed.length} fallas. Controles por tema: ${mal.length ? `${mal.length} MAL` : 'todo bien (el BPM o el tono ya no está y lo demás quedó igual)'}.`,
    ...r.failed.map((f) => `- FALLA \`${f.rel}\`: ${f.error}`), ...mal.map((m) => `- MAL ${m}`), '',
    '## Pet Sounds, uno por uno', '', '| Tema | BPM del tag antes | después | PAILA antes | PAILA después |', '|---|---|---|---|---|', ...pet, '',
    '## Respaldo', ...resp.lineas, '', '## Historial', ...hist.map((e) => `- ${e.kind} ${e.id} · ${e.summary} · ${e.files} archivos · ${e.canUndo ? 'se puede deshacer' : `NO se puede deshacer: ${e.whyNot}`}`)].join('\n'))
  a.lib.close()
}

async function deshacer() {
  const a = abrir()
  if (!fs.existsSync(lock(a)) || !/bpm y tono/i.test(fs.readFileSync(lock(a), 'utf8'))) fail(`Falta el aviso ${lock(a)} de esta corrida`)
  const { batchId, antes } = JSON.parse(fs.readFileSync(aplicadoJson, 'utf8')) as { batchId: number; antes: Record<string, { rel: string; dj: { bpm: string | null; key: string | null }; tags: unknown; paila: unknown }> }
  const e = historialDe(a).list().find((x) => x.kind === 'tags' && x.id === batchId)
  if (!e?.canUndo) fail(`La tanda ${batchId} no se puede deshacer desde el Historial: ${e?.whyNot}`)
  const t0 = Date.now()
  const r = await a.lib.ops.run('corrida: deshacer bpm y tono', () => historialDe(a).undo('tags', batchId))
  tiempo('bpm y tono: deshacer', Date.now() - t0, { temas: Object.keys(antes).length })
  const mal: string[] = []
  for (const [id, was] of Object.entries(antes)) {
    const p = a.lib.trackPath(Number(id))!
    if (JSON.stringify(readDjTag(p)) !== JSON.stringify(was.dj)) mal.push(`${was.rel}: ${JSON.stringify(readDjTag(p))} en vez de ${JSON.stringify(was.dj)}`)
    if (JSON.stringify(readTags(p, { exact: true })) !== JSON.stringify(was.tags)) mal.push(`${was.rel}: cambiaron otros tags`)
    if (JSON.stringify(pailaOf(a, Number(id)) ?? null) !== JSON.stringify(was.paila)) mal.push(`${was.rel}: cambió lo que mide PAILA`)
  }
  const back = tidy(a.lib.db, ['djtags']).changes.length
  escribir('bpm-tono-deshacer.md', [`# BPM y tono basura: deshacer desde el Historial (${ahora()})`, '',
    `Historial: ${JSON.stringify(r)}. Controles por tema: ${mal.length ? `${mal.length} MAL` : 'todos volvieron con su BPM y su tono, y lo demás igual'}. El paso vuelve a proponer ${back}.`,
    ...mal.map((m) => `- MAL ${m}`)].join('\n'))
  a.lib.close()
}

const run: Record<string, () => unknown> = { preparar, vista, aplicar, deshacer }
if (!run[mode]) fail('Uso: preparar | vista | aplicar | deshacer (ver el encabezado)')
await run[mode]()
