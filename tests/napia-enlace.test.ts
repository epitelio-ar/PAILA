// El enlace NAPIA ↔ PAILA (el autor, 1/11): NAPIA deja en qué anda en un archivo, PAILA lo lee; lo que no se consiguió
// queda marcado en «Faltan o suenan mal».
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { ENLACE_VENCE_MS, escribirEnlace, leerEnlace, vigente, type EnlaceNapia } from '@paila/core/sockseek/enlace'
import { marcarNoConseguidos } from '@paila/core/wanted-napia'
import { Jobs } from '@paila/core/jobs'

const e = (o: Partial<EnlaceNapia> = {}): EnlaceNapia => ({ hora: Date.now(), corriendo: true, lista: 'PAILA - mejorar calidad', hechos: 10, total: 100, bajados: 7, carpeta: 'F:/NAPIA', fin: null, ...o })

describe('enlace NAPIA → PAILA', () => {
  it('se escribe entero y se lee de la primera carpeta que lo tiene', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'enl-a-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'enl-b-'))
    escribirEnlace(b, e())
    expect(leerEnlace([a, b])?.lista).toBe('PAILA - mejorar calidad')
    expect(fs.readdirSync(b)).toEqual(['para-paila.json'])
  })
  it('un "corriendo" viejo es de una NAPIA que se cerró', () => {
    expect(vigente(e())).toBe(true)
    expect(vigente(e({ hora: Date.now() - ENLACE_VENCE_MS - 1 }))).toBe(false)
    expect(vigente(e({ corriendo: false }))).toBe(false)
  })
  it('la bajada se ve en la barra de trabajos y desaparece al terminar', () => {
    let ultimo: { kind: string }[] = []
    const j = new Jobs((l) => { ultimo = l })
    j.externo('napia', 'NAPIA bajando', { done: 3, total: 10, current: '', found: 2, startedAt: 0 })
    expect(j.list().map((x) => x.kind)).toEqual(['napia'])
    j.externo('napia', '', null)
    expect(j.list()).toEqual([])
    expect(ultimo).toEqual([])
  })
})

describe('lo que NAPIA no consiguió vuelve a la lista', () => {
  it('marca por artista y título, sin tocar lo ya reemplazado', () => {
    const db = new DatabaseSync(':memory:')
    db.exec("CREATE TABLE wanted (id INTEGER PRIMARY KEY, artist TEXT, title TEXT, status TEXT, note TEXT NOT NULL DEFAULT '', updated_at TEXT)")
    db.exec("INSERT INTO wanted (artist, title, status) VALUES ('La Renga', 'Ruta 40', 'pedido'), ('Soda Stereo', 'Té para tres', 'pendiente'), ('La Renga', 'Ruta 40 ', 'reemplazado')")
    expect(marcarNoConseguidos(db, [{ artist: 'la renga', title: 'Ruta 40' }], '2026-11-01')).toBe(1)
    const notas = db.prepare('SELECT note FROM wanted ORDER BY id').all() as { note: string }[]
    expect(notas.map((n) => n.note)).toEqual(['no_soulseek:2026-11-01', '', ''])
  })
})

import { openDb } from '@paila/core/db'
import { listaParaMejorar } from '@paila/core/wanted-napia'
describe('Buscar mejor copia con NAPIA desde un tema', () => {
  it('arma la lista con esos temas, aunque no estén en «Faltan o suenan mal»; sin los que no se pueden buscar', () => {
    const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mej-')), 'paila.db'))
    db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', 'C:/')").run()
    db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
    const add = (id: number, rel: string, artist: string | null, title: string | null) =>
      db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, duration, artist, title) VALUES (?, 1, ?, 1, 1, 'musica', 'mp3', 200, ?, ?)").run(id, rel, artist, title)
    add(1, 'Soda Stereo/Persiana americana.mp3', 'Soda Stereo', 'Persiana Americana')
    add(2, 'varios/Track 01.mp3', null, 'Track 01')
    const csv = listaParaMejorar(db, [1, 2])
    expect(csv).toContain('Soda Stereo')
    expect(csv).not.toContain('Track 01')
    expect(listaParaMejorar(db, [])).toBe('')
  })
})
