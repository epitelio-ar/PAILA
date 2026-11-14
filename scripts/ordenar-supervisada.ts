// Corrida supervisada de Ordenar (MASTERPLAN-5, etapa 3, "Se mide"; AGENTS.es.md, "Corridas supervisadas"): lo que PAILA propondría
// sola sobre la Música de verdad, en vista previa. NADA SE APLICA: no llama a Aplicar ni a nada que escriba archivos; trabaja sobre
// COPIAS de la base (una por pasada) en una carpeta temporal, y la base que le pasás no se abre nunca para escribir.
// Tres pasadas, cada una sobre su propia copia: la regla de fábrica, la misma sin número ni año, y por género.
// Antes de las pasadas, en una copia "preparada", arma los repetidos con lo que ya está en la base (huellas del análisis: no lee
// archivos si el disco no está) y los guarda, como hace el estado de la colección cuando termina el análisis.
// Vuelca cada grupo, cada carta (todas, sin el tope de 60 de la pantalla) y unas marcas automáticas para revisar a ojo. Con el disco
// puesto también lee los archivos del mismo tamaño (byte-a-byte.tsv) y los primeros bytes de los de códec raro (extensiones.tsv).
//
//   node scripts/run-ts.mjs scripts/ordenar-supervisada.ts --base <copia de paila.db> --salida docs/pruebas/ordenar-supervisada-AAAA-MM-DD
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Library } from '@paila/core/library'
import { Organizer, DEFAULT_RULE } from '@paila/core/organizer'
import { Changes } from '@paila/core/changes'
import { findDuplicates } from '@paila/core/duplicates'
import { guardarRepetidos, repetidosAlDia } from '@paila/core/repetidos-guardados'
import { armarRevision, delNombre, elegirCarpetas } from '@paila/core/revision-armar'
import { leerRevision } from '@paila/core/revision'
import { reglasGuardadas } from '@paila/core/tidy-reglas'
import { visible } from '@paila/core/db'
import { extensionFix, sniff, suspicious } from '@paila/core/extensions'
import { GRUPOS_REVISION, type OrganizeOptions } from '@paila/shared/types'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const base = arg('--base'), salida = arg('--salida')
if (!base || !salida || !fs.existsSync(base)) { console.error('Uso: --base <copia de paila.db> --salida <carpeta>'); process.exit(2) }
const real = path.resolve(process.env.APPDATA ?? os.homedir(), 'PAILA', 'paila.db').toLowerCase()
if (path.resolve(base).toLowerCase() === real) { console.error('Pasale una COPIA de la base, no la real.'); process.exit(2) }

const PASADAS: { clave: string; regla: OrganizeOptions }[] = [
  { clave: 'fabrica', regla: { rule: DEFAULT_RULE, dest: 'Biblioteca' } }, // idioma-ok: la carpeta de fábrica
  { clave: 'sin-numero-ni-anio', regla: { rule: '%artista%/%album%/%titulo%', dest: 'Biblioteca' } }, // idioma-ok: códigos de la regla
  { clave: 'por-genero', regla: { rule: '%genero%/%artista%/%n% - %titulo%', dest: 'Biblioteca' } }, // idioma-ok: códigos de la regla
]

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-ordenar-sup-'))
fs.mkdirSync(salida, { recursive: true })
const tsv = (archivo: string, cab: string[], filas: unknown[][]) =>
  fs.writeFileSync(path.join(salida, archivo), [cab, ...filas].map((f) => f.map((v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n') + '\n')

function abrir(archivo: string) {
  const lib = new Library(archivo, null)
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid && r.available)?.path ?? null
  const pathOf = (i: number) => lib.trackPath(i)
  // ffmpeg no se usa: solo Aplicar lo necesita, y acá no se aplica nada
  const changes = new Changes(lib.db, pathOf, 'ffmpeg-no-se-usa', path.join(tmp, 'resguardo'))
  const organizer = new Organizer(lib.db, rootPath)
  const setting = (k: string) => (lib.db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null
  return { lib, db: lib.db, pathOf, changes, organizer, setting }
}

// 1) la copia preparada: la base al día (migraciones) y los repetidos guardados
const prep = path.join(tmp, 'preparada.db')
fs.copyFileSync(base, prep)
for (const x of ['-wal', '-shm']) if (fs.existsSync(base + x)) fs.copyFileSync(base + x, prep + x)
{
  const p = abrir(prep)
  const disco = p.lib.roots().map((r) => `${r.path} (${r.available ? 'conectado' : 'NO conectado'})`).join(', ')
  console.log(`raíces: ${disco}`)
  const t = performance.now()
  // los que el paso 1 (mismo archivo, byte a byte) pidió leer: con el disco desconectado no se lee ninguno
  const pedidos = new Set<number>()
  const grupos = await findDuplicates(p.db, (i) => { pedidos.add(i); return p.pathOf(i) })
  guardarRepetidos(p.db, grupos)
  console.log(`repetidos: ${grupos.length} grupos en ${Math.round(performance.now() - t)} ms`)
  const rel = (i: number) => (p.db.prepare('SELECT rel_path AS r, size FROM files WHERE id = ?').get(i) as { r: string; size: number })
  const huella = (i: number) => { const a = p.pathOf(i); try { return a ? crypto.createHash('sha1').update(fs.readFileSync(a)).digest('hex') : null } catch { return null } }
  const leidos = [...pedidos].map((i) => ({ i, ...rel(i), sha1: huella(i) })).sort((a, b) => a.size - b.size || a.r.localeCompare(b.r))
  const iguales = (x: { sha1: string | null }) => !!x.sha1 && leidos.filter((y) => y.sha1 === x.sha1).length > 1
  tsv('byte-a-byte.tsv', ['fileId', 'rel', 'tamaño', 'sha1', 'igualAOtro', 'enGrupo'], leidos.map((x) => [x.i, x.r, x.size, x.sha1 ?? '(no se leyó)', iguales(x) ? 'sí' : '',
    grupos.find((g) => g.items.some((it) => it.id === x.i))?.level ?? '']))
  console.log(`paso 1 de repetidos: ${leidos.length} archivos del mismo tamaño, ${leidos.filter((x) => x.sha1).length} leídos, ${leidos.filter(iguales).length} iguales byte a byte a otro`)
  // las extensiones que mienten: el escaneo leyó un códec que no es el de la extensión, y los primeros bytes dicen qué es
  const sospechosos = (p.db.prepare(`SELECT id, rel_path AS rel, ext, codec, kind FROM files WHERE ${visible()} AND error IS NULL`).all() as
    { id: number; rel: string; ext: string; codec: string | null; kind: string }[]).filter((r) => suspicious(r.ext, r.codec))
  tsv('extensiones.tsv', ['fileId', 'rel', 'tipo', 'ext', 'códec', 'primerosBytes', 'arreglo'], sospechosos.map((r) => {
    const a = p.pathOf(r.id)
    let real: string | null = null
    try { real = a ? sniff(a) : null } catch { real = null }
    const fix = real ? extensionFix(r.rel, real, null) : null
    return [r.id, r.rel, r.kind, r.ext, r.codec, real ?? (a ? '(no se pudo leer)' : '(sin disco)'), fix ? `${fix.base ? fix.base + ' · ' : ''}.${fix.ext}` : '']
  }))
  console.log(`extensiones: ${sospechosos.length} con códec que no es el de la extensión`)
  p.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  p.lib.close()
}

const resumen: Record<string, unknown> = { base, fecha: new Date().toISOString() }

for (const pas of PASADAS) {
  const archivo = path.join(tmp, `${pas.clave}.db`)
  fs.copyFileSync(prep, archivo)
  const p = abrir(archivo)
  const t0 = performance.now()
  elegirCarpetas(p, pas.regla)
  const reglas = reglasGuardadas(p.setting)
  armarRevision({ db: p.db, changes: p.changes, organizer: p.organizer, pathOf: p.pathOf, reglas })
  const r = leerRevision(p.db, p.changes, p.organizer)
  const ms = Math.round(performance.now() - t0)
  const dir = `${pas.clave}`
  fs.mkdirSync(path.join(salida, dir), { recursive: true })

  // los tags de hoy de cada tema, y cómo quedarían con lo que está para aplicar
  const tags = new Map((p.db.prepare(`SELECT id, artist, album_artist AS aa, title, album, year, genre, track, rel_path AS rel FROM files`).all() as
    { id: number; artist: string | null; aa: string | null; title: string | null; album: string | null; year: string | null; genre: string | null; track: string | null; rel: string }[]).map((x) => [x.id, x]))
  const futuro = new Map<number, Record<string, string | null>>()
  for (const c of p.changes.list()) { const m = futuro.get(c.fileId) ?? {}; m[c.field] = c.after; futuro.set(c.fileId, m) }
  const t = (id: number, k: 'artist' | 'aa' | 'title' | 'album' | 'year' | 'genre' | 'track') => tags.get(id)?.[k] ?? ''

  const cuenta: Record<string, { total: number; on: number; error: number }> = {}
  for (const g of GRUPOS_REVISION) {
    const filas = r.grupos[g]
    cuenta[g] = { total: filas.length, on: filas.filter((x) => x.on).length, error: filas.filter((x) => x.error).length }
    if (g === 'mov') {
      tsv(`${dir}/grupo-mov.tsv`, ['fileId', 'de', 'a', 'on', 'error', 'artista', 'artistaDisco', 'disco', 'año', 'género', 'n', 'título', 'futuro'],
        filas.map((x) => [x.fileId, x.antes, x.despues, x.on, x.error, t(x.fileId, 'artist'), t(x.fileId, 'aa'), t(x.fileId, 'album'), t(x.fileId, 'year'),
          t(x.fileId, 'genre'), t(x.fileId, 'track'), t(x.fileId, 'title'), JSON.stringify(futuro.get(x.fileId) ?? {})]))
    } else if (g === 'rep') {
      tsv(`${dir}/grupo-rep.tsv`, ['fileId', 'vaALaPapelera', 'seQueda', 'on', 'error'], filas.map((x) => [x.fileId, x.rel, x.antes, x.on, x.error]))
    } else {
      tsv(`${dir}/grupo-${g}.tsv`, ['fileId', 'rel', 'campo', 'antes', 'despues', 'on', 'error', 'artista', 'título'],
        filas.map((x) => [x.fileId, x.rel, x.campo, x.antes, x.despues, x.on, x.error, t(x.fileId, 'artist'), t(x.fileId, 'title')]))
    }
  }

  // las cartas, todas (la pantalla muestra hasta 60 de cada tipo)
  const plan = p.organizer.plan(pas.regla, true)
  const todasChoque = plan.clashes ?? []
  tsv(`${dir}/cartas-choque.tsv`, ['fileId', 'de', 'destino', 'chocaCon'], todasChoque.map((c) => [c.fileId, c.from, c.to, c.with]))
  const quien = p.db.prepare(`SELECT f.id, f.rel_path AS rel, f.artist, f.title FROM files f WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica'
      AND (COALESCE(TRIM(f.artist), '') = '' OR COALESCE(TRIM(f.title), '') = '')
      AND NOT EXISTS (SELECT 1 FROM pending_changes p WHERE p.file_id = f.id AND p.field IN ('artist', 'title'))
      AND NOT EXISTS (SELECT 1 FROM propuestas p WHERE p.file_id = f.id AND p.tipo = 'papelera') ORDER BY f.rel_path`).all() as { id: number; rel: string; artist: string | null; title: string | null }[]
  tsv(`${dir}/cartas-quien.tsv`, ['fileId', 'rel', 'artistaHoy', 'títuloHoy', 'sugiereArtista', 'sugiereTítulo'],
    quien.map((q) => { const s = delNombre(q.rel); return [q.id, q.rel, q.artist, q.title, s?.artista ?? '(nada)', s?.titulo ?? ''] }))
  const pares = (repetidosAlDia(p.db)?.grupos ?? []).filter((g) => g.level !== 'version' && g.propuesto == null && (g.decidir || g.keep == null))
  tsv(`${dir}/cartas-par.tsv`, ['grupo', 'nivel', 'porQué', 'seQuedaría', 'id', 'rel', 'kbps', 'dur', 'nota'],
    pares.flatMap((g, k) => g.items.map((i) => [k + 1, g.level, g.warning ?? g.why, g.keep === i.id ? 'sí' : '', i.id, i.rel, i.kbps, i.duration?.toFixed(1), i.grade])))
  const todosRep = repetidosAlDia(p.db)?.grupos ?? []
  tsv(`${dir}/repetidos-todos.tsv`, ['grupo', 'nivel', 'porQué', 'decidir', 'seQueda', 'id', 'rel', 'kbps', 'dur', 'nota'],
    todosRep.flatMap((g, k) => g.items.map((i) => [k + 1, g.level, g.warning ?? g.why, g.decidir ? 'sí' : '', g.keep === i.id ? 'sí' : '', i.id, i.rel, i.kbps, i.duration?.toFixed(1), i.grade])))
  tsv(`${dir}/salteados.tsv`, ['fileId', 'rel', 'motivo'], plan.skipped.map((s) => [s.fileId, s.rel, s.reason]))

  // las carpetas que quedarían: artista (primer nivel) y artista/disco, con cuántos temas
  const nivel = (to: string, n: number) => to.split('/').slice(pas.regla.dest ? 1 : 0, (pas.regla.dest ? 1 : 0) + n).join('/')
  const conteo = (n: number) => { const m = new Map<string, number>(); for (const x of r.grupos.mov) { const k = nivel(x.despues ?? '', n); m.set(k, (m.get(k) ?? 0) + 1) } return [...m].sort((a, b) => a[0].localeCompare(b[0])) }
  tsv(`${dir}/carpetas-nivel1.tsv`, ['carpeta', 'temas'], conteo(1))
  tsv(`${dir}/carpetas-nivel2.tsv`, ['carpeta', 'temas'], conteo(2))

  // marcas automáticas: lo que hay que mirar sí o sí (no deciden nada: se revisa a ojo)
  const marcas: [string, number, string, string][] = []
  const marca = (tipo: string, id: number, rel: string, detalle: string) => marcas.push([tipo, id, rel, detalle])
  const RARO = /\b(sin (g[eé]nero|artista|[aá]lbum|disco|t[ií]tulo)|varios|various|va|unknown|desconocid[oa]|no genre|untitled|track ?\d+)\b/i
  const PROHIBIDO = /(^|\/)(pioneer|.*ableton.*|.* project|samples?|sample ?packs?|loops?|presets?)(\/|$)/i
  for (const x of r.grupos.mov) {
    const to = x.despues ?? '', partes = to.split('/')
    const anio = to.match(/\/(\d{4}) - /)?.[1]
    if (anio && (+anio < 1900 || +anio > 2026)) marca('año-raro', x.fileId, x.rel, to)
    if (/\/0{3}\d( - |\/)/.test(to)) marca('año-cero', x.fileId, x.rel, to)
    if (/\/00 - [^/]+$/.test(to)) marca('tema-número-cero', x.fileId, x.rel, to)
    if (RARO.test(partes.slice(1).join('/'))) marca('nombre-genérico', x.fileId, x.rel, to)
    if (PROHIBIDO.test(x.rel)) marca('origen-prohibido', x.fileId, x.rel, to)
    if (/\/\d{3,} - [^/]+$/.test(to)) marca('número-de-tema-largo', x.fileId, x.rel, to)
    if (to.length > 200) marca('ruta-larga', x.fileId, x.rel, `${to.length} letras`)
    if (/\/ - |\/-|- \.| \.[a-z0-9]+$|\(\)|\[\]/.test(to)) marca('pedazo-vacío', x.fileId, x.rel, to)
    if (/[A-Za-z]_[A-Za-z]|_ /.test(to)) marca('guion-bajo', x.fileId, x.rel, to)
    const ext = (s: string) => s.slice(s.lastIndexOf('.')).toLowerCase()
    if (ext(x.rel) !== ext(to)) marca('extensión-cambia', x.fileId, x.rel, to)
  }
  // artistas parecidos: el mismo después de sacar artículos, "J", "DJ", acentos, mayúsculas y signos; o uno metido en el otro
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const porArtista = new Map<string, number>()
  if (pas.regla.rule.startsWith('%genero%')) for (const [k, n] of conteo(2)) { const a = k.split('/')[1] ?? ''; porArtista.set(a, (porArtista.get(a) ?? 0) + n) }
  const artistas = (porArtista.size ? [...porArtista] : conteo(1)).map(([k, n]) => ({ k, n, w: norm(k) }))
  for (let i = 0; i < artistas.length; i++) for (let j = i + 1; j < artistas.length; j++) {
    const a = artistas[i], b = artistas[j]
    if (!a.w || !b.w) continue
    const sinArt = (w: string) => w.replace(/^(the|los|las|la|el|dj|j|mc|lil) /, '')
    const dentro = (x: string, y: string) => x.length >= 4 && (` ${y} `).includes(` ${x} `) && !/[&,]| y | x | feat| ft\.? | vs\.? /i.test(` ${b.k} ${a.k} `)
    if (a.w === b.w || sinArt(a.w) === sinArt(b.w) || dentro(a.w, b.w) || dentro(b.w, a.w))
      marca('artistas-parecidos', 0, `${a.k} (${a.n})`, `${b.k} (${b.n})`)
  }
  // nombres: artistas cortados o que pierden mucho, títulos que quedan vacíos
  for (const x of [...r.grupos.nom, ...r.grupos.net]) {
    const a = (x.antes ?? '').trim(), d = (x.despues ?? '').trim()
    if (!d && a) marca('nombre-queda-vacío', x.fileId, x.rel, `${x.campo}: "${a}" → ""`)
    else if (a && d && a.length - d.length >= 6 && !/\(|\[|www|\.com|official|video|audio|lyric/i.test(a)) marca('nombre-pierde-mucho', x.fileId, x.rel, `${x.campo}: "${a}" → "${d}"`)
    if (x.campo === 'artist' && a && d && norm(a).includes(norm(d)) && norm(a) !== norm(d) && !/feat|ft\.|&|,| x | y /i.test(a)) marca('artista-cortado', x.fileId, x.rel, `"${a}" → "${d}"`)
  }
  tsv(`${dir}/marcas.tsv`, ['tipo', 'fileId', 'rel', 'detalle'], marcas)
  const porTipo = Object.fromEntries([...new Set(marcas.map((m) => m[0]))].map((k) => [k, marcas.filter((m) => m[0] === k).length]))
  const cartas = Object.fromEntries(['par', 'choque', 'quien'].map((k) => [k, r.decidir.filter((c) => c.tipo === k).length]))
  resumen[pas.clave] = { regla: pas.regla, ms, listos: r.listos, enRekordbox: r.enRekordbox, grupos: cuenta, cartasEnPantalla: cartas,
    cartasTodas: { par: pares.length, choque: todasChoque.length, quien: quien.length }, yaEnSuLugar: plan.alreadyOk, salteados: plan.skipped.length,
    carpetasArtista: conteo(1).length, carpetasDisco: conteo(2).length, marcas: porTipo, reglasNombres: reglas }
  console.log(`${pas.clave}: ${ms} ms · ${JSON.stringify(cuenta)} · cartas ${JSON.stringify(resumen[pas.clave] && (resumen[pas.clave] as { cartasTodas: unknown }).cartasTodas)} · marcas ${JSON.stringify(porTipo)}`)
  p.lib.close()
}
fs.writeFileSync(path.join(salida, 'resumen.json'), JSON.stringify(resumen, null, 2) + '\n')
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`listo: ${salida}`)
