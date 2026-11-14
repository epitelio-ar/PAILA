// Ensayo general del punto 1 (scripts/ensayo.ts), paso 5: las grillas de Rekordbox y el rekordbox.xml, sobre la copia de la base
// que apunta a Música-copia. Las grillas las calcula la app armada (con la placa de video, como mañana): se abre en "solo mirar"
// (la grilla solo se guarda en la base; el análisis no arranca solo) con el aviso de medición, se calcula una muestra y se compara
// con lo que estima PAILA para toda la Música. El XML lo escribe el motor (como el botón), fuera de la Música.
//   muestra: arma la playlist "Ensayo grillas" (N temas de Música de todos los formatos; siempre los mismos)
//   medir:   abre la app, pide la estimación (toda la Música y la muestra) y calcula la muestra
//   xml:     exporta toda la Música a <datos>/salidas/rekordbox.xml con las grillas y lo revisa
//   rekordbox: trae el rekordbox.xml del autor (--xml), organiza, exporta y compara; después deshace lo organizado
//   vaciar:  saca los temas de la playlist de la muestra (para que el control final de las playlists cuadre)
//
//   node scripts/run-ts.mjs scripts/ensayo-grillas.ts muestra|medir|xml --datos <carpeta> [--n 40]
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseRbXml } from '@paila/core/rbxml'
import { gridPlan } from '@paila/core/gridrun'
import { DEFAULT_RULE } from '@paila/core/organizer'
import { abrirApp } from './conducir'
import { tomarMedicion } from './turnos.mjs'
import { arg, datos, fail, log, mode } from './corte-base'
import { abrir, ahora, escribir, salidas, tiempo } from './ensayo-base'

const NOMBRE = 'Ensayo grillas'
const hash = (s: string) => crypto.createHash('md5').update(s).digest().readUInt32LE(0)

function muestra() {
  const a = abrir()
  try {
    const n = Number(arg('--n', '40'))
    const rows = a.lib.db.prepare("SELECT id, ext FROM files WHERE kind = 'musica' AND trashed_at IS NULL AND missing_at IS NULL AND error IS NULL").all() as { id: number; ext: string }[]
    // como la Música: la misma proporción de cada formato, elegidos siempre igual (por número de tema)
    const byExt = new Map<string, number[]>()
    for (const r of rows) byExt.set(r.ext.toLowerCase(), [...(byExt.get(r.ext.toLowerCase()) ?? []), r.id])
    const ids = [...byExt.values()].flatMap((l) => l.sort((x, y) => hash(`g${x}`) - hash(`g${y}`)).slice(0, Math.max(1, Math.round((n * l.length) / rows.length))))
    const old = a.lib.db.prepare('SELECT id FROM playlists WHERE name = ?').get(NOMBRE) as { id: number } | undefined
    const id = old?.id ?? a.c.playlists.create(NOMBRE, 'list')
    if (old) a.c.playlists.removeTracks(id, a.c.playlists.trackIds(id))
    a.c.playlists.addTracks(id, ids)
    log(`Playlist "${NOMBRE}" (${id}): ${ids.length} temas · ${[...byExt].map(([e, l]) => `${e} ${l.length}`).join(', ')}`)
  } finally { a.lib.close() }
}

async function medir() {
  const pl = (() => { const a = abrir(); try { return (a.lib.db.prepare('SELECT id FROM playlists WHERE name = ?').get(NOMBRE) as { id: number } | undefined)?.id } finally { a.lib.close() } })()
  if (!pl) fail('Primero: muestra')
  const tiempos = path.join(salidas, 'grillas-tiempos.jsonl')
  process.env.PAILA_GRID_TIEMPOS = tiempos
  const soltar = await tomarMedicion('ensayo del punto 1: grillas de una muestra', { esperar: 60 * 60_000 })
  const app = await abrirApp(datos, { soloLectura: true, log: path.join(salidas, 'app-grillas.log') })
  try {
    type Plan = { tracks: number; already: number; seconds: number; engine: string }
    const todo = await app.js<Plan>('window.paila.gridPlan(null, false, false)')
    const plan = await app.js<Plan>(`window.paila.gridPlan(${pl}, false, false)`)
    log(`Toda la Música: ${todo.tracks} temas sin grilla (${todo.already} ya tienen), motor ${todo.engine}, estimado ${Math.round(todo.seconds / 60)} min`)
    log(`Muestra: ${plan.tracks} temas, estimado ${plan.seconds} s`)
    const t0 = Date.now()
    await app.js(`(window.__grid = window.paila.gridRun(${pl}, false, false).then((r) => (window.__done = r), (e) => (window.__done = { error: String(e) })), 1)`)
    let done: unknown = null
    while (!done) { await new Promise((r) => setTimeout(r, 5000)); done = await app.js('window.__done ?? null').catch(() => null) }
    const ms = Date.now() - t0
    const porTema = ms / 1000 / Math.max(1, plan.tracks)
    tiempo('grillas: muestra', ms, { temas: plan.tracks, estimado: plan.seconds, motor: plan.engine, resultado: done })
    escribir('5-grillas.md', [`# Grillas (${ahora()})`, '',
      `Motor: ${todo.engine}. Muestra de ${plan.tracks} temas: ${Math.round(ms / 1000)} s (${porTema.toFixed(1)} s por tema); PAILA estimaba ${plan.seconds} s.`,
      `Toda la Música: ${todo.tracks} temas sin grilla. PAILA estima ${Math.round(todo.seconds / 60)} min; con lo medido en la muestra serían ${Math.round((porTema * todo.tracks) / 60)} min.`,
      `Resultado: \`${JSON.stringify(done)}\``].join('\n'))
  } finally {
    await app.cerrar().catch(() => app.matar())
    soltar()
  }
}

async function xml() {
  const a = abrir()
  try {
    const dest = path.join(salidas, 'rekordbox.xml')
    const t0 = Date.now()
    const r = await a.lib.ops.run('ensayo: rekordbox.xml', () => a.c.rekordbox.export({ scope: 'todo', playlistIds: [], dest, grid: true, suggestedCues: false, pailaWhenMoving: false }))
    tiempo('rekordbox.xml: exportar', Date.now() - t0, { temas: r.tracks, listas: r.playlists })
    const tracks = parseRbXml(fs.readFileSync(dest, 'utf8'))
    const conGrilla = tracks.filter((t) => t.grid.length), conBpm = tracks.filter((t) => t.bpm), fuera = tracks.filter((t) => !/PAILA-trabajo[\\/]Música-copia/i.test(t.path))
    const noEsta = tracks.filter((t) => !fs.existsSync(t.path))
    escribir('5-rekordbox.md', [`# rekordbox.xml (${ahora()})`, '', `${r.tracks} temas y ${r.playlists} listas en \`${dest}\` (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB).`,
      `Con grilla: ${conGrilla.length}; con BPM: ${conBpm.length}; con la ruta fuera de la copia: ${fuera.length}; con la ruta que no existe: ${noEsta.length}.`,
      ...noEsta.slice(0, 20).map((t) => `- no existe: \`${t.path}\``)].join('\n'))
  } finally { a.lib.close() }
}

/**
 * El camino de mañana para no perder lo de Rekordbox: traer su rekordbox.xml ANTES de mover, organizar, y ver que el XML nuevo
 * lleve el TrackID, la grilla y los cues de Rekordbox con la ruta nueva. Después deshace lo organizado. --xml: el rekordbox.xml
 * del autor con las rutas pasadas a la copia.
 */
async function rekordbox() {
  const a = abrir()
  try {
    const dj = a.c.rekordbox.dj
    const t0 = Date.now()
    const imp = a.lib.ops.run('ensayo: traer de Rekordbox', () => dj.importRekordbox(arg('--xml')))
    const r = await imp
    tiempo('rekordbox: traer su XML', Date.now() - t0, { temas: r.tracks, coinciden: r.matched, porNombre: r.byName, grillas: r.grids, cues: r.cues })
    const plan = gridPlan(a.lib.db, dj, null, 'gpu')
    log(`Grillas que faltan calcular: ${plan.tracks - plan.already} de ${plan.tracks} (estimado ${Math.round(plan.seconds / 60)} min)`)
    const o = { rule: DEFAULT_RULE, dest: 'Biblioteca' }
    const t1 = Date.now()
    const org = await a.lib.ops.run('ensayo: organizar', () => a.c.organizer.apply(a.c.organizer.plan(o)))
    tiempo('rekordbox: organizar', Date.now() - t1, { movidos: org.moved })
    const dest = path.join(salidas, 'rekordbox-despues-de-organizar.xml')
    await a.lib.ops.run('ensayo: rekordbox.xml', () => a.c.rekordbox.export({ scope: 'todo', playlistIds: [], dest, grid: true, suggestedCues: false, pailaWhenMoving: false }))
    const suyo = new Map(parseRbXml(fs.readFileSync(arg('--xml'), 'utf8')).map((t) => [t.trackId, t]))
    const nuevo = parseRbXml(fs.readFileSync(dest, 'utf8'))
    const mismos = nuevo.filter((t) => suyo.has(t.trackId))
    const movidos = mismos.filter((t) => t.path !== suyo.get(t.trackId)!.path)
    const grillaIgual = mismos.filter((t) => t.grid.length && JSON.stringify(t.grid[0]) === JSON.stringify(suyo.get(t.trackId)!.grid[0]))
    const cuesIgual = mismos.filter((t) => suyo.get(t.trackId)!.cues.length && t.cues.length === suyo.get(t.trackId)!.cues.length)
    escribir('5-rekordbox-traido.md', [`# Traer el rekordbox.xml antes de mover (${ahora()})`, '',
      `Su XML: ${r.tracks} temas; coinciden con PAILA ${r.matched} (${r.byName} por nombre y tamaño); grillas ${r.grids}, cues ${r.cues}, estrellas ${r.stars}, colores ${r.colours}. No coinciden ${r.unmatched.length}${r.unmatched.length ? `: ${r.unmatched.slice(0, 10).map((x) => `\`${x}\``).join(', ')}` : ''}.`,
      `Grillas que PAILA todavía tiene que calcular: ${plan.tracks - plan.already} de ${plan.tracks} (estimado ${Math.round(plan.seconds / 60)} min).`,
      `Organizar: ${org.moved} temas. El XML nuevo: ${nuevo.length} temas; con el TrackID de Rekordbox ${mismos.length}; de esos, con la ruta nueva ${movidos.length}, con la misma primera marca de la grilla ${grillaIgual.length}, con los mismos cues ${cuesIgual.length}.`].join('\n'))
    const t2 = Date.now()
    const u = await a.lib.ops.run('ensayo: deshacer organizar', () => a.c.organizer.undo(org.batchId!))
    tiempo('rekordbox: deshacer organizar', Date.now() - t2, { vuelven: u.moved, fallas: u.failed.length })
  } finally { a.lib.close() }
}

function vaciar() {
  const a = abrir()
  try {
    const old = a.lib.db.prepare('SELECT id FROM playlists WHERE name = ?').get(NOMBRE) as { id: number } | undefined
    if (old) a.c.playlists.removeTracks(old.id, a.c.playlists.trackIds(old.id))
    log(old ? 'Playlist de la muestra vacía' : 'No había playlist de la muestra')
  } finally { a.lib.close() }
}

const MODOS: Record<string, () => unknown> = { muestra, medir, xml, vaciar, rekordbox }
if (!MODOS[mode]) fail(`Modo desconocido: ${mode}. Modos: ${Object.keys(MODOS).join(', ')}`)
await MODOS[mode]()
