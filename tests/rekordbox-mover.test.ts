// El aviso antes de mover o renombrar temas que están en Rekordbox (core/rbmoving.ts, pedido del autor del 24/10): Rekordbox
// reconoce cada tema por dónde está, así que si Organizar lo mueve o Arreglar nombres le cambia el nombre del archivo, lo pierde
// hasta que se vuelve a importar. Las dos vistas previas cuentan cuántos son.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { DEFAULT_RULE, Organizer } from '@paila/core/organizer'
import { inRekordbox } from '@paila/core/rbmoving'
import { tidyFirst } from '@paila/core/tidy'
import { rulesOf } from '@paila/shared/tidy-profiles'

let dir: string, lib: Library, rootId: number
const add = (rel: string, t: { artist: string; title: string }) => Number(lib.db.prepare(
  "INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, duration, artist, title, probed_at) VALUES (?, ?, 1, 1, 'musica', 'mp3', 200, ?, ?, '2026-10-24')",
).run(rootId, rel, t.artist, t.title).lastInsertRowid)
const fromXml = (id: number, trackId: string) => lib.db.prepare("INSERT INTO rb_ids (file_id, track_id, source) VALUES (?, ?, 'rekordbox')").run(id, trackId)

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-rb-mover-'))
  fs.mkdirSync(path.join(dir, 'M'))
  lib = new Library(path.join(dir, 'paila.db'), null)
  rootId = (await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])).id
})
afterEach(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('temas que están en Rekordbox y cambian de lugar o de nombre', () => {
  it('cuenta los que vinieron del rekordbox.xml y los que PAILA ya exportó, una vez cada uno', () => {
    const a = add('a.mp3', { artist: 'A', title: 'a' }), b = add('b.mp3', { artist: 'B', title: 'b' }), c = add('c.mp3', { artist: 'C', title: 'c' })
    fromXml(a, '101')
    lib.db.prepare("INSERT INTO rb_ids (file_id, track_id, source) VALUES (?, '102', 'paila')").run(b) // número puesto por PAILA: no basta
    lib.db.prepare("INSERT INTO rb_exports (file_id, exported_at) VALUES (?, '2026-10-24'), (?, '2026-10-24')").run(a, c) // exportados
    expect(inRekordbox(lib.db, [a, b, c, a])).toBe(2)
    expect(inRekordbox(lib.db, [])).toBe(0)
  })

  it('la vista previa de Organizar dice cuántos de los que se mueven están en Rekordbox', () => {
    const moved = add('Rock/soda stereo - signos.mp3', { artist: 'Soda Stereo', title: 'Signos' })
    add('Rock/divididos - el 38.mp3', { artist: 'Divididos', title: 'El 38' })
    const quieto = add('Biblioteca/Charly García/Demoliendo hoteles.mp3', { artist: 'Charly García', title: 'Demoliendo hoteles' })
    fromXml(moved, '201'); fromXml(quieto, '202') // el que ya está en su lugar no cuenta
    const p = new Organizer(lib.db, () => path.join(dir, 'M')).plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' })
    expect(p.moves.map((m) => m.fileId)).not.toContain(quieto)
    expect(p.inRekordbox).toBe(1)
  })

  it('Arreglar nombres dice cuántos de los que cambian de nombre de archivo están en Rekordbox (los de tags solos, no)', () => {
    const sucio = add('Ozric Tentacles - Saucers [www.slider.kz].mp3', { artist: 'Ozric Tentacles', title: 'Saucers' })
    const limpio = add('Soda Stereo - Signos.mp3', { artist: 'SODA STEREO', title: 'signos' }) // cambian sus tags, no el nombre
    fromXml(sucio, '301'); fromXml(limpio, '302')
    const { screen, changes } = tidyFirst(lib.db, () => null, rulesOf('prolijo'))
    expect(changes.some((c) => c.id === sucio && c.field === 'filename')).toBe(true)
    expect(changes.some((c) => c.id === limpio && (c.field === 'filename' || c.field === 'extension'))).toBe(false)
    expect(screen.inRekordbox).toBe(1)
  })
})
