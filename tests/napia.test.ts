// NAPIA (el panel de control para sockseek): encontrar sockseek y leer su config sin mostrar la cuenta, armar la lista y los
// argumentos, leer el avance (con líneas reales de sockseek 3.0.6), el _index.csv y los .incomplete, la carpeta de la
// Bandeja de PAILA, y correr un sockseek de mentira (tests/fixtures/sockseek-falso.mjs): avance, ya estaba y cancelar.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { SOCKSEEK_EXE, configCandidates, findSockseek, readConfig, tieneFreno } from '@paila/core/sockseek/config'
import { buildArgs, listCsv, listFileName, listRows } from '@paila/core/sockseek/args'
import { Progress, isEstablishError, isPeerError, problemOf } from '@paila/core/sockseek/progress'
import { indexSummary, parseIndex } from '@paila/core/sockseek/indexcsv'
import { SockseekRun } from '@paila/core/sockseek/run'
import { bandejaFolder, pailaDbCandidates } from '@paila/core/sockseek/paila'
import { parseList } from '@paila/core/listparse'
import { sockseekCsv, sockseekTxt } from '@paila/core/listexport'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
const FALSO = path.join(__dirname, 'fixtures', 'sockseek-falso.mjs')

describe('encontrar sockseek y su configuración', () => {
  it('busca el elegido a mano, la carpeta de programas y el PATH; la config en el orden de sockseek', () => {
    const local = path.join(tmp, 'local'), bin = path.join(tmp, 'bin')
    fs.mkdirSync(path.join(local, 'Programs', 'sockseek'), { recursive: true }); fs.mkdirSync(bin)
    expect(findSockseek({ localAppData: local, pathVar: bin })).toBeNull()
    fs.writeFileSync(path.join(bin, 'sockseek.exe'), '')
    expect(findSockseek({ localAppData: local, pathVar: bin })?.from).toBe('PATH')
    fs.writeFileSync(path.join(local, 'Programs', 'sockseek', 'sockseek.exe'), '')
    expect(findSockseek({ localAppData: local, pathVar: bin })?.from).toBe('carpeta de programas')
    expect(findSockseek({ localAppData: local, chosen: path.join(bin, 'sockseek.exe') })?.from).toBe('elegido a mano')
    expect(findSockseek({ localAppData: local, chosen: path.join(bin, 'no-existe.exe') })?.from).toBe('carpeta de programas')
    // el con freno de NAPIA (en su carpeta de datos) va antes que el de siempre; el elegido a mano, antes que todos
    const freno = path.join(tmp, 'napia-datos', 'sockseek')
    // (en Mac el programa se llama sockseek, sin .exe)
    fs.mkdirSync(freno, { recursive: true }); fs.writeFileSync(path.join(freno, SOCKSEEK_EXE), '')
    expect(findSockseek({ localAppData: local, frenoDirs: [path.join(tmp, 'no-esta'), freno] })).toEqual({ exe: path.join(freno, SOCKSEEK_EXE), from: 'con freno de NAPIA' })
    expect(findSockseek({ localAppData: local, frenoDirs: [freno], chosen: path.join(bin, 'sockseek.exe') })?.from).toBe('elegido a mano')
    expect([tieneFreno('3.0.6-napia.1'), tieneFreno('3.0.6'), tieneFreno(null)]).toEqual([true, false, false])
    expect(configCandidates({ home: 'H', appData: 'A' }, path.join('P', 'sockseek.exe'))).toEqual([path.join('H', '.config', 'sockseek', 'sockseek.conf'), path.join('A', 'sockseek', 'sockseek.conf'), path.join('P', 'sockseek.conf')])
  })

  it('una config real: cuenta puesta (sin mostrarla), carpeta Descargando y acciones que mueven a Completo', () => {
    const conf = readConfig([
      '# Configuracion de sockseek', 'username = alguien', 'password = secreta123', '',
      'output-dir = D:/Soulseek/Descargando',
      'listen-port = 2416',
      'on-complete = when=success scope=album hidden update-index -- powershell -NoProfile -File "C:/x/mover-a-completo.ps1" -Ruta "{path}" -Desde "{outputdir}" -Hasta "D:/Soulseek/Completo"',
      '[mover-temas-sueltos]', 'profile-cond = !album', 'output-dir = F:/otra',
      'on-complete = when=success scope=track hidden -- powershell -File "C:/x/mover-a-completo.ps1" -Hasta "D:/Soulseek/Completo"',
    ].join('\r\n'))
    expect(conf).toEqual({ hasUser: true, hasPass: true, outputDir: 'D:/Soulseek/Descargando', onComplete: true, moveTo: ['D:/Soulseek/Completo'], listenPort: 2416 })
    expect(JSON.stringify(conf)).not.toContain('secreta')
    expect(readConfig('username = \npassword =\n# output-dir = F:/x\n', 'C:/Users/yo')).toEqual({ hasUser: false, hasPass: false, outputDir: null, onComplete: false, moveTo: [], listenPort: null })
    expect(readConfig('user = a\npass = b\noutput-dir = ~/Música/Soulseek').outputDir).toBe('/Música/Soulseek')
    expect(readConfig('listen-port = 99999').listenPort).toBeNull()
  })
})

describe('la lista y los argumentos', () => {
  const tracks = [
    { artist: 'Duran Duran', title: 'Save a Prayer - 2009 Remaster', album: 'Rio', duration: 225 },
    { artist: 'Erasure', title: 'Ship of Fools', album: null, duration: null },
    { artist: 'Toto', title: 'Africa', album: null, duration: 295 },
  ]
  it('CSV de sockseek, sin remasters si se pide y solo los primeros para probar', () => {
    expect(listCsv(tracks, { sacarRemaster: true, primeros: null, saltearTenes: false }).split('\r\n')).toEqual(['Artist,Title,Album,Length', 'Duran Duran,Save a Prayer,Rio,225', 'Erasure,Ship of Fools,,', 'Toto,Africa,,295', ''])
    expect(listCsv(tracks, { sacarRemaster: false, primeros: 1 }).split('\r\n')).toEqual(['Artist,Title,Album,Length', 'Duran Duran,Save a Prayer - 2009 Remaster,Rio,225', ''])
  })
  it('las filas del avance son las mismas que van a sockseek: sin repetidos (también los que solo difieren en el remaster) ni renglones vacíos', () => {
    const rows = listRows([...tracks, { artist: 'duran duran', title: 'Save a Prayer', album: null, duration: null }, { artist: 'X', title: ' ', album: null, duration: null }], { sacarRemaster: true, primeros: null, saltearTenes: false })
    expect(rows.map((r) => r.title)).toEqual(['Save a Prayer', 'Ship of Fools', 'Africa'])
    expect(listRows(tracks, { sacarRemaster: true, primeros: 2 })).toHaveLength(2)
  })
  it('argumentos: CSV, destino (o el de la config), calidad y avance en JSON; nunca la cuenta', () => {
    const o = { calidad: 'buena' as const, sacarRemaster: true, primeros: null, saltearTenes: false }
    expect(buildArgs({ csvPath: 'C:/l/80s Mood.csv', outputDir: 'F:/Bandeja', options: o })).toEqual(['C:/l/80s Mood.csv', '--input-type', 'csv', '-o', 'F:/Bandeja', '--min-bitrate', '320', '--pref-format', 'flac,wav,aiff,aif', '--progress-json'])
    expect(buildArgs({ csvPath: 'x.csv', outputDir: null, options: { ...o, calidad: 'sinperdida' } })).toEqual(['x.csv', '--input-type', 'csv', '--format', 'flac,wav,aiff,aif', '--pref-format', 'flac', '--progress-json'])
    expect(buildArgs({ csvPath: 'x.csv', outputDir: null, options: { ...o, calidad: 'cualquiera' } }).join(' ')).not.toMatch(/--user|--pass/)
    // «La que haya»: nada obligatorio (no hay --format ni --min-bitrate), pero primero sin pérdida y después 320
    const cualquiera = buildArgs({ csvPath: 'x.csv', outputDir: null, options: { ...o, calidad: 'cualquiera' } })
    expect(cualquiera).toEqual(['x.csv', '--input-type', 'csv', '--pref-format', 'flac,wav,aiff,aif', '--pref-min-bitrate', '320', '--progress-json'])
    expect(cualquiera).not.toContain('--format')
    expect(cualquiera).not.toContain('--min-bitrate')
    // el puerto que NAPIA abrió en el router, para que sockseek escuche justo en ese
    expect(buildArgs({ csvPath: 'x.csv', outputDir: null, options: o, listenPort: 2416 })).toEqual(['x.csv', '--input-type', 'csv', '--min-bitrate', '320', '--pref-format', 'flac,wav,aiff,aif', '--listen-port', '2416', '--progress-json'])
    // con freno, las respuestas llegan más espaciadas: búsquedas de 8 s
    expect(buildArgs({ csvPath: 'x.csv', outputDir: null, options: o, freno: true }).join(' ')).toContain('--search-timeout 8000')
  })
  it('el nombre de la lista sirve de carpeta en Windows', () => {
    expect(listFileName('80s Mood')).toBe('80s Mood')
    expect(listFileName('Rock: lo mejor? / 2024.')).toBe('Rock lo mejor 2024')
    expect(listFileName('CON')).toBe('CON (lista)')
    expect(listFileName('  ')).toBe('Lista')
  })
  it('entra lo que exporta PAILA para sockseek (.txt s:"…" y .csv), y un texto pegado', () => {
    const items = [{ artist: 'Soda Stereo', title: 'De Música Ligera', album: 'Canción Animal', duration: 211 }, { artist: '', title: 'Africa', duration: null }]
    expect(parseList(sockseekTxt(items), 'Faltan o suenan mal.txt').entries.map((e) => [e.artist, e.title])).toEqual([['Soda Stereo', 'De Música Ligera'], ['', 'Africa']])
    expect(parseList(sockseekCsv(items), 'Faltan o suenan mal.csv').entries.map((e) => [e.artist, e.title, e.album, e.duration])).toEqual([['Soda Stereo', 'De Música Ligera', 'Canción Animal', 211], ['', 'Africa', null, null]])
    const p = parseList('s:"Virus - Wadu Wadu"   strict-title=true\na:"Soda Stereo - Signos"\nCharly García - Demoliendo Hoteles')
    expect(p.entries.map((e) => `${e.artist} - ${e.title}`)).toEqual(['Virus - Wadu Wadu', 'Charly García - Demoliendo Hoteles'])
    expect(p.skipped).toEqual(['a:"Soda Stereo - Signos"'])
  })
})

describe('leer el avance de sockseek', () => {
  // líneas reales de sockseek 3.0.6 (con --mock-files-dir, sin entrar a Soulseek)
  const OUT = [
    '{"type":"search_start","timestamp":"2026-10-21T02:45:06Z","data":{"artist":"Soda Stereo","title":"De Musica Ligera"}}',
    '{"type":"search_start","timestamp":"2026-10-21T02:45:06Z","data":{"artist":"Los Redondos","title":"Tema Inexistente"}}',
    '{"type":"download_start","timestamp":"2026-10-21T02:45:06Z","data":{"artist":"Soda Stereo","title":"De Musica Ligera","username":"local","filename":"mock\\\\Soda Stereo - De Musica Ligera.mp3","size":8002968,"extension":"mp3"}}',
    '{"type":"download_progress","timestamp":"2026-10-21T02:45:06Z","data":{"jobId":"e9126c7f","bytesTransferred":4001484,"totalBytes":8002968,"percent":50}}',
    '{"type":"track_state","timestamp":"2026-10-21T02:45:06Z","data":{"artist":"Los Redondos","title":"Tema Inexistente","lifecycleState":"Terminal","activityPhase":"None","terminalOutcome":"Failed","skipReason":"None","failureReason":"NoSearchResults","rawResultCount":0,"lockedCount":0}}',
  ]
  it('estado por tema: buscando, bajando con %, no se encontró, bajado, ya estaba; otras líneas al registro', () => {
    const p = new Progress([{ artist: 'Soda Stereo', title: 'De Musica Ligera' }, { artist: 'Los Redondos', title: 'Tema Inexistente' }, { artist: 'Virus', title: 'Wadu Wadu' }])
    for (const l of OUT) p.stdout(l)
    expect(p.tracks.map((t) => [t.state, t.percent])).toEqual([['bajando', 50], ['noEncontrado', null], ['espera', null]])
    expect(p.tracks[1].detail).toMatch(/Nadie lo tiene/)
    p.stdout('{"type":"track_state","data":{"artist":"Soda Stereo","title":"De Musica Ligera","lifecycleState":"Terminal","terminalOutcome":"Succeeded","downloadPath":"C:/x/lista/Soda Stereo - De Musica Ligera.mp3","bitRate":320,"extension":"mp3"}}')
    p.stdout('{"type":"track_state","data":{"artist":"virus","title":"wadu  wadu","lifecycleState":"Terminal","terminalOutcome":"Skipped","skipReason":"AlreadyExists","downloadPath":"C:/x/lista/Virus - Wadu Wadu.mp3"}}')
    p.stdout('  Soda Stereo - De Musica Ligera (200s)')
    expect(p.tracks.map((t) => t.state)).toEqual(['bajado', 'noEncontrado', 'yaEstaba'])
    expect(p.tracks[0].format).toBe('mp3 320 kbps')
    expect(p.counts()).toMatchObject({ bajado: 1, noEncontrado: 1, yaEstaba: 1, espera: 0 })
    expect(p.log).toEqual(['Soda Stereo - De Musica Ligera (200s)'])
  })
  it('falló la bajada ≠ no se encontró; cancelar deja lo que no terminó como cancelado', () => {
    const p = new Progress([{ artist: 'A', title: 'Uno' }, { artist: 'B', title: 'Dos' }, { artist: 'C', title: 'Tres' }])
    p.stdout('{"type":"track_state","data":{"artist":"A","title":"Uno","terminalOutcome":"Failed","failureReason":"AllDownloadsFailed"}}')
    p.stdout('{"type":"search_start","data":{"artist":"B","title":"Dos"}}')
    p.cancelPending()
    expect(p.tracks.map((t) => t.state)).toEqual(['fallo', 'cancelado', 'cancelado'])
    expect(p.tracks[0].detail).toMatch(/no se pudo conectar/)
  })
  it('lo que ya estaba llega solo en track_list (línea real de sockseek 3.0.6, 21/10): no queda "En espera"', () => {
    const p = new Progress([{ artist: 'Led Zeppelin', title: 'Dancing Days' }, { artist: 'La Renga', title: 'Ruta 40' }])
    p.stdout('{"type":"track_list","timestamp":"2026-10-21T22:24:48.1250427Z","data":{"total":2,"pending":1,"existing":1,"notFound":0,"tracks":[{"index":0,"artist":"Led Zeppelin","title":"Dancing Days","lifecycleState":"Terminal","activityPhase":"None","terminalOutcome":"Skipped","skipReason":"AlreadyExists"},{"index":1,"artist":"La Renga","title":"Ruta 40","lifecycleState":"Pending","activityPhase":"None","terminalOutcome":"None","skipReason":"None"}]}}')
    expect(p.tracks.map((t) => t.state)).toEqual(['yaEstaba', 'espera'])
  })
  it('"No se pudo" con el motivo real de sockseek cuando no es uno conocido', () => {
    const p = new Progress([{ artist: 'A', title: 'Uno' }])
    p.stdout('{"type":"track_state","data":{"artist":"A","title":"Uno","terminalOutcome":"Failed","failureReason":"Rarísimo"}}')
    expect(p.tracks[0].detail).toBe('No se pudo bajar (sockseek dice: Rarísimo).')
  })
  it('no se conecta con nadie: muchas conexiones imposibles y nada bajado (no "probá más tarde")', () => {
    const line = '[warn] [003] Failed to establish a direct or indirect transfer connection to ana (190.1.2.3:2234)'
    expect(isEstablishError(line)).toBe(true)
    expect(isEstablishError('[warn] Failed to establish connection to peer pepito: Connection refused')).toBe(false)
    const p = new Progress([{ artist: 'Led Zeppelin', title: 'Dancing Days' }, { artist: 'La Renga', title: 'Ruta 40' }])
    for (let i = 0; i < 3; i++) p.stderr(line)
    expect(p.nadieConecta()).toBe(false) // mientras baja hacen falta más
    p.stdout('{"type":"track_state","data":{"artist":"Led Zeppelin","title":"Dancing Days","terminalOutcome":"Failed","failureReason":"AllDownloadsFailed"}}')
    expect(p.nadieConecta(true)).toBe(true)
    for (let i = 0; i < 6; i++) p.stderr(line)
    expect(p.nadieConecta()).toBe(true)
    // si algo llegó a bajar, el puerto no es el problema
    p.stdout('{"type":"download_start","data":{"artist":"La Renga","title":"Ruta 40","size":5000}}')
    p.stdout('{"type":"download_progress","data":{"totalBytes":5000,"percent":12}}')
    expect(p.nadieConecta(true)).toBe(false)
    // con temas que nadie tiene, no es el puerto
    const q = new Progress([{ artist: 'X', title: 'Y' }])
    for (let i = 0; i < 5; i++) q.stderr(line)
    q.stdout('{"type":"track_state","data":{"artist":"X","title":"Y","terminalOutcome":"Failed","failureReason":"NoSearchResults"}}')
    expect(q.nadieConecta(true)).toBe(false)
  })
  it('el registro: la cuenta, la misma cuenta abierta en otro lado, el resumen; los cortes con otros usuarios no alarman', () => {
    expect(problemOf('[error] [cli] Soulseek login failed: Missing Soulseek username and password. Provide --user and --pass, or configure username/password.')?.kind).toBe('sinCuenta')
    expect(problemOf('Kicked from server.')?.kind).toBe('echado')
    expect(problemOf('[error] [cli] Soulseek login failed: INVALIDPASS')?.kind).toBe('claveMal')
    expect(problemOf('[008] SongJob: failed [No search results]: Los Redondos - Tema Inexistente')).toBeNull()
    expect(isPeerError('[warn] Failed to establish connection to peer pepito: Connection refused')).toBe(true)
    expect(isPeerError('[cli] Soulseek login failed: timed out')).toBe(false)
    const p = new Progress([])
    p.stderr('[warn] Transfer failed: Connection reset by peer'); p.stderr('[cli] Completed: 2 succeeded, 1 failed.')
    expect([p.peerErrors, p.summary, p.problem]).toEqual([1, { ok: 2, failed: 1 }, null])
  })
})

describe('el _index.csv de sockseek y lo que quedó a medias', () => {
  it('estados reales: bajado, no se pudo (9 = nadie lo tiene), ya estaba y pendiente; los .incomplete', () => {
    const dir = path.join(tmp, 'Descargando', '80s Mood')
    fs.mkdirSync(path.join(dir, 'disco'), { recursive: true })
    fs.writeFileSync(path.join(dir, '_index.csv'), 'filepath,artist,album,title,length,tracktype,state,failurereason\n./Soda Stereo - De Musica Ligera.mp3,Soda Stereo,,De Musica Ligera,-1,0,1,0\n,Los Redondos,,Tema Inexistente,-1,0,2,9\n./Virus - Wadu Wadu.mp3,Virus,,Wadu Wadu,-1,0,3,0\n,Benjamin Orr,The Lace,Stay the Night,264,0,0,0\n')
    fs.writeFileSync(path.join(dir, 'disco', 'tema.flac.incomplete'), '')
    expect(parseIndex(fs.readFileSync(path.join(dir, '_index.csv'), 'utf8')).map((r) => [r.state, r.reason, r.path])).toEqual([['bajado', 0, './Soda Stereo - De Musica Ligera.mp3'], ['noSePudo', 9, null], ['yaEstaba', 0, './Virus - Wadu Wadu.mp3'], ['pendiente', 0, null]])
    expect(indexSummary(dir)).toEqual({ file: path.join(dir, '_index.csv'), bajados: 2, noEncontrados: 1, pendientes: 1, aMedias: 1 })
    expect(indexSummary(path.join(tmp, 'nunca'))).toBeNull()
  })
})

describe('la Bandeja de PAILA', () => {
  it('lee la carpeta de la base de PAILA en solo lectura (la portable primero); sin base o sin carpeta, null', () => {
    const appData = path.join(tmp, 'AppData'), portable = path.join(tmp, 'portable')
    fs.mkdirSync(path.join(appData, 'PAILA'), { recursive: true })
    const db = new DatabaseSync(path.join(appData, 'PAILA', 'paila.db'))
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('inbox_dir', 'D:/Soulseek/Completo')"); db.close()
    const files = pailaDbCandidates(appData, portable)
    expect(files[0]).toBe(path.join(portable, 'PAILA-datos', 'paila.db'))
    expect(bandejaFolder(files)).toBe('D:/Soulseek/Completo')
    expect(bandejaFolder(pailaDbCandidates(path.join(tmp, 'otra')))).toBeNull()
  })
})

describe('correr sockseek (uno de mentira)', () => {
  const rows = [{ artist: 'Soda Stereo', title: 'De Musica Ligera', album: null, duration: 211 }, { artist: 'Los Redondos', title: 'Tema Inexistente', album: null, duration: null }, { artist: 'Virus', title: 'Una Falla', album: null, duration: null }]
  const run = (out: string, env: NodeJS.ProcessEnv = {}) => {
    const csv = path.join(tmp, 'listas', 'Prueba.csv')
    fs.mkdirSync(path.dirname(csv), { recursive: true })
    fs.writeFileSync(csv, listCsv(rows, { sacarRemaster: true, primeros: null, saltearTenes: false }))
    let changes = 0
    const r = new SockseekRun({ command: process.execPath, args: [FALSO, ...buildArgs({ csvPath: csv, outputDir: out, options: { calidad: 'buena', sacarRemaster: true, primeros: null, saltearTenes: false } })], env: { ...process.env, ...env } }, rows, () => changes++)
    return { r, changes: () => changes }
  }

  it('avance por tema, el _index.csv, y la segunda vez lo bajado "ya estaba"', async () => {
    const out = path.join(tmp, 'destino')
    const a = run(out)
    expect(await a.r.done).toEqual({ exitCode: 1, cancelled: false })
    expect(a.r.progress.tracks.map((t) => t.state)).toEqual(['bajado', 'noEncontrado', 'fallo'])
    expect(a.r.progress.peerErrors).toBe(2)
    expect(a.r.progress.summary).toEqual({ ok: 1, failed: 2 })
    expect(a.changes()).toBeGreaterThan(5)
    expect(fs.existsSync(path.join(out, 'Prueba', 'Soda Stereo - De Musica Ligera.mp3'))).toBe(true)
    expect(indexSummary(path.join(out, 'Prueba'))).toMatchObject({ bajados: 1, noEncontrados: 2, aMedias: 1 })
    const b = run(out)
    await b.r.done
    expect(b.r.progress.tracks.map((t) => t.state)).toEqual(['yaEstaba', 'noEncontrado', 'fallo'])
  })

  it('sin cuenta: lo dice claro y no queda corriendo', async () => {
    const a = run(path.join(tmp, 'sin-cuenta'), { FALSO_SIN_CUENTA: '1' })
    expect((await a.r.done).exitCode).toBe(1)
    expect(a.r.progress.problem?.kind).toBe('sinCuenta')
  })

  it('sin poder conectarse con nadie: encuentra pero no baja nada, y se reconoce el patrón', async () => {
    const a = run(path.join(tmp, 'puerto-cerrado'), { FALSO_PUERTO_CERRADO: '1' })
    await a.r.done
    expect(a.r.progress.tracks.map((t) => t.state)).toEqual(['fallo', 'noEncontrado', 'fallo'])
    expect(a.r.progress.establishErrors).toBe(6)
    expect(a.r.progress.nadieConecta(true)).toBe(true)
    expect(a.r.progress.counts()).toMatchObject({ bajado: 0, fallo: 2, noEncontrado: 1 })
  })

  it('cancelar corta sockseek y lo que lanzó (no quedan procesos colgados)', async () => {
    const pidFile = path.join(tmp, 'nieto.pid')
    const a = run(path.join(tmp, 'cancelar'), { FALSO_LENTO: '1', FALSO_PID: pidFile })
    for (let i = 0; i < 100 && !(fs.existsSync(pidFile) && a.r.progress.tracks[0].state === 'bajando'); i++) await new Promise((r) => setTimeout(r, 100))
    const nieto = Number(fs.readFileSync(pidFile, 'utf8'))
    const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
    expect(alive(nieto)).toBe(true)
    expect(await a.r.cancel()).toMatchObject({ cancelled: true })
    expect(a.r.progress.tracks.map((t) => t.state)).toEqual(['cancelado', 'cancelado', 'cancelado'])
    for (let i = 0; i < 30 && alive(nieto); i++) await new Promise((r) => setTimeout(r, 100))
    expect(alive(nieto)).toBe(false)
  })
})
