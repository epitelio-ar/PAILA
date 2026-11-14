// Punto 1 del masterplan 3 sobre la Música de verdad (bitácora docs/pruebas/2026-10-24-punto-1-real.md): lo que se mira antes y
// después de cada paso. Las vistas previas van sobre una COPIA de la base con PAILA_SOLO_LECTURA=1 (scripts/ensayo.ts con
// --musica-real); acá van las que no tiene el ensayo y la cuenta de la base real, que se abre solo para leer.
//   traer:  "4. Traer lo que ya hiciste en Rekordbox" sobre la copia (solo la base): cuántos temas reconoce y cuántas grillas trae.
//   simular-duplicados / simular-nombres: en una copia, y solo en su base, como si se hubieran aplicado los pasos 1 y 2.
//   traer-real: lo mismo que traer, sobre la base real y con PAILA cerrada (--base-real).
//   volumen: vista previa de "Volumen parejo" sobre la copia (lee el ReplayGain de cada archivo, no escribe nada).
//   exportar: el rekordbox.xml de toda la Música desde la copia (--xml dentro de D:\PAILA-trabajo), con su resumen; --heredar
//           pasa antes a la copia que queda las estrellas y veces tocado del duplicado que se fue.
//   exportar-real: lo mismo desde la base real, con PAILA cerrada (--base-real), heredando siempre.
//   nombres-de: los cambios de Nombres (perfil Oficial) de unas carpetas (--donde "a/|b/"), uno por renglón, sobre la copia.
//   contar: la base real (o la que diga --base), abierta solo para leer: temas por colección, papelera, playlists, Rekordbox,
//           pendientes, respaldos y lo último del Historial. Para el antes y el después de cada paso.
//
//   PAILA_SOLO_LECTURA=1 node scripts/run-ts.mjs scripts/punto1-real.ts traer --datos <copia> --xml <rekordbox.xml> --musica-real
//   node scripts/run-ts.mjs scripts/punto1-real.ts contar [--base <paila.db>] [--salida <archivo.json>]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gridPlan } from '@paila/core/gridrun'
import type { TidyStep } from '@paila/core/tidy'
import { arg, fail, log, mode } from './corte-base'

async function traer() {
  if (process.env.PAILA_SOLO_LECTURA !== '1') fail('Correlo con PAILA_SOLO_LECTURA=1')
  const xml = arg('--xml')
  if (!xml || !fs.existsSync(xml)) fail('Falta --xml')
  const { abrir, ahora, escribir, tiempo } = await import('./ensayo-base') // crea <datos>/salidas: solo con --datos
  const a = abrir()
  try {
    const dj = a.c.rekordbox.dj
    const t0 = Date.now()
    const r = await a.lib.ops.run('punto 1: traer de Rekordbox (copia)', () => dj.importRekordbox(xml))
    tiempo('rekordbox: traer su XML', Date.now() - t0, { temas: r.tracks, coinciden: r.matched, porNombre: r.byName, grillas: r.grids, cues: r.cues })
    const plan = gridPlan(a.lib.db, dj, null, 'gpu')
    escribir('0-rekordbox-traer.md', [`# Traer el rekordbox.xml (${ahora()}), sobre la copia de la base`, '',
      `XML: \`${xml}\` (${fs.statSync(xml).mtime.toISOString()}).`,
      `Su XML: ${r.tracks} temas; coinciden con PAILA ${r.matched} (${r.byName} por nombre y tamaño); grillas ${r.grids}, cues ${r.cues}, estrellas ${r.stars}, colores ${r.colours}.`,
      `Grillas que PAILA todavía tiene que calcular: ${plan.tracks - plan.already} de ${plan.tracks} (estimado ${Math.round(plan.seconds / 60)} min).`, '',
      `## No coinciden (${r.unmatched.length})`, ...r.unmatched.map((x) => `- \`${x}\``)].join('\n'))
  } finally { a.lib.close() }
}

/**
 * En la copia, y solo en la base: los de la vista previa de Duplicados revisada (--lista <1-duplicados.json>) quedan "en la
 * papelera", menos los grupos de --excluir (números de tema separados por coma: el grupo que tenga alguno no se toca). Así
 * Nombres y Organizar se ven como después del paso 1. Ningún archivo se lee para escribir ni se escribe.
 */
async function simularDuplicados() {
  if (process.env.PAILA_SOLO_LECTURA !== '1') fail('Correlo con PAILA_SOLO_LECTURA=1')
  const groups = JSON.parse(fs.readFileSync(arg('--lista'), 'utf8')) as { keep: number | null; items: { id: number }[] }[]
  const fuera = new Set(arg('--excluir').split(',').filter(Boolean).map(Number))
  const { abrir } = await import('./ensayo-base')
  const a = abrir()
  try {
    const db = a.lib.db
    if (db.prepare("SELECT value FROM settings WHERE key = 'punto1_simulado'").get()) fail('Esta copia ya tiene los duplicados simulados')
    const now = new Date().toISOString()
    const trash = db.prepare('UPDATE files SET trashed_at = ? WHERE id = ?')
    let n = 0, saltados = 0
    for (const g of groups) {
      if (g.keep == null) continue
      if (g.items.some((i) => fuera.has(i.id))) { saltados++; continue }
      for (const i of g.items) if (i.id !== g.keep) { trash.run(now, i.id); n++ }
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('punto1_simulado', ?)").run(now)
    log(`Duplicados: ${n} temas marcados como en la papelera (solo en la base); ${saltados} grupos sin tocar`)
  } finally { a.lib.close() }
}

/**
 * En la copia, y solo en la base: los tags de la vista previa de Nombres (perfil Oficial, todos los pasos que proponen algo y las
 * dudas que no se aplican solas, afuera), como si se hubieran aplicado; los renombres de archivo no. Para ver Organizar.
 */
async function simularNombres() {
  if (process.env.PAILA_SOLO_LECTURA !== '1') fail('Correlo con PAILA_SOLO_LECTURA=1')
  const { abrir } = await import('./ensayo-base')
  const { tidy, toProposals } = await import('@paila/core/tidy')
  const { rulesOf } = await import('@paila/shared/tidy-profiles')
  const { COLUMN } = await import('@paila/core/tagio')
  const a = abrir()
  try {
    const db = a.lib.db
    const OFICIAL = rulesOf('oficial')
    const pathOf = (id: number) => a.lib.trackPath(id)
    const steps = [...new Set(tidy(db, undefined, pathOf, OFICIAL).changes.map((c) => c.step))] as TidyStep[]
    const props = toProposals(tidy(db, steps, pathOf, OFICIAL).changes)
    let n = 0
    for (const p of props) {
      const col = COLUMN[p.field as keyof typeof COLUMN]
      if (!col) continue
      db.prepare(`UPDATE files SET ${col} = ? WHERE id = ?`).run(p.value, p.id)
      n++
    }
    log(`Nombres: ${n} tags puestos en la base (de ${props.length} propuestas; los renombres de archivo no)`)
  } finally { a.lib.close() }
}

/**
 * "4. Traer lo que ya hiciste en Rekordbox" sobre la base REAL (--base-real), con PAILA cerrada: el botón abre un diálogo de
 * archivos que no se puede apretar desde afuera. Guarda en la base lo mismo que el botón (el número de Rekordbox de cada tema, sus
 * grillas, cues y estrellas) y no toca ningún archivo. Se niega si PAILA está abierta o si la base no tiene la versión de este
 * código (no corre migraciones: la base queda en la versión de la PAILA instalada).
 */
async function traerReal() {
  const xml = arg('--xml')
  if (!xml || !fs.existsSync(xml)) fail('Falta --xml')
  const { lib, c } = await abrirReal()
  try {
    const t0 = Date.now()
    const r = await c.rekordbox.dj.importRekordbox(xml)
    log(`Traído en ${Date.now() - t0} ms: ${r.tracks} temas, coinciden ${r.matched} (${r.byName} por nombre y tamaño); grillas ${r.grids}, cues ${r.cues}, estrellas ${r.stars}, colores ${r.colours}; no coinciden ${r.unmatched.length}`)
  } finally { lib.close() }
}

/** La base REAL (--base-real) con PAILA cerrada, para los modos *-real. No corre migraciones: se niega si la base no tiene la versión de este código. */
async function abrirReal() {
  const base = defaultBase()
  if (!process.argv.includes('--base-real')) fail('Falta --base-real (escribe en la base de esta PC)')
  if (/PAILA\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq PAILA.exe', '/NH'], { encoding: 'utf8' }))) fail('PAILA está abierta: cerrala primero')
  const { MIGRATIONS } = await import('@paila/core/migrations')
  const raw = new DatabaseSync(base, { readOnly: true })
  const v = (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  raw.close()
  if (v !== MIGRATIONS.length) fail(`La base está en la v${v} y este código en la v${MIGRATIONS.length}: no la abro`)
  const { Library } = await import('@paila/core/library')
  const { findFfmpeg, findFfprobe } = await import('@paila/core/probe')
  const { createServices } = await import('../apps/paila/electron/context')
  const lib = new Library(base, findFfprobe())
  const c = createServices({ lib, ffprobe: findFfprobe()!, ffmpeg: findFfmpeg()!, userData: path.dirname(base), version: 'punto1' })
  return { base, lib, c }
}

/**
 * Vista previa de "Volumen parejo" sobre la copia: el mismo cálculo que el botón (lee el ReplayGain que cada archivo tiene hoy,
 * sin escribir nada). Para revisar antes de aplicarlo en la base real: cuántos quedan listos, los que traían uno mal puesto,
 * los que no se pueden escribir y los ajustes más grandes (un tema que hay que subir o bajar mucho puede ser un análisis malo).
 */
async function volumen() {
  if (process.env.PAILA_SOLO_LECTURA !== '1') fail('Correlo con PAILA_SOLO_LECTURA=1')
  const { abrir, ahora, escribir } = await import('./ensayo-base')
  const { gainPlan, gainChanges } = await import('@paila/core/replaygain')
  const a = abrir()
  try {
    const plan = await gainPlan(a.lib.db, (id) => a.lib.trackPath(id), { readCurrent: true })
    const tracks = plan.albums.flatMap((al) => al.tracks.map((t) => ({ ...t, album: al.key ? `${al.artist} — ${al.album}` : al.album })))
    const listos = tracks.filter((t) => t.gain != null && !t.why)
    const fuertes = [...listos].sort((x, y) => Math.abs(y.gain!) - Math.abs(x.gain!)).slice(0, 25)
    const porque = new Map<string, number>()
    for (const t of tracks) if (t.why) porque.set(t.why, (porque.get(t.why) ?? 0) + 1)
    const db = (x: number | null) => (x == null ? '–' : `${x > 0 ? '+' : ''}${x.toFixed(1)} dB`)
    const discos = plan.albums.filter((al) => al.key)
    escribir('4-volumen.md', [`# Volumen parejo (${ahora()}), sobre la copia de la base`, '',
      `Listos ${plan.ready} (de esos, ${plan.wrong} traían uno mal puesto por otro programa) · ya iguales ${plan.same} · bien con el de otro programa ${plan.other} · falta analizar ${plan.notAnalyzed} · no se pueden escribir ${plan.cantWrite}. Cambios que se arman: ${gainChanges(plan).length}.`,
      `Discos con volumen de disco: ${discos.filter((al) => al.gain != null).length} de ${discos.length}.`, '',
      '## Por qué no llevan', ...[...porque].map(([w, n]) => `- ${w}: ${n}`), '',
      '## Los 25 ajustes más grandes', ...fuertes.map((t) => `- ${db(t.gain)} (${t.lufs?.toFixed(1)} LUFS, pico ${t.peak ?? '–'}) · \`${t.rel}\``), '',
      `## Traían uno mal puesto (${plan.wrong})`, ...tracks.filter((t) => t.wrong != null).map((t) => `- tenía ${db(t.wrong)}, va ${db(t.gain)} · \`${t.rel}\``), '',
      '## No se escriben', ...tracks.filter((t) => t.why && t.gain == null && !/analizar|silencio|mismo|coincide/i.test(t.why)).map((t) => `- ${t.why} · \`${t.rel}\``)].join('\n'))
  } finally { a.lib.close() }
}

/**
 * Todos los cambios de Nombres (perfil Oficial, todos los pasos) y las dudas, uno por renglón, de los temas cuya ruta empieza con
 * alguno de --donde (separados por "|"). Sobre la copia, sin escribir nada: para revisar un grupo chico (los temas que llegaron
 * después del paso 2) y armar en la app solo esos.
 */
async function nombresDe() {
  if (process.env.PAILA_SOLO_LECTURA !== '1') fail('Correlo con PAILA_SOLO_LECTURA=1')
  const donde = arg('--donde').split('|').filter(Boolean)
  if (!donde.length) fail('Falta --donde')
  const { abrir, ahora, escribir, salidas } = await import('./ensayo-base')
  const { tidy } = await import('@paila/core/tidy')
  const { rulesOf } = await import('@paila/shared/tidy-profiles')
  const a = abrir()
  try {
    const OFICIAL = rulesOf('oficial')
    const pathOf = (id: number) => a.lib.trackPath(id)
    const db = a.lib.db
    const steps = [...new Set(tidy(db, undefined, pathOf, OFICIAL).changes.map((c) => c.step))] as TidyStep[]
    const r = tidy(db, steps, pathOf, OFICIAL)
    const es = (rel: string) => donde.some((d) => rel.startsWith(d))
    const ch = r.changes.filter((c) => es(c.rel))
    const rev = r.review.filter((c) => es(c.rel))
    const temas = (db.prepare('SELECT COUNT(*) n FROM files WHERE trashed_at IS NULL AND missing_at IS NULL').get() as { n: number }).n
    escribir('2-nombres-de.md', [`# Nombres, perfil Oficial, solo ${donde.join(' · ')} (${ahora()})`, '',
      `${ch.length} cambios en ${new Set(ch.map((c) => c.id)).size} temas; ${rev.length} para mirar a mano. (Toda la base: ${r.changes.length} cambios, ${temas} temas.)`, '',
      '## Cambios', ...ch.map((c) => `- [${c.step}] ${c.field}: \`${c.from ?? '—'}\` → \`${c.to}\`${c.note ? ` · ${c.note}` : ''} · id ${c.id} · \`${c.rel}\``), '',
      '## Para mirar a mano', ...rev.map((c) => `- ${c.staged ? '[se aplica]' : '[DUDA]'} ${c.field}: \`${c.from ?? '—'}\` → \`${c.to}\` · ${c.why} · \`${c.rel}\``)].join('\n'))
    fs.writeFileSync(path.join(salidas, '2-nombres-de.json'), JSON.stringify(ch.map((c) => ({ id: c.id, field: c.field, value: c.to, step: c.step }))))
  } finally { a.lib.close() }
}

/**
 * Lo que Rekordbox sabía del duplicado que PAILA mandó a la papelera (paso 1) pasa a la copia que queda: la estrella más alta y la
 * suma de veces tocado (el autor, 24/10: 8 estrellas y 6 veces tocado de temas cuya copia también está en Rekordbox). Las
 * grillas no: medido, la del otro archivo cae corrida o es de otro audio. Una sola vez por base (queda anotado en settings).
 */
function heredarDeDuplicados(db: DatabaseSync | import('@paila/core/db').Db) {
  const d = db as DatabaseSync
  // una segunda exportación (después del día de uso, por ejemplo) no vuelve a sumar las veces tocado
  const ya = d.prepare("SELECT value FROM settings WHERE key = 'punto1_herencia_rekordbox'").get() as { value: string } | undefined
  if (ya) return [`(ya heredado el ${ya.value}: no se vuelve a sumar)`]
  const filas = d.prepare(`SELECT t.kept_id AS kept, t.orig_rel AS orig, k.rel_path AS keptRel, m.stars, m.play_count AS plays
    FROM trash_log t JOIN dj_meta m ON m.file_id = t.file_id JOIN files k ON k.id = t.kept_id
    WHERE t.reason = 'Duplicados' AND t.restored_at IS NULL AND k.trashed_at IS NULL AND (m.stars > 0 OR m.play_count > 0)`).all() as { kept: number; orig: string; keptRel: string; stars: number; plays: number | null }[]
  const now = new Date().toISOString()
  const hecho: string[] = []
  d.exec('BEGIN')
  try {
    for (const f of filas) {
      const k = d.prepare('SELECT stars, play_count AS plays FROM dj_meta WHERE file_id = ?').get(f.kept) as { stars: number; plays: number | null } | undefined
      const stars = Math.max(k?.stars ?? 0, f.stars ?? 0), plays = (k?.plays ?? 0) + (f.plays ?? 0)
      d.prepare(`INSERT INTO dj_meta (file_id, stars, play_count, imported_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (file_id) DO UPDATE SET stars = excluded.stars, play_count = excluded.play_count`).run(f.kept, stars, plays, now)
      hecho.push(`★${k?.stars ?? 0}→${stars} · tocado ${k?.plays ?? 0}→${plays} · ${f.keptRel} (de ${f.orig})`)
    }
    d.prepare("INSERT INTO settings (key, value) VALUES ('punto1_herencia_rekordbox', ?)").run(now)
    d.exec('COMMIT')
  } catch (e) { d.exec('ROLLBACK'); throw e }
  return hecho
}

/** El resumen del rekordbox.xml que salió: temas, playlists, grillas, cues, números de Rekordbox y lo que queda afuera. */
function resumenXml(db: DatabaseSync | import('@paila/core/db').Db, r: { tracks: number; playlists: number; grids: number; cues: number; skipped: { rel: string; reason: string }[] }, dest: string, titulo: string, heredado: string[]) {
  const xml = fs.readFileSync(dest, 'utf8')
  const ids = [...xml.matchAll(/<TRACK TrackID="([^"]+)"/g)].map((m) => m[1])
  const rb = new Set(((db as DatabaseSync).prepare("SELECT track_id AS id FROM rb_ids WHERE source = 'rekordbox'").all() as { id: string }[]).map((x) => x.id))
  const nuevos = ids.filter((id) => !rb.has(id)).length
  return [`# ${titulo} (${new Date().toISOString()})`, '',
    `\`${dest}\` (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB): ${r.tracks} temas, ${r.playlists} playlists, ${r.grids} con grilla, ${r.cues} con cues.`,
    `Con el número que ya tienen en Rekordbox: ${ids.length - nuevos}; nuevos para Rekordbox: ${nuevos}. TrackID repetidos: ${ids.length - new Set(ids).size}.`, '',
    ...(heredado.length ? [`## Heredado de los duplicados que se fueron (${heredado.length})`, ...heredado.map((h) => `- ${h}`), ''] : []),
    `## Quedan afuera (${r.skipped.length})`, ...r.skipped.map((s) => `- ${s.reason} · \`${s.rel}\``)].join('\n')
}

/** El XML va dentro de D:\PAILA-trabajo, nunca en la Música. */
const dentroDeTrabajo = (p: string) => {
  const dest = path.resolve(p || '')
  if (!/^D:\\PAILA-trabajo\\/i.test(dest)) fail('El XML va dentro de D:\\PAILA-trabajo')
  return dest
}

const exportOpts = (dest: string) => ({ scope: 'todo' as const, playlistIds: [], dest, grid: true, suggestedCues: false, pailaWhenMoving: false })

/**
 * El rekordbox.xml de toda la Música (con grillas y el TrackID de Rekordbox de cada tema) desde la COPIA, para revisarlo antes de
 * llevarlo a Rekordbox. El motor de PAILA no escribe nada con PAILA_SOLO_LECTURA=1: se levanta solo durante la exportación y
 * solo si el XML va dentro de D:\PAILA-trabajo (nunca en la Música). Con --heredar, antes pasa a la copia que queda lo que
 * Rekordbox sabía del duplicado que se fue (heredarDeDuplicados).
 */
async function exportar() {
  if (process.env.PAILA_SOLO_LECTURA !== '1') fail('Correlo con PAILA_SOLO_LECTURA=1')
  const dest = dentroDeTrabajo(arg('--xml'))
  const { abrir, escribir } = await import('./ensayo-base')
  const a = abrir()
  try {
    const heredado = process.argv.includes('--heredar') ? heredarDeDuplicados(a.lib.db) : []
    process.env.PAILA_SOLO_LECTURA = '0'
    let r
    try { r = await a.lib.ops.run('punto 1: rekordbox.xml (copia)', () => a.c.rekordbox.export(exportOpts(dest))) } finally { process.env.PAILA_SOLO_LECTURA = '1' }
    escribir('5-rekordbox-xml.md', resumenXml(a.lib.db, r, dest, 'rekordbox.xml desde la copia', heredado))
  } finally { a.lib.close() }
}

/**
 * El mismo rekordbox.xml desde la base REAL (--base-real), con PAILA cerrada (el botón abre un diálogo para guardar que desde
 * afuera no se puede apretar): primero heredarDeDuplicados y después la exportación por el motor de PAILA, que anota qué temas
 * viajaron a Rekordbox (para avisar si después se mueven). El XML va dentro de D:\PAILA-trabajo; no toca ningún tema.
 */
async function exportarReal() {
  const dest = dentroDeTrabajo(arg('--xml'))
  const { lib, c } = await abrirReal()
  try {
    const heredado = heredarDeDuplicados(lib.db)
    const r = await lib.ops.run('punto 1: rekordbox.xml', () => c.rekordbox.export(exportOpts(dest)))
    const md = resumenXml(lib.db, r, dest, 'rekordbox.xml desde la base real', heredado)
    fs.writeFileSync(dest.replace(/\.xml$/i, '.md'), md)
    log(md.split('\n').slice(0, 12).join('\n'))
  } finally { lib.close() }
}

/**
 * Una regla de colección en la base REAL (--base-real), con PAILA cerrada, por el motor (Library.setRule: guarda y reclasifica).
 * --ruta puede ser una carpeta o un archivo solo (la regla busca la ruta exacta): el autor, 24/10, el mix de 77 minutos de
 * "pendrive/musica/Musica vieja" a "Sets y en vivo" sin llevarse los temas comunes de esa carpeta.
 */
async function reglaReal() {
  const rel = arg('--ruta'), kind = arg('--tipo') as Parameters<import('@paila/core/library').Library['setRule']>[2]
  if (!rel || !kind) fail('Falta --ruta o --tipo')
  const { lib } = await abrirReal()
  try {
    const db = lib.db as unknown as DatabaseSync
    const antes = db.prepare('SELECT id, kind FROM files WHERE root_id = 1 AND (rel_path = ? OR rel_path LIKE ? || \'/%\')').all(rel, rel) as { id: number; kind: string }[]
    if (!antes.length) fail(`No hay ningún tema en ${rel}`)
    lib.setRule(1, rel, kind)
    const despues = db.prepare('SELECT rel_path AS rel, kind FROM files WHERE root_id = 1 AND (rel_path = ? OR rel_path LIKE ? || \'/%\')').all(rel, rel)
    log(`Regla ${rel} → ${kind}: ${JSON.stringify(despues)}`)
  } finally { lib.close() }
}

const defaultBase = () => path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'PAILA', 'paila.db')

/** La base abierta solo para leer (nunca con Library: abrirla así corre las migraciones, que escriben). */
function contar() {
  const base = arg('--base') || defaultBase()
  const db = new DatabaseSync(base, { readOnly: true })
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n
  const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
  const out = {
    at: new Date().toISOString(), base,
    version: (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    porColeccion: db.prepare("SELECT kind, COUNT(*) AS n FROM files WHERE trashed_at IS NULL AND missing_at IS NULL AND excluded_at IS NULL GROUP BY kind ORDER BY kind").all(),
    enPapelera: one('SELECT COUNT(*) AS n FROM files WHERE trashed_at IS NOT NULL'),
    faltan: one('SELECT COUNT(*) AS n FROM files WHERE missing_at IS NOT NULL AND trashed_at IS NULL'),
    playlists: one('SELECT COUNT(*) AS n FROM playlists'),
    lugaresEnPlaylists: one('SELECT COUNT(*) AS n FROM playlist_items'),
    rekordboxIds: one('SELECT COUNT(*) AS n FROM rb_ids'),
    grillas: one('SELECT COUNT(*) AS n FROM dj_grid'),
    pendientes: db.prepare('SELECT field, COUNT(*) AS n FROM pending_changes GROUP BY field ORDER BY field').all(),
    diarioAbierto: one('SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL'),
    respaldos: has('backups') ? db.prepare('SELECT id, op, dir, files, bytes, created_at, complete, deleted_at FROM backups ORDER BY id DESC LIMIT 5').all() : [],
    ajustes: db.prepare("SELECT key, value FROM settings WHERE key LIKE 'backup%' OR key LIKE 'respaldo%' OR key = 'dj_tools'").all(),
    ultimosMovimientos: db.prepare('SELECT batch_id, COUNT(*) AS n, MIN(undone_at) AS deshecho FROM moves_log GROUP BY batch_id ORDER BY batch_id DESC LIMIT 3').all(),
    ultimaPapelera: db.prepare('SELECT batch_id, COUNT(*) AS n, MAX(created_at) AS at, COUNT(restored_at) AS vueltos FROM trash_log GROUP BY batch_id ORDER BY batch_id DESC LIMIT 3').all(),
  }
  db.close()
  const s = JSON.stringify(out, null, 1)
  if (arg('--salida')) fs.writeFileSync(arg('--salida'), s)
  log(s)
}

const MODOS: Record<string, () => void | Promise<void>> = { traer, contar, 'simular-duplicados': simularDuplicados, 'simular-nombres': simularNombres, 'traer-real': traerReal, volumen, 'nombres-de': nombresDe, exportar, 'exportar-real': exportarReal, 'regla-real': reglaReal }
if (!MODOS[mode]) fail(`Modo desconocido: ${mode}. Modos: ${Object.keys(MODOS).join(', ')}`)
await MODOS[mode]()
