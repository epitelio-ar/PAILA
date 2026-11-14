// Medición de escala (MASTERPLAN-2, Fase O): arma una biblioteca sintética de 100.000 temas (solo filas en una base temporal
// y archivos vacíos en %TEMP%, sin audio) y mide lo que se siente en la interfaz con bibliotecas enormes.
//
//   node scripts/run-ts.mjs scripts/escala.ts [--temas 100000] [--etiqueta antes] [--guardar-base <archivo.db>] [--sin-archivos] [--huellas <base.db>]
//   --sin-archivos: solo la base (rápido; no mide el escaneo ni Duplicados, que necesitan los archivos)
//   --huellas: toma las huellas acústicas de otra base (una COPIA de la de PAILA, solo se lee) para que las sintéticas se
//   parezcan a las reales (cuánto se repiten los valores, silencios, valores comunes entre temas). Sin eso, se inventan.
//
// El aviso de medición (paila-medicion.lock en la carpeta temporal) lo deja y lo saca el propio script (scripts/turnos.mjs); si otra sesión mide, no corre.
// Los archivos vacíos quedan en %TEMP%\paila-escala-<temas> para reusarlos en la próxima medición (borrarlos a mano).
import fs from 'node:fs'
import { tomarMedicion } from './turnos.mjs'
import os from 'node:os'
import path from 'node:path'
import v8 from 'node:v8'
import { Library } from '@paila/core/library'
import { transaction } from '@paila/core/db'
import { findDuplicates } from '@paila/core/duplicates'
import { DatabaseSync } from 'node:sqlite'
import { decodeFingerprint, encodeFingerprint } from '@paila/core/analysis/chromaprint'
import { SoundIndex, buildFromDb, fingerprintOf, libraryPrints } from '@paila/core/soundindex'
import { History, type HistoryDeps } from '@paila/core/history'
import { Improver } from '@paila/core/improve'
import { tidy, tidyFirst, tidyProfiles, type TidyChange } from '@paila/core/tidy'
import { rulesOf, DEFAULT_PROFILE } from '@paila/shared/tidy-profiles'
import { TRACK_FIELDS, type Track } from '@paila/shared/types'
import { display } from '@paila/shared/trackinfo'
import { filterTracks, sortTracks, type TableQuery } from '@paila/shared/tableview'
import { TrackIndex } from '@paila/core/tableindex'
import { Wanted } from '@paila/core/wanted'
import { officialNames } from '@paila/core/official-run'

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const N = Number(arg('--temas', '100000'))
const LABEL = arg('--etiqueta', 'sin etiqueta')
const NO_FILES = process.argv.includes('--sin-archivos')
const KEEP_DB = arg('--guardar-base', '') // para mirar después la base sintética (con sus tamaños de verdad)
const PRINTS_DB = arg('--huellas', '')

// ---------- datos sintéticos (siempre los mismos: generador con semilla) ----------
// mulberry32: números al azar repetibles y bien repartidos (el generador anterior repetía mucho los tamaños de archivo)
let seed = 20261020
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
const WORDS = ['Luna', 'Fuego', 'Noche', 'Ritmo', 'Calle', 'Sol', 'Amor', 'Baile', 'Cumbia', 'Sombra', 'Viento', 'Río', 'Mar',
  'Ciudad', 'Corazón', 'Tiempo', 'Verano', 'Humo', 'Neón', 'Selva', 'Pista', 'Eco', 'Sueño', 'Oro', 'Barrio', 'Tormenta']
const PREFIX = ['', '', '', 'DJ ', 'Los ', 'La ', 'El ', 'Dj ', 'MC ', 'Banda ']
const GENRES = ['Cumbia', 'House', 'Techno', 'Reggaeton', 'Rock', 'Pop', 'Trap', 'Funk', 'Electrónica', 'Folklore', '']
const GRADES = ['A+', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'D', 'F']
const CAMELOT = Array.from({ length: 24 }, (_, i) => `${(i % 12) + 1}${i < 12 ? 'A' : 'B'}`)
const JUNK = [...Array(30).fill(''), ' (Official Video)', ' [www.slider.kz]', ' (Letra)', ' (1)', ' ft. Invitado', ' MSTRD']
const safe = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_')

interface Synth { rel: string; artist: string | null; title: string | null; album: string; track: string; year: string; genre: string; duration: number; dupOf?: number }

function synth(n: number): Synth[] {
  const artists = Array.from({ length: Math.max(10, Math.round(n / 50)) }, (_, i) => {
    const a = `${pick(PREFIX)}${pick(WORDS)} ${pick(WORDS)}${i % 7 === 0 ? '' : ` ${i}`}`
    return i % 13 === 0 ? a.toLowerCase() : i % 17 === 0 ? a.toUpperCase() : a
  })
  const out: Synth[] = []
  const used = new Set<string>()
  const unique = (rel: string) => { const r = used.has(rel.toLowerCase()) ? rel.replace(/([^/]+)$/, `${out.length} $1`) : rel; used.add(r.toLowerCase()); return r }
  while (out.length < n) {
    const ai = Math.floor(rnd() * artists.length), artist = artists[ai]
    const folder = `${safe(artist)} [${ai}]` // carpeta única aunque dos artistas solo difieran en mayúsculas
    const album = `${pick(WORDS)} ${pick(WORDS)}`
    const year = String(1970 + Math.floor(rnd() * 56))
    const count = 6 + Math.floor(rnd() * 10)
    for (let k = 1; k <= count && out.length < n; k++) {
      const title = `${pick(WORDS)} ${pick(WORDS).toLowerCase()}${pick(JUNK)}`
      const noTags = rnd() < 0.08 // sin tags: Arreglar nombres los saca del nombre del archivo
      const dup = out.length > 100 && rnd() < 0.02 ? Math.floor(rnd() * out.length) : -1
      if (dup >= 0) { const o = out[dup]; out.push({ ...o, rel: unique(`Para revisar/${o.rel.slice(0, o.rel.indexOf('/'))}/${path.posix.basename(o.rel)}`), dupOf: dup }); continue }
      const file = `${String(k).padStart(2, '0')} - ${safe(artist)} - ${safe(title)}.${rnd() < 0.8 ? 'mp3' : 'flac'}`
      out.push({
        rel: unique(`${folder}/${year} - ${safe(album)}/${file}`), artist: noTags ? null : artist, title: noTags ? null : title,
        album, track: String(k), year, genre: pick(GENRES), duration: 120 + Math.round(rnd() * 300 * 100) / 100,
      })
    }
  }
  return out
}

// ---------- huellas acústicas sintéticas ----------
// Cada tema toma una huella (real, de --huellas, o inventada) y la "mezcla" con un número propio: conserva cómo se repiten
// sus valores pero deja de parecerse a los otros temas. Los valores que en la base real están en muchos temas (silencio,
// acordes comunes) se dejan tal cual: así el índice tiene que lidiar con ellos como en una biblioteca de verdad.
// Los repetidos (dupOf) son la misma huella con ruido, como un MP3 de otra calidad; ~0,5 % son versiones (comparten 40 s).
const STABLE = [3, 19, 27, 29, 31, 26, 28, 30, 2, 21, 18, 1, 15, 7, 20, 9, 25, 11, 14, 23, 0, 6, 8, 24, 5, 10, 17, 22, 13, 4, 16, 12]
function inventedPrint(): Uint32Array {
  const fp = new Uint32Array(960)
  let v = (rnd() * 2 ** 32) >>> 0
  for (let i = 0; i < fp.length; i++) { for (let b = 0; b < 32; b++) if (rnd() < 0.12) v ^= 1 << b; fp[i] = v >>> 0 }
  return fp
}
function noisyPrint(fp: Uint32Array, worst: number): Uint32Array {
  return fp.map((x) => { let v = x; STABLE.forEach((b, rank) => { if (rnd() < 0.02 + (worst - 0.02) * (rank / 31)) v ^= 1 << b }); return v >>> 0 })
}
function syntheticPrints(data: Synth[], write: (i: number, print: string) => void) {
  let reals: Uint32Array[] = [], common = new Set<number>()
  if (PRINTS_DB) {
    const db = new DatabaseSync(PRINTS_DB, { readOnly: true })
    reals = (db.prepare('SELECT chromaprint FROM analysis WHERE chromaprint IS NOT NULL').all() as { chromaprint: string }[]).map((r) => decodeFingerprint(r.chromaprint))
    db.close()
    const df = new Map<number, number>()
    for (const fp of reals) for (const v of new Set(fp)) df.set(v, (df.get(v) ?? 0) + 1)
    common = new Set([...df].filter(([, c]) => c >= 3).map(([v]) => v))
    console.log(`Huellas reales de base: ${reals.length} (${common.size} valores comunes a 3 o más temas)`)
  }
  // Se escriben de a una (las 100.000 juntas no entran en memoria). Se guardan solo las que después hacen falta: las que
  // tienen un repetido y las últimas 500 (de ahí salen las versiones).
  const needed = new Set(data.filter((s) => s.dupOf != null).map((s) => s.dupOf!))
  const kept = new Map<number, Uint32Array>()
  const recent: Uint32Array[] = []
  data.forEach((s, i) => {
    let fp: Uint32Array
    if (s.dupOf != null) fp = noisyPrint(kept.get(s.dupOf)!, 0.15 + rnd() * 0.15)
    else {
      if (reals.length) { const r = reals[Math.floor(rnd() * reals.length)], k = (rnd() * 2 ** 32) >>> 0; fp = r.map((v) => (common.has(v) ? v : (v ^ k) >>> 0)) } else fp = inventedPrint()
      if (recent.length && rnd() < 0.005) { const o = recent[Math.floor(rnd() * recent.length)]; if (o.length >= 320 && fp.length >= 520) { fp = fp.slice(); fp.set(noisyPrint(o.subarray(0, 320), 0.1), 200) } }
    }
    if (needed.has(i)) kept.set(i, fp)
    recent.push(fp); if (recent.length > 500) recent.shift()
    write(i, encodeFingerprint(fp))
  })
}

// ---------- medir ----------
const results: { what: string; ms: number; extra?: string }[] = []
async function measure(what: string, fn: () => unknown, reps = 3, extra?: (r: unknown) => string) {
  const times: number[] = []
  let last: unknown
  for (let i = 0; i < reps; i++) {
    const t = performance.now()
    last = await fn()
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  const ms = times[Math.floor(times.length / 2)]
  results.push({ what, ms, extra: extra?.(last) })
  console.log(`${what.padEnd(46)} ${ms.toFixed(0).padStart(7)} ms${extra ? `   ${extra(last)}` : ''}`)
  return last
}

async function main() {
  const t0 = Date.now()
  await tomarMedicion('prueba de escala (100.000 temas)') // deja y saca solo el aviso de medición (scripts/turnos.mjs)
  const data = synth(N)

  // Archivos vacíos (una sola vez): el escaneo "sin cambios" los recorre como recorrería la biblioteca de verdad.
  const dir = path.join(os.tmpdir(), `paila-escala-${N}-v2`) // v2: con el generador nuevo
  const music = path.join(dir, 'Musica')
  if (NO_FILES) fs.mkdirSync(music, { recursive: true })
  else if (!fs.existsSync(path.join(dir, 'listo'))) {
    console.log(`Creando ${N} archivos vacíos en ${music}… (solo la primera vez)`)
    fs.rmSync(dir, { recursive: true, force: true })
    for (const d of new Set(data.map((s) => path.posix.dirname(s.rel)))) fs.mkdirSync(path.join(music, ...d.split('/')), { recursive: true })
    for (const s of data) fs.writeFileSync(path.join(music, ...s.rel.split('/')), '')
    fs.writeFileSync(path.join(dir, 'listo'), String(N))
  }

  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-escala-db-'))
  const dbFile = path.join(dbDir, 'paila.db')
  try {
    // Base con las filas (como si ya estuvieran escaneadas y analizadas).
    let lib = new Library(dbFile, 'ffprobe-falso')
    const root = await lib.addRoot(music, [{ rel: '', kind: 'musica' }, { rel: 'Para revisar', kind: 'revisar' }])
    const db = lib.db
    transaction(db, () => {
      const ins = db.prepare(`INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, codec, sample_rate, bits, channels, kbps, duration,
        artist, album_artist, title, album, track, year, genre, probed_at) VALUES (?, ?, 0, ?, ?, ?, ?, 44100, 16, 2, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`)
      const ana = db.prepare(`INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, is_label, eff_kbps, cutoff, lufs, bpm, bpm_source, music_key, camelot, energy, flags)
        VALUES (?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'preciso', 'C', ?, ?, ?)`)
      const now = new Date().toISOString()
      data.forEach((s, i) => {
        const mtime = NO_FILES ? 0 : Math.round(fs.statSync(path.join(music, ...s.rel.split('/'))).mtimeMs)
        const ext = s.rel.slice(s.rel.lastIndexOf('.') + 1)
        const id = Number(ins.run(root.id, s.rel, mtime, s.rel.startsWith('Para revisar/') ? 'revisar' : 'musica', ext, ext === 'mp3' ? 'mp3' : 'flac',
          ext === 'mp3' ? 320 : 900, s.duration, s.artist, s.title, s.album, s.track, s.year, s.genre, now).lastInsertRowid)
        if (i % 10 !== 9) ana.run(id, mtime, now, pick(GRADES), 'MP3 320', 320, 19500, -9 + rnd() * 4, 90 + Math.round(rnd() * 80), pick(CAMELOT), 1 + Math.floor(rnd() * 10), rnd() < 0.03 ? 'upscaled' : null)
      })
      // Historial de alguien que usa PAILA hace rato: 200 tandas de tags, 20 de papelera, 5 de Organizar.
      const j = db.prepare('INSERT INTO journal (batch_id, file_id, rel_path, field, before, after, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (let b = 1; b <= 200; b++) for (let k = 0; k < 100; k++) { const id = 1 + ((b * 100 + k) % N); j.run(b, id, data[id - 1].rel, 'genre', 'Cumbia', 'Cumbia villera', new Date(Date.UTC(2026, 0, 1) + b * 3600_000).toISOString()) }
      const m = db.prepare('INSERT INTO moves_log (batch_id, root_id, file_id, from_rel, to_rel, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      for (let b = 1; b <= 5; b++) for (let k = 0; k < 2000; k++) { const id = 1 + ((b * 2000 + k) % N); m.run(b, root.id, id, `viejo/${data[id - 1].rel}`, data[id - 1].rel, new Date(Date.UTC(2026, 1, 1) + b * 86400_000).toISOString()) }
      const tr = db.prepare('INSERT INTO trash_log (batch_id, file_id, orig_rel, trash_rel, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      for (let b = 1; b <= 20; b++) for (let k = 0; k < 50; k++) { const id = 1 + ((b * 50 + k + 50_000) % N); tr.run(b, id, data[id - 1].rel, `_PAILA/papelera/x/${data[id - 1].rel}`, 'Duplicado', new Date(Date.UTC(2026, 2, 1) + b * 86400_000).toISOString()) }
    })
    lib.close()

    console.log(`\nPAILA a escala — ${N.toLocaleString('es-AR')} temas — ${LABEL}\n`)
    await measure('Abrir la base y armar el estado inicial', () => {
      if (lib.db.isOpen) lib.close()
      lib = new Library(dbFile, 'ffprobe-falso')
      return { roots: lib.roots(), count: lib.trackCount(), pending: lib.pendingAnalysis() }
    })
    const rows = await measure('tracks() (toda la tabla)', () => lib.tracks(), 3, (r) => `${(r as unknown[]).length} filas`) as unknown[][]
    await measure('  mandarla a la interfaz (copia IPC)', () => v8.deserialize(v8.serialize(rows)), 3, () => `${(v8.serialize(rows).length / 1e6).toFixed(1)} MB`)
    const tracks = await measure('  armar los temas en la interfaz', () => rows.map((r) => Object.fromEntries(TRACK_FIELDS.map((f, i) => [f, r[i]])) as Track), 3) as Track[]
    // la búsqueda de la interfaz (shared/tableview.ts, como la usa la tabla): filtrar por palabras y ordenar por artista
    const search = (w: string) => sortTracks(filterTracks(tracks, { words: [w], kind: 'todo', test: null, inPl: null }), (t) => display(t).artist.toLowerCase(), 1)
    await measure('Buscar "luna" y ordenar por artista', () => search('luna'), 1, (r) => `${(r as unknown[]).length} resultados (la primera búsqueda arma el texto de cada tema)`)
    await measure('  buscar otra palabra ("sol")', () => search('sol'), 3, (r) => `${(r as unknown[]).length} resultados`)
    // Desde 20.000 temas (BIG_LIBRARY) la tabla vive en un hilo del proceso principal (core/tableindex.ts): la interfaz recibe
    // solo el orden de los ids y las filas que se ven.
    const table = new TrackIndex()
    await measure('Tabla grande: leer los temas (hilo aparte)', () => table.load(lib.db), 3, (r) => `${(r as { total: number }).total} temas`)
    const view = (sort: TableQuery['sort'], query = ''): TableQuery => ({ kind: 'musica', problem: null, query, plIds: null, sort })
    let flip = 1 as 1 | -1 // cada vez otro sentido, para que no la conteste la memoria de la última consulta
    await measure('  ordenar la vista (Música por artista, en frío)', () => { table.load(lib.db); return table.query(view({ key: 'artist', dir: (flip = -flip as 1 | -1) })) }, 3, (r) => `${(r as number[]).length} temas (incluye releer)`)
    const ids = table.query(view({ key: 'artist', dir: 1 }))
    await measure('  mandar a la interfaz los ids y 60 filas', () => v8.deserialize(v8.serialize({ ids, rows: table.rows(ids.slice(0, 60)) })), 3, () => `${(v8.serialize({ ids, rows: table.rows(ids.slice(0, 60)) }).length / 1e6).toFixed(2)} MB`)
    let alt = false // "luna" y "luna " buscan lo mismo, pero no las contesta la memoria de la última consulta
    await measure('  buscar "luna" (ya ordenada)', () => table.query(view({ key: 'artist', dir: 1 }, (alt = !alt) ? 'luna' : 'luna ')), 3, (r) => `${(r as number[]).length} resultados`)
    await measure('  ordenar por título (en frío)', () => table.query(view({ key: 'title', dir: (flip = -flip as 1 | -1) })), 2)
    await measure('trackPath() × 10.000', () => { for (let i = 1; i <= 10_000; i++) lib.trackPath(i) }, 3)
    await measure('Resumen de Análisis (insights)', () => lib.insights(), 3)
    if (!NO_FILES) await measure('Escanear sin cambios', () => lib.scan(), 2, (r) => (r as { phase: string }).phase)

    // Para Duplicados hacen falta tamaños de verdad (los archivos vacíos miden 0): los repetidos comparten el tamaño.
    transaction(lib.db, () => {
      const up = lib.db.prepare('UPDATE files SET size = ? WHERE id = ?')
      const sizes: number[] = []
      data.forEach((s, i) => { sizes[i] = s.dupOf != null ? sizes[s.dupOf] : 3_000_000 + Math.floor(rnd() * 12_000_000); up.run(sizes[i], i + 1) })
    })
    // Huellas acústicas (para los temas analizados): Duplicados las usa para el mismo audio en otra calidad y versiones.
    // El índice y la Bandeja solo usan la base, así que se miden también con --sin-archivos.
    transaction(lib.db, () => {
      const up = lib.db.prepare("UPDATE analysis SET chromaprint = ?, prints_at = '2026-10-20', src_size = (SELECT size FROM files WHERE id = analysis.file_id) WHERE file_id = ?")
      syntheticPrints(data, (i, p) => up.run(p, i + 1))
    })
    // con huellas, cada fila del análisis pesa ~3,5 KB: así lo ve quien ya analizó (la pantalla Análisis lo pide cada 4 s)
    await measure('Resumen de Análisis (con huellas)', () => lib.insights(), 3)
    const one = fingerprintOf(lib.db, 124)!
    const index = await measure('Índice de huellas (armar)', () => buildFromDb(lib.db), 1, (r) => { const x = r as SoundIndex; return `${x.size} temas, ${(x.postings / 1e6).toFixed(1)} M claves, ~${(x.postings * 14 / 1e6).toFixed(0)} MB de índice` }) as SoundIndex
    await measure('  pares por sonido (todo contra el índice)', () => index.pairs(), 1, (r) => `${(r as unknown[]).length} pares para comparar bit a bit`)
    await measure('  Bandeja: buscar un archivo nuevo', async () => (await libraryPrints(lib.db)).index.query(one), 3, (r) => `${(r as unknown[]).length} candidatos (la primera vez arma el índice; después queda guardado)`)
    if (!NO_FILES) await measure('Duplicados (buscar)', () => findDuplicates(lib.db, (id) => lib.trackPath(id)), 1, (r) => `${(r as unknown[]).length} grupos`)
    const history = new History(lib.db, { improver: new Improver(lib.db), rootPath: (rid: number) => lib.roots().find((r) => r.id === rid && r.available)?.path ?? null } as unknown as HistoryDeps)
    await measure('Historial (lista)', () => history.list(), 3, (r) => `${(r as unknown[]).length} tandas`)
    const pathOf = (id: number) => lib.trackPath(id)
    await measure('Arreglar nombres (una pasada)', () => tidy(lib.db, undefined, pathOf, rulesOf(DEFAULT_PROFILE)), 1, (r) => { const x = r as { changes: unknown[]; steps: { key: string; count: number }[] }; return `${x.changes.length} propuestas (${x.steps.filter((s) => s.count).map((s) => `${s.key} ${s.count}`).join(', ')})` })
    // la pantalla se abre con el perfil elegido; los números de los otros tres los cuenta después un hilo aparte (core/tidyworker.ts)
    let chosen: TidyChange[] = []
    await measure('Arreglar nombres (abrir la pantalla)', () => { chosen = tidyFirst(lib.db, pathOf, rulesOf(DEFAULT_PROFILE)).changes }, 1)
    await measure('  los otros perfiles (en segundo plano)', () => tidyProfiles(lib.db, pathOf, rulesOf(DEFAULT_PROFILE), chosen), 1,
      (r) => (r as { key: string; count: number }[]).map((x) => `${x.key} ${x.count}`).join(', '))
    // Faltan o suenan mal (usabilidad, 2.ª tanda, P1): antes limpiaba los nombres de toda la Música en el proceso principal; ahora
    // sale con los nombres de los tags y los limpia un hilo aparte (core/tidyworker.ts). Se mide lo que traba la ventana.
    await measure('Faltan o suenan mal (abrir; antes: limpia acá)', () => new Wanted(lib.db, officialNames(lib.db)).list(), 1, (r) => `${(r as unknown[]).length} temas`)
    const conHilo = new Wanted(lib.db, officialNames(lib.db))
    conHilo.limpios.enHilo(() => new Promise(() => { /* el hilo trabaja aparte: acá no se espera */ }), () => {})
    await measure('Faltan o suenan mal (abrir; ahora: con el hilo)', () => conHilo.list(), 1, (r) => `${(r as unknown[]).length} temas`)
    lib.close()
    if (KEEP_DB) fs.copyFileSync(dbFile, KEEP_DB)
    console.log(`\nMemoria usada al final: ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB · tiempo total ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    console.log('\n| Qué | ms | Detalle |\n|---|---:|---|')
    for (const r of results) console.log(`| ${r.what.trim()} | ${r.ms.toFixed(0)} | ${r.extra ?? ''} |`)
  } finally {
    try { fs.rmSync(dbDir, { recursive: true, force: true }) } catch { /* la base quedó abierta por un error: se borra a mano */ }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
