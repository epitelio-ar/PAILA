// Lo que encontró el ensayo general del punto 1 en Organizar (docs/pruebas/2026-10-24-ensayo-punto-1.md), con los nombres reales:
// una carpeta "DE LA CALLE" al lado de "De La Calle" (en Windows, la misma) y un disco con los tags rotos que quedaba "KAS_ST (2…8)".
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { DEFAULT_RULE, Organizer } from '@paila/core/organizer'

let dir: string, lib: Library, rootId: number
const add = (rel: string, t: { artist?: string; albumArtist?: string; title?: string; album?: string }) =>
  lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, duration, artist, album_artist, title, album, probed_at) VALUES (?, ?, 1, 1, 'musica', 'mp3', 200, ?, ?, ?, ?, '2026-10-24')")
    .run(rootId, rel, t.artist ?? null, t.albumArtist ?? null, t.title ?? null, t.album ?? null)
const plan = () => new Organizer(lib.db, () => path.join(dir, 'M')).plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' })

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-org-ensayo-'))
  fs.mkdirSync(path.join(dir, 'M'))
  lib = new Library(path.join(dir, 'paila.db'), null)
  rootId = (await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])).id
})
afterEach(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('ensayo general del punto 1: Organizar', () => {
  it('un "artista del álbum" que es una página no arma otra carpeta con el artista escrito distinto', () => {
    add('CA2024/De La Calle - Bata Boom.mp3', { artist: 'De La Calle', title: 'Bata Boom' })
    add('Chengue/De La Calle - Una Wacha Piola.mp3', { artist: 'De La Calle', title: 'Una Wacha Piola' })
    add('CA2024/De La Calle - Re loco.mp3', { artist: 'DE LA CALLE', albumArtist: 'WwW.ZonaCumbieros.NeT', title: 'RE LOCO', album: 'WwW.ZonaCumbieros.NeT' })
    const folders = new Set(plan().moves.map((m) => m.to.split('/')[1]))
    expect([...folders]).toEqual(['De La Calle'])
  })

  it('tres temas o más con los mismos tags (rotos) no se mueven: quedarían "KAS_ST (2)", "KAS_ST (3)"…', () => {
    for (const t of ['The Gate', 'Hope Im Alone', 'Letters', 'Mirrors']) add(`melodic/AL046 - KASST - ${t}.mp3`, { artist: 'AL046', title: 'KAS:ST' })
    // dos con el mismo nombre (casi siempre el mismo tema repetido) siguen yendo con "(2)", y los demás se mueven igual
    add('Rock/La Renga/05- La Renga - El Juicio Del Ganzo.mp3', { artist: 'La Renga', title: 'El Juicio Del Ganzo' })
    add('Rock/La Renga/07- La Renga - El Juicio Del Ganzo.mp3', { artist: 'La Renga', title: 'El Juicio Del Ganzo' })
    add('Rock/Divididos/01 - salir a asustar.mp3', { artist: 'Divididos', title: 'Salir a asustar' })
    const p = plan()
    expect(p.moves.some((m) => m.from.includes('KASST'))).toBe(false)
    const skipped = p.skipped.filter((s) => s.rel.includes('KASST'))
    expect(skipped).toHaveLength(4)
    expect(skipped[0].reason).toMatch(/4 temas distintos tienen los mismos tags \(AL046 — KAS:ST\)/)
    expect(p.moves.map((m) => m.to).sort()).toEqual(['Biblioteca/Divididos/Salir a asustar.mp3', 'Biblioteca/La Renga/El Juicio Del Ganzo (2).mp3', 'Biblioteca/La Renga/El Juicio Del Ganzo.mp3'])
    expect(p.conflicts).toBe(1)
    expect(p.clashes!.map((c) => path.basename(c.to))).toEqual(['El Juicio Del Ganzo (2).mp3'])
  })

  it('Organizar dos veces seguidas no mueve nada la segunda (dos formas de escribir que empatan), ni choca con dos Folder.jpg', async () => {
    // en un disco de verdad: "El Polaco" y "El polaco" (un tema cada uno) y dos simples de Chromatics con su Folder.jpg
    const file = (rel: string, t: Parameters<typeof add>[1] | null) => {
      const abs = path.join(dir, 'M', ...rel.split('/'))
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, Buffer.alloc(100 + rel.length))
      if (t) {
        add(rel, t)
        const st = fs.statSync(abs)
        lib.db.prepare('UPDATE files SET size = ?, mtime = ? WHERE rel_path = ?').run(st.size, st.mtimeMs, rel)
      }
    }
    file('a/el polaco - otro.mp3', { artist: 'El polaco', title: 'Otro' })
    file('z/El Polaco - Deja de llorar.mp3', { artist: 'El Polaco', title: 'Deja de llorar' })
    file('kento/2017 - Cherry/01 Cherry.mp3', { artist: 'Chromatics', title: 'Cherry' })
    file('kento/2017 - Cherry/Folder.jpg', null)
    file('kento/2015 - Shadow/01 Shadow.mp3', { artist: 'Chromatics', title: 'Shadow' })
    file('kento/2015 - Shadow/Folder.jpg', null)
    const org = new Organizer(lib.db, () => path.join(dir, 'M'))
    const p = org.plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' })
    expect(new Set(p.moves.filter((m) => /polaco/i.test(m.from)).map((m) => m.to.split('/')[1]))).toEqual(new Set(['El Polaco']))
    expect(p.extras.filter((x) => x.to.endsWith('Folder.jpg'))).toHaveLength(1)
    const r = await lib.ops.run('prueba', () => org.apply(p))
    expect(r.failed).toEqual([])
    const again = org.plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' })
    expect(again.moves).toEqual([])
    // el Folder.jpg que se quedó (su lugar ya lo tiene el otro) no se vuelve a proponer cada vez
    expect(again.extras).toEqual([])
  })

  it('las miniaturas del Reproductor de Windows no acompañan al disco; Folder.jpg y cover.jpg sí (pedido del 24/10)', () => {
    const d = 'Rock/Soda Stereo - Signos'
    for (const n of ['01 Signos.mp3', 'Folder.jpg', 'cover.jpg', 'AlbumArt_{8F3C1A2B-1D4E-4B6A-9C3F-2E5D7A9B0C11}_Large.jpg',
      'AlbumArt_{8F3C1A2B-1D4E-4B6A-9C3F-2E5D7A9B0C11}_Small.jpg', 'AlbumArtSmall.jpg']) {
      fs.mkdirSync(path.join(dir, 'M', d), { recursive: true })
      fs.writeFileSync(path.join(dir, 'M', d, n), Buffer.alloc(100))
    }
    add(`${d}/01 Signos.mp3`, { artist: 'Soda Stereo', title: 'Signos' })
    const extras = plan().extras.map((x) => path.posix.basename(x.from)).sort()
    expect(extras).toEqual(['Folder.jpg', 'cover.jpg'])
  })

  it('el tema que ya quedó en su "(2)" no cuenta como choque la vez siguiente', async () => {
    for (const n of ['05', '07']) {
      const rel = `Rock/La Renga/${n}- La Renga - El Juicio Del Ganzo.mp3`, abs = path.join(dir, 'M', ...rel.split('/'))
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, Buffer.alloc(100 + Number(n)))
      add(rel, { artist: 'La Renga', title: 'El Juicio Del Ganzo' })
      const st = fs.statSync(abs)
      lib.db.prepare('UPDATE files SET size = ?, mtime = ? WHERE rel_path = ?').run(st.size, st.mtimeMs, rel)
    }
    const org = new Organizer(lib.db, () => path.join(dir, 'M'))
    const p = org.plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' })
    expect(p.conflicts).toBe(1)
    await lib.ops.run('prueba', () => org.apply(p))
    const again = org.plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' })
    expect([again.moves.length, again.conflicts, again.clashes!.length, again.alreadyOk]).toEqual([0, 0, 0, 2])
  })
})
