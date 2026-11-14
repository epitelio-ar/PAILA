// sockseek de mentira para los tests de NAPIA: imita su salida (--progress-json por stdout, el registro por stderr y el
// _index.csv) sin entrar a Soulseek ni bajar nada. Lee el CSV que arma NAPIA y "baja" cada tema escribiendo un archivo chico.
// Temas especiales: título con "Inexistente" → nadie lo tiene; con "Falla" → no respondieron. FALSO_LENTO=1 tarda y deja un
// proceso nieto (su pid en FALSO_PID) para probar que cancelar no deja nada colgado. FALSO_SIN_CUENTA=1 imita la cuenta vacía.
// FALSO_PUERTO_CERRADO=1: encuentra todo pero no se puede conectar con nadie (el puerto cerrado).
// Para ver la pantalla: FALSO_PAUSA=<ms> tarda eso en cada tema; FALSO_NO_ENCUENTRA=<expresión> nadie tiene los que la cumplen
// (por ejemplo "feat|Remaster": así "buscar de otra forma", sin eso, los encuentra).
// La calidad real: FALSO_FUENTES=<json> da, por título, los usuarios que lo comparten y el archivo de audio de cada uno
// ({"Tema": [["ana", "C:/x/inflado.mp3"], ["beto", "C:/x/bueno.mp3"]]}): "baja" del primero que no esté en --banned-users
// (copiando ese archivo, con su extensión); si están todos vetados, nadie lo tiene. Un tercer dato "lenta" (["ana", "C:/x.mp3", "lenta"]):
// ese usuario manda de a un byte cada 200 ms y nunca termina (para probar el corte de fuentes lentas, core/sockseek/lentitud.ts).
// Un tercer dato "como:<nombre>": el archivo de ese usuario se llama así, como en Soulseek ("como:A - Tema (Acapella).mp3").
// Un disco (una fila sin título: la carpeta entera de una persona): FALSO_DISCOS=<json> da, por disco, los archivos de la carpeta de
// alguien ({"Love and Sex": ["C:/x/01 - Uno.flac", …]}): se copian a <destino>/<lista>/<Artista - Disco>/. Sin el disco, nadie lo tiene.
// FALSO_JOBS=<n>: baja n temas a la vez, como el sockseek de verdad (sin esto, de a uno). El índice se escribe tema por tema.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const csvPath = args[0]
const out = args.includes('-o') ? args[args.indexOf('-o') + 1] : process.cwd()
const ev = (type, data) => process.stdout.write(JSON.stringify({ type, timestamp: new Date().toISOString(), data }) + '\n')
const log = (s) => process.stderr.write(s + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

log('[cli] Starting CLI session in local mode')
if (process.env.FALSO_SIN_CUENTA) { log('[error] [cli] Soulseek login failed: Missing Soulseek username and password. Provide --user and --pass, or configure username/password.'); process.exit(1) }

const cells = (line) => { const r = []; let c = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { c += '"'; i++ } else if (ch === '"') q = false; else c += ch } else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = '' } else c += ch } r.push(c); return r }
const rows = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(cells).map(([artist, title, album, length]) => ({ artist, title, album, length }))
const name = path.basename(csvPath, path.extname(csvPath))
const dir = path.join(out, name)
fs.mkdirSync(dir, { recursive: true })
// como sockseek: el índice en <destino>/<lista>/_index.csv, o donde diga --index-path
const fuentes = process.env.FALSO_FUENTES ? JSON.parse(process.env.FALSO_FUENTES) : null
const vetados = args.includes('--banned-users') ? args[args.indexOf('--banned-users') + 1].split(',') : []
const indexFile = args.includes('--index-path') ? args[args.indexOf('--index-path') + 1] : path.join(dir, '_index.csv')
fs.mkdirSync(path.dirname(indexFile), { recursive: true })
const before = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(cells) : []
// lo ya bajado, con dónde quedó (NAPIA lo mueve a la carpeta de la lista y corrige el índice)
const done = new Map(before.filter((r) => r[6] === '1' || r[6] === '3').map((r) => [`${r[1]}|${r[3]}`, r[0]]))
const index = []

if (process.env.FALSO_LENTO) {
  const nieto = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
  fs.writeFileSync(process.env.FALSO_PID, String(nieto.pid))
}
ev('track_list', { total: rows.length, tracks: rows.map((r, index) => ({ index, artist: r.artist, title: r.title, lifecycleState: 'Pending' })) })
let ok = 0, failed = 0
const cell = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
// como sockseek: el índice se reescribe cada vez que un tema termina (si lo cortan, queda lo que ya terminó)
const anotar = (fila) => {
  index.push(fila)
  fs.writeFileSync(indexFile, ['filepath,artist,album,title,length,tracktype,state,failurereason', ...index.map((r) => r.map(cell).join(','))].join('\n') + '\n')
}

async function disco(r) {
  const archivos = (process.env.FALSO_DISCOS ? JSON.parse(process.env.FALSO_DISCOS) : {})[r.album]
  ev('search_start', { artist: r.artist, album: r.album })
  if (process.env.FALSO_PAUSA) await sleep(Number(process.env.FALSO_PAUSA))
  if (!archivos) { ev('track_state', { artist: r.artist, album: r.album, lifecycleState: 'Terminal', terminalOutcome: 'Failed', failureReason: 'NoSearchResults' }); failed++; return }
  const carpeta = path.join(dir, `${r.artist} - ${r.album}`)
  fs.mkdirSync(carpeta, { recursive: true })
  for (const a of archivos) fs.copyFileSync(a, path.join(carpeta, path.basename(a)))
  ev('track_state', { artist: r.artist, album: r.album, lifecycleState: 'Terminal', terminalOutcome: 'Succeeded', downloadPath: carpeta }); ok++
}

async function uno(r) {
  if (!r.title) return disco(r)
  // la fuente: el primer usuario que lo tiene y no está vetado (con FALSO_FUENTES)
  const fuente = fuentes?.[r.title]?.find(([u]) => !vetados.includes(u)) ?? null
  const ext = fuente ? path.extname(fuente[1]).slice(1) : 'mp3'
  // como sockseek: sin los caracteres que Windows no deja en un nombre ("Quevedo: Bzrp…")
  const como = typeof fuente?.[2] === 'string' && fuente[2].startsWith('como:') ? fuente[2].slice(5) : null
  const file = path.join(dir, (como ?? `${r.artist} - ${r.title}.${ext}`).replace(/[<>:"/\\|?*]/g, '_'))
  if (done.has(`${r.artist}|${r.title}`)) {
    const antes = done.get(`${r.artist}|${r.title}`) || file
    ev('track_state', { artist: r.artist, title: r.title, lifecycleState: 'Terminal', terminalOutcome: 'Skipped', skipReason: 'AlreadyExists', downloadPath: antes })
    anotar([antes.replace(/\\/g, "/"), r.artist, r.album, r.title, r.length || -1, 0, 3, 0]); ok++; return
  }
  ev('search_start', { artist: r.artist, title: r.title })
  log(`[007] SongJob: searching: ${r.artist} - ${r.title}`)
  if (process.env.FALSO_PAUSA) await sleep(Number(process.env.FALSO_PAUSA))
  if (/Inexistente/.test(r.title) || (fuentes?.[r.title] && !fuente) || (process.env.FALSO_NO_ENCUENTRA && new RegExp(process.env.FALSO_NO_ENCUENTRA, 'i').test(`${r.artist} - ${r.title}`))) {
    ev('track_state', { artist: r.artist, title: r.title, lifecycleState: 'Terminal', terminalOutcome: 'Failed', failureReason: 'NoSearchResults' })
    anotar(['', r.artist, r.album, r.title, r.length || -1, 0, 2, 9]); failed++; return
  }
  if (process.env.FALSO_PUERTO_CERRADO) {
    // como en una PC real el 21/10: encuentra, pero no se puede conectar con ninguno de los que lo tienen
    for (const u of ['ana', 'beto', 'caro']) log(`[warn] [003] Failed to establish a direct or indirect message connection to ${u} (190.1.2.3:2234)`)
    ev('track_state', { artist: r.artist, title: r.title, lifecycleState: 'Terminal', terminalOutcome: 'Failed', failureReason: 'AllDownloadsFailed' })
    anotar(['', r.artist, r.album, r.title, r.length || -1, 0, 2, 4]); failed++; return
  }
  // con FALSO_FUENTES, lo que pesa el archivo de ese usuario (así la muestra y la lentitud ven tamaños de verdad); el número de
  // renglón lo hace único (el avance de sockseek se reconoce por el tamaño)
  const size = (fuente ? fs.statSync(fuente[1]).size : 1000) + r.title.length + 7 * rows.indexOf(r)
  ev('download_start', { artist: r.artist, title: r.title, username: fuente?.[0] ?? 'alguien', filename: `x\\${path.basename(file)}`, size, extension: ext })
  log('[warn] Failed to establish connection to peer pepito: Connection refused')
  ev('download_progress', { jobId: 'j', bytesTransferred: size / 2, totalBytes: size, percent: 50 })
  // como sockseek: lo que va bajando, a medias (con FALSO_FUENTES, la primera mitad del archivo de ese usuario: core/sockseek/muestra.ts)
  if (fuente) { const b = fs.readFileSync(fuente[1]); fs.writeFileSync(file + '.incomplete', b.subarray(0, Math.floor(b.length / 2))) } else fs.writeFileSync(file + '.incomplete', 'medio')
  if (fuente?.[2] === 'lenta') {
    // un usuario lentísimo: un byte cada 200 ms, nunca termina (hasta que lo corten)
    for (let b = size / 2; ; b++) { await sleep(200); ev('download_progress', { jobId: 'j', bytesTransferred: b, totalBytes: size, percent: Math.round((b / size) * 1000) / 10 }) }
  }
  if (process.env.FALSO_LENTO) await sleep(30000)
  if (/Falla/.test(r.title)) {
    ev('track_state', { artist: r.artist, title: r.title, lifecycleState: 'Terminal', terminalOutcome: 'Failed', failureReason: 'AllDownloadsFailed' })
    anotar(['', r.artist, r.album, r.title, r.length || -1, 0, 2, 4]); failed++; return
  }
  if (fuente) { fs.rmSync(file + '.incomplete'); fs.copyFileSync(fuente[1], file) } else fs.renameSync(file + '.incomplete', file)
  ev('track_state', { artist: r.artist, title: r.title, lifecycleState: 'Terminal', terminalOutcome: 'Succeeded', downloadPath: file, extension: ext, bitRate: 320 })
  anotar([file.replace(/\\/g, "/"), r.artist, r.album, r.title, r.length || -1, 0, 1, 0]); ok++
}

// de a uno, o de a FALSO_JOBS a la vez
const cola = [...rows]
await Promise.all(Array.from({ length: Math.max(1, Number(process.env.FALSO_JOBS) || 1) }, async () => { while (cola.length) await uno(cola.shift()) }))
if (!index.length) fs.writeFileSync(indexFile, 'filepath,artist,album,title,length,tracktype,state,failurereason\n')
log(`[cli] Completed: ${ok} succeeded, ${failed} failed.`)
process.exit(failed ? 1 : 0)
