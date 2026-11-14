// Tests de la búsqueda de nombres oficiales con fuentes simuladas (core/official-run.ts, core/online/sources.ts), de lo que
// se generaliza a otros temas del mismo artista (core/official-findings.ts), del diccionario de artistas
// (core/artistdict.ts) y del perfil Oficial dentro del asistente (core/tidy-official.ts). Discogs y AcoustID: datos armados.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { ArtistDict, sameName } from '@paila/core/artistdict'
import { OfficialSearch, cleanedRows } from '@paila/core/official-run'
import { artistKey, officialFindings, printKey, recKey } from '@paila/core/official-findings'
import { OnlineCache, Polite, type FetchFn, type HttpRes } from '@paila/core/online/http'
import { AcoustId, Deezer, Discogs } from '@paila/core/online/sources'
import { tidy } from '@paila/core/tidy'
import { rulesOf } from '@paila/shared/tidy-profiles'
import type { RecHit } from '@paila/core/online/hits'

let dir: string
let db: Db
let nextId = 1
const add = (rel: string, artist: string | null, title: string | null, duration = 200) => {
  const id = nextId++
  db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, duration, artist, title, codec) VALUES (?, 1, ?, 1000, 1, 'musica', 'mp3', ?, ?, ?, 'mp3')").run(id, rel, duration, artist, title)
  return id
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-oficial-'))
  db = openDb(path.join(dir, 'paila.db'))
  db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', 'C:/')").run()
  db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
  nextId = 1
})
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

const res = (status: number, body: unknown): HttpRes => ({ ok: status < 400, status, json: async () => body })
const mbRec = (artist: string, title: string, ms: number) => ({ title, length: ms, 'artist-credit': [{ name: artist, joinphrase: '', artist: { id: `id-${artist}`, name: artist } }], releases: [] })

describe('ritmo de pedidos', () => {
  it('los pedidos salen separados por el ritmo del servicio aunque se pidan a la vez', async () => {
    // Con reloj falso: con el de verdad, si la PC estaba cargada el proceso se frenaba entre que el primero reservaba su
    // turno y salía, o Windows adelantaba un temporizador, y los pedidos quedaban a menos de 85 ms (fallaba solo).
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
    try {
      const starts: number[] = [], events: string[] = []
      let n = 0
      const slow: FetchFn = async () => {
        const i = ++n
        starts.push(Date.now()); events.push(`sale ${i}`)
        await new Promise((r) => setTimeout(r, 300))
        events.push(`vuelve ${i}`)
        return res(200, {})
      }
      const http = new Polite('Prueba', 100, slow)
      const all = Promise.all([http.get('a'), http.get('b'), http.get('c')])
      await vi.runAllTimersAsync()
      await all
      // exactamente al ritmo del servicio: uno cada 100 ms
      expect(starts.map((t) => t - starts[0])).toEqual([0, 100, 200])
      // no espera la respuesta anterior: el segundo y el tercero salen antes de que vuelva el primero (que tarda 300 ms)
      expect(events).toEqual(['sale 1', 'sale 2', 'sale 3', 'vuelve 1', 'vuelve 2', 'vuelve 3'])
    } finally { vi.useRealTimers() }
  })

  it('si el servicio pide ir más despacio (429), espera más y reintenta, sin adelantar a los que esperan', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
    try {
      const t0 = Date.now(), log: string[] = []
      let busy = true
      const fetchFn: FetchFn = async (url) => {
        log.push(`${url} ${Date.now() - t0}`)
        if (url === 'a' && busy) { busy = false; return res(429, {}) }
        return res(200, {})
      }
      const http = new Polite('Prueba', 100, fetchFn)
      const all = Promise.all([http.get('a'), http.get('b')])
      await vi.runAllTimersAsync()
      expect((await all).map((r) => r.status)).toEqual([200, 200])
      // "a" sale, le dicen 429; "b" ya tenía su turno a los 100 ms; "a" reintenta 4 s después del próximo turno libre
      expect(log).toEqual(['a 0', 'b 100', 'a 4200'])
    } finally { vi.useRealTimers() }
  })
})

describe('buscar en internet (fuentes simuladas)', () => {
  it('pregunta a cada fuente una sola vez, con los artistas de MusicBrainz primero, y guarda todo en la caché', async () => {
    add('a.mp3', 'Los Redondos', 'Tarea Fina', 210)
    add('b.mp3', 'Los Redondos', 'Ji Ji Ji', 300)
    const urls: { url: string; headers?: Record<string, string> }[] = []
    const fetchFn: FetchFn = async (url, init) => {
      urls.push({ url, headers: init?.headers })
      if (url.includes('/ws/2/artist/')) return res(200, { artists: [{ id: 'pr', name: 'Patricio Rey y sus Redonditos de Ricota', score: 100, aliases: [{ name: 'Los Redondos' }] }] })
      if (url.includes('/ws/2/recording/')) return res(200, { recordings: decodeURIComponent(url).includes('arid:pr') ? [mbRec('Patricio Rey y sus Redonditos de Ricota', decodeURIComponent(url).includes('Tarea') ? 'Tarea fina' : 'Ji ji ji', decodeURIComponent(url).includes('Tarea') ? 211_000 : 299_000)] : [] })
      if (url.includes('api.deezer.com')) return res(200, { data: [] })
      if (url.includes('api.discogs.com')) return res(200, { results: [{ title: 'Patricio Rey Y Sus Redonditos De Ricota - Lobo Suelto', style: ['Rock'] }] })
      return res(404, {})
    }
    const s = new OfficialSearch(db, { ua: 'PAILA-test', keys: () => ({ discogs: { key: 'K123456', secret: 'S123456' } }), fetchFn, gapMs: { musicbrainz: 0, deezer: 0, discogs: 0, acoustid: 0 } })
    const rows = cleanedRows(db)
    expect(s.todo(rows)).toMatchObject({ tracks: 2, artists: 1, musicbrainz: 3, deezer: 2, discogs: 2, acoustid: 0 })
    const p = await s.run(rows, () => {}, () => false)
    expect(p.done).toBe(7)
    // los temas de MusicBrainz se buscaron entre los artistas encontrados (el id del alias)
    expect(urls.filter((u) => u.url.includes('/ws/2/recording/')).every((u) => decodeURIComponent(u.url).includes('arid:pr'))).toBe(true)
    // Discogs con la clave de la aplicación en el encabezado (como dice su documentación), nunca en la dirección
    const dg = urls.find((u) => u.url.includes('discogs'))!
    expect(dg.headers?.Authorization).toBe('Discogs key=K123456, secret=S123456')
    expect(dg.url).not.toContain('K123456')
    expect(dg.headers?.['User-Agent']).toBe('PAILA-test')
    // la segunda vez no se pide nada
    urls.length = 0
    await s.run(rows, () => {}, () => false)
    expect(urls).toEqual([])
    const f = officialFindings(db, rows)
    expect([...f.values()].flat().filter((x) => x.field === 'artist').map((x) => [x.field, x.to, x.conf])).toEqual([
      ['artist', 'Patricio Rey y sus Redonditos de Ricota', 'alta'],
      ['artist', 'Patricio Rey y sus Redonditos de Ricota', 'alta'],
    ])
  })

  it('Deezer: si no encuentra el remix, busca el tema original (sin el paréntesis)', async () => {
    const qs: string[] = []
    const fetchFn: FetchFn = async (url) => { qs.push(decodeURIComponent(new URL(url).searchParams.get('q') ?? '')); return res(200, { data: qs.length === 3 ? [{ title: 'Blinding Lights', duration: 200, artist: { name: 'The Weeknd' } }] : [] }) }
    const hits = await new Deezer(fetchFn, 0).recordings('The Weekend', 'Blinding Lights (Asi-C Dancehall Remix 2020)')
    expect(qs).toEqual(['artist:"The Weekend" track:"Blinding Lights (Asi-C Dancehall Remix 2020)"', 'The Weekend Blinding Lights (Asi-C Dancehall Remix 2020)', 'The Weekend Blinding Lights'])
    expect(hits[0]).toMatchObject({ title: 'Blinding Lights', credit: [{ name: 'The Weeknd' }] })
  })

  it('una clave que no anda para esa fuente sola (las otras siguen)', async () => {
    add('a.mp3', 'Balvin', 'Mi Gente', 187)
    const fetchFn: FetchFn = async (url) => (url.includes('discogs') ? res(401, { message: 'Invalid consumer key/secret' }) : url.includes('deezer') ? res(200, { data: [{ title: 'Mi Gente', duration: 187, artist: { name: 'J Balvin' } }] }) : res(200, { artists: [], recordings: [] }))
    const s = new OfficialSearch(db, { ua: 'x', keys: () => ({ discogs: { token: 'malo123' } }), fetchFn, gapMs: { musicbrainz: 0, deezer: 0, discogs: 0 } })
    const p = await s.run(cleanedRows(db), () => {}, () => false)
    expect(p.bySource.discogs?.stopped).toMatch(/no aceptó la clave/)
    expect(p.bySource.deezer?.done).toBe(1)
  })

  it('AcoustID: reconoce los temas sin nombre por la huella guardada y avisa si la clave es mala', async () => {
    const id = add('Sin nombre/pista 03.mp3', null, null, 205)
    db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, chromaprint) VALUES (?, 1, 1, 1, '', 'AQAAHUOSS')").run(id)
    let body = ''
    const fetchFn: FetchFn = async (url, init) => {
      if (!url.includes('acoustid')) return res(200, { artists: [], recordings: [], data: [] })
      body = init?.body ?? ''
      return res(200, { status: 'ok', results: [{ score: 0.97, recordings: [{ title: 'De música ligera', duration: 210, artists: [{ name: 'Soda Stereo' }] }] }] })
    }
    const s = new OfficialSearch(db, { ua: 'x', keys: () => ({ acoustid: 'CLAVE1234' }), fetchFn, gapMs: { musicbrainz: 0, deezer: 0, acoustid: 0 } })
    const rows = cleanedRows(db)
    expect(s.todo(rows).acoustid).toBe(1)
    await s.run(rows, () => {}, () => false)
    expect(body).toContain('fingerprint=AQAAHUOSS')
    expect(body).toContain('duration=205')
    expect(new OnlineCache(db).get('acoustid', printKey('AQAAHUOSS'))?.status).toBe('ok')
    expect(officialFindings(db, rows).get(id)).toEqual([expect.objectContaining({ field: 'artist', to: 'Soda Stereo', conf: 'alta' }), expect.objectContaining({ field: 'title', to: 'De música ligera' })])
    const bad: FetchFn = async () => res(400, { status: 'error', error: { code: 4, message: 'invalid API key' } })
    await expect(new AcoustId('mala', 'x', bad, 0).test()).rejects.toThrow(/no aceptó la clave/)
    await expect(new Discogs({ key: 'a', secret: 'b' }, 'x', async () => res(401, {}), 0).test()).rejects.toThrow(/no aceptó la clave/)
  })

  it('lo que AcoustID ya reconoció con el mismo nombre y duración no se le pregunta a MusicBrainz, y "encontrados" cuenta temas', async () => {
    // prueba con personas, 28/10: 300 temas, 1.174 búsquedas, 37 min (30 de MusicBrainz) y "1.429 encontrados"
    const a = add('a.mp3', 'Sumo', 'La Rubia Tarada', 215), b = add('b.mp3', 'Sumo', 'Divididos Por La Felicidad', 240)
    for (const [id, fp] of [[a, 'AQAAHUOSA'], [b, 'AQAAHUOSB']] as const) db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, chromaprint) VALUES (?, 1, 1, 1, '', ?)").run(id, fp)
    const recs: string[] = []
    const fetchFn: FetchFn = async (url, init) => {
      if (url.includes('acoustid')) {
        // la huella de "a" es ese tema (como lo escribe MusicBrainz); la de "b", otra versión más larga
        return res(200, { status: 'ok', results: (init?.body ?? '').includes('AQAAHUOSA')
          ? [{ score: 0.96, recordings: [{ title: 'La rubia tarada', duration: 214, artists: [{ name: 'Sumo' }] }] }]
          : [{ score: 0.95, recordings: [{ title: 'Divididos por la felicidad', duration: 300, artists: [{ name: 'Sumo' }] }] }] })
      }
      if (url.includes('/ws/2/artist/')) return res(200, { artists: [{ id: 'sumo', name: 'Sumo', score: 100, aliases: [] }] })
      if (url.includes('/ws/2/recording/')) { recs.push(decodeURIComponent(url)); return res(200, { recordings: [mbRec('Sumo', 'Divididos por la felicidad', 240_000)] }) }
      if (url.includes('api.deezer.com')) return res(200, { data: [{ title: 'La Rubia Tarada', duration: 215, artist: { name: 'Sumo' } }, { title: 'Divididos Por La Felicidad', duration: 240, artist: { name: 'Sumo' } }] })
      return res(404, {})
    }
    const s = new OfficialSearch(db, { ua: 'x', keys: () => ({ acoustid: 'CLAVE1234' }), fetchFn, gapMs: { musicbrainz: 0, deezer: 0, acoustid: 0 } })
    const rows = cleanedRows(db)
    const seen: number[] = []
    const p = await s.run(rows, (x) => seen.push(x.total), () => false)
    // a MusicBrainz solo se le preguntó por "b" (la de "a" ya la trajo AcoustID) y el total se achicó al saberlo
    expect(recs).toHaveLength(1)
    expect(recs[0]).toContain('Divididos')
    expect(seen[0]).toBe(7) // 1 artista + 2 temas en MusicBrainz, 2 en Deezer, 2 huellas
    expect(p.total).toBe(6)
    expect(p.done).toBe(6)
    // dos temas, encontrados en tres fuentes cada uno: cuentan dos
    expect(p.found).toBe(2)
    // y la propuesta de "a" sale igual que si se le hubiera preguntado a MusicBrainz
    expect(officialFindings(db, rows).get(a)).toEqual([expect.objectContaining({ field: 'title', to: 'La rubia tarada', conf: 'alta', sources: ['musicbrainz'] })])
    expect(officialFindings(db, rows).get(b)).toEqual([expect.objectContaining({ field: 'title', to: 'Divididos por la felicidad' })])
  })
})

describe('generalizar a los otros temas del mismo artista', () => {
  const put = (src: 'musicbrainz' | 'deezer', artist: string, title: string, hits: RecHit[]) => new OnlineCache(db).put(src, recKey(artist, title), 'ok', hits)
  const r = (artist: string, title: string, len: number): RecHit => ({ source: 'musicbrainz', title, credit: [{ name: artist, join: '' }], length: len })
  it('dos temas confirmados alcanzan para proponer el nombre en los que no se encontraron', () => {
    const a = add('1.mp3', 'Los Redondos', 'Tarea Fina', 210), b = add('2.mp3', 'Los Redondos', 'Ji Ji Ji', 300), c = add('3.mp3', 'los redondos', 'Rarezas en vivo', 250)
    new OnlineCache(db).put('musicbrainz', artistKey('Los Redondos'), 'ok', [{ source: 'musicbrainz', id: 'pr', name: 'Patricio Rey y sus Redonditos de Ricota', score: 100, aliases: ['Los Redondos'] }])
    put('musicbrainz', 'Los Redondos', 'Tarea Fina', [r('Patricio Rey y sus Redonditos de Ricota', 'Tarea fina', 211)])
    put('musicbrainz', 'Los Redondos', 'Ji Ji Ji', [r('Patricio Rey y sus Redonditos de Ricota', 'Ji ji ji', 300)])
    const f = officialFindings(db, cleanedRows(db))
    expect(f.get(a)?.[0]).toMatchObject({ conf: 'alta' })
    expect(f.get(b)?.[0]).toMatchObject({ conf: 'alta' })
    expect(f.get(c)?.[0]).toMatchObject({ field: 'artist', to: 'Patricio Rey y sus Redonditos de Ricota', conf: 'alta', why: expect.stringMatching(/mismo artista/) })
  })
  it('si un tema confirma el nombre tal cual, no se generaliza (pueden ser dos artistas que se llaman igual)', () => {
    add('1.mp3', 'Miranda', 'Ya lo Sabia', 181); add('2.mp3', 'Miranda', 'Vamos a la playa', 200); const c = add('3.mp3', 'Miranda', 'Otro', 200)
    put('musicbrainz', 'Miranda', 'Ya lo Sabia', [r('Miranda!', 'Ya lo sabía', 181)])
    put('musicbrainz', 'Miranda', 'Vamos a la playa', [r('Miranda', 'Vamos a la playa', 200)])
    expect(officialFindings(db, cleanedRows(db)).get(c)).toBeUndefined()
  })
  it('sin ningún tema confirmado, el alias exacto de MusicBrainz se propone para mirar a mano', () => {
    const a = add('1.mp3', 'Los Redondos', 'Tema raro', 210)
    new OnlineCache(db).put('musicbrainz', artistKey('Los Redondos'), 'ok', [{ source: 'musicbrainz', id: 'pr', name: 'Patricio Rey y sus Redonditos de Ricota', score: 100, aliases: ['Los Redondos'] }])
    expect(officialFindings(db, cleanedRows(db)).get(a)?.[0]).toMatchObject({ to: 'Patricio Rey y sus Redonditos de Ricota', conf: 'media' })
  })
})

describe('diccionario de artistas', () => {
  it('aprende solo correcciones del mismo nombre', () => {
    expect(sameName('Balvin', 'J Balvin')).toBe(true)
    expect(sameName('Los Redondos', 'Patricio Rey y sus Redonditos de Ricota')).toBe(true)
    expect(sameName('The Weekend', 'The Weeknd')).toBe(true)
    expect(sameName('Alma Fuerte', 'Almafuerte')).toBe(true)
    expect(sameName('cumbia', 'Damas Gratis')).toBe(false)
    const d = new ArtistDict(db)
    expect(d.learn('Balvin', 'J Balvin', 'edicion')).toBe(1)
    expect(d.learn('cumbia', 'Damas Gratis', 'edicion')).toBe(0)
    // un invitado agregado es de ese tema, no del artista
    expect(d.learn('Emilia', 'Emilia feat. TINI', 'edicion')).toBe(0)
    expect(d.learn('Balvin feat. Bad Bunny', 'J Balvin feat. Bad Bunny', 'edicion')).toBe(1)
    expect(d.list().map((e) => [e.from, e.to])).toEqual([['Balvin', 'J Balvin']])
  })
  it('se aplica por partes y se exporta e importa sin pisar lo propio', () => {
    const d = new ArtistDict(db)
    d.set('Balvin', 'J Balvin', 'a mano'); d.set('Alma Fuerte', 'Almafuerte', 'a mano')
    expect(ArtistDict.apply('balvin & Bad Bunny', d.map())).toBe('J Balvin & Bad Bunny')
    const out = d.export()
    d.remove('Alma Fuerte'); d.set('Balvin', 'J. Balvin', 'a mano')
    const r = d.import(out)
    expect(r).toEqual({ added: 1, same: 0, clashes: [{ from: 'Balvin', mine: 'J. Balvin', theirs: 'J Balvin' }] })
    expect(() => d.import('{"hola":1}')).toThrow(/no es un diccionario/)
  })
})

describe('perfil Oficial en el asistente', () => {
  it('lo seguro se propone, lo dudoso va a "para mirar a mano" y el diccionario manda', () => {
    const a = add('1.mp3', 'La Renga', 'Cuando Vendran', 201)
    const b = add('2.mp3', 'Balvin', 'Mi Gente', 187)
    const c = add('3.mp3', 'Miranda', 'Ya lo Sabia', 181)
    const d = add('4.mp3', 'Enanitos Verdes', 'Lamento Boliviano', 222)
    const cache = new OnlineCache(db)
    cache.put('musicbrainz', recKey('La Renga', 'Cuando Vendran'), 'ok', [{ source: 'musicbrainz', title: 'Cuando vendrán', credit: [{ name: 'La Renga', join: '' }], length: 200 }])
    cache.put('musicbrainz', recKey('Balvin', 'Mi Gente'), 'ok', [{ source: 'musicbrainz', title: 'Mi Gente', credit: [{ name: 'J Balvin', join: '' }], length: 186 }])
    cache.put('musicbrainz', recKey('Enanitos Verdes', 'Lamento Boliviano'), 'ok', [{ source: 'musicbrainz', title: 'Lamento boliviano', credit: [{ name: 'Los Enanitos Verdes', join: '' }], length: 223 }])
    cache.put('musicbrainz', recKey('Miranda', 'Ya lo Sabia'), 'ok', [{ source: 'musicbrainz', title: 'Ya lo sabía', credit: [{ name: 'Miranda!', join: '' }], length: 181 }])
    // en Prolijo no se usa internet
    expect(tidy(db, undefined, undefined, rulesOf('prolijo')).changes.filter((x) => x.step === 'official')).toEqual([])
    const r = tidy(db, undefined, undefined, rulesOf('oficial'))
    // las mayúsculas son las del tema (el autor, 24/10): las tildes sí, "Lamento Boliviano" → "Lamento boliviano" (solo mayúsculas) no
    expect(r.changes.filter((x) => x.step === 'official').map((x) => [x.id, x.field, x.to])).toEqual([[a, 'title', 'Cuando Vendrán'], [c, 'artist', 'Miranda!'], [c, 'title', 'Ya lo Sabía']])
    // "Balvin" → "J Balvin" con una sola fuente no se propone (una palabra sola); "Enanitos Verdes" va a mirar a mano
    expect(r.review.filter((x) => !x.staged)).toEqual([expect.objectContaining({ id: d, field: 'artist', to: 'Los Enanitos Verdes', origin: 'oficial' })])
    // "Miranda → Miranda" en el diccionario ("así está bien") frena la propuesta de internet
    new ArtistDict(db).set('Miranda', 'Miranda', 'aceptado')
    expect(tidy(db, undefined, undefined, rulesOf('oficial')).changes.some((x) => x.id === c && x.field === 'artist')).toBe(false)
    // y una corrección del diccionario se aplica sola (también en Prolijo)
    new ArtistDict(db).set('Balvin', 'J Balvin', 'edicion')
    expect(tidy(db, undefined, undefined, rulesOf('prolijo')).changes.find((x) => x.id === b && x.field === 'artist')).toMatchObject({ to: 'J Balvin', rules: ['diccionario'] })
  })
})
