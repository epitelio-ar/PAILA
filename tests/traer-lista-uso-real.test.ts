// "Traer una lista", lo que salió del uso real del 24/10/2026 (docs/pruebas/2026-10-24-uso-real.md):
// - "Los dos" en "Para confirmar · otra versión": la tuya entra a la playlist y la versión pedida va a la lista «Faltan o suenan mal»;
//   cuando llega, entra al lado de la tuya. Cambiar de idea la saca.
// - Traer la misma lista otra vez ofrece actualizar la que ya está (sumar lo nuevo y lo que ahora sí tenés) en vez de «(2)».
// - Emparejar: el disco del nombre del archivo no le gana al título; un cover contra el original se ofrece como otra versión.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { Playlists } from '@paila/core/playlists'
import { Requests, type NewItem } from '@paila/core/requests'
import { Wanted } from '@paila/core/wanted'
import { ListMatcher, type LibTrack } from '@paila/core/listmatch'
import { nameGuess } from '@paila/core/inbox'
import { sameName } from '@paila/core/requests-update'

let dir: string, db: Db, pl: Playlists, wanted: Wanted, req: Requests
const add = (rel: string, artist: string, title: string, duration: number, grade = 'A') => {
  const id = Number(db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, title, duration) VALUES (1, ?, 1000, 1, 'musica', 'mp3', ?, ?, ?)").run(rel, artist, title, duration).lastInsertRowid)
  db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade) VALUES (?, 1, 1, 1, 'x', ?)").run(id, grade)
  return id
}
const item = (position: number, artist: string, title: string, duration: number, fileId: number | null, kind: NewItem['kind'] = fileId ? 'version' : 'none', decision: NewItem['decision'] = null): NewItem =>
  ({ position, artist, title, album: null, duration, isrc: null, kind, why: '', decision, fileId })
const missing = () => wanted.list().filter((w) => w.fileId == null).map((w) => `${w.artist} - ${w.title}`).sort()

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-traer-'))
  db = openDb(path.join(dir, 'paila.db'))
  db.exec("INSERT INTO volumes (id, serial, last_mount) VALUES (1, 'X', 'C:\\\\'); INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', 'x')")
  pl = new Playlists(db, () => null)
  wanted = new Wanted(db)
  req = new Requests(db, pl, wanted, () => null)
})
afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('"Los dos" en otra versión', () => {
  it('la tuya entra a la playlist y la pedida va a la lista «Faltan o suenan mal»; al llegar, entra al lado', () => {
    // KC & The Sunshine Band: la lista pide el remaster de 3:05, vos tenés el WAV de 5:06
    const kc = add('M/KC - Give It Up.wav', 'KC & The Sunshine Band', 'Give It Up', 306, 'D')
    const toto = add('M/Toto - Africa.mp3', 'Toto', 'Africa', 295)
    const d = req.create({ name: 'Joda', source: 'CSV de Spotify', items: [item(1, 'Toto', 'Africa', 295, toto, 'exacto'), item(2, 'KC & The Sunshine Band', 'Give It Up - 2004 Remaster', 185, kc, 'version', 'ambos')] })
    expect(d.items).toHaveLength(3)
    const mine = d.items.find((i) => i.file?.id === kc)!
    expect(mine.decision).toBe('ambos')
    expect(mine.state).toBe('baja') // la tuya es D: entra y además se busca una mejor
    const pedida = d.items.find((i) => i.versionOf === 2)!
    expect(pedida).toMatchObject({ state: 'falta', file: null, position: 2 })
    expect(pl.trackIds(d.playlistId!)).toEqual([toto, kc])
    expect(missing()).toContain('KC & The Sunshine Band - Give It Up')
    // llega la de 3:05 por la Bandeja y se escanea: entra a la playlist al lado de la tuya
    const nueva = add('M/KC - Give It Up (Remaster).mp3', 'KC & The Sunshine Band', 'Give It Up', 185)
    const w = db.prepare('SELECT wanted_id AS w FROM request_items WHERE id = ?').get(pedida.id) as { w: number }
    db.prepare("UPDATE wanted SET status = 'llego', arrived_path = ? WHERE id = ?").run(path.join(dir, 'no-existe', 'KC.mp3'), w.w)
    expect(req.sync()).toBe(1)
    expect(pl.trackIds(d.playlistId!)).toEqual([toto, kc, nueva])
  })

  it('después de creado también: "Los dos" suma la pedida y cambiar de idea la saca de la lista «Faltan o suenan mal»', () => {
    const vogue = add('M/Madonna - Vogue.mp3', 'Madonna', 'Vogue', 319)
    const d = req.create({ name: 'Vogue', source: 'Texto pegado', items: [item(1, 'Madonna', 'Vogue', 316 - 10, vogue)] })
    const it0 = d.items[0]
    expect(it0.state).toBe('revisar')
    const d2 = req.decide(it0.id, 'ambos')
    expect(d2.items).toHaveLength(2)
    expect(d2.items.find((i) => i.id === it0.id)!.decision).toBe('ambos')
    expect(pl.trackIds(d.playlistId!)).toEqual([vogue])
    expect(missing()).toContain('Madonna - Vogue')
    const d3 = req.decide(it0.id, 'si')
    expect(d3.items).toHaveLength(1)
    expect(missing()).not.toContain('Madonna - Vogue')
    expect(pl.trackIds(d.playlistId!)).toEqual([vogue])
    // en la vista previa, "Los dos" cuenta como confirmado (la tuya entra)
    expect(req.decide(it0.id, null).items[0].state).toBe('revisar')
  })
})

describe('traer la misma lista otra vez', () => {
  it('la vista previa avisa que ya está, y actualizarla suma lo nuevo y lo que ahora sí tenés (sin «(2)»)', () => {
    const a = add('M/Soda - Ella.mp3', 'Soda Stereo', 'Ella Usó Mi Cabeza Como Un Revólver', 271)
    const d = req.create({ name: 'Fiesta 2026', source: 'CSV de Spotify', items: [item(1, 'Soda Stereo', 'Ella Usó Mi Cabeza Como Un Revólver', 271, a, 'exacto'), item(2, 'Duki', 'Goteo', 180, null)] })
    expect(missing()).toContain('Duki - Goteo')
    expect(sameName(db, 'fiesta 2026')).toMatchObject({ id: d.id, playlistName: 'Fiesta 2026' })
    expect(sameName(db, 'Otra lista')).toBeNull()
    // ahora sí tenés "Goteo" (lo bajaste) y la lista en Spotify creció
    const goteo = add('M/Duki - Goteo.mp3', 'Duki', 'Goteo', 180)
    const nuevo = add('M/Emilia - Cuatro Babys.mp3', 'Emilia', 'Cuatro Babys', 200)
    const r = req.update(d.id, [item(1, 'Soda Stereo', 'Ella Usó Mi Cabeza Como Un Revólver', 271, a, 'exacto'), item(2, 'Duki', 'Goteo', 180, goteo, 'exacto'), item(3, 'Emilia', 'Cuatro Babys', 200, nuevo, 'exacto'), item(4, 'Bizarrap', 'Session 53', 190, null)])
    expect(r).toMatchObject({ added: 2, found: 1 })
    expect(r.detail.total).toBe(4)
    expect(pl.trackIds(d.playlistId!)).toEqual([a, goteo, nuevo])
    expect(missing()).not.toContain('Duki - Goteo')
    expect(missing()).toContain('Bizarrap - Session 53')
    expect(pl.tree().filter((n) => n.name.startsWith('Fiesta 2026'))).toHaveLength(1)
    // traerla igual otra vez no cambia nada
    expect(req.update(d.id, [item(1, 'Soda Stereo', 'Ella Usó Mi Cabeza Como Un Revólver', 271, a, 'exacto')])).toMatchObject({ added: 0, found: 0 })
    // una deshecha ya no se ofrece
    req.undo(d.id)
    expect(sameName(db, 'Fiesta 2026')).toBeNull()
  })
})

describe('emparejamiento: casos reales del 24/10', () => {
  const lib = (id: number, rel: string, artist: string, title: string, duration: number, album: string | null = null): LibTrack =>
    ({ id, rel, ext: 'flac', artist, title, duration, album, grade: 'A', flags: null, isrc: null, guess: nameGuess(rel) })
  const entry = (artist: string, title: string, duration: number | null) => ({ position: 1, artist, title, album: null, duration, isrc: null, path: null })

  it('el nombre del disco en el archivo no le gana al título', () => {
    expect(nameGuess('Laura Branigan - Self Control - 05 - Spanish Eddie.flac')).toEqual({ artist: 'Laura Branigan', title: 'Spanish Eddie' })
    expect(nameGuess('Toto - Africa - 2004 - Remaster.mp3')).toEqual({ artist: 'Toto', title: 'Africa - 2004 - Remaster' }) // el año no es número de tema
    const eddie = lib(1, 'Recibidos/Laura Branigan - Self Control - 05 - Spanish Eddie.flac', 'Laura Branigan', 'Spanish Eddie', 247.7, 'Self Control')
    const solo = new ListMatcher([eddie])
    expect(solo.match(entry('Laura Branigan', 'Self Control', 249)).kind).toBe('none')
    // con el tema de verdad (la versión larga), ese es el que se ofrece
    const largo = lib(2, 'Recibidos/1-08 Laura Branigan - Self Control.flac', 'Laura Branigan', 'Self Control', 302.5, 'Pop Classics: The Long Versions, Volume 2')
    expect(new ListMatcher([eddie, largo]).match(entry('Laura Branigan', 'Self Control', 249))).toMatchObject({ kind: 'version', fileId: 2 })
  })

  it('un cover en la lista contra el original que tenés: se ofrece como otra versión', () => {
    const m = new ListMatcher([
      lib(1, "Biblioteca/The Weather Girls/It's Raining Men.mp3", 'The Weather Girls', "It's Raining Men", 326),
      lib(2, "Biblioteca/MC Hammer/U Can't Touch This.mp3", 'MC Hammer', "U Can't Touch This", 257),
      lib(3, 'Biblioteca/Otro/Intro.mp3', 'Otro', 'Intro', 60),
    ])
    const raining = m.match(entry('Sugar Sisters', "It's Raining Man", 212))
    expect(raining).toMatchObject({ kind: 'version', fileId: 1 })
    expect(raining.why).toContain('otro artista')
    expect(m.match(entry('Lyricist', "You Can't Touch This", 240))).toMatchObject({ kind: 'version', fileId: 2 })
    // lo genérico o sin parecido no
    expect(m.match(entry('Alguien', 'Intro', 60)).kind).toBe('none')
    expect(m.match(entry('Alguien', 'Otra Cosa Distinta', 200)).kind).toBe('none')
  })

  it('lo que baja en lugar del pedido (otro tema del mismo disco) no entra a la playlist', () => {
    const d = req.create({ name: 'Branigan', source: 'Texto pegado', items: [item(1, 'Laura Branigan', 'Self Control', 249, null)] })
    const eddie = add('M/Laura Branigan - Self Control - 05 - Spanish Eddie.flac', 'Laura Branigan', 'Spanish Eddie', 247.7)
    const llego = path.join(dir, 'Bandeja', 'Laura Branigan - Self Control - 05 - Spanish Eddie.flac')
    db.prepare("INSERT INTO inbox_items (path, size, mtime, result, checked_at) VALUES (?, 1000, 1, '{}', 'x')").run(llego)
    const w = db.prepare('SELECT wanted_id AS w FROM request_items WHERE request_id = ?').get(d.id) as { w: number }
    db.prepare("UPDATE wanted SET status = 'llego', arrived_path = ? WHERE id = ?").run(llego, w.w)
    expect(req.sync()).toBe(0)
    expect(pl.trackIds(d.playlistId!)).not.toContain(eddie)
  })
})

describe('la pantalla', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps/paila/ui/src/Requests.tsx'), 'utf8')
  it('tiene "Los dos", "Buscar uno mejor" y "Actualizar la que ya está"', () => {
    expect(src).toContain("decide(i, 'ambos')")
    expect(src).toContain('T.buscarMejor')
    expect(src).toContain('window.paila.updateRequest(')
  })
  it('borrar una playlist: también con clic derecho y Supr en la barra lateral, siempre preguntando', () => {
    const pls = fs.readFileSync(path.join(__dirname, '..', 'apps/paila/ui/src/Playlists.tsx'), 'utf8')
    expect(pls).toContain('onContextMenu=')
    expect(pls).toContain("e.key === 'Delete'")
    expect(pls).toContain('window.paila.deletePlaylistInfo(')
    expect(fs.readFileSync(path.join(__dirname, '..', 'apps/paila/ui/src/Sidebar.tsx'), 'utf8')).toContain('onDelete={p.onDeletePlaylist}')
  })
})
