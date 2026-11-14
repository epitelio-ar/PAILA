// Repaso de criterios del 24/10 (bitácora docs/pruebas/2026-10-24-repaso-criterios.md): las decisiones que PAILA toma sola,
// probadas contra la vista previa de la Música real con una COPIA de la base, sin tocar ningún archivo (PAILA_SOLO_LECTURA).
//   simular:   en la copia de la base, y solo en la base, hace como si se hubieran aplicado Duplicados (los que se van quedan
//              "en la papelera") y Arreglar nombres (perfil Oficial, sin renombrar archivos), para ver Organizar, Tapas y Discos
//              como los vería alguien que hizo los pasos 1 y 2. Los archivos no se leen ni se escriben.
//   organizar: la vista previa de Organizar con lo que conviene mirar: carpetas de artista que en Windows serían la misma, artistas
//              repartidos en varias carpetas, "&", "x", "y", compilados. segundo: un segundo Organizar tiene que dar 0.
//   danados:   "Dañado" con la cuenta vieja y la nueva, leyendo los archivos de --musica (solo lectura).
//   mayusculas: los títulos que Deezer publica con otras mayúsculas (propuesta para mirar, no se aplica).
//   bandeja:   entre dos archivos que llegaron para el mismo tema, el de antes y el de ahora (--bandeja <carpeta>; no toca nada).
//   tapas-deezer: los discos con varios candidatos del mismo nombre en Deezer, la tapa de antes y la de ahora (pregunta a Deezer).
//
//   PAILA_SOLO_LECTURA=1 node scripts/run-ts.mjs scripts/repaso.ts <paso> --datos <carpeta con la copia de paila.db>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { countDecodeErrors, endsWithId3v1 } from '@paila/core/analysis/decodeerrors'
import { lowPriority } from '@paila/core/lowpriority'
import { visible } from '@paila/core/db'
import { findDuplicates } from '@paila/core/duplicates'
import { InboxFlow } from '@paila/core/inboxflow'
import type { InboxResult } from '@paila/shared/types'
import { OnlineCache, Polite, realFetch } from '@paila/core/online/http'
import { albumGroups } from '@paila/core/albums'
import { albumMatch, pickByTracks, sameNumber, type DeezerAlbum, type DeezerAlbumInfo } from '@paila/core/covers'
import { albumBase } from '@paila/core/albumcheck'
import { similarity } from '@paila/core/online/hits'
import type { AlbumGroup } from '@paila/core/albums'
import { bareTitle, type RecHit } from '@paila/core/online/hits'
import { recKey } from '@paila/core/official-findings'
import { tidy, type TidyStep } from '@paila/core/tidy'
import { COLUMN, type TagField } from '@paila/core/tagio'
import { rulesOf } from '@paila/shared/tidy-profiles'
import { DEFAULT_RULE } from '@paila/core/organizer'
import { fold, loose } from '@paila/core/names'
import { arg, fail, log, mode } from './corte-base'
import { abrir, ahora, escribir, salidas, type Abierta } from './ensayo-base'

if (process.env.PAILA_SOLO_LECTURA !== '1') fail('Correlo con PAILA_SOLO_LECTURA=1: el repaso no toca archivos')

async function simular(a: Abierta) {
  const db = a.lib.db
  if (db.prepare("SELECT value FROM settings WHERE key = 'repaso_simulado'").get()) fail('Esta copia ya está simulada')
  // 1) Duplicados: lo que el botón manda a la papelera, solo marcado en la base
  const groups = await findDuplicates(db, () => null)
  const ids = groups.flatMap((g) => (g.keep == null ? [] : g.items.filter((i) => i.id !== g.keep).map((i) => i.id)))
  const now = new Date().toISOString()
  const trash = db.prepare('UPDATE files SET trashed_at = ? WHERE id = ?')
  for (const id of ids) trash.run(now, id)
  log(`Duplicados: ${ids.length} temas marcados como en la papelera (solo en la base)`)
  // 2) Arreglar nombres, perfil Oficial, todos los pasos que proponen algo; los tags van a la base, los archivos no se renombran
  const OFICIAL = rulesOf('oficial')
  const all = tidy(db, undefined, (id) => a.lib.trackPath(id), OFICIAL)
  const steps = [...new Set(all.changes.map((c) => c.step))] as TidyStep[]
  const { changes } = tidy(db, steps, (id) => a.lib.trackPath(id), OFICIAL)
  let n = 0
  for (const ch of changes) {
    if (ch.field === 'filename' || ch.field === 'extension') continue
    const col = COLUMN[ch.field as TagField]
    if (!col) continue
    db.prepare(`UPDATE files SET ${col} = ? WHERE id = ?`).run(ch.to, ch.id)
    n++
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('repaso_simulado', ?)").run(now)
  log(`Nombres: ${n} tags cambiados en la base (de ${changes.length} cambios; los renombres de archivo no)`)
}

async function organizar(a: Abierta) {
  const o = { rule: DEFAULT_RULE, dest: 'Biblioteca' }
  const plan = a.c.organizer.plan(o)
  // carpeta de artista de cada tema movido (lo que queda debajo de "Biblioteca/")
  const artistDir = (to: string) => to.split('/')[1]
  const dirs = new Map<string, number>()
  for (const m of plan.moves) dirs.set(artistDir(m.to), (dirs.get(artistDir(m.to)) ?? 0) + 1)
  // en Windows "DE LA CALLE" y "De La Calle" son la misma carpeta; "Rodríguez" y "Rodriguez", no (dos carpetas)
  const byFold = new Map<string, string[]>()
  for (const d of dirs.keys()) byFold.set(fold(d), [...(byFold.get(fold(d)) ?? []), d])
  const twins = [...byFold.values()].filter((l) => l.length > 1)
  // un artista principal que además aparece con otros ("Kase.O" y "Kase.O & Andres Campo")
  const names = [...dirs.keys()]
  const withOthers = names.flatMap((d) => {
    const m = d.match(/^(.+?)\s+(?:&|x|y|and|vs\.?|con)\s+(.+)$/i)
    if (!m) return []
    const solo = names.filter((x) => fold(x) === fold(m[1]) || fold(x) === fold(m[2]))
    return [`\`${d}\` (${dirs.get(d)})${solo.length ? ` — también: ${solo.map((s) => `\`${s}\` (${dirs.get(s)})`).join(', ')}` : ''}`]
  })
  const varios = plan.moves.filter((m) => artistDir(m.to) === 'Varios Artistas')
  escribir('3-organizar-repaso.md', [
    `# Organizar (${o.rule} en ${o.dest}) — repaso (${ahora()})`, '',
    `Se mueven ${plan.moves.length} temas y ${plan.extras.length} acompañantes. Ya en su lugar: ${plan.alreadyOk}. Se saltean: ${plan.skipped.length}. Choques "(2)": ${plan.conflicts}.`,
    `Carpetas de artista: ${dirs.size}.`, '',
    `## Carpetas que solo cambian en mayúsculas o acentos (${twins.length})`, ...twins.map((l) => `- ${l.map((d) => `\`${d}\` (${dirs.get(d)})`).join(' · ')}`), '',
    `## Con "&", "x", "y", "vs" o "con" (${withOthers.length})`, ...withOthers.map((x) => `- ${x}`), '',
    `## Varios Artistas (${varios.length})`, ...varios.map((m) => `- \`${m.from}\` → \`${m.to}\``), '',
    `## Choques (${plan.clashes?.length ?? 0})`, ...(plan.clashes ?? []).map((c) => `- \`${c.from}\` → \`${c.to}\` (con \`${c.with}\`)`), '',
    `## Se saltean (${plan.skipped.length})`, ...plan.skipped.map((s) => `- ${s.reason} · \`${s.rel}\``), '',
    `## Carpetas de artista (${dirs.size})`, ...[...dirs].sort((x, y) => x[0].localeCompare(y[0])).map(([d, k]) => `- \`${d}\` ${k}`), '',
    `## Movimientos (${plan.moves.length})`, ...plan.moves.map((m) => `- \`${m.from}\` → \`${m.to}\``),
  ].join('\n'))
  fs.writeFileSync(path.join(salidas, '3-organizar-repaso.json'), JSON.stringify(plan))
}

/** Un segundo Organizar tiene que dar 0: pone en la base (solo en la base) cada tema donde lo deja el primero y vuelve a armar el plan. */
async function segundo(a: Abierta) {
  const o = { rule: DEFAULT_RULE, dest: 'Biblioteca' }
  const first = a.c.organizer.plan(o)
  const move = a.lib.db.prepare('UPDATE files SET rel_path = ? WHERE id = ?')
  for (const m of first.moves) move.run(m.to, m.fileId)
  const again = a.c.organizer.plan(o)
  log(`Primer Organizar: ${first.moves.length} temas. Segundo: ${again.moves.length} temas`)
  for (const m of again.moves.slice(0, 30)) log(`  ${m.from} → ${m.to}`)
}

/**
 * "Dañado": cuántos errores da cada tema con la cuenta vieja (palabras de error en todo lo que escribe ffmpeg) y con la nueva
 * (tropiezos del decodificador), leyendo el archivo de `--musica` (solo lectura, de a uno y con prioridad baja). Los que hoy dicen
 * "Dañado" y una muestra de `--sanos` que no.
 */
async function danados(a: Abierta) {
  const musica = arg('--musica') || a.root, sanos = Number(arg('--sanos', '60'))
  const W = /(error|invalid|corrupt|overread|skipping)/gi, L = /Decoding error|Error while decoding/i
  const oldCount = (stderr: string, file: string) => { // la de antes del 24/10, tal cual
    const all = (stderr.match(W) || []).length
    if (!all || /\.mp3$/i.test(file) || !endsWithId3v1(file)) return all
    const lines = stderr.split(/\r?\n/); let i = lines.length - 1
    while (i >= 0 && !L.test(lines[i])) i--
    if (i < 0) return all
    let last = lines[i].match(W)?.length ?? 0
    for (i--; i >= 0 && !L.test(lines[i]) && (lines[i].match(W) || /\bfailed\b/i.test(lines[i])); i--) last += lines[i].match(W)?.length ?? 0
    return all - last
  }
  const read = (file: string) => new Promise<string>((res) => {
    const p = spawn(a.ffmpeg, ['-hide_banner', '-nostats', '-nostdin', '-i', file, '-f', 'null', '-'], { windowsHide: true })
    lowPriority(p.pid)
    let e = ''
    p.stderr.on('data', (d) => { e += d; if (e.length > 200_000) e = e.slice(-100_000) })
    p.on('close', () => res(e)); p.on('error', () => res(''))
  })
  const base = `FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND f.kind != 'produccion' AND f.error IS NULL`
  const dam = a.lib.db.prepare(`SELECT f.id, f.rel_path AS rel, a.grade ${base} AND a.flags LIKE '%damaged%' ORDER BY f.rel_path`).all() as { id: number; rel: string; grade: string }[]
  const ok = a.lib.db.prepare(`SELECT f.id, f.rel_path AS rel, a.grade ${base} AND COALESCE(a.flags, '') NOT LIKE '%damaged%' ORDER BY (f.id * 7919) % 4703 LIMIT ?`).all(sanos) as typeof dam
  const rows: { kind: string; viejo: number | null; nuevo: number | null; grade: string; rel: string }[] = []
  for (const [kind, list] of [['dañado', dam], ['sano', ok]] as const) for (const r of list) {
    const file = path.join(musica, ...r.rel.split('/'))
    if (!fs.existsSync(file)) { rows.push({ kind, viejo: null, nuevo: null, grade: r.grade, rel: r.rel }); continue }
    const e = await read(file)
    rows.push({ kind, viejo: oldCount(e, file), nuevo: countDecodeErrors(e, file), grade: r.grade, rel: r.rel })
  }
  const d = rows.filter((r) => r.kind === 'dañado' && r.nuevo != null), s = rows.filter((r) => r.kind === 'sano' && r.nuevo != null)
  const sale = d.filter((r) => r.nuevo! <= 3), entra = s.filter((r) => r.nuevo! > 3)
  escribir('calidad-danados.md', [
    `# "Dañado": cuenta vieja (palabras) y nueva (tropiezos) — ${ahora()}`, '',
    `Leídos de ${musica}. Hoy dicen "Dañado": ${dam.length} (${d.length} leídos). Muestra de sanos: ${s.length}.`,
    `- Dejan de ser "Dañado" (3 tropiezos o menos): **${sale.length}**`,
    `- Siguen "Dañado": ${d.length - sale.length}`,
    `- De la muestra de sanos, pasarían a "Dañado": **${entra.length}**`, '',
    '| | Palabras (antes) | Tropiezos (ahora) | Nota | Tema |', '|---|---:|---:|---|---|',
    ...rows.map((r) => `| ${r.kind} | ${r.viejo ?? '—'} | ${r.nuevo ?? '—'} | ${r.grade} | \`${r.rel}\` |`),
  ].join('\n'))
  log(`Dejan de ser "Dañado": ${sale.length} de ${d.length}; de ${s.length} sanos, pasarían: ${entra.length}`)
}

/** Títulos que Deezer publica con otras mayúsculas que las tuyas (las mismas letras): una propuesta para mirar, no se aplica. */
async function mayusculas(a: Abierta) {
  const cache = new OnlineCache(a.lib.db)
  cache.known('deezer')
  const rows = a.lib.db.prepare(`SELECT id, rel_path AS rel, artist, title FROM files WHERE ${visible()} AND kind = 'musica' AND artist IS NOT NULL AND title IS NOT NULL ORDER BY rel_path`).all() as { id: number; rel: string; artist: string; title: string }[]
  const out: string[] = []
  for (const r of rows) {
    const hits = cache.get<RecHit[]>('deezer', recKey(r.artist, r.title))?.data ?? []
    const same = hits.map((h) => bareTitle(h.title)).find((t) => t !== r.title && t.toLowerCase() === r.title.toLowerCase())
    if (same) out.push(`- \`${r.title}\` → \`${same}\` · ${r.artist} · \`${r.rel}\``)
  }
  escribir('2-titulos-mayusculas.md', [`# Títulos con otras mayúsculas en Deezer — ${ahora()}`, '', `${out.length} de ${rows.length} temas. Propuesta para mirar: no se aplica.`, '', ...out].join('\n'))
  log(`Títulos con otras mayúsculas en Deezer: ${out.length} de ${rows.length}`)
}

/**
 * Tapas de Deezer: el disco que se elegía antes (el primero que pasaba la comparación vieja, donde "Luis Miguel del Amargue"
 * contenía a "Luis Miguel") y el de ahora (comparación nueva y, si hay varios, por los temas y el año). Pregunta a Deezer (solo
 * lectura, de a uno), no baja ninguna imagen.
 */
async function tapasDeezer(a: Abierta) {
  const dz = new Polite('Deezer', 400, realFetch, 'PAILA repaso de criterios')
  const oldSame = (g: AlbumGroup, artist: string, album: string) => {
    const x = albumBase(album), y = albumBase(g.album), ok = x === y || (similarity(x, y) >= 0.85 && sameNumber(album, g.album))
    const u = loose(artist), v = loose(g.artist)
    return ok && (g.various || u === v || u.includes(v) || v.includes(u) || similarity(u, v) >= 0.8)
  }
  const info = new Map<number, DeezerAlbumInfo | null>()
  const get = async (id: number) => { if (!info.has(id)) info.set(id, await dz.json<DeezerAlbumInfo>(`https://api.deezer.com/album/${id}`).catch(() => null)); return info.get(id)! }
  const desc = (c: DeezerAlbum | undefined) => (c ? `${c.artist?.name ?? '?'} — ${c.title} (${info.get(c.id!)?.release_date?.slice(0, 4) ?? '?'}, ${info.get(c.id!)?.tracks?.data?.length ?? '?'} temas)` : 'ninguno')
  const out: string[] = []
  let total = 0
  for (const g of albumGroups(a.lib.db, 2)) {
    const q = g.various ? `album:"${g.album}"` : `artist:"${g.artist}" album:"${g.album}"`
    const all = ((await dz.json<{ data?: DeezerAlbum[] }>(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=8`).catch(() => null))?.data ?? []).filter((d) => d.cover_xl)
    const before = all.find((d) => oldSame(g, d.artist?.name ?? '', d.title))
    const cands = all.filter((d) => albumMatch(g, d.artist?.name ?? '', d.title))
    const unsure = new Set(cands.filter((d) => albumMatch(g, d.artist?.name ?? '', d.title) === 'quizas'))
    const now = cands.length > 1 || unsure.size ? await pickByTracks(g, cands, get, unsure) : cands[0]
    if (!before && !now) continue
    total++
    if (before?.id === now?.id) continue
    for (const c of [before, now]) if (c?.id != null) await get(c.id)
    out.push(`- ${g.artist} — ${g.album} (${g.year ?? 'sin año'}, ${g.tracks.length} temas tuyos): antes ${desc(before)} · ahora ${desc(now)}`)
  }
  escribir('4-tapas-deezer.md', [`# Tapas de Deezer: antes y ahora — ${ahora()}`, '', `${total} discos con una tapa posible en Deezer; cambia en ${out.length}.`, '', ...out].join('\n'))
  log(`Discos con tapa posible en Deezer: ${total}; cambia en ${out.length}`)
}

/**
 * Bandeja: entre dos o más archivos que llegaron para el mismo tema, el que se elegía antes (mejor nota y, si empatan, el primero
 * por nombre) y el de ahora (la regla de Duplicados). Lee lo que ya revisó la Bandeja (`--bandeja`: su carpeta); no toca nada.
 */
async function bandeja(a: Abierta) {
  const folder = arg('--bandeja')
  if (!folder) fail('Falta --bandeja <carpeta>')
  const flow = new InboxFlow(a.lib.db, { workDir: path.join(salidas, 'bandeja-trabajo') } as never, null as never, null as never, { ffprobe: a.ffprobe, describe: null as never, inRekordbox: () => [] })
  const all = flow.results(folder).filter((r) => r.decision === 'reemplazar' && r.match)
  const RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }
  const old = new Map<number, InboxResult>()
  for (const r of all) { const b = old.get(r.match!.fileId); if (!b || (RANK[r.check?.newGrade ?? ''] ?? 9) < (RANK[b.check?.newGrade ?? ''] ?? 9)) old.set(r.match!.fileId, r) }
  const now = new Map(flow.plan(folder).replace.map((p) => [p.fileId, p.path]))
  const out: string[] = []
  for (const [id, r] of old) {
    const cands = all.filter((x) => x.match!.fileId === id)
    if (cands.length < 2) continue
    out.push(`- ${r.match!.rel}: ${cands.length} archivos · antes \`${path.basename(r.path)}\` · ahora \`${path.basename(now.get(id) ?? '')}\`${now.get(id) === r.path ? ' (igual)' : ''} · ${cands.map((c) => `${c.check?.newGrade} ${c.ext} ${c.kbps ?? ''}`).join(' / ')}`)
  }
  escribir('bandeja-repaso.md', [`# Bandeja: dos archivos para el mismo tema — ${ahora()}`, '', ...out].join('\n'))
  log(`Temas con dos archivos o más en la Bandeja: ${out.length}; cambia cuál va en ${out.filter((l) => !l.includes('(igual)')).length}`)
}

const PASOS: Record<string, (a: Abierta) => Promise<void>> = { bandeja, simular, organizar, segundo, danados, mayusculas, 'tapas-deezer': tapasDeezer }
if (!PASOS[mode]) fail(`Paso desconocido: ${mode}. Pasos: ${Object.keys(PASOS).join(', ')}`)
const a = abrir()
try { await PASOS[mode](a) } finally { a.lib.close() }
