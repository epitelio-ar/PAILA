// Lo que encontró la corrida supervisada de Ordenar sobre la Música real (13/11/2026, bitácora
// docs/pruebas/ordenar-supervisada-2026-11-13.md): un test por cada error, con los casos reales achicados. Están marcados `it.fails`
// (el error está hoy: el test pasa porque falla) o `it.todo` (decisión de gusto o arreglo más grande). Quien arregle uno saca el
// `.fails` y el test tiene que pasar derecho. Sin archivos de verdad: la base sola (Organizar y Ordenar solo leen tags).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { Organizer } from '@paila/core/organizer'
import { Changes } from '@paila/core/changes'
import { guardarRepetidos } from '@paila/core/repetidos-guardados'
import { armarCarpetas, delNombre, elegirCarpetas, movesDeEjemplo } from '@paila/core/revision-armar'
import { elegirEjemplos } from '../apps/paila/ui/src/ordenarRegla'
import { leerRevision } from '@paila/core/revision'
import { propuestas } from '@paila/core/propuestas'
import { tidy } from '@paila/core/tidy'
import { formaDeLaBiblioteca, REGLA_ORDENAR } from '@paila/core/forma-actual'
import { Rekordbox } from '@paila/core/rekordbox'
import { Playlists } from '@paila/core/playlists'
import { UNSUPPORTED } from '@paila/core/djexport'
import type { DupGroup, DupItem } from '@paila/shared/types'

const FABRICA = { rule: '%artista%/%año% - %album%/%n% - %titulo%', dest: 'Biblioteca' } // idioma-ok: la regla de fábrica
const POR_GENERO = { rule: '%genero%/%artista%/%n% - %titulo%', dest: 'Biblioteca' } // idioma-ok: la forma por género

interface Tema { rel: string; artist?: string; albumArtist?: string; title?: string; album?: string; year?: string; track?: string; genre?: string; duration?: number; codec?: string }
let dir = '', db: Db | null = null
afterEach(() => { db?.close(); db = null; if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = '' })

function base(temas: Tema[]) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-ordenar-sup-'))
  fs.mkdirSync(path.join(dir, 'M'))
  const d = openDb(path.join(dir, 'paila.db'))
  db = d
  d.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', ?)").run(dir)
  d.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
  const ins = d.prepare(`INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, album_artist, title, album, year, track, genre, duration, codec)
    VALUES (1, ?, 1000, 1, 'musica', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const ids = temas.map((t) => Number(ins.run(t.rel, path.extname(t.rel).slice(1), t.artist ?? null, t.albumArtist ?? null, t.title ?? null, t.album ?? null,
    t.year ?? null, t.track ?? null, t.genre ?? null, t.duration ?? 200, t.codec ?? null).lastInsertRowid))
  const organizer = new Organizer(d, () => path.join(dir, 'M'))
  const changes = new Changes(d, () => null, 'ffmpeg-no-se-usa', path.join(dir, 'resguardo'))
  const destino = (id: number, regla = FABRICA) => organizer.plan(regla, true).moves.find((m) => m.fileId === id)?.to ?? null
  return { db: d, ids, organizer, changes, destino }
}
const item = (id: number, rel: string): DupItem => ({ id, rel, ext: 'mp3', size: 1, kbps: 320, duration: 200, grade: 'B', kind: 'musica' } as DupItem)
const probable = (items: DupItem[], keep: number): DupGroup =>
  ({ level: 'probable', label: 'probable', why: 'mismos artista, título y duración', items, keep, similarity: null, warning: null, decidir: true })

describe('corrida supervisada de Ordenar (13/11): carpetas', () => {
  // Almafuerte, "Toro y Pampa": un tema con año "0001" y otro con 2006; empatan y gana el más viejo, el roto (organizer.ts:196-202)
  it('un año imposible ("0001") no arma la carpeta del disco: gana el año de verdad', () => {
    const b = base([
      { rel: 'Biblioteca/Almafuerte/Toro y Pampa.flac', artist: 'Almafuerte', album: 'Toro y pampa', year: '0001', track: '9', title: 'Toro y Pampa' },
      { rel: 'Biblioteca/Almafuerte/Unas Estrofas Más.mp3', artist: 'Almafuerte', album: 'Toro y Pampa', year: '2006', track: '4', title: 'Unas Estrofas Más' },
    ])
    expect(b.destino(b.ids[0])).toBe('Biblioteca/Almafuerte/2006 - Toro y Pampa/09 - Toro y Pampa.flac')
  })

  // Mihai Pol y Thomas Wood: pistas de vinilo "A1", "B2" → parseInt da NaN y queda "00 - " (organizer.ts:107)
  it('una pista de vinilo ("A1", "B2") no queda "00 - "', () => {
    const b = base([
      { rel: 'Biblioteca/Mihai Pol/x/Anomaly.aiff', artist: 'Mihai Pol', album: 'ORIGINAL SERIES 01', year: '2019', track: 'A1', title: 'Anomaly' },
      { rel: 'Biblioteca/Mihai Pol/x/London.aiff', artist: 'Mihai Pol', album: 'ORIGINAL SERIES 01', year: '2019', track: 'B1', title: 'London' },
    ])
    const to = b.destino(b.ids[0])
    expect(to).not.toMatch(/\/00 - /)
    expect(to).toMatch(/\/(A1 - )?Anomaly\.aiff$/)
  })

  // "Pibes Chorros" (15) y "Los Pibes Chorros" (1); "La Mancha de Rolando" (22) y "Mancha De Rolando" (1): dos carpetas para el mismo
  // artista. La clave de la carpeta (duoKey, organizer-names.ts:13, usada en organizer.ts:155) no saca el artículo del principio.
  // decisión de gusto (el autor, 13/11): juntar artistas partidos no se hace solo; queda para preguntarle al autor
  it.todo('"Los Pibes Chorros" y "Pibes Chorros" van a una sola carpeta (la forma más usada): de gusto, no automático')

  // "Live: Era '87-'93", "El Cartel: The Big Boss", "David Firman: Royal Philharmonic Orchestra…": el ":" pasa a "_" (cleanName,
  // organizer.ts:46). Propuesta: ": " → " - " (y "/" entre dos nombres, el primero)
  it('los dos puntos de un disco no quedan como "_" en la carpeta', () => {
    const b = base([
      { rel: 'x/Nightrain.mp3', artist: "Guns N' Roses", album: "Live: Era '87-'93", year: '1999', track: '1', title: 'Nightrain' },
      { rel: 'x/Patience.mp3', artist: "Guns N' Roses", album: "Live: Era '87-'93", year: '1999', track: '9', title: 'Patience' },
    ])
    expect(b.destino(b.ids[0])).not.toContain('_')
    expect(b.destino(b.ids[0])).toBe("Biblioteca/Guns N' Roses/1999 - Live - Era '87-'93/01 - Nightrain.mp3")
  })
  it('el "?" del final de un disco se va de la carpeta (no queda "GO_"); el nombre del archivo no cambia', () => {
    const b = base([
      { rel: 'x/bad guy.mp3', artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?', year: '2019', track: '2', title: 'bad guy' },
      { rel: 'x/xanny.mp3', artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?', year: '2019', track: '3', title: 'xanny?' },
    ])
    expect(b.destino(b.ids[0])).toBe('Biblioteca/Billie Eilish/2019 - WHEN WE ALL FALL ASLEEP, WHERE DO WE GO/02 - bad guy.mp3')
    expect(b.destino(b.ids[1])).toMatch(/\/03 - xanny_\.mp3$/)
  })

  // por género: 140 temas en carpetas como "Electronic, Latin, Pop" o "Cubano_Hip Hop_Latin_Trap_…", y "http___vk.com_usuario"
  // de carpeta (organizer.ts:109 usa el tag entero, sin isSite ni el primer género)
  it('por género: un tag con varios géneros usa el primero, y una página no es un género', () => {
    const b = base([
      { rel: 'x/a.mp3', artist: 'Alguien', title: 'A', genre: 'Electronic, Latin, Pop' },
      { rel: 'x/b.mp3', artist: 'Otro', title: 'B', genre: 'http___vk.com_usuario' },
    ])
    expect(b.destino(b.ids[0], POR_GENERO)).toBe('Biblioteca/Electronic/Alguien/A.mp3')
    expect(b.destino(b.ids[1], POR_GENERO)).toBe('Biblioteca/Sin género/Otro/B.mp3')
  })

  it.todo('por género: "Cumbia"/"CUMBIA", "Hip Hop"/"Hip-Hop", "Synth Pop"/"Synthpop" van a una sola carpeta (hoy 13 pares)')
  // la Biblioteca se ordenó en octubre con disco y año, sin n.º: la de fábrica (con n.º) renombraba 948 temas ya ordenados
  it('la primera vez, la forma que ofrece Ordenar sale de cómo ya está la Biblioteca (948 temas se renombraban para sumar el n.º)', () => {
    const temas: Tema[] = []
    for (let i = 0; i < 21; i++) for (const t of ['Uno', 'Dos']) temas.push({ rel: `Biblioteca/Banda ${i}/${2000 + i} - Disco ${i}/${t}.mp3`, artist: `Banda ${i}`, album: `Disco ${i}`, year: String(2000 + i), track: t === 'Uno' ? '1' : '2', title: t })
    temas.push({ rel: 'Descargas/suelto.mp3', artist: 'Otra', title: 'Suelto' })
    const b = base(temas)
    const forma = { rule: '%artista%/%año% - %album%/%titulo%', dest: 'Biblioteca' } // idioma-ok: la regla
    expect(formaDeLaBiblioteca(b.db)).toEqual(forma)
    const r = leerRevision(b.db, b.changes, b.organizer)
    expect(r.carpetas).toBeNull()
    expect([r.formaHoy, r.regla]).toEqual([forma, forma])
    // con esa forma no se renombra lo que ya está ordenado
    elegirCarpetas({ db: b.db, organizer: b.organizer }, forma)
    expect(propuestas(b.db, 'mover').map((p) => p.rel)).toEqual(['Descargas/suelto.mp3'])
  })
  it('con pocos discos ordenados no hay una forma clara: queda la de fábrica', () => {
    const b = base([{ rel: 'Biblioteca/A/2001 - D/x.mp3', artist: 'A', album: 'D', year: '2001', title: 'x' }])
    expect(formaDeLaBiblioteca(b.db)).toBeNull()
    // la de entrada de Ordenar: disco con año y sin número (el autor, 13/11)
    expect(leerRevision(b.db, b.changes, b.organizer).regla).toEqual(REGLA_ORDENAR)
  })
  // El autor, 13/11: todos sin número. Con la forma de entrada (sin %n%) los 30 discos mezclados quedan todos sin número
  it('un disco con temas con y sin n.º de pista queda todo sin número con la forma de entrada (el autor, 13/11)', () => {
    const b = base([
      { rel: 'Biblioteca/La Renga/1994 - A dónde me lleva la vida/01 - Blues de Bolivia.mp3', artist: 'La Renga', album: 'A dónde me lleva la vida', year: '1994', track: '1', title: 'Blues de Bolivia' },
      { rel: 'Biblioteca/La Renga/1994 - A dónde me lleva la vida/El terco.mp3', artist: 'La Renga', album: 'A dónde me lleva la vida', year: '1994', title: 'El terco' },
    ])
    expect(b.destino(b.ids[0], REGLA_ORDENAR)).toBe('Biblioteca/La Renga/1994 - A dónde me lleva la vida/Blues de Bolivia.mp3')
    expect(b.destino(b.ids[1], REGLA_ORDENAR)).toBeNull() // ya está donde va
  })
  it.todo('un tema sin n.º de pista en los datos: PAILA propone completarlo desde MusicBrainz en "De internet" (hoy MusicBrainz solo completa disco, año y género)')
  it.todo('un tema solo en la carpeta de su disco por un nombre apenas distinto ("Insoportablemente Vivo" / "En Vivo") no se saca a la del artista')
})

describe('corrida supervisada de Ordenar (13/11): repetidos sin decidir', () => {
  // OUKE, Smooth Criminal, Karma Chameleon, Bang Bang… 13 de los 23 temas que cambiaban de carpeta eran la copia de una carta "¿Son el
  // mismo?" sin contestar: armaban un disco de dos con el mismo tema, o un disco de un tema para no chocar (armarCarpetas,
  // revision-armar.ts:56-64, no mira las cartas par pendientes)
  it('la copia de un repetido sin decidir no se mueve hasta contestar la carta', () => {
    const b = base([
      { rel: 'Biblioteca/CA7RIEL & Paco Amoroso/OUKE.mp3', artist: 'CA7RIEL & Paco Amoroso', album: 'OUKE', year: '2019', track: '1', title: 'OUKE' },
      { rel: 'Descargas/Ca7riel & Paco Amoroso - OUKE.mp3', artist: 'Ca7riel & Paco Amoroso', album: 'OUKE', year: '2019', title: 'OUKE' },
    ])
    const [orig, copia] = b.ids
    guardarRepetidos(b.db, [probable([item(orig, 'Biblioteca/CA7RIEL & Paco Amoroso/OUKE.mp3'), item(copia, 'Descargas/Ca7riel & Paco Amoroso - OUKE.mp3')], orig)])
    elegirCarpetas({ db: b.db, organizer: b.organizer }, FABRICA)
    const mueve = propuestas(b.db, 'mover').map((p) => p.fileId)
    expect(mueve).not.toContain(copia)
    // y el original no arma "2019 - OUKE/" porque la copia cuenta como segundo tema del disco
    expect(propuestas(b.db, 'mover').find((p) => p.fileId === orig)?.despues ?? null).toBeNull()
  })

  // Lola, Semen-Up, Vamos las bandas, Es La Que Va: la misma pareja aparece como "¿Son el mismo?" y como "Irían al mismo lugar"
  it('una pareja que ya es carta "par" no aparece también como "choque"', () => {
    const b = base([
      { rel: 'Biblioteca/Wanakin/Lola.mp3', artist: 'Wanakin', title: 'Lola', duration: 170 },
      { rel: 'Chengue y Trap/Wanakin - Lola.mp3', artist: 'Wanakin', title: 'Lola', duration: 175 },
    ])
    const [orig, copia] = b.ids
    guardarRepetidos(b.db, [probable([item(orig, 'Biblioteca/Wanakin/Lola.mp3'), item(copia, 'Chengue y Trap/Wanakin - Lola.mp3')], orig)])
    elegirCarpetas({ db: b.db, organizer: b.organizer }, FABRICA)
    const r = leerRevision(b.db, b.changes, b.organizer)
    expect(r.decidir.filter((c) => c.tipo === 'par')).toHaveLength(1)
    expect(r.decidir.filter((c) => c.tipo === 'choque')).toEqual([])
  })
})

describe('corrida supervisada de Ordenar (13/11): "¿De quién es?"', () => {
  // "Unknown Artist - A1 I Wish VINYL ONLY [FLIP].aiff" y "Rusherking LOBA.mp3" (artista "y2mate.com"): Organizar los saltea por
  // "le faltan tags" (usable/isSite), pero la carta pregunta solo por el tag vacío (revision.ts:74-83). Quedan trabados sin pregunta.
  it('un tema con artista "Unknown Artist" o una página de descarga tiene su carta "¿De quién es?"', () => {
    const b = base([
      { rel: 'Electronica/House/Unknown Artist - A1 I Wish VINYL ONLY  [FLIP].aiff', artist: 'Unknown Artist', title: 'I Wish' },
      { rel: 'Chengue y Trap/Rusherking LOBA.mp3', artist: 'y2mate.com', title: 'Rusherking LOBA' },
    ])
    elegirCarpetas({ db: b.db, organizer: b.organizer }, FABRICA)
    const quien = leerRevision(b.db, b.changes, b.organizer).decidir.filter((c) => c.tipo === 'quien').map((c) => (c as { fileId: number }).fileId)
    expect(quien.sort()).toEqual([...b.ids].sort())
  })

  // "Track11" de El Bordo y "Pista 12": el título es un "no sé"; el tema se ordena con ese nombre y nadie pregunta
  it('un título "Track11" o "Pista 12" pide la carta "¿De quién es?"', () => {
    const b = base([{ rel: 'Biblioteca/El Bordo/2002 - Carnaval de las heridas/Track11.mp3', artist: 'El Bordo', album: 'Carnaval de las heridas', year: '2002', track: '11', title: 'Track11' }])
    elegirCarpetas({ db: b.db, organizer: b.organizer }, FABRICA)
    expect(leerRevision(b.db, b.changes, b.organizer).decidir.some((c) => c.tipo === 'quien')).toBe(true)
  })

  // "100 BPM - Que Te Vaya Bien (Remix) Callejero Fino.mp3" → sugería artista "100 BPM" (delNombre, revision-armar.ts:127-131)
  it('la sugerencia no toma el BPM como artista', () => {
    expect(delNombre('DISCO CUMPLE/Chengue/100 BPM - Que Te Vaya Bien (Remix) Callejero Fino.mp3')?.artista).not.toBe('100 BPM')
  })

  // "3 Nathy Peluso   Vivir Así Es Morir De Amor   Karaoke Instrumenta.mp3": los espacios triples marcan un " - " que Windows no dejó
  it('la sugerencia lee los espacios triples como separador', () => {
    expect(delNombre('X/3 Nathy Peluso   Vivir Así Es Morir De Amor   Karaoke Instrumenta.mp3')?.artista).toBe('Nathy Peluso')
  })

  it('los stems de otro programa ("VOCALS_130BPM_CMajor_DEM4_….mp3") no son temas para preguntar de quién son', () => {
    const b = base([
      { rel: 'VOCALS_130BPM_CMajor_DEM4_charly_garc_a___yo_ya_s___official_visualizer_.mp3' },
      { rel: 'NO_VOCALS_130BPM_CMajor_DEM4_charly_garc_a___yo_ya_s___official_visualizer_.mp3' },
      { rel: 'Descargas/01 - Charly Garcia - Demoliendo hoteles.mp3' },
    ])
    const quien = leerRevision(b.db, b.changes, b.organizer).decidir.filter((c) => c.tipo === 'quien').map((c) => (c as { fileId: number }).fileId)
    expect(quien).toEqual([b.ids[2]])
  })
  it.todo('"los dos, con (2)" no le saca al nombre lo que ya lo distinguía ("Es La Que Va (versión 3-27)" → "Es La Que Va (2)")')
})

describe('corrida supervisada de Ordenar (13/11): nombres', () => {
  // "pendrive/…/TECHNO TECH PROG/melodic/AL046 - KASST - Outomorrow.mp3": con artista "AL046" en todos, la carpeta parece un
  // disco y "melodic" queda de álbum (fillFromFolders, tidy-steps.ts:186-193)
  it('una carpeta con nombre de estilo ("melodic") no se vuelve el álbum', () => {
    const b = base(['A MAGIC WORLD', 'Our Last Dance', 'Outomorrow'].map((t) =>
      ({ rel: `pendrive/ELECTRONICA/TECHNO TECH PROG/melodic/AL046 - KASST - ${t}.mp3`, artist: 'AL046', title: 'KAS:ST' })))
    const albums = tidy(b.db).changes.filter((c) => c.field === 'album').map((c) => c.to)
    expect(albums).not.toContain('melodic')
  })
})

describe('corrida supervisada de Ordenar (13/11), con el disco: extensiones que mienten', () => {
  // 11 ".mp3" de Biblioteca (Cazzu, Emilia "Jagger.mp3.mp3", Whitney Houston, La Joaqui…) son un WebM con audio Opus y un ID3 pegado
  // adelante. sniff() dice "MP3" a propósito (extensions.ts:13-29: así se les pueden escribir los tags), pero el control de equipos
  // y el exporte miran solo la extensión (rekordbox.ts:133 y :161, djexport.ts:37-42): salen como compatibles y en la cabina no suenan.
  const opusConMp3 = { rel: 'Biblioteca/Emilia/Jagger.mp3.mp3', artist: 'Emilia', title: 'Jagger', codec: 'opus' }

  it('un .mp3 que por dentro es Opus no sale como compatible con un CDJ', () => {
    const b = base([opusConMp3])
    const rb = new Rekordbox(b.db, () => 'X:/no-se-lee.mp3', new Playlists(b.db, () => null))
    expect(rb.compatibility('cdj-nxs2').issues.map((i) => i.fileId)).toEqual(b.ids)
  })

  it('un .mp3 que por dentro es Opus no entra al exporte de Traktor (que no lee Opus)', () => {
    const b = base([opusConMp3])
    const rb = new Rekordbox(b.db, () => 'X:/no-se-lee.mp3', new Playlists(b.db, () => null))
    expect(rb.pick({ scope: 'todo', playlistIds: [] }, UNSUPPORTED.traktor, 'Traktor').tracks).toEqual([])
  })

  it.todo('Ordenar avisa de los .mp3 que son Opus por dentro (proponer convertirlos) y del nombre "Jagger.mp3.mp3"')
})

describe('los ejemplos de "¿Cómo querés tus carpetas?" (13/11)', () => {
  // con la base real, el ejemplo de "Por artista y disco" era "CA7RIEL & Paco Amoroso / 2019 - OUKE / OUKE (2).mp3"
  it('no usan temas que chocan ni los de un repetido sin decidir', () => {
    const b = base([
      { rel: 'Descargas/OUKE.mp3', artist: 'CA7RIEL & Paco Amoroso', album: 'OUKE', year: '2019', track: '1', title: 'OUKE' },
      { rel: 'Otros/Ca7riel & Paco Amoroso - OUKE.mp3', artist: 'Ca7riel & Paco Amoroso', album: 'OUKE', year: '2019', title: 'OUKE' },
      { rel: 'A/x.mp3', artist: 'Led Zeppelin', title: 'Hats Off', album: 'III', year: '1970', track: '10' },
      { rel: 'B/y.mp3', artist: 'Led Zeppelin', title: 'Hats Off', album: 'III', year: '1970', track: '10' },
      { rel: 'C/uno.mp3', artist: 'La Renga', title: 'Uno', album: 'Despedazado', year: '1996', track: '1' },
      { rel: 'C/dos.mp3', artist: 'La Renga', title: 'Dos', album: 'Despedazado', year: '1996', track: '2' },
    ])
    const [ouke, copia] = b.ids
    guardarRepetidos(b.db, [probable([item(ouke, 'Descargas/OUKE.mp3'), item(copia, 'Otros/Ca7riel & Paco Amoroso - OUKE.mp3')], ouke)])
    const ms = movesDeEjemplo({ db: b.db, organizer: b.organizer }, REGLA_ORDENAR)
    expect(ms.map((m) => m.to).sort()).toEqual(['Biblioteca/La Renga/1996 - Despedazado/Dos.mp3', 'Biblioteca/La Renga/1996 - Despedazado/Uno.mp3'])
    // y la pantalla, por las dudas, nunca elige uno con "(2)"
    expect(elegirEjemplos([{ fileId: 1, to: 'Biblioteca/A/2019 - D/OUKE (2).mp3' }, { fileId: 2, to: 'Biblioteca/B/2019 - E/Otro.mp3' }], 1, 'Biblioteca').map((m) => m.fileId)).toEqual([2])
  })
})
