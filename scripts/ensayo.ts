// Ensayo general del punto 1 del masterplan 3 (bitácora docs/pruebas/2026-10-24-ensayo-punto-1.md): los pasos que mañana se
// hacen sobre la Música real, en el mismo orden y enteros, sobre D:\PAILA-trabajo\Música-copia con una copia de la base (la
// prepara `motor-corrida.ts preparar`, que exige el aviso copia-en-uso.lock). Cada paso escribe su vista previa completa en
// <datos>/salidas para revisarla a mano; con --aplicar lo aplica como el botón de la app, mide cuánto tarda, controla el
// respaldo por paso y anota qué dice el Historial. Deshacer todo y comparar: `motor-corrida.ts deshacer` y `comparar`.
//
//   node scripts/run-ts.mjs scripts/ensayo.ts <paso> --datos <carpeta> [--aplicar]
// Pasos: duplicados, nombres, organizar (los de tapas, volumen y Rekordbox están en scripts/ensayo-discos.ts).
import fs from 'node:fs'
import path from 'node:path'
import { findDuplicates } from '@paila/core/duplicates'
import { tidy, tidyFirst, toProposals, type TidyStep } from '@paila/core/tidy'
import { rulesOf } from '@paila/shared/tidy-profiles'
import { DEFAULT_RULE } from '@paila/core/organizer'
import type { DupGroup } from '@paila/shared/types'
import { arg, fail, log, mode } from './corte-base'
import { abrir, ahora, aplicarPendientes, escribir, historial, historialDe, min, salidas, tiempo, type Abierta } from './ensayo-base'

const aplicar = process.argv.includes('--aplicar')

async function duplicados(a: Abierta) {
  const t0 = Date.now()
  // --sin-leer: sin abrir los archivos (los idénticos salen de la huella guardada): sirve mientras otra sesión usa la copia
  const groups = await findDuplicates(a.lib.db, process.argv.includes('--sin-leer') ? () => null : (id) => a.lib.trackPath(id))
  tiempo('duplicados: buscar', Date.now() - t0, { grupos: groups.length })
  const by = (l: DupGroup['level']) => groups.filter((g) => g.level === l)
  // lo mismo que el botón "Mandar N a la papelera" con lo que viene elegido (las versiones nunca)
  const ids: number[] = [], keptBy = new Map<number, number>()
  let bytes = 0
  for (const g of groups) if (g.keep != null) for (const it of g.items) if (it.id !== g.keep) { ids.push(it.id); keptBy.set(it.id, g.keep); bytes += it.size }
  const line = (g: DupGroup) => g.items.map((i) => {
    const k = g.keep === i.id ? '**se queda**' : g.keep == null ? '·' : 'papelera'
    return `  - ${k} · ${i.grade ?? '–'} · ${i.ext.toUpperCase()}${i.kbps ? ` ${i.kbps}` : ''} · ${min(i.duration)} · ${i.kind} · \`${i.rel}\`${i.artist || i.title ? ` — ${i.artist ?? '¿?'} / ${i.title ?? '¿?'}` : ''}${i.playlists.length ? ` · listas: ${i.playlists.join(', ')}` : ''}`
  }).join('\n')
  const inRb = a.c.rekordbox.exportedIds(ids).size
  fs.writeFileSync(path.join(salidas, '1-duplicados.json'), JSON.stringify(groups))
  // para mirar: un tema que se va de la carpeta de su disco (el disco queda incompleto) mientras se queda una copia suelta,
  // y una copia de "Para revisar" que le gana a una de Música
  const albumOf = new Map((a.lib.db.prepare("SELECT id, rel_path AS rel, album FROM files WHERE trashed_at IS NULL AND missing_at IS NULL AND kind = 'musica'").all() as { id: number; rel: string; album: string | null }[]).map((r) => [r.id, r]))
  const porCarpeta = new Map<string, Map<string, number>>()
  for (const r of albumOf.values()) if (r.album) { const d = path.posix.dirname(r.rel), m = porCarpeta.get(d) ?? new Map<string, number>(); m.set(r.album.toLowerCase(), (m.get(r.album.toLowerCase()) ?? 0) + 1); porCarpeta.set(d, m) }
  const enSuDisco = (id: number) => { const r = albumOf.get(id); return !!r?.album && (porCarpeta.get(path.posix.dirname(r.rel))?.get(r.album.toLowerCase()) ?? 0) >= 4 }
  const rompeDisco = groups.filter((g) => g.keep != null && !enSuDisco(g.keep) && g.items.some((i) => i.id !== g.keep && enSuDisco(i.id)))
  const revisarGana = groups.filter((g) => g.keep != null && g.items.find((i) => i.id === g.keep)?.kind !== 'musica' && g.items.some((i) => i.id !== g.keep && i.kind === 'musica'))
  const durDif = groups.filter((g) => g.keep != null && Math.max(...g.items.map((i) => i.duration ?? 0)) - Math.min(...g.items.map((i) => i.duration ?? 0)) > 3)
  escribir('1-duplicados-vista.md', [
    `# Duplicados — vista previa (${ahora()})`, '',
    `${groups.length} grupos: ${by('exact').length} idénticos, ${by('quality').length} mismo audio en otra calidad, ${by('probable').length} probables, ${by('version').length} de versiones.`,
    `El botón propone mandar a la papelera **${ids.length} archivos (${(bytes / 1e9).toFixed(2)} GB)**; ${inRb} ya estaban en un rekordbox.xml exportado.`,
    `Por colección, lo que va a la papelera: ${JSON.stringify(Object.fromEntries([...new Set(groups.flatMap((g) => g.items.map((i) => i.kind)))].map((k) => [k, groups.reduce((s, g) => s + (g.keep == null ? 0 : g.items.filter((i) => i.id !== g.keep && i.kind === k).length), 0)])))}`, '',
    `## Para mirar`, '',
    `- **Se saca un tema de la carpeta de su disco y se queda una copia suelta** (${rompeDisco.length}): ${rompeDisco.map((g) => `\`${g.items.find((i) => i.id === g.keep)!.rel}\` se queda, se va \`${g.items.filter((i) => i.id !== g.keep && enSuDisco(i.id)).map((i) => i.rel).join('`, `')}\``).join(' · ')}`,
    `- **Se queda una copia de "Para revisar" y se va la de Música** (${revisarGana.length}): ${revisarGana.map((g) => `\`${g.items.find((i) => i.id === g.keep)!.rel}\``).join(' · ')}`,
    `- **Duran distinto (más de 3 s)** (${durDif.length}): ${durDif.map((g) => g.items.map((i) => `${min(i.duration)}${i.id === g.keep ? '*' : ''}`).join('/')).join(' · ')}`, '',
    ...(['probable', 'quality', 'exact', 'version'] as const).flatMap((l) => [
      `## ${by(l)[0]?.label ?? l} (${by(l).length})`, '',
      ...by(l).map((g, i) => `${i + 1}. ${g.why}${g.similarity != null ? ` (parecido ${Math.round(g.similarity * 100)} %)` : ''}${g.warning ? ` — ⚠ ${g.warning}` : ''}\n${line(g)}`), '',
    ]),
  ].join('\n'))
  if (!aplicar) return
  const desde = ahora()
  const t1 = Date.now()
  const r = await a.lib.ops.run('ensayo: duplicados', () => a.c.trash.trash(ids, 'Duplicados', keptBy))
  tiempo('duplicados: a la papelera', Date.now() - t1, { archivos: r.moved, fallas: r.failed.length, gb: +(bytes / 1e9).toFixed(2) })
  for (const f of r.failed) log(`  FALLA ${f.rel}: ${f.error}`)
  historial(a).filter((e) => e.at >= desde)
}

/** Las reglas del perfil Oficial, y los pasos que vienen marcados en la pantalla (todos los que proponen algo). */
const OFICIAL = rulesOf('oficial')

async function nombres(a: Abierta) {
  const pathOf = (id: number) => a.lib.trackPath(id)
  const t0 = Date.now()
  const { screen, changes } = tidyFirst(a.lib.db, pathOf, OFICIAL)
  tiempo('nombres: abrir la pantalla (perfil Oficial)', Date.now() - t0, { cambios: changes.length })
  const steps = screen.steps.filter((s) => s.count).map((s) => s.key) as TidyStep[]
  const pct = (n: number) => `${n} (${Math.round((100 * n) / Math.max(1, screen.before.total))} %)`
  const comp = (c: typeof screen.before) => `artista ${pct(c.artist)}, título ${pct(c.title)}, álbum ${pct(c.album)}, año ${pct(c.year)}, género ${pct(c.genre)}`
  const porPaso = new Map<string, typeof changes>()
  for (const ch of changes) porPaso.set(ch.step, [...(porPaso.get(ch.step) ?? []), ch])
  escribir('2-nombres-vista.md', [
    `# Arreglar nombres y tags, perfil Oficial — vista previa (${ahora()})`, '',
    `${changes.length} cambios en ${new Set(changes.map((x) => x.id)).size} temas. Búsquedas oficiales guardadas: ${screen.searched}.`,
    `Antes: ${comp(screen.before)} de ${screen.before.total}.`, `Después: ${comp(screen.after)}.`,
    `Sin artista o título que no se pueden completar: ${screen.leftover.count}.`, '',
    '## Pasos', ...screen.steps.map((s) => `- **${s.key}** ${s.count} cambios en ${s.tracks} temas${s.warning ? ` — ⚠ ${s.warning}` : ''}`), '',
    '## Por regla', ...Object.entries(screen.byRule).map(([k, v]) => `- ${k}: ${v!.count}`), '',
    `## Para mirar a mano (${screen.review.length}: ${screen.review.filter((r) => !r.staged).length} dudas que no se aplican solas y ${screen.review.filter((r) => r.staged).length} cambios que sí se aplican, con una nota; ${screen.kept} ya dejados como están)`, '',
    ...screen.review.map((r) => `- ${r.staged ? '[SE APLICA] ' : '[DUDA] '}${r.field}: \`${r.from ?? '∅'}\` → \`${r.to}\` · ${r.why}${r.origin ? ` · ${r.origin}` : ''}${r.blocked ? ' · BLOQUEADO' : ''} · \`${r.rel}\``), '',
    '### Por motivo', ...[...new Map(screen.review.map((r) => [`${r.staged ? 'se aplica' : 'duda'} · ${r.why.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N').slice(0, 110)}`, 0])).keys()]
      .map((k) => [k, screen.review.filter((r) => `${r.staged ? 'se aplica' : 'duda'} · ${r.why.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N').slice(0, 110)}` === k).length] as const).sort((x, y) => y[1] - x[1]).map(([k, n]) => `- ${n} · ${k}`), '',
    `## Sets y en vivo (${screen.sets.length})`, ...screen.sets.map((s) => `- ${s.minutes} min · ${s.why} · \`${s.rel}\``), '',
    `## Sin artista o título que no se completan (muestra)`, ...screen.leftover.sample.map((s) => `- \`${s}\``), '',
    ...[...porPaso].flatMap(([step, l]) => [`## Paso ${step} (${l.length})`, '',
      ...l.map((ch) => `- ${ch.field}: \`${ch.from ?? '∅'}\` → \`${ch.to}\`${ch.rules?.length ? ` [${ch.rules.join(',')}]` : ''}${ch.note ? ` · ${ch.note}` : ''} · \`${ch.rel}\``), '']),
  ].join('\n'))
  if (!aplicar) return
  // como "Pasar a Cambios pendientes" con los pasos marcados y después "Aplicar todo"
  const p = toProposals(tidy(a.lib.db, steps, pathOf, OFICIAL).changes)
  a.c.changes.stageMany(p)
  const pend = a.c.changes.list()
  log(`Pendientes: ${pend.length} (${p.length} propuestas). Por campo: ${JSON.stringify(Object.fromEntries([...new Set(pend.map((x) => x.field))].map((f) => [f, pend.filter((x) => x.field === f).length])))}`)
  await aplicarPendientes(a, 'nombres')
}

async function organizar(a: Abierta) {
  const o = { rule: DEFAULT_RULE, dest: 'Biblioteca' }
  const t0 = Date.now()
  const plan = a.c.organizer.plan(o)
  tiempo('organizar: vista previa', Date.now() - t0, { mover: plan.moves.length, acompañantes: plan.extras.length, choques: plan.conflicts })
  const kinds = a.lib.db.prepare('SELECT kind, COUNT(*) AS n FROM files WHERE trashed_at IS NULL AND missing_at IS NULL AND excluded_at IS NULL GROUP BY kind').all()
  const inRb = a.c.rekordbox.exportedIds(plan.moves.map((m) => m.fileId)).size
  escribir('3-organizar-vista.md', [
    `# Organizar (${o.rule} en ${o.dest}) — vista previa (${ahora()})`, '',
    `Se mueven ${plan.moves.length} temas y ${plan.extras.length} acompañantes (tapas, .cue…). Ya en su lugar: ${plan.alreadyOk}. Se saltean: ${plan.skipped.length}. Choques "(2)": ${plan.conflicts}. ${inRb} ya estaban en un rekordbox.xml.`,
    `Temas por colección (solo se organiza "musica"): ${JSON.stringify(kinds)}`, '',
    `## Choques (${plan.clashes?.length ?? 0})`, ...(plan.clashes ?? []).map((c) => `- \`${c.from}\` → \`${c.to}\` (con \`${c.with}\`)`), '',
    `## Se saltean (${plan.skipped.length})`, ...plan.skipped.map((s) => `- ${s.reason} · \`${s.rel}\``), '',
    `## Acompañantes (${plan.extras.length})`, ...plan.extras.map((x) => `- \`${x.from}\` → \`${x.to}\``), '',
    `## Movimientos (${plan.moves.length})`, ...plan.moves.map((m) => `- \`${m.from}\` → \`${m.to}\``),
  ].join('\n'))
  if (!aplicar) return
  const desde = ahora()
  const t1 = Date.now()
  let last = 0
  const r = await a.lib.ops.run('ensayo: organizar', () => a.c.organizer.apply(a.c.organizer.plan(o), { onProgress: (p) => { if (p.done - last >= 500) { last = p.done; log(`  ${p.done}/${p.total}`) } } }))
  tiempo('organizar: aplicar', Date.now() - t1, { movidos: r.moved, acompañantes: r.extras, fallas: r.failed.length })
  for (const f of r.failed) log(`  FALLA ${f.rel}: ${f.error}`)
  const again = a.c.organizer.plan(o)
  log(`Después: quedan para mover ${again.moves.length} y ${again.extras.length} acompañantes; ya en su lugar ${again.alreadyOk}`)
  historial(a).filter((e) => e.at >= desde)
}

/** Deshace una tanda del Historial (--tipo organizar --id 2), como el botón, y mide cuánto tarda. */
async function deshacer(a: Abierta) {
  const tipo = arg('--tipo'), id = Number(arg('--id'))
  const e = historial(a).find((x) => x.kind === tipo && x.id === id)
  if (!e) fail(`No está en el Historial: ${tipo} ${id}`)
  const t0 = Date.now()
  const r = await a.lib.ops.run('ensayo: deshacer', () => historialDe(a).undo(e!.kind, id))
  tiempo(`deshacer ${tipo} ${id}`, Date.now() - t0, { hechos: r.done, fallas: r.failed.length })
  for (const f of r.failed) log(`  FALLA ${f.rel}: ${f.error}`)
}

const PASOS: Record<string, (a: Abierta) => Promise<void>> = { duplicados, nombres, organizar, deshacer }
if (!PASOS[mode]) fail(`Paso desconocido: ${mode}. Pasos: ${Object.keys(PASOS).join(', ')}`)
void arg
const a = abrir()
try { await PASOS[mode](a) } finally { a.lib.close() }
