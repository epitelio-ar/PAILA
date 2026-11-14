// Tests de la cola del reproductor (shared/playqueue.ts) y del álbum de un tema (core/playerqueue.ts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDb, transaction } from '@paila/core/db'
import { albumQueue } from '@paila/core/playerqueue'
import { advance, back, clearQueue, jump, emptyQ, enqueue, nextRepeat, removeFromQueue, setItems, setRepeat, setShuffle, start, upcoming, type PlayQ } from '@paila/shared/playqueue'

const run = (q: PlayQ, steps: number, manual = false, rnd?: () => number) => {
  const out: (number | null)[] = []
  for (let i = 0; i < steps; i++) { const r = advance(q, manual, rnd); q = r.q; out.push(r.id) }
  return { q, out }
}

describe('cola del reproductor', () => {
  it('sigue la lista en orden y termina al final', () => {
    const q = start(emptyQ, [1, 2, 3], 1)
    expect(run(q, 4).out).toEqual([2, 3, null, null])
  })

  it('repetir todo vuelve al principio; repetir uno repite solo cuando termina solo', () => {
    expect(run(setRepeat(start(emptyQ, [1, 2, 3], 2), 'all'), 3).out).toEqual([3, 1, 2])
    const one = setRepeat(start(emptyQ, [1, 2, 3], 2), 'one')
    expect(run(one, 2).out).toEqual([2, 2])                // termina solo: se repite
    expect(run(one, 2, true).out).toEqual([3, null])        // "siguiente" a mano: pasa al que sigue
  })

  it('la cola suena primero y después sigue la lista desde donde estaba', () => {
    let q = start(emptyQ, [1, 2, 3, 4], 2)
    q = enqueue(q, [9], 'end'); q = enqueue(q, [8], 'next') // la cola queda 8, 9
    expect(q.upNext).toEqual([8, 9])
    const r = run(q, 4)
    expect(r.out).toEqual([8, 9, 3, 4])                     // 3 sigue al 2, no al 9
    expect(r.q.upNext).toEqual([])
  })

  it('quitar y vaciar la cola', () => {
    let q = enqueue(start(emptyQ, [1, 2], 1), [5, 6, 7], 'end')
    q = removeFromQueue(q, 1)
    expect(q.upNext).toEqual([5, 7])
    expect(clearQueue(q).upNext).toEqual([])
  })

  it('"anterior" vuelve al último que sonó y se puede ir para atrás varias veces', () => {
    let q = start(emptyQ, [1, 2, 3], 1)
    q = run(q, 2).q                                          // suena el 3
    const a = back(q); expect(a.id).toBe(2)
    const b = back(a.q); expect(b.id).toBe(1)
    expect(back(b.q).id).toBeNull()
    expect(advance(a.q, true).id).toBe(3)                    // y después sigue la lista
  })

  it('aleatorio: no repite hasta agotar la lista y termina (o repite todo)', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const q = setShuffle(start(emptyQ, [1, 2, 3, 4, 5], 3), true)
    const r = run(q, 5, false, rnd)
    expect(r.out.slice(0, 4).sort()).toEqual([1, 2, 4, 5])  // los cuatro que faltaban, sin repetir
    expect(r.out[4]).toBeNull()                             // se acabó
    const again = run(setRepeat(q, 'all'), 12, false, rnd).out
    expect(again.every((x) => x != null)).toBe(true)
    expect(new Set(again.slice(0, 4)).size).toBe(4)
  })

  it('aleatorio con un solo tema y repetir todo no se queda sin tema', () => {
    const q = setRepeat(setShuffle(start(emptyQ, [7], 7), true), 'all')
    expect(run(q, 2).out).toEqual([7, 7])
  })

  it('cambiar la lista (por ejemplo al álbum) sigue desde el tema que suena', () => {
    const q = setItems(start(emptyQ, [1, 2, 3, 4], 2), [10, 2, 11])
    expect(run(q, 2).out).toEqual([11, null])
    expect(upcoming(q)).toEqual([11])
    expect(upcoming(setShuffle(q, true))).toEqual([]) // con aleatorio no se sabe qué sigue
  })

  it('un tema que no está en la lista (vino de la cola) no rompe: sigue desde el último de la lista', () => {
    let q = start(emptyQ, [1, 2, 3], 1)
    q = enqueue(q, [50], 'next')
    expect(run(q, 3).out).toEqual([50, 2, 3])
  })

  it('saltar a un tema de la cola o de la lista: suena ya y lo anterior queda en el historial', () => {
    let q = enqueue(start(emptyQ, [1, 2, 3, 4], 1), [8, 9], 'end')
    q = jump(q, 9)
    expect(q).toMatchObject({ current: 9, upNext: [8], history: [1] })
    q = jump(q, 3)
    expect(q).toMatchObject({ current: 3, anchor: 3, history: [1, 9] })
    expect(run(q, 2).out).toEqual([8, 4])
  })

  it('el botón de repetir recorre apagado → todo → uno', () => {
    expect([nextRepeat('off'), nextRepeat('all'), nextRepeat('one')]).toEqual(['all', 'one', 'off'])
  })
})

describe('álbum de un tema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-playerqueue-'))
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })
  it('lo ordena por número de tema, solo en su carpeta y sin lo que está en la papelera', () => {
    const db = openDb(path.join(dir, 'a.db'))
    transaction(db, () => {
      db.exec("INSERT INTO volumes (serial, label, last_mount) VALUES ('X', 'X', 'C:\\\\')")
      db.exec("INSERT INTO roots (volume_id, rel_path, added_at) VALUES (1, 'M', '2026-01-01')")
      const f = db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, album, track, trashed_at) VALUES (1, ?, 1, 1, 'musica', 'mp3', ?, ?, ?)")
      f.run('Soda/Signos/b.mp3', 'Signos', '2/9', null)      // id 1
      f.run('Soda/Signos/a.mp3', 'Signos', '1/9', null)      // id 2
      f.run('Soda/Signos/c.mp3', ' signos ', '10', null)     // id 3 (mayúsculas y espacios no cuentan)
      f.run('Soda/Signos/z.mp3', 'Signos', null, null)       // id 4 (sin número: al final)
      f.run('Soda/Signos/x.mp3', 'Signos', '3', '2026-01-02') // id 5 (en la papelera)
      f.run('Otro/Signos/a.mp3', 'Signos', '1', null)        // id 6 (otra carpeta, mismo nombre de álbum)
      f.run('Soda/Suelto.mp3', null, null, null)             // id 7 (sin álbum)
    })
    expect(albumQueue(db, 1)).toEqual([2, 1, 3, 4])
    expect(albumQueue(db, 6)).toEqual([6])
    expect(albumQueue(db, 7)).toEqual([7])
    expect(albumQueue(db, 999)).toEqual([])
    db.close()
  })
})
