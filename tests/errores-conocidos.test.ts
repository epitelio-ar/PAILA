// Los errores conocidos sin arreglo de docs/PENDIENTES.md (punto 3, revisión del 21/10), uno por test. Los que todavía
// fallan van con it.fails (cuando se arreglen, vitest avisa y pasan a it); los que piden una decisión, con it.todo.
// El ZIP de la Bandeja está en tests/bandeja-vigilada.test.ts (usa su biblioteca con audio analizado). Los que se arreglaron al
// cerrar el masterplan 2 (21/10) quedan como tests comunes.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { checkWritable, hashBefore, readTags, writeTags } from '@paila/core/tagio'
import { analyzeFile, type AnalyzeJob } from '@paila/core/analysis/analyze'
import { countDecodeErrors, endsWithId3v1 } from '@paila/core/analysis/decodeerrors'
import { findFfprobe } from '@paila/core/probe'
import { extensionFix, sniff, suspicious } from '@paila/core/extensions'
import { findDuplicates } from '@paila/core/duplicates'
import { Organizer, DEFAULT_RULE } from '@paila/core/organizer'
import { Replacer } from '@paila/core/replace'
import { Wanted } from '@paila/core/wanted'
import { officialNames } from '@paila/core/official-run'
import { tidy } from '@paila/core/tidy'
import { artistParts, isSeparator, nameList } from '@paila/core/artists'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const ff = (...args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args])
const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `paila-${name}-`))
const names = (a: string) => artistParts(a).filter((p) => !isSeparator(p)).map((p) => p.trim())

describe('"Ella Baila Sola … DEL Records 2023.mp3" (laboratorio)', () => {
  // No es un MP3 con ceros: es un WebM (Opus, bajado de YouTube) con extensión .mp3. Empieza con la marca EBML
  // 1A 45 DF A3 y dice "webm" en el byte 0x18; sniff() no conoce WebM, así que nadie corrige la extensión y la librería
  // de tags busca un cuadro de MPEG que no existe ("MPEG audio header not found").
  let dir: string
  let file: string
  beforeAll(() => {
    dir = tmp('webm')
    file = path.join(dir, 'Ella Baila Sola - (Video Oficial) - Eslabon Armado.mp3')
    ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-f', 'webm', file)
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('el códec ya dice que algo no cuadra', () => {
    expect(fs.readFileSync(file).subarray(0, 4).toString('hex')).toBe('1a45dfa3')
    expect(suspicious('mp3', 'opus')).toBe(true)
  })
  it('se reconoce como WebM y se propone la extensión .webm', () => {
    expect(sniff(file)).toBe('WEBM')
    expect(extensionFix('Musica para acomodar/Ella Baila Sola.mp3', 'WEBM', 'Ella Baila Sola')).toMatchObject({ ext: 'webm', base: null })
  })
})

describe('FLAC con un tag ID3 pegado adelante ("Barbie Girl", "Don\'t Start Now", 22/10)', () => {
  // Es un FLAC de verdad (ffprobe lo lee bien), pero empieza con "ID3": sniff() decía "MP3" y al guardar tags PAILA frenaba
  // con "se llama .flac pero por dentro es MP3". En la Música hay 4 (con ID3v2.3 y v2.4).
  let dir: string, file: string
  const id3 = (title: string, version: 3 | 4) => {
    const text = Buffer.concat([Buffer.from([0]), Buffer.from(title, 'latin1')])
    const frame = Buffer.concat([Buffer.from('TIT2'), Buffer.from([0, 0, 0, text.length, 0, 0]), text])
    const body = Buffer.concat([frame, Buffer.alloc(64)]) // con relleno, como los de verdad
    const n = body.length
    return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, version, 0, 0, (n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]), body])
  }
  beforeAll(() => {
    dir = tmp('flacid3')
    const plain = path.join(dir, 'plain.flac')
    ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-metadata', 'title=Barbie Girl', '-metadata', 'artist=Aqua', plain)
    file = path.join(dir, 'Aqua - Barbie Girl.flac')
    fs.writeFileSync(file, Buffer.concat([id3('Barbie Girl', 3), fs.readFileSync(plain)]))
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('se reconoce como FLAC (no como "MP3 con extensión .flac"), con ID3v2.3 o v2.4 adelante', () => {
    expect(sniff(file)).toBe('FLAC')
    const v4 = path.join(dir, 'v4.flac')
    fs.writeFileSync(v4, Buffer.concat([id3('As It Was', 4), fs.readFileSync(path.join(dir, 'plain.flac'))]))
    expect(sniff(v4)).toBe('FLAC')
    expect(() => checkWritable(file, file)).not.toThrow()
  })
  it('un MP3 con ID3 sigue siendo MP3, y un ID3 con lo que sea después (o nada) también', () => {
    const mp3 = path.join(dir, 'tema.mp3')
    ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-metadata', 'title=Tema', mp3)
    expect(sniff(mp3)).toBe('MP3')
    const raro = path.join(dir, 'raro.mp3')
    fs.writeFileSync(raro, Buffer.concat([id3('Raro', 3), Buffer.alloc(64)]))
    expect(sniff(raro)).toBe('MP3')
    // un ID3 pegado a un WAV (con MP3 adentro, "divididos - nene de antes.mp3"): se le escribe el ID3 de adelante como siempre
    const wav = path.join(dir, 'wav.wav'), hib = path.join(dir, 'nene de antes.mp3')
    ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wav)
    fs.writeFileSync(hib, Buffer.concat([id3('Nene de antes', 3), fs.readFileSync(wav)]))
    expect(sniff(hib)).toBe('MP3')
  })
  it('se le escriben tags (en el FLAC y en el ID3) y el sonido queda idéntico', async () => {
    const before = await hashBefore(ffmpeg, file)
    writeTags(file, { title: 'Barbie Girl (Radio Edit)' })
    expect(readTags(file).title).toBe('Barbie Girl (Radio Edit)')
    expect(sniff(file)).toBe('FLAC')
    expect(await hashBefore(ffmpeg, file)).toBe(before)
  })
})

describe('FLAC con el tag viejo de MP3 (ID3v1) al final: no está dañado (Barbie Girl y los otros 3, 22/10)', () => {
  // El decodificador lee los 128 bytes del tag como si fueran audio y tropieza justo al terminar ("invalid sync code"):
  // 4 errores, y la nota decía "F, dañado" aunque el tema está entero.
  let dir: string, sano: string, roto: string
  const tag = Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125, 0x20)])
  beforeAll(() => {
    dir = tmp('flacv1')
    const plain = path.join(dir, 'plain.flac')
    ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-ac', '2', plain)
    sano = path.join(dir, 'sano.flac')
    fs.writeFileSync(sano, Buffer.concat([fs.readFileSync(plain), tag]))
    // roto de verdad: basura en el medio del audio, y además el tag al final
    const b = Buffer.from(fs.readFileSync(plain))
    for (let i = Math.floor(b.length * 0.4); i < Math.floor(b.length * 0.4) + 4000; i++) b[i] = (i * 37) & 0xff
    roto = path.join(dir, 'roto.flac')
    fs.writeFileSync(roto, Buffer.concat([b, tag]))
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('el error del final por el tag no cuenta', async () => {
    expect(endsWithId3v1(sano)).toBe(true)
    expect((await analyzeFile({ ffmpeg, file: sano, channels: 2, withPrints: false } as AnalyzeJob)).decodeErrors).toBe(0)
  })
  it('un FLAC roto de verdad sigue con errores aunque tenga el tag', async () => {
    expect((await analyzeFile({ ffmpeg, file: roto, channels: 2, withPrints: false } as AnalyzeJob)).decodeErrors).toBeGreaterThan(0)
  })
  it('en un MP3 el tag del final es normal y no se descuenta nada', () => {
    const stderr = '[mp3 @ 0] invalid frame header\n[aist#0:0/mp3 @ 0] Decoding error: Invalid data found'
    expect(countDecodeErrors(stderr, path.join(dir, 'x.mp3'))).toBe(1) // un tropiezo (antes se contaban 3 palabras)
    expect(countDecodeErrors(stderr, sano)).toBe(0)
  })
  it('con el ffmpeg 6.0 (el de Mac), que lo dice "Error while decoding stream", tampoco cuenta (visto en GitHub, 23/10)', () => {
    const stderr = '[flac @ 0x1] invalid sync code\n[flac @ 0x1] invalid frame header\n[flac @ 0x1] decode_frame() failed\nError while decoding stream #0:0: Invalid data found when processing input'
    expect(countDecodeErrors(stderr, sano)).toBe(0)
    // un tropiezo de antes en el medio sí cuenta
    expect(countDecodeErrors(`[flac @ 0x1] invalid sync code\nError while decoding stream #0:0: Invalid data found when processing input\n${stderr}`, sano)).toBe(1)
  })
})

describe('Organizar → reemplazar ese tema → Deshacer la tanda de Organizar', () => {
  let dir: string, lib: Library, org: Organizer, rep: Replacer
  const rootOf = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
  const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
  beforeAll(async () => {
    dir = tmp('orgrep')
    fs.mkdirSync(M('Descargas'), { recursive: true })
    ff('-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-b:a', '96k', '-metadata', 'artist=Fulano', '-metadata', 'title=Tema', M('Descargas/tema.mp3'))
    fs.mkdirSync(path.join(dir, 'Bajado'))
    ff('-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', path.join(dir, 'Bajado/tema.flac'))
    lib = new Library(path.join(dir, 'paila.db'), ffprobe)
    await lib.addRoot(M(''), [{ rel: '', kind: 'musica' }])
    await lib.scan()
    org = new Organizer(lib.db, rootOf)
    rep = new Replacer(lib.db, rootOf, ffprobe, ffmpeg)
  })
  afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('el deshacer sigue al tema a su nombre de hoy (.flac) en vez de decir "El archivo ya no está"', async () => {
    const r = await org.apply(org.plan({ rule: DEFAULT_RULE, dest: '' }))
    expect(r.moved).toBe(1)
    const id = (lib.db.prepare("SELECT id FROM files WHERE rel_path = 'Fulano/Tema.mp3'").get() as { id: number }).id
    await rep.replace(id, path.join(dir, 'Bajado/tema.flac'), { keepTags: true, keepCover: false, sameName: true })
    expect(fs.existsSync(M('Fulano/Tema.flac'))).toBe(true)
    const u = await org.undo(r.batchId!)
    expect(u.failed).toEqual([]) // antes: [{ rel: 'Fulano/Tema.mp3', error: 'El archivo ya no está' }]
    expect(fs.existsSync(M('Descargas/tema.flac'))).toBe(true)
    expect(fs.existsSync(M('Fulano'))).toBe(false)
    expect(lib.db.prepare('SELECT rel_path AS rel FROM files WHERE id = ?').get(id)).toEqual({ rel: 'Descargas/tema.flac' })
    await lib.scan() // la base y el disco coinciden
    expect(lib.db.prepare('SELECT COUNT(*) AS n FROM files WHERE missing_at IS NOT NULL').get()).toEqual({ n: 0 })
  })
  it('si el tema cambió de lugar después (no solo de extensión), queda donde está y lo dice', async () => {
    const r = await org.apply(org.plan({ rule: DEFAULT_RULE, dest: '' }))
    const id = (lib.db.prepare("SELECT id FROM files WHERE rel_path = 'Fulano/Tema.flac'").get() as { id: number }).id
    fs.mkdirSync(M('Otra'))
    fs.renameSync(M('Fulano/Tema.flac'), M('Otra/Tema.flac'))
    lib.db.prepare("UPDATE files SET rel_path = 'Otra/Tema.flac' WHERE id = ?").run(id)
    expect((await org.undo(r.batchId!)).failed).toEqual([{ rel: 'Fulano/Tema.flac', error: expect.stringMatching(/queda donde está/) }])
    expect(fs.existsSync(M('Otra/Tema.flac'))).toBe(true)
  })
})

describe('Duplicados', () => {
  let dir: string, lib: Library
  beforeAll(async () => {
    dir = tmp('dups')
    fs.mkdirSync(path.join(dir, 'M'))
    lib = new Library(path.join(dir, 'paila.db'), null)
    const root = await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
    const ins = lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, duration, artist, title, probed_at) VALUES (?, ?, ?, 1, 'musica', ?, ?, ?, ?, '2026-10-21')")
    // los dos de la biblioteca real (corpus.json): el FLAC dura 3,4 s más que el MP3 de slider.kz; sin huella todavía
    ins.run(root.id, 'Fiestas/set diciembre/Madonna - Music.flac', 30_000_000, 'flac', 225.6, 'Madonna', 'Music')
    ins.run(root.id, 'pendrive/80s90s/Madonna - Music [www.slider.kz].mp3', 9_036_443, 'mp3', 222.2, 'Madonna', 'Music')
  })
  afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('Madonna MP3/FLAC: 3,4 s de diferencia por nombre (el margen es ±3 s; por sonido ya entra hasta 2 %)', async () => {
    const groups = await findDuplicates(lib.db, () => null)
    expect(groups.filter((g) => g.level !== 'version').map((g) => g.items.length)).toEqual([2])
  })
  // Los límites de la corrida del 20/10 (docs/archivo/pruebas/2026-10-20-duplicados.md) se arreglaron el 23/10 (4A.3): sus
  // tests están en tests/duplicados-pedazos.test.ts. Queda uno que la huella acústica no puede resolver:
  it.todo('un loop sin una sola nota (solo bombo y hi-hat) en peor calidad: la huella lo ve igual a cualquier otro loop de bombo; haría falta otra huella (energía por bandas)')

})


describe('Faltan o suenan mal: títulos "Título - Artista"', () => {
  let dir: string, lib: Library
  beforeAll(async () => {
    dir = tmp('wanted')
    fs.mkdirSync(path.join(dir, 'M'))
    lib = new Library(path.join(dir, 'paila.db'), null)
    const root = await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
    lib.db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, duration, artist, title, probed_at) VALUES (1, ?, 'Bajados/Bien Alto - La Renga.mp3', 1, 1, 'musica', 'mp3', 200, 'Varios', 'Bien Alto - La Renga', '2026-10-21')").run(root.id)
  })
  afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('sin el nombre oficial, el .csv sale al revés (artista "Bien Alto")', () => {
    expect(new Wanted(lib.db).names([1]).get(1)).toEqual({ artist: 'Bien Alto', title: 'La Renga' })
  })
  it('con el nombre oficial (Fase C) sale bien: el núcleo ya lo sabe usar', () => {
    const w = new Wanted(lib.db, () => ({ artist: 'La Renga', title: 'Bien Alto' }))
    expect(w.names([1]).get(1)).toEqual({ artist: 'La Renga', title: 'Bien Alto' })
  })
  it('la app crea la lista «Faltan o suenan mal» con el nombre oficial (apps/paila/electron/context.ts)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../apps/paila/electron/context.ts'), 'utf8')
    expect(src).toMatch(/new Wanted\(lib\.db, officialNames\(lib\.db\)\)/)
  })
  it('sin nada buscado en internet, el nombre oficial no inventa nada (y no corre el asistente)', () => {
    expect(officialNames(lib.db)(1)).toBeNull()
  })
})

describe('Arreglar nombres: títulos que repiten el artista y títulos cortados en 30 letras', () => {
  let dir: string, lib: Library
  const tone = (rel: string, meta: Record<string, string>) => {
    const out = path.join(dir, 'M', ...rel.split('/'))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out)
  }
  const to = (end: string, field: string) => tidy(lib.db).changes.find((c) => c.rel.endsWith(end) && c.field === field)?.to
  beforeAll(async () => {
    dir = tmp('tidy30')
    // los dos de Llevar la música (docs/archivo/pruebas/2026-10-20-llevar.md): el título del tag repite el artista
    tone('Cambalache/Chaka Khan/Chaka Khan - Chaka Khan - Like Sugar.mp3', { artist: 'Chaka Khan', title: 'Chaka Khan - Like Sugar' })
    tone('pop/The Weekend - The Weekend - Blinding Lights.mp3', { artist: 'The Weekend', title: 'The Weekend - Blinding Lights' })
    // tag viejo cortado en 30 letras, con el título entero en el nombre del archivo (La Renga, Arreglar nombres del 20/10)
    tone('Rock/La Renga/La Renga - Voy A Bailar A La Nave Del Olvido.mp3', { artist: 'La Renga', title: 'Voy A Bailar A La Nave Del Olv' })
    // corrida supervisada del 22/10: el corte cayó en la extensión del nombre del archivo
    tone('Rock/Redondos/09-nuestro amo juega al esclavo155.mp3', { artist: 'Los Redondos', title: 'Nuestro amo juega al esclavo.m' })
    // el n.º de tema pegado adelante del título (~40 en la Música), y los que empiezan con un número de verdad
    tone('Rock/No Te Va Gustar/05- el mismo canal.mp3', { artist: 'No te va gustar', title: '05- El mismo canal' })
    tone('Rock/Las Pastillas del Abuelo/donde esconder tantas manos.mp3', { artist: 'Las Pastillas del Abuelo', title: '07 Donde esconder tantas manos', track: '7/13' })
    tone('Rock/Guns N Roses/02 14 Years.mp3', { artist: "Guns N' Roses", title: '14 Years', track: '2' })
    tone('Pop/Ariana Grande - 7 rings.mp3', { artist: 'Ariana Grande', title: '7 rings' })
    tone('Pop/Lali - 1 amor.mp3', { artist: 'Lali', title: '1 amor - Lali' })
    // el disco de Luca Prodan con "Track01"… como artista; "Salta La Banca - 12. El Relato"; y dos que no se tocan
    tone('Rock/Luca Prodan/PERDEDORES HERMOSOS - LUCA PRODAN/Track01 - perdedores hermosos.mp3', { artist: 'Track01', title: 'Track01 - perdedores hermosos' })
    tone('Rock/Luca Prodan/PERDEDORES HERMOSOS - LUCA PRODAN/Track06 - Billy.mp3', { artist: 'Track06', title: 'Track06 - Billy' })
    tone('Rock/Sueltos/Track03 - Algo.mp3', { artist: 'Track03', title: 'Track03 - Algo' })
    tone('Rock/Salta La Banca - 12. El Relato (Visceral 2013).mp3', { artist: 'Salta La Banca', title: 'Salta La Banca - 12. El Relato (Visceral 2013)' })
    tone('Techno/Closed I - 91-DIVOC [V1].mp3', { artist: 'Closed I', title: '91-DIVOC [V1]' })
    tone('Rock/No Te Va Gustar/no te va gustar - 10 fueron.mp3', { artist: 'no te va gustar', title: '10 fueron' })
    // visto en la app (22/10): en una carpeta con "017 - Queen…" y "04 - SOY CORDOBES", "1 amor - Lali" perdía el "1"
    tone('Set/1 amor - Lali (Lyrics video).mp3', { artist: 'Lali', title: '1 amor - Lali' })
    tone('Set/017 - Queen - Bohemian Rhapsody.mp3', { artist: 'Various Artists', title: '017 - Queen - Bohemian Rhapsody' })
    tone('Set/Rodrigo - Soy Cordobes.mp3', { artist: 'Rodrigo', title: '04 - SOY CORDOBES', track: '4' })
    tone('Rap/Funk Experience/01 Viva El Funk.mp3', { artist: 'R De Rumba & Porcel', title: '01 Viva El Funk' })
    tone('Rap/Funk Experience/05 Sed The Funk.mp3', { artist: 'R De Rumba & Porcel', title: '05 Sed The Funk' })
    tone('Rap/Funk Experience/10 Ella No Vea La Tele.mp3', { artist: 'R De Rumba & Porcel', title: '10 Ella No Vea La Tele' })
    lib = new Library(path.join(dir, 'paila.db'), ffprobe)
    await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
    await lib.scan()
  })
  afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('el asistente saca el artista repetido del título (ya resuelto: lo que quedó mal en el celular venía de tags sin arreglar)', () => {
    expect(to('Chaka Khan - Like Sugar.mp3', 'title')).toBe('Like Sugar')
    expect(to('The Weekend - Blinding Lights.mp3', 'title')).toBe('Blinding Lights')
  })
  it('sin internet, un título de 30 letras se completa con el nombre del archivo que lo trae entero', () => {
    expect(to('Nave Del Olvido.mp3', 'title')).toBe('Voy A Bailar A La Nave Del Olvido')
  })
  it('un título de 30 letras que arrastra un pedazo de la extensión (".m") se corta antes del punto', () => {
    expect(to('esclavo155.mp3', 'title')).toBe('Nuestro amo juega al esclavo')
  })
  it('el n.º de tema pegado adelante del título se saca (con cero o un signo, y si coincide con el tema o el nombre del archivo)', () => {
    expect(to('05- el mismo canal.mp3', 'title')).toBe('El mismo canal')
    expect(to('donde esconder tantas manos.mp3', 'title')).toBe('Donde esconder tantas manos')
    expect(to('01 Viva El Funk.mp3', 'title')).toBe('Viva El Funk')
    expect(to('10 Ella No Vea La Tele.mp3', 'title')).toBe('Ella No Vea La Tele') // sin cero, pero sus hermanos de carpeta sí
  })
  it('los títulos que empiezan con un número de verdad quedan como están', () => {
    expect(to('02 14 Years.mp3', 'title')).toBeUndefined() // tema 2
    expect(to('7 rings.mp3', 'title')).toBeUndefined()
    expect(to('Lali - 1 amor.mp3', 'title')).not.toMatch(/^amor/)
    expect(to('1 amor - Lali (Lyrics video).mp3', 'title')).not.toMatch(/^amor/)
    expect(to('Soy Cordobes.mp3', 'title')).toBe('SOY CORDOBES')
    expect(to('91-DIVOC [V1].mp3', 'title')).toBeUndefined()
    expect(to('no te va gustar - 10 fueron.mp3', 'title')).not.toBe('fueron')
  })
  it('después del artista repetido: "Salta La Banca - 12. El Relato" → "El Relato"', () => {
    expect(to('Salta La Banca - 12. El Relato (Visceral 2013).mp3', 'title')).toBe('El Relato (Visceral 2013)')
  })
  it('"Track01" como artista es el n.º de tema: el artista sale de la carpeta del disco, y el título y el n.º del nombre', () => {
    expect(to('Track01 - perdedores hermosos.mp3', 'artist')).toBe('Luca Prodan')
    expect(to('Track01 - perdedores hermosos.mp3', 'title')).toBe('perdedores hermosos')
    expect(to('Track01 - perdedores hermosos.mp3', 'track')).toBe('1')
    expect(to('Track06 - Billy.mp3', 'artist')).toBe('Luca Prodan')
    // sin una carpeta que lo diga, no se inventa: queda para mirar a mano ("Rock" es un género)
    expect(to('Sueltos/Track03 - Algo.mp3', 'artist')).toBeUndefined()
    expect(tidy(lib.db).review.find((r) => r.rel.endsWith('Track03 - Algo.mp3') && r.field === 'artist')?.why).toMatch(/n\.º de tema/)
  })
})

describe('artistas con ";" o " x "', () => {
  it('" x " y "y" ya separan en la lista de nombres sueltos (nameList)', () => {
    expect(nameList('Bizarrap x Quevedo')).toEqual(['Bizarrap', 'Quevedo'])
  })
  it('";" separa en nameList (los tags de Windows Media y de muchas descargas juntan así)', () => {
    expect(nameList('Bizarrap; Quevedo')).toEqual(['Bizarrap', 'Quevedo'])
  })
  it('artistParts (diccionario, nombres oficiales, mayúsculas) separa ";" y " x " como "," y "&"', () => {
    expect(names('Bizarrap; Quevedo')).toEqual(['Bizarrap', 'Quevedo'])
    expect(names('Bizarrap x Quevedo')).toEqual(['Bizarrap', 'Quevedo'])
  })
  it('"Malcolm X" y "X Ambassadors" no se parten', () => {
    expect(names('Malcolm X')).toEqual(['Malcolm X'])
    expect(nameList('X Ambassadors')).toEqual(['X Ambassadors'])
  })
})

describe('otros de PENDIENTES (necesitan audio real o la interfaz)', () => {
  it.todo('rock en vivo con tempo variable: el BPM sale mal (necesita un caso del laboratorio y la decisión de mostrar "tempo variable")')
})
