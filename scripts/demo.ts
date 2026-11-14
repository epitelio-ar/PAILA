// Biblioteca de demostración para las capturas públicas (README): audio sintético corto con artistas, títulos y carpetas
// INVENTADOS, ya escaneada en una base de PAILA nueva. Nada sale de la música de nadie. El análisis lo hace la app al abrirse.
//
//   node scripts/run-ts.mjs scripts/demo.ts C:\PAILA-demo           → C:\PAILA-demo\Musica (archivos) y C:\PAILA-demo\datos (base)
//   node scripts/run-ts.mjs scripts/demo.ts C:\PAILA-demo --en      → C:\PAILA-demo\datos-en: la misma base para analizar en inglés
// Se puede repetir: rehace Musica y datos desde cero (no toca nada más). Las capturas salen con `npm run captura` (docs/capturas/).
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { analyzeFolder } from '@paila/core/collections'
import { Library } from '@paila/core/library'
import { Playlists } from '@paila/core/playlists'
import { findFfprobe } from '@paila/core/probe'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const base = path.resolve(process.argv[2] ?? '')
if (!process.argv[2] || /música/i.test(base)) { console.error('Uso: node scripts/run-ts.mjs scripts/demo.ts <carpeta> (nunca dentro de una carpeta "Música")'); process.exit(2) }
const MUSICA = path.join(base, 'Musica'), DATOS = path.join(base, 'datos')
// --en: copia la base a datos-en sin los análisis, para que la app los rehaga en inglés (los textos de la nota se guardan en el idioma en que se analiza)
if (process.argv[3] === '--en') {
  const en = path.join(base, 'datos-en')
  fs.rmSync(en, { recursive: true, force: true }); fs.cpSync(DATOS, en, { recursive: true })
  const db = new DatabaseSync(path.join(en, 'paila.db')); db.exec('DELETE FROM analysis'); db.close()
  console.log(`Listo ${en}: abrila con PAILA_IDIOMA=en y PAILA_USER_DATA=${en} hasta que termine el análisis.`); process.exit(0)
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-demo-'))

// mulberry32: siempre sale la misma biblioteca
let seed = 20261024
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const between = (a: number, b: number) => a + rnd() * (b - a)

type Fmt = 'flac' | 'mp3-320' | 'mp3-256' | 'mp3-128' | 'm4a' | 'wav' | 'aiff' | 'trucho-320' | 'trucho-flac'
interface Artista { n: string; genero: string; bpm: [number, number]; suave?: boolean; discos: [string, number, Fmt][] }
// Todo inventado (artistas, discos y temas). Cada disco lleva su formato; abajo se cambian a mano algunos temas.
const ARTISTAS: Artista[] = [
  { n: 'Vela Rota', genero: 'Cumbia electrónica', bpm: [96, 104], discos: [['Mapa de sal', 2019, 'flac'], ['Cobre y cielo', 2023, 'mp3-320']] },
  { n: 'Marea Quebrada', genero: 'House', bpm: [122, 126], discos: [['Doce lunas', 2021, 'flac'], ['Terraza 24', 2024, 'mp3-320']] },
  { n: 'Cobalto Seis', genero: 'Techno', bpm: [128, 134], discos: [['Línea de fuga', 2018, 'mp3-128'], ['Sala de máquinas', 2022, 'flac']] },
  { n: 'Maite Quillén', genero: 'Folklore', bpm: [78, 92], suave: true, discos: [['Cartas al viento', 2012, 'm4a'], ['Hilo rojo', 2016, 'flac']] },
  { n: 'Los Faroles del Alba', genero: 'Rock', bpm: [112, 138], discos: [['Todo por hacer', 2009, 'mp3-256'], ['Ruido blanco', 2014, 'mp3-128']] },
  { n: 'Ñandú Eléctrico', genero: 'Funk', bpm: [100, 112], discos: [['Fiebre azul', 2020, 'mp3-320'], ['Pulso de barrio', 2025, 'flac']] },
  { n: 'Dos Lunas Azules', genero: 'Ambient', bpm: [60, 72], suave: true, discos: [['Nubes bajas', 2017, 'wav'], ['Isla fría', 2021, 'flac']] },
  { n: 'Paloma Verdeluz', genero: 'Pop', bpm: [104, 120], discos: [['Rayo verde', 2022, 'mp3-320'], ['Sal y limón', 2025, 'aiff']] },
  { n: 'Sombra Cítrica', genero: 'Downtempo', bpm: [84, 94], discos: [['Papel de calco', 2015, 'mp3-256'], ['Vidrio', 2019, 'flac']] },
  { n: 'Kilómetro Cero', genero: 'Breaks', bpm: [130, 140], discos: [['Satélite', 2023, 'flac'], ['La vuelta larga', 2013, 'mp3-128']] },
  { n: 'DJ Terraza', genero: 'Electrónica', bpm: [118, 124], discos: [['Sesiones de verano', 2024, 'mp3-320']] },
  { n: 'Orquesta Hojarasca', genero: 'Jazz', bpm: [70, 96], suave: true, discos: [['Domingo sin reloj', 2011, 'flac']] },
]
const TITULOS = ['Ciudad dormida', 'Brasas de enero', 'Espejo roto', 'Marea alta', 'Verano eterno', 'Neón y ceniza', 'Último tren', 'Casa vacía', 'Pulso', 'Tormenta de arena',
  'Cometa', 'Horizonte', 'Madrugada', 'Camino al río', 'Luz de garage', 'Fuego lento', 'Sin aviso', 'Lluvia tardía', 'Altamar', 'Polvo de estrellas', 'Bajo la mesa', 'Gira el mundo',
  'Archivo siete', 'Relámpago', 'Tinta', 'Piedra y papel', 'Ventana al sur', 'Cenizas de cobre', 'Sueño de hotel', 'Aire nuevo', 'Mil caminos', 'Cielo prestado', 'Eco de fábrica',
  'Rojo y oro', 'Noche de tango roto', 'Las cuatro de la mañana', 'Invierno tibio', 'Radio lejana', 'Volver a casa', 'Sombra larga', 'Salto al vacío', 'Mapa de papel', 'Ola de calor',
  'Quince minutos', 'Boca de tormenta', 'Faro apagado', 'Semilla', 'Domingo de lluvia', 'Barrio alto', 'Humo azul', 'Fin de semana', 'La última luz', 'Puerto seco', 'Reloj de arena',
  'Cuerda floja', 'Hacia el norte', 'Gran hotel', 'Pequeño volcán', 'Tierra firme', 'Tren de medianoche', 'Costa brava', 'Ruta cuarenta', 'Lejos de todo', 'Mil y una noches',
  'Océano', 'Primera vez', 'Calle ciega', 'Bahía', 'Neblina', 'Cuatro estaciones', 'Gotas', 'Fábrica de sol', 'Sin destino', 'Muelle viejo', 'Orilla', 'Piel de luna',
  'Aurora', 'Ritmo lento', 'Fuga', 'Zona libre', 'Cartón pintado', 'Dos mares', 'Isla verde', 'Camino de tierra', 'Rumbo', 'Diez de la noche', 'Pase de magia', 'Último verano']

interface Tema { fuente?: string; carpeta: string; archivo: string; fmt: Fmt; seg: number; bpm: number; suave: boolean; raiz: number; menor: boolean; tags: Record<string, string>; tapa?: string }
const temas: Tema[] = []
const RAICES = [110, 98, 130.81, 73.42, 82.41, 87.31, 123.47, 92.5, 103.83]
const EXT: Record<Fmt, string> = { flac: 'flac', 'mp3-320': 'mp3', 'mp3-256': 'mp3', 'mp3-128': 'mp3', m4a: 'm4a', wav: 'wav', aiff: 'aiff', 'trucho-320': 'mp3', 'trucho-flac': 'flac' }
const sano = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_')
let tit = 0
for (const a of ARTISTAS) {
  for (const [disco, anio, fmt] of a.discos) {
    const cant = a.discos.length === 1 ? 6 : 3 + Math.floor(rnd() * 3)
    const tapa = `${sano(a.n)}/${anio} - ${sano(disco)}/cover.jpg`
    for (let k = 1; k <= cant; k++) {
      const titulo = TITULOS[tit++ % TITULOS.length]
      const tags = { title: titulo, artist: a.n, album_artist: a.n, album: disco, genre: a.genero, track: `${k}/${cant}`, date: String(anio) }
      temas.push({ carpeta: `${sano(a.n)}/${anio} - ${sano(disco)}`, archivo: `${String(k).padStart(2, '0')} - ${sano(titulo)}`, fmt, seg: Math.round(between(14, 34)), bpm: Math.round(between(...a.bpm)), suave: !!a.suave, raiz: RAICES[Math.floor(rnd() * RAICES.length)], menor: rnd() < 0.6, tags, tapa })
    }
  }
}
// Mezcla de calidades dentro de un mismo disco (lo que pasa en una biblioteca de verdad) y los "truchos": 128 recodificados a 320 o a FLAC
const cambiar = (artista: string, n: number, fmt: Fmt) => { const t = temas.filter((x) => x.tags.artist === artista)[n]; if (t) t.fmt = fmt }
cambiar('Vela Rota', 1, 'trucho-320'); cambiar('Vela Rota', 6, 'mp3-128'); cambiar('Marea Quebrada', 2, 'trucho-flac'); cambiar('Marea Quebrada', 5, 'mp3-256')
cambiar('Maite Quillén', 3, 'trucho-320'); cambiar('Ñandú Eléctrico', 4, 'mp3-128'); cambiar('Sombra Cítrica', 2, 'trucho-320'); cambiar('Kilómetro Cero', 1, 'm4a')
cambiar('Paloma Verdeluz', 0, 'flac'); cambiar('Dos Lunas Azules', 7, 'mp3-320'); cambiar('Los Faroles del Alba', 4, 'flac')
const por = (artista: string, n: number) => temas.filter((x) => x.tags.artist === artista)[n]

// Para ordenar: sin tags (el nombre del archivo dice quién es), tags desprolijos y nombres con basura; a Arreglar nombres le sobra para mostrar
const suelto = (archivo: string, tags: Record<string, string>, fmt: Fmt = 'mp3-320'): Tema => ({ carpeta: 'Descargas', archivo, fmt, seg: Math.round(between(12, 26)), bpm: Math.round(between(96, 128)), suave: false, raiz: RAICES[Math.floor(rnd() * RAICES.length)], menor: rnd() < 0.5, tags })
temas.push(
  suelto('Vela Rota - Cenizas de cobre', {}), suelto('02_marea_quebrada_-_sal_y_limon_(official_video)', {}), suelto('Pista 04', {}, 'mp3-128'),
  suelto('PALOMA VERDELUZ - NUBES BAJAS [HQ]', { artist: 'PALOMA VERDELUZ', title: 'NUBES BAJAS [HQ]' }),
  suelto('Cobalto Seis feat. Nina Arce - Rayo Verde (Original Mix)', { artist: 'cobalto seis ft. nina arce', title: 'rayo verde (original mix)' }),
  suelto('luz de garage  (Lyrics)', { artist: 'Ñandú Electrico', title: 'luz de garage  (Lyrics)' }, 'mp3-128'),
  suelto('Dos Lunas Azules - Gotas (Video Oficial)', { artist: 'Dos Lunas Azules', title: 'Gotas (Video Oficial)', genre: 'ambient' }),
  suelto('Track 09 - Banda sin nombre', { artist: 'Banda sin nombre' }),
)
// Repetidos: copia exacta, el mismo tema en otro formato (mismo sonido, distinta calidad) y una versión recortada
const copia = (de: Tema, carpeta: string, archivo: string, fmt: Fmt = de.fmt): Tema => ({ ...de, fuente: de.fuente ?? `${de.carpeta}/${de.archivo}`, carpeta, archivo: `${de.tags.artist} - ${de.tags.title}${archivo ? ' ' + archivo : ''}`, fmt, tapa: undefined, tags: { ...de.tags, track: '' } })
temas.push(copia(por('Vela Rota', 0), 'Descargas', '(1)'), copia(por('Cobalto Seis', 5), 'Para revisar', '', 'mp3-128'),
  copia(por('Marea Quebrada', 0), 'Para revisar', '', 'mp3-128'), copia(por('Paloma Verdeluz', 2), 'Descargas', '', 'mp3-320'))
// Sample pack: de producción, PAILA no lo renombra ni lo ordena
const PACK = 'Sample Packs/Percusiones del Sur (sample pack)'
for (const [i, n] of ['Bombo 01', 'Bombo 02', 'Caja 01', 'Caja 02', 'Hat cerrado', 'Hat abierto', 'Clap', 'Loop 100 bpm', 'Loop 120 bpm', 'Loop 128 bpm'].entries()) {
  temas.push({ carpeta: PACK, archivo: n, fmt: 'wav', seg: i >= 7 ? 8 : 1, bpm: i >= 7 ? [100, 120, 128][i - 7] : 110, suave: false, raiz: 55, menor: true, tags: {} })
}

/** Una expresión de ffmpeg (aevalsrc): bombo, bajo, hats con ruido, clap y un acorde. `c` = canal: el ruido y la fase cambian (si no, PAILA lo marca estéreo falso). */
function expr(t: Tema, c: number): string {
  const b = 60 / t.bpm, f = (s: number) => (t.raiz * 2 * 2 ** (s / 12)).toFixed(2), ns = (i: number) => (c ? `(random(${i})*0+random(${i})*2-1)` : `(random(${i})*2-1)`), ph = c ? `+1.1` : ``
  const pad = `0.06*(sin(2*PI*${f(0)}*t${ph})+sin(2*PI*${f(t.menor ? 3 : 4)}*t${ph})+sin(2*PI*${f(7)}*t${ph})+0.5*sin(2*PI*${f(12)}*t${ph}))`
  const aire = `0.012*${ns(2)}`
  const fade = `min(1,t/0.4)*min(1,(${t.seg}-t)/1.5)`
  if (t.suave) return `0.7*${fade}*((0.8+0.2*sin(2*PI*0.15*t))*${pad}*2.2+0.03*${ns(0)}*exp(-50*mod(t+${b / 2},${b}))+${aire}+0.12*sin(2*PI*${t.raiz}*t)*exp(-2*mod(t,${b * 2})))`
  const bombo = `0.6*sin(2*PI*58*mod(t,${b}))*exp(-8*mod(t,${b}))`, bajo = `0.22*sin(2*PI*${t.raiz}*t${ph})*(0.55+0.45*exp(-5*mod(t,${b / 2})))`
  const hat = `0.16*${ns(0)}*exp(-60*mod(t+${b / 2},${b}))`, clap = `0.2*${ns(1)}*exp(-22*mod(t+${b},${2 * b}))`
  return `0.6*${fade}*(${bombo}+${bajo}+${hat}+${clap}+${pad}+${aire})`
}

const correr = (args: string[]) => new Promise<void>((ok, ko) => execFile(ffmpeg, ['-v', 'error', '-y', ...args], (e, _o, err) => (e ? ko(new Error(`${e.message}\n${err}`)) : ok())))
/** Corre las tareas de a pocas (el ffmpeg de otras sesiones también necesita lugar). */
async function pool<T>(xs: T[], n: number, f: (x: T, i: number) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) { const k = i++; await f(xs[k], k) } }))
}
const ARTE = new Map<string, string>()
async function tapa(rel: string): Promise<string> {
  const abs = path.join(MUSICA, ...rel.split('/'))
  if (ARTE.has(rel)) return ARTE.get(rel)!
  const h = Math.floor(rnd() * 360), hex = (hh: number, s: number, l: number) => { const k = (n: number) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l), g = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [g(0), g(8), g(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('') }
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const x = Math.round(between(60, 260)), y = Math.round(between(60, 260)), w = Math.round(between(150, 320))
  await correr(['-f', 'lavfi', '-i', `gradients=s=600x600:c0=0x${hex(h, 0.65, 0.42)}:c1=0x${hex((h + 70) % 360, 0.7, 0.2)}:x0=0:y0=0:x1=600:y1=600:d=1`, '-vf',
    `drawbox=x=${x}:y=${y}:w=${w}:h=${w}:color=white@0.14:t=fill,drawbox=x=${x + 40}:y=${y + 40}:w=${w}:h=${w}:color=0x${hex((h + 180) % 360, 0.8, 0.6)}@0.35:t=fill,drawbox=x=40:y=520:w=520:h=6:color=white@0.5:t=fill`, '-frames:v', '1', '-q:v', '3', abs])
  ARTE.set(rel, abs)
  return abs
}

async function sintetizar(t: Tema, n: number) {
  const dir = path.join(MUSICA, ...t.carpeta.split('/')), out = path.join(dir, `${t.archivo}.${EXT[t.fmt]}`)
  fs.mkdirSync(dir, { recursive: true })
  const fuente = path.join(TMP, `fuente-${t.fuente ?? `${t.carpeta}/${t.archivo}`}.wav`.replace(/[^\w.-]/g, '_'))
  if (!fs.existsSync(fuente)) await correr(['-f', 'lavfi', '-i', `aevalsrc=exprs='${expr(t, 0)}|${expr(t, 1)}':s=44100:d=${t.seg}`, fuente])
  const meta = Object.entries(t.tags).filter(([, v]) => v).flatMap(([k, v]) => ['-metadata', `${k}=${v}`])
  let entrada = fuente
  if (t.fmt.startsWith('trucho')) { // el engaño de siempre: se baja a MP3 128 (corta lo agudo) y se vuelve a subir como si fuera bueno
    const feo = path.join(TMP, `feo-${n}.mp3`), vuelta = path.join(TMP, `vuelta-${n}.wav`)
    await correr(['-i', fuente, '-c:a', 'libmp3lame', '-b:a', '128k', feo]); await correr(['-i', feo, vuelta]); entrada = vuelta
  }
  const codec: Record<string, string[]> = {
    flac: ['-c:a', 'flac'], 'trucho-flac': ['-c:a', 'flac'], 'mp3-320': ['-c:a', 'libmp3lame', '-b:a', '320k'], 'trucho-320': ['-c:a', 'libmp3lame', '-b:a', '320k'],
    'mp3-256': ['-c:a', 'libmp3lame', '-b:a', '256k'], 'mp3-128': ['-c:a', 'libmp3lame', '-b:a', '128k'], m4a: ['-c:a', 'aac', '-b:a', '256k'], wav: ['-c:a', 'pcm_s16le'], aiff: ['-c:a', 'pcm_s16be', '-write_id3v2', '1'],
  }
  const conTapa = t.tapa && ['flac', 'mp3', 'm4a'].includes(EXT[t.fmt])
  const arte = conTapa ? await tapa(t.tapa!) : null
  await correr([...(arte ? ['-i', entrada, '-i', arte, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic'] : ['-i', entrada, '-map', '0:a']),
    ...codec[t.fmt], ...(EXT[t.fmt] === 'mp3' ? ['-id3v2_version', '3'] : []), ...meta, out])
}

fs.rmSync(MUSICA, { recursive: true, force: true }); fs.rmSync(DATOS, { recursive: true, force: true })
fs.mkdirSync(MUSICA, { recursive: true }); fs.mkdirSync(DATOS, { recursive: true })
const t0 = Date.now()
await pool(temas, 3, async (t, i) => { await sintetizar(t, i); if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${temas.length} archivos`) })
// la tapa también va suelta (cover.jpg) en la mitad de las carpetas de disco, como la deja cualquier descargador
for (const rel of ARTE.keys()) if (rnd() < 0.5) fs.rmSync(path.join(MUSICA, ...rel.split('/')), { force: true })
console.log(`Audio listo: ${temas.length} archivos en ${Math.round((Date.now() - t0) / 1000)} s`)

// La base de PAILA: la carpeta agregada con las colecciones que sugiere la propia app (el sample pack queda como "producción") y escaneada
const lib = new Library(path.join(DATOS, 'paila.db'), findFfprobe())
const sug = await analyzeFolder(MUSICA)
await lib.addRoot(MUSICA, sug.suggestions.filter((s) => s.kind !== 'musica').map((s) => ({ rel: s.rel, kind: s.kind })))
await lib.scan()
const pl = new Playlists(lib.db, (i) => lib.trackPath(i))
const ids = new Map(lib.tracks().map((r) => [String(r[2]), r[0] as number]))
const idDe = (t: Tema) => ids.get(`${t.carpeta}/${t.archivo}.${EXT[t.fmt]}`)
const lista = (nombre: string, xs: Tema[]) => pl.addTracks(pl.create(nombre, 'list'), xs.map(idDe).filter((x): x is number => x != null))
const musica = temas.filter((t) => t.tags.album && t.carpeta !== 'Para revisar')
lista('Para arrancar la tarde', musica.filter((t) => t.suave || t.bpm < 100).slice(0, 14))
lista('Pista llena', musica.filter((t) => t.bpm >= 120).slice(0, 16))
lista('Viaje en auto', musica.filter((_, i) => i % 5 === 2).slice(0, 15))
lista('Cumbia y barrio', musica.filter((t) => /Cumbia|Funk|Pop/.test(t.tags.genre)).slice(0, 12))
console.log(`Base lista: ${lib.trackCount()} temas, ${pl.tree().length} playlists en ${DATOS}`)
lib.close()
fs.rmSync(TMP, { recursive: true, force: true })
