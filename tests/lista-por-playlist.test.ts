// Faltan o suenan mal, "Solo de esta playlist" (el autor, 24/10/2026: "en la lista de pedir me agrega todos los malos,
// quiero solo los de mala calidad y que no tengo de esa playlist que cargué"): lo que le falta a la playlist (viene del pedido
// que la armó) y sus temas de mala calidad; nada de lo malo del resto de la Música. Exportar y Bajar con NAPIA mandan solo eso.
// También: la playlist creada con "Traer una lista" tiene que verse (el grupo PLAYLISTS plegado se abre solo).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { Playlists } from '@paila/core/playlists'
import { PlaylistOps } from '@paila/core/playlistops'
import { Requests } from '@paila/core/requests'
import { Wanted } from '@paila/core/wanted'

const ROOT = path.join(__dirname, '..')
describe('faltan o suenan mal de una sola playlist', () => {
  let dir: string, db: Db, pl: Playlists, wanted: Wanted, req: Requests
  const add = (rel: string, artist: string, title: string, grade: string) => {
    const id = Number(db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, title, duration) VALUES (1, ?, 1000, 1, 'musica', 'mp3', ?, ?, 200)").run(rel, artist, title).lastInsertRowid)
    db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade) VALUES (?, 1, 1, 1, 'x', ?)").run(id, grade)
    return id
  }
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-lpp-'))
    db = openDb(path.join(dir, 'paila.db'))
    db.exec("INSERT INTO volumes (id, serial, last_mount) VALUES (1, 'X', 'C:\\\\'); INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', 'x')")
    pl = new Playlists(db, () => null)
    wanted = new Wanted(db)
    req = new Requests(db, pl, wanted, () => null)
  })
  afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('solo lo de la playlist: lo que falta y lo suyo de mala calidad (no lo malo del resto)', () => {
    const malaFuera = add('M/Fuera - Mala.mp3', 'Fuera', 'Mala', 'F') // mala, pero de otra parte de la Música
    const malaDentro = add('M/Toto - Africa.mp3', 'Toto', 'Africa', 'D') // mala y está en la lista traída
    const buena = add('M/Soda - Ella.mp3', 'Soda Stereo', 'Ella', 'A') // buena, en la lista traída
    const d = req.create({
      name: 'Joda', source: 'CSV de Spotify', items: [
        { position: 1, artist: 'Toto', title: 'Africa', album: null, duration: 200, isrc: null, kind: 'exacto', why: '', decision: null, fileId: malaDentro },
        { position: 2, artist: 'Soda Stereo', title: 'Ella', album: null, duration: 200, isrc: null, kind: 'exacto', why: '', decision: null, fileId: buena },
        { position: 3, artist: 'Duki', title: 'Falta Este', album: null, duration: 200, isrc: null, kind: 'none', why: '', decision: null, fileId: null },
      ],
    })
    expect(d.playlistId).not.toBeNull()
    const todo = wanted.list().map((i) => `${i.artist} - ${i.title}`)
    expect(todo).toContain('Fuera - Mala') // sin filtro, entra todo lo malo
    const solo = wanted.list(undefined, undefined, d.playlistId).map((i) => `${i.artist} - ${i.title}`).sort()
    expect(solo).toEqual(['Duki - Falta Este', 'Toto - Africa'])
    expect(solo).not.toContain('Fuera - Mala')
    expect(malaFuera).toBeGreaterThan(0)
    // exportar: solo eso (y sin playlist, todo)
    const out = wanted.export('txt', undefined, { playlistId: d.playlistId })
    expect(out.text.split('\r\n').filter(Boolean).sort()).toEqual(['Duki - Falta Este', 'Toto - Africa'])
    expect(out.count).toBe(2)
  })

  it('otra playlist (sin pedido) con un tema malo: solo ese; una playlist vacía: nada', () => {
    const mala = add('M/Otro - Malo.mp3', 'Otro', 'Malo', 'F')
    const p2 = pl.create('Mis malos')
    pl.addTracks(p2, [mala])
    expect(wanted.list(undefined, undefined, p2).map((i) => i.title)).toEqual(['Malo'])
    expect(wanted.list(undefined, undefined, pl.create('Vacía'))).toEqual([])
  })

  // uso real del 24/10: seis «Fiesta 2026» fusionadas sacando las originales dejaron los pedidos sin playlist
  const pedido = (name: string, artist: string, title: string) => req.create({ name, source: 'CSV de Spotify', items: [{ position: 1, artist, title, album: null, duration: 200, isrc: null, kind: 'none', why: '', decision: null, fileId: null }] })
  const reqPl = (id: number) => (db.prepare('SELECT playlist_id AS p FROM requests WHERE id = ?').get(id) as { p: number | null }).p

  it('fusionar sacando las originales pasa los pedidos a la nueva, y deshacer los devuelve', () => {
    const ops = new PlaylistOps(db, pl)
    const a = pedido('Cala', 'Falta', 'Uno'), b = pedido('Cala', 'Falta', 'Dos')
    const m = ops.merge([a.playlistId!, b.playlistId!], 'Cala junta', true)
    expect(reqPl(a.id)).toBe(m.id)
    expect(reqPl(b.id)).toBe(m.id)
    expect(wanted.list(undefined, undefined, m.id).map((i) => i.title).sort()).toEqual(['Dos', 'Uno'])
    ops.undo(m.batchId)
    expect(reqPl(a.id)).toBe(a.playlistId)
    expect(reqPl(b.id)).toBe(b.playlistId)
    // sin sacar las originales, los pedidos quedan donde estaban
    const m2 = ops.merge([a.playlistId!, b.playlistId!], 'Otra', false)
    expect(reqPl(a.id)).toBe(a.playlistId)
    ops.undo(m2.batchId)
  })

  it('borrar una playlist (o su carpeta) avisa sus pedidos y se deshace desde el Historial con ellos enganchados', () => {
    const ops = new PlaylistOps(db, pl)
    const folder = pl.create('Fiestas', 'folder')
    const d = req.create({ name: 'Boda', source: 'CSV de Spotify', parentId: folder, items: [{ position: 1, artist: 'Falta', title: 'Tres', album: null, duration: 200, isrc: null, kind: 'none', why: '', decision: null, fileId: null }] })
    expect(ops.requestsIfRemoved(d.playlistId!)).toBe(1)
    expect(ops.requestsIfRemoved(folder)).toBe(1)
    expect(ops.requestsIfRemoved(pl.create('Sin pedido'))).toBe(0)
    const batch = ops.remove(folder)!
    expect(pl.tree().some((n) => n.id === folder || n.id === d.playlistId)).toBe(false)
    expect(reqPl(d.id)).toBeNull()
    expect(ops.entries().find((e) => e.id === batch)!.summary).toContain('«Fiestas»')
    ops.undo(batch)
    const t = pl.tree()
    expect(t.find((n) => n.id === d.playlistId)?.parentId).toBe(folder)
    expect(reqPl(d.id)).toBe(d.playlistId)
    expect(wanted.list(undefined, undefined, d.playlistId).map((i) => i.title)).toEqual(['Tres'])
  })
})

describe('la pantalla', () => {
  const wl = fs.readFileSync(path.join(ROOT, 'apps/paila/ui/src/WantedList.tsx'), 'utf8')
  it('el filtro manda la playlist a la tabla, a Exportar y a NAPIA, y se refresca con las playlists', () => {
    expect(wl).toContain('window.paila.wanted(c, playlistId)')
    expect(wl).toContain('window.paila.exportWanted(format, onlyNew, playlistId, que)')
    expect(wl).toContain('window.paila.wantedToNapia(onlyNew, playlistId, que)')
    expect(wl).toContain("addEventListener('paila:playlists', f)")
  })
  it('la playlist creada con Traer una lista se ve: el grupo plegado se abre y hay un botón "Ver la playlist"', () => {
    const side = fs.readFileSync(path.join(ROOT, 'apps/paila/ui/src/Sidebar.tsx'), 'utf8')
    expect(side).toContain('abrirAlCrecer={p.playlists.length}')
    expect(side).toMatch(/abrirAlCrecer > antes\.current\) \{ setClosed\(false\)/)
    expect(fs.readFileSync(path.join(ROOT, 'apps/paila/ui/src/Requests.tsx'), 'utf8')).toContain('onOpenPlaylist((data as RequestDetail).playlistId!)')
    expect(fs.readFileSync(path.join(ROOT, 'apps/paila/ui/src/hooks/usePlaylists.ts'), 'utf8')).toContain("dispatchEvent(new Event('paila:playlists'))")
  })
})
