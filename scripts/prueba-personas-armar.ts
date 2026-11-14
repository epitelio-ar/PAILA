// Arma la música de la prueba con personas (scripts/prueba-personas.ts armar): elige ~270 temas de tu Música (solo los lee),
// los COPIA a <carpeta>/original/Música y desordena las copias a propósito: repetidos en otra calidad y con otro nombre, nombres
// rotos, temas sin tapa o sin tags, mala calidad re-codificada, falsos FLAC, WMA y OGG, carpetas mezcladas. Más una lista de
// Spotify (CSV como el de Exportify) donde faltan temas. La elección sale de una semilla y queda en seleccion.json: rearmar da lo mismo.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export interface Tema { src: string; rel: string; size: number; artist: string; title: string; album: string; isrc: string; ms: number }
export interface Hecho { dst: string; src: string; que: string }

const AUDIO = /\.(mp3|flac|m4a|wav|aiff?)$/i
// lo que no es "música de alguien": exports de Rekordbox, proyectos, samples, stems, audios de WhatsApp, lo de PAILA
const SALTEAR_CARPETA = /^(_PAILA|PIONEER|\..*)$|sample|pack|loop|stems?\b|acapella|kit\b|ableton|project|proyecto|amigx|recibidos|demos?\b|promos?\b/i
const SALTEAR_ARCHIVO = /^(NO_)?VOCALS_|whatsapp|^\._/i

/** Generador con semilla (mulberry32): la misma semilla, la misma elección. */
export function azar(semilla: number) {
  let a = semilla >>> 0
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const mezclar = <T>(xs: T[]) => { const c = [...xs]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j], c[i]] } return c }
  return { r, mezclar, uno: <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] }
}

/** Todos los temas candidatos de la carpeta de origen (entre 1 y 40 MB), ordenados para que la semilla mande. */
export function listar(desde: string) {
  const out: { src: string; rel: string; size: number }[] = []
  const recorrer = (dir: string) => {
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (ents.some((e) => /\.als$/i.test(e.name))) return // proyecto de Ableton
    for (const e of ents) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) { if (!SALTEAR_CARPETA.test(e.name)) recorrer(abs); continue }
      if (!AUDIO.test(e.name) || SALTEAR_ARCHIVO.test(e.name)) continue
      const size = fs.statSync(abs).size
      if (size > 1e6 && size < 40e6) out.push({ src: abs, rel: path.relative(desde, abs).split(path.sep).join('/'), size })
    }
  }
  recorrer(desde)
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1))
}

/** Artista, título, disco, ISRC y duración, con el ffprobe del proyecto. */
export function leerTags(ffprobe: string, src: string) {
  try {
    const j = JSON.parse(execFileSync(ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_format', src], { encoding: 'utf8', timeout: 20000 })) as { format: { duration?: string; tags?: Record<string, string> } }
    const t = Object.fromEntries(Object.entries(j.format.tags ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).trim()]))
    return { artist: t.artist ?? '', title: t.title ?? '', album: t.album ?? '', isrc: t.isrc ?? t.tsrc ?? '', ms: Math.round(Number(j.format.duration ?? 0) * 1000) }
  } catch { return { artist: '', title: '', album: '', isrc: '', ms: 0 } }
}

const limpio = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90)
const ext = (f: string) => path.extname(f).toLowerCase()
/** "Artista - Título" del tag o, si no hay, el nombre del archivo. */
const nombreBase = (t: Tema) => (t.artist && t.title ? limpio(`${t.artist} - ${t.title}`) : limpio(path.basename(t.src, path.extname(t.src))))

/** Las carpetas mezcladas donde caen los temas sueltos (como la Música de cualquiera). */
const SUELTOS = ['', 'Nuevos', 'varios temas', 'DESCARGAS/2019/viejo', 'DESCARGAS', 'Música del celu', 'para ordenar', 'temas sueltos (2)', 'cosas/cosas/temas', 'Mix fiesta']

export function armarMusica(o: { desde: string; destino: string; temas: Tema[]; semilla: number; ffmpeg: string; aviso: (s: string) => void }): Hecho[] {
  const { uno, mezclar, r } = azar(o.semilla + 1)
  const hechos: Hecho[] = []
  const usados = new Set<string>()
  const lugar = (rel: string) => {
    let p = rel, n = 2
    while (usados.has(p.toLowerCase())) { p = rel.replace(/(\.[^.]+)$/, ` (${n++})$1`) }
    usados.add(p.toLowerCase())
    const abs = path.join(o.destino, ...p.split('/'))
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    return { rel: p, abs }
  }
  const ff = (args: string[]) => execFileSync(o.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 180000 })
  const hacer = (t: Tema, rel: string, que: string, como: ((abs: string) => void) | null) => {
    let l = lugar(rel)
    try { if (como) como(l.abs); else fs.copyFileSync(t.src, l.abs) } catch (e) {
      o.aviso(`  no salió "${que}" con ${t.rel}: ${(e as Error).message.split('\n')[0]}; va la copia tal cual`)
      fs.rmSync(l.abs, { force: true })
      l = lugar(rel.replace(/\.[^.]+$/, ext(t.src)))
      fs.copyFileSync(t.src, l.abs); que = 'copia tal cual'
    }
    hechos.push({ dst: l.rel, src: t.rel, que })
    if (hechos.length % 25 === 0) o.aviso(`  ${hechos.length} archivos…`)
  }

  // los discos (temas que comparten carpeta en el origen) quedan juntos en Discos/<carpeta>; el resto se reparte
  const porCarpeta = new Map<string, Tema[]>()
  for (const t of o.temas) { const d = path.posix.dirname(t.rel); porCarpeta.set(d, [...(porCarpeta.get(d) ?? []), t]) }
  const discos = new Set([...porCarpeta.entries()].filter(([, ts]) => ts.length >= 5).map(([d]) => d))
  const mp3oFlac = (t: Tema) => ['.mp3', '.flac'].includes(ext(t.src))
  const sueltos = mezclar(o.temas.filter((t) => !discos.has(path.posix.dirname(t.rel))))
  const enDisco = o.temas.filter((t) => discos.has(path.posix.dirname(t.rel)))
  // cada desorden toma temas distintos; los que sobran van tal cual
  const tomar = (n: number, ok: (t: Tema) => boolean = () => true) => { const xs: Tema[] = []; for (let i = 0; i < sueltos.length && xs.length < n; i++) if (ok(sueltos[i])) xs.push(...sueltos.splice(i--, 1)); return xs }
  const conTags = (t: Tema) => !!(t.artist && t.title) && mp3oFlac(t)
  const rotos = tomar(40, conTags), sinTapa = tomar(20, mp3oFlac), malos = tomar(14, (t) => ext(t.src) === '.mp3' || ext(t.src) === '.flac')
  const falsos = tomar(4, (t) => ext(t.src) === '.mp3'), wma = tomar(3), ogg = tomar(3), repetir = tomar(30, conTags)
  // las trampas (revisión del 02/11): dos pares de temas distintos que quedan como dos pistas del mismo disco con el mismo nombre
  // ("03 - Comentario" y "05 - Comentario"). No son repetidos: si alguno termina en la papelera, PAILA protegió mal
  const trampas = tomar(4, mp3oFlac)
  const carpeta = () => uno(SUELTOS)
  const en = (dir: string, nombre: string) => (dir ? `${dir}/${nombre}` : nombre)

  for (const t of enDisco) hacer(t, `Discos/${limpio(path.posix.basename(path.posix.dirname(t.rel)))}/${path.basename(t.src)}`, 'disco: tal cual', null)
  for (const t of sueltos) hacer(t, en(carpeta(), path.basename(t.src)), 'tal cual', null)

  let pista = 1
  rotos.forEach((t, i) => {
    const e = ext(t.src), b = nombreBase(t), nn = String(pista).padStart(2, '0')
    const formas: [string, string, string[] | null][] = [
      [`Track ${nn}${e}`, 'nombre "Track NN" (los tags están bien)', null],
      [`AudioTrack ${nn}${e}`, 'nombre "AudioTrack NN" y SIN tags (ni artista ni título)', ['-map_metadata', '-1']],
      [`${limpio(t.title)}${e}`, 'sin artista en el nombre ni en el tag', ['-metadata', 'artist=', '-metadata', 'album_artist=']],
      [`${b.toUpperCase()}${e}`, 'nombre en MAYÚSCULAS', null],
      [`${b.toLowerCase()}${e}`, 'nombre en minúsculas', null],
      [`${b.replace(/ - /, '_-_').replace(/ /g, '_')}${e}`, 'nombre con "_" en vez de espacios', null],
      [`${b.replace(/ - /, '--').replace(/ /g, '-').toLowerCase()}${e}`, 'nombre con guiones pegados', null],
      [`${String(i + 1).padStart(2, '0')}. ${limpio(t.title)} (${limpio(t.artist)})${e}`, 'artista entre paréntesis después del título', null],
    ]
    const [nombre, que, meta] = formas[i % formas.length]
    if (i % formas.length < 2) pista++
    hacer(t, en(carpeta(), nombre), que, meta ? (abs) => ff(['-i', t.src, '-map', meta[0] === '-map_metadata' ? '0:a' : '0', '-c', 'copy', ...meta, abs]) : null)
  })
  for (const t of sinTapa) hacer(t, en(carpeta(), path.basename(t.src)), 'sin tapa (se le sacó la imagen)', (abs) => ff(['-i', t.src, '-map', '0:a', '-c', 'copy', abs]))
  malos.forEach((t, i) => {
    const kbps = i % 2 ? 96 : 128
    hacer(t, en(carpeta(), `${path.basename(t.src, path.extname(t.src))}.mp3`), `mala calidad: re-codificado a MP3 ${kbps} kbps`, (abs) => ff(['-i', t.src, '-map', '0:a', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-map_metadata', '0', abs]))
  })
  for (const t of falsos) hacer(t, en(carpeta(), `${path.basename(t.src, path.extname(t.src))}.flac`), 'falso FLAC: un MP3 pasado a FLAC (parece sin pérdida y no lo es)', (abs) => ff(['-i', t.src, '-map', '0:a', '-c:a', 'flac', '-map_metadata', '0', abs]))
  for (const t of wma) hacer(t, en(carpeta(), `${nombreBase(t)}.wma`), 'pasado a WMA', (abs) => ff(['-i', t.src, '-map', '0:a', '-c:a', 'wmav2', '-b:a', '160k', '-map_metadata', '0', abs]))
  for (const t of ogg) hacer(t, en(carpeta(), `${nombreBase(t)}.ogg`), 'pasado a OGG', (abs) => ff(['-i', t.src, '-map', '0:a', '-c:a', 'libvorbis', '-q:a', '5', '-map_metadata', '0', abs]))

  // repetidos: el original va a una carpeta y la copia a otra, con otro nombre (y a veces peor calidad)
  repetir.forEach((t, i) => {
    hacer(t, en(carpeta(), path.basename(t.src)), 'tal cual (tiene un repetido)', null)
    const e = ext(t.src), b = nombreBase(t)
    const otra = uno(SUELTOS.filter(Boolean))
    if (i % 3 === 0) hacer(t, en(otra, `${b} (1)${e}`), `REPETIDO de ${t.rel}: copia idéntica con otro nombre`, null)
    else if (i % 3 === 1) hacer(t, en(otra, `${limpio(t.title)} - ${limpio(t.artist)}.mp3`), `REPETIDO de ${t.rel}: peor calidad (MP3 128 kbps) y nombre al revés`, (abs) => ff(['-i', t.src, '-map', '0:a', '-c:a', 'libmp3lame', '-b:a', '128k', '-map_metadata', '0', abs]))
    else hacer(t, en(otra, `${b.toLowerCase()} [${r() < 0.5 ? 'www.descargas.net' : 'copia'}].mp3`), `REPETIDO de ${t.rel}: MP3 192 kbps con basura en el nombre`, (abs) => ff(['-i', t.src, '-map', '0:a', '-c:a', 'libmp3lame', '-b:a', '192k', '-map_metadata', '0', abs]))
  })
  for (let p = 0; p + 1 < trampas.length; p += 2) {
    const [a, b] = [trampas[p], trampas[p + 1]]
    const titulo = limpio(a.title || nombreBase(a)), artista = a.artist || 'Varios', disco = `Trampa ${p / 2 + 1}`
    for (const [t, n] of [[a, '03'], [b, '05']] as [Tema, string][]) {
      const meta = ['-metadata', `title=${titulo}`, '-metadata', `artist=${artista}`, '-metadata', `album=${disco}`, '-metadata', `track=${Number(n)}`]
      hacer(t, `Discos/${disco}/${n} - ${titulo}${ext(t.src)}`, `TRAMPA: no es repetido (otra pista del mismo disco con el mismo nombre)`, (abs) => ff(['-i', t.src, '-map', '0:a', '-c', 'copy', ...meta, abs]))
    }
  }
  return hechos
}

/** Lo que quedó como trampa (para que el modo prueba sepa si alguien tiró uno que no era repetido): el lugar en Música/. */
export const trampasDe = (hechos: Hecho[]) => hechos.filter((h) => h.que.startsWith('TRAMPA')).map((h) => h.dst)

/** Un tema que puede ir en una lista de Spotify: con artista y título, sin artistas de orquesta ("X: Royal Philharmonic…"). */
export const paraLista = (t: Tema) => !!(t.artist && t.title) && !t.artist.includes(':') && t.artist.length <= 40
const pliegue = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/(.*?)|feat..*/g, '').replace(/[^a-z0-9]/g, '')

/**
 * Los temas de la lista: 5 en mala calidad, 3 con repetido y el resto de lo que quedó tal cual, mezclados con la semilla, sin dos
 * veces el mismo título (dos "La Tortura") ni más de 2 del mismo artista (salían 8 de Shakira); y hasta 12 que faltan.
 */
export function elegirLista(hechos: Hecho[], temas: Tema[], faltan: Tema[], semilla: number) {
  const { mezclar } = azar(semilla + 3)
  const porSrc = new Map(temas.map((t) => [t.rel, t]))
  const tiene: Tema[] = []
  const titulos = new Set<string>(), artistas = new Map<string, number>()
  const sumar = (f: (h: Hecho) => boolean, n: number) => {
    let puestos = 0
    for (const src of mezclar([...new Set(hechos.filter(f).map((h) => h.src))])) {
      const t = porSrc.get(src)
      if (puestos >= n || !t || !paraLista(t) || tiene.includes(t)) continue
      const a = pliegue(t.artist.split(/[;,&]| feat/i)[0]), ti = pliegue(t.title)
      if (titulos.has(ti) || (artistas.get(a) ?? 0) >= 2) continue
      titulos.add(ti); artistas.set(a, (artistas.get(a) ?? 0) + 1); tiene.push(t); puestos++
    }
  }
  sumar((h) => h.que.startsWith('mala calidad'), 5)
  sumar((h) => h.que.startsWith('REPETIDO'), 3)
  sumar((h) => h.que === 'tal cual' || h.que === 'disco: tal cual', 18 - tiene.length)
  return { tiene, faltan: faltan.filter((t) => paraLista(t) && !titulos.has(pliegue(t.title))).slice(0, 12) }
}

const CAMPOS = ['Track URI', 'Track Name', 'Artist URI(s)', 'Artist Name(s)', 'Album URI', 'Album Name', 'Album Artist URI(s)', 'Album Artist Name(s)', 'Album Release Date',
  'Album Image URL', 'Disc Number', 'Track Number', 'Track Duration (ms)', 'Track Preview URL', 'Explicit', 'Popularity', 'ISRC', 'Added By', 'Added At']

/** Una lista de Spotify como la baja Exportify: `tiene` (están en la Música de la prueba) mezclados con `faltan`. */
export function listaSpotify(tiene: Tema[], faltan: Tema[], semilla: number) {
  const { mezclar, r } = azar(semilla + 2)
  const id = () => Array.from({ length: 22 }, () => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'[Math.floor(r() * 62)]).join('')
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`
  const filas = mezclar([...tiene, ...faltan]).map((t, i) => [`spotify:track:${id()}`, t.title, `spotify:artist:${id()}`, t.artist, `spotify:album:${id()}`, !t.album || /desconocid|unknown/i.test(t.album) ? t.title : t.album, `spotify:artist:${id()}`, t.artist,
    '', '', 1, i + 1, t.ms, '', 'false', Math.floor(30 + r() * 60), t.isrc, 'spotify:user:paila-prueba', '2026-10-20T18:00:00Z'].map(q).join(','))
  return [CAMPOS.map(q).join(','), ...filas].join('\n') + '\n'
}
