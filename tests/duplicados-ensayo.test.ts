// Lo que encontró el ensayo general del punto 1 en Duplicados (docs/pruebas/2026-10-24-ensayo-punto-1.md): a igual calidad, se
// quedaba la copia de la ruta más corta aunque fuera la suelta de un compilado, y el disco original quedaba incompleto.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findDuplicates, pickKeeper } from '@paila/core/duplicates'
import { Library } from '@paila/core/library'
import type { DupItem } from '@paila/shared/types'

const item = (id: number, rel: string, over: Partial<DupItem> = {}): DupItem => ({
  id, rel, ext: 'flac', size: 1, kbps: 950, duration: 228, grade: 'A', kind: 'musica', tagged: true, artist: 'Patricio Rey', title: 'Vamos las bandas', playlists: [], ...over,
})

describe('ensayo general del punto 1: Duplicados', () => {
  it('a igual calidad se queda el que está en la carpeta de su disco, no la copia suelta de la ruta más corta', () => {
    const suelta = item(1, 'FIESTA AMIGOS vol2/FIESTA AMIGOS 2024/Rock 2024/06 - Vamos las bandas.flac')
    const enDisco = item(2, 'Patricio Rey y Sus Redonditos de Ricota/1988 - Un baión para el ojo idiota/06 - Vamos las bandas.flac', { inAlbum: true })
    expect(pickKeeper([suelta, enDisco])).toBe(2)
    // la calidad sigue mandando: un MP3 en su disco no le gana a un FLAC suelto
    expect(pickKeeper([item(3, 'Funcional/06 - Lets Go Away.flac'), item(4, 'Carpeta X/Pet Sounds/1-06 Lets Go Away.mp3', { ext: 'mp3', kbps: 320, grade: 'B', inAlbum: true })])).toBe(3)
    // y la copia de "Para revisar" sigue perdiendo aunque esté en un disco
    expect(pickKeeper([item(5, 'a/Tema.flac'), item(6, 'kingston/Contents/Artista/Disco/Tema.flac', { kind: 'revisar', inAlbum: true })])).toBe(5)
  })

  it('la búsqueda marca qué temas están en la carpeta de su disco (4 o más temas del mismo álbum, y son la mitad de la carpeta)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-dupdisco-'))
    const lib = new Library(path.join(dir, 'paila.db'), null)
    try {
      fs.mkdirSync(path.join(dir, 'M'))
      const root = await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
      const ins = lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, duration, artist, title, album, probed_at) VALUES (?, ?, ?, 1, 'musica', 'flac', ?, 'Patricio Rey', ?, ?, '2026-10-24')")
      const disco = 'Patricio Rey y Sus Redonditos de Ricota/1988 - Un baión para el ojo idiota'
      let size = 100
      for (const [n, t] of [['01', 'Todo un palo'], ['02', 'Ella debe estar tan linda'], ['03', 'Aquella solitaria vaca cubana'], ['06', 'Vamos las bandas']]) ins.run(root.id, `${disco}/${n} - ${t}.flac`, size++, 200 + size, t, 'Un baión para el ojo idiota')
      // la misma "Vamos las bandas" en un compilado (mismos tags y duración: probable por nombre), con la ruta más corta
      ins.run(root.id, 'CA2024/Rock/06 - Vamos las bandas.flac', 999, 200 + 103, 'Vamos las bandas', 'Un baión para el ojo idiota')
      const groups = await findDuplicates(lib.db, () => null)
      expect(groups).toHaveLength(1)
      const g = groups[0]
      expect(g.items.find((i) => i.id === g.keep)!.rel).toBe(`${disco}/06 - Vamos las bandas.flac`)
      expect(g.items.map((i) => [path.basename(path.dirname(i.rel)), !!i.inAlbum]).sort()).toEqual([['1988 - Un baión para el ojo idiota', true], ['Rock', false]])
    } finally { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('a igual nota y formato gana la copia que no satura, aunque tenga menos bitrate (el autor, 24/10)', () => {
    // "Karma Chameleon": se quedaba la de "DISCOROCK 2" (picos de +1,6 dB) y se iba la de slider.kz (−1,1 dB), las dos B y MP3 320
    const satura = item(1, 'DISCO CUMPLE/DISCOROCK/DISCOROCK 2/Culture Club - 09 - Karma Chameleon.mp3', { ext: 'mp3', kbps: 320, grade: 'B', clipEvents: 35, lufs: -8.7 })
    const limpia = item(2, 'pendrive/musica/Musica vieja/ELECTRONICA/80s90s/Culture Club - Karma Chameleon [www.slider.kz].mp3', { ext: 'mp3', kbps: 256, grade: 'B', clipEvents: 0, lufs: -11.8 })
    expect(pickKeeper([satura, limpia])).toBe(2)
    // la nota sigue mandando, y sin pérdida le sigue ganando a con pérdida aunque sature
    expect(pickKeeper([item(3, 'a.mp3', { ext: 'mp3', grade: 'C' }), item(4, 'b.mp3', { ext: 'mp3', grade: 'B', clipEvents: 300, lufs: -6 })])).toBe(4)
    expect(pickKeeper([item(5, 'a.mp3', { ext: 'mp3', kbps: 320, clipEvents: 0, lufs: -10 }), item(6, 'b.flac', { clipEvents: 300, lufs: -6 })])).toBe(6)
  })

  it('satura = recortes de verdad (5 o más), no un pico de más de 0 dB entre muestras', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-dupsatura-'))
    const lib = new Library(path.join(dir, 'paila.db'), null)
    try {
      fs.mkdirSync(path.join(dir, 'M'))
      const root = await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
      const ins = lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, kbps, duration, artist, title, probed_at) VALUES (?, ?, ?, 1, 'musica', 'mp3', ?, ?, ?, ?, '2026-10-24')")
      const an = lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, true_peak, clip_events, lufs) VALUES (?, 1, ?, 1, '2026-10-24', ?, ?, ?, ?)")
      const tema = (rel: string, size: number, kbps: number, dur: number, artist: string, title: string, grade: string, tp: number, clips: number, lufs: number) => {
        const id = Number(ins.run(root.id, rel, size, kbps, dur, artist, title).lastInsertRowid)
        an.run(id, size, grade, tp, clips, lufs)
        return id
      }
      // "Karma Chameleon": la de "DISCOROCK 2" tiene 35 recortes (3 dB más fuerte); la de slider.kz, ninguno → se queda la limpia
      const kSatura = tema('Reserva/Culture Club - Karma Chameleon.mp3', 100, 320, 238, 'Culture Club', 'Karma Chameleon', 'B', 1.6, 35, -8.7)
      const kLimpia = tema('Pendrive/Culture Club - Karma Chameleon [www.slider.kz].mp3', 200, 320, 238, 'Culture Club', 'Karma Chameleon', 'B', -1.1, 0, -11.8)
      // "El Juicio Del Ganzo": pico de +0,1 dB entre muestras y ningún recorte → no satura; sigue ganando el de más bitrate
      const j160 = tema('Rock/La Renga/07- La Renga - El Juicio Del Ganzo.mp3', 300, 160, 250, 'La Renga', 'El Juicio Del Ganzo', 'D', 0.1, 0, -13.7)
      tema('Rock/La Renga/la renga - el juicio del ganso.mp3', 400, 128, 250, 'La Renga', 'El Juicio Del Ganzo', 'D', -0.5, 0, -13.7)
      const groups = await findDuplicates(lib.db, () => null)
      expect(groups).toHaveLength(2)
      const k = groups.find((g) => g.items.some((i) => i.id === kSatura))!, j = groups.find((g) => g.items.some((i) => i.id === j160))!
      expect(k.items.map((i) => [i.id, i.clipEvents]).sort()).toEqual([[kSatura, 35], [kLimpia, 0]].sort())
      expect(k.keep).toBe(kLimpia)
      expect(j.items.every((i) => !i.clipEvents)).toBe(true)
      expect(j.keep).toBe(j160)
    } finally { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('una carpeta por género con 4 temas de un disco entre muchos sueltos no es "su disco"', async () => {
    // "pendrive/…/Psy": 4 temas de "He.art" de Astrix entre 16; la otra copia de "Alien Turned Human" está en "Electronica/Psytrance"
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-dupgenero-'))
    const lib = new Library(path.join(dir, 'paila.db'), null)
    try {
      fs.mkdirSync(path.join(dir, 'M'))
      const root = await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
      const ins = lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, duration, artist, title, album, probed_at) VALUES (?, ?, ?, 1, 'musica', 'mp3', ?, ?, ?, ?, '2026-10-24')")
      let size = 100
      for (const t of ['Alien Turned Human', 'Deep Jungle Walk', 'Sex Style', 'Coming Soon']) ins.run(root.id, `kingston/ELECTRONICA/Psy/Astrix - ${t}.mp3`, size++, 300 + size, 'Astrix', t, 'He.art')
      for (let i = 0; i < 8; i++) ins.run(root.id, `kingston/ELECTRONICA/Psy/Otro ${i} - Tema ${i}.mp3`, size++, 300 + size, `Otro ${i}`, `Tema ${i}`, null)
      ins.run(root.id, 'Electronica/Psytrance/Astrix - Alien Turned Human.mp3', 999, 401, 'Astrix', 'Alien Turned Human', 'He.art') // la misma duración
      const groups = await findDuplicates(lib.db, () => null)
      expect(groups).toHaveLength(1)
      expect(groups[0].items.every((i) => !i.inAlbum)).toBe(true)
      // sin disco de por medio, sigue la ruta más corta
      expect(groups[0].items.find((i) => i.id === groups[0].keep)!.rel).toBe('Electronica/Psytrance/Astrix - Alien Turned Human.mp3')
    } finally { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
