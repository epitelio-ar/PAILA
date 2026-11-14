// Tests de lo que salió del uso real de NAPIA (24/10, docs/pruebas/2026-10-24-uso-real.md):
// - "Saltear lo que ya tenés" saltea solo lo que tenés bien (A/B); lo de mala calidad se baja para reemplazarlo (yatenes.ts);
// - lo que la lista «Faltan o suenan mal» manda como "otra versión" ("No es") no se saltea (wanted.ts → listexport.ts → listparse.ts);
// - una acapella (o un remix, en vivo) que no se pidió no sirve: se busca en otro usuario (otraversion.ts, control.ts);
// - lo bajado llega con el nombre y los tags de la lista (nombres.ts);
// - lo que quedó a medio bajar de una fuente lenta se borra al terminar (carpetas.ts, limpiarAMedias).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from '@paila/core/db'
import { Requests } from '@paila/core/requests'
import { Playlists } from '@paila/core/playlists'
import { Wanted } from '@paila/core/wanted'
import { napiaCsv } from '@paila/core/listexport'
import { parseCsv } from '@paila/core/listparse'
import { buenaCalidad, saltearTenes, type TemaPaila } from '@paila/core/sockseek/yatenes'
import { otraVersion } from '@paila/core/sockseek/otraversion'
import { arreglarArchivo, nombreDeLista } from '@paila/core/sockseek/nombres'
import { DESCARTADOS, entregar, limpiarAMedias, rutasTrabajo } from '@paila/core/sockseek/carpetas'
import { resumir } from '@paila/core/sockseek/tanda'
import { readTags, writeTags } from '@paila/core/tagio'
import { pcmHash } from '@paila/core/audiohash'
import { bajarLista, ffmpeg, hacerAudios } from './fixtures/napia-lista'

let dir: string
let a: (n: string) => string
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-uso-real-'))
  a = hacerAudios(dir)
}, 120_000)
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const tema = (title: string, duration = 200) => ({ artist: 'Soda Stereo', title, album: null, duration })
const lib = (title: string, grade: string | null, flags: string | null = null, id = 1): TemaPaila =>
  ({ id, rel: `Rock/Soda Stereo - ${title}.mp3`, ext: 'mp3', artist: 'Soda Stereo', title, duration: 200, grade, flags, isrc: null, effKbps: 128, clipEvents: 3, lufs: -8 })

describe('"Saltear lo que ya tenés" mira la calidad', () => {
  it('saltea lo que tenés en A o B; lo de C, D o F (o inflado) lo baja para reemplazarlo', () => {
    const biblio = [lib('Uno', 'A'), lib('Dos', 'B', null, 2), lib('Tres', 'C', null, 3), lib('Cuatro', 'D', null, 4), lib('Cinco', 'B', 'upscaled', 5), lib('Seis', null, null, 6)]
    const r = saltearTenes(['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete'].map((t) => tema(t)), biblio)
    // sin analizar todavía (Seis) no se sabe: se saltea, como antes
    expect(r.tenes.map((t) => t.title)).toEqual(['Uno', 'Dos', 'Seis'])
    expect(r.mejorar.map((t) => [t.title, t.nota])).toEqual([['Tres', 'C'], ['Cuatro', 'D'], ['Cinco', 'B']])
    expect(r.faltan.map((t) => t.title)).toEqual(['Tres', 'Cuatro', 'Cinco', 'Siete'])
    // lo de mala calidad viaja con tu copia: NAPIA se queda solo con una claramente mejor (control.ts, esMejor)
    expect(r.faltan[1].reemplaza).toMatchObject({ nota: 'D', kbps: 128, que: 'MP3 · nota D', recortes: 3, lufs: -8, duracion: 200, marcas: [] })
    expect(r.faltan[2].reemplaza).toMatchObject({ nota: 'B', marcas: ['upscaled'] })
    expect(r.faltan[3].reemplaza).toBeUndefined()
    expect(buenaCalidad(lib('x', 'A+'))).toBe(true)
    expect(buenaCalidad(lib('x', 'F'))).toBe(false)
  })

  it('lo marcado "otra versión" no se saltea aunque se parezca a lo que tenés', () => {
    const r = saltearTenes([{ ...tema('Uno'), otraVersion: true }], [lib('Uno', 'A')])
    expect(r.tenes).toHaveLength(0)
    expect(r.faltan[0]).toMatchObject({ title: 'Uno', otraVersion: true })
  })
})

describe('"No es · otra versión" viaja de PAILA a NAPIA', () => {
  it('la lista «Faltan o suenan mal» lo marca, el CSV para NAPIA lo lleva y NAPIA lo lee', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-otra-'))
    const db = openDb(path.join(d, 'paila.db'))
    try {
      db.exec("INSERT INTO volumes (id, serial, last_mount) VALUES (1, 'X', 'C:\\'); INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', 'x')")
      const vogue = Number(db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, title, duration) VALUES (1, 'Madonna - Vogue.mp3', 1, 1, 'musica', 'mp3', 'Madonna', 'Vogue', 319)").run().lastInsertRowid)
      const wanted = new Wanted(db)
      const req = new Requests(db, new Playlists(db, () => null), wanted, () => null)
      const det = req.create({ name: 'Fiesta 2026', source: 'Spotify', items: [
        { position: 1, artist: 'Madonna', title: 'Vogue', album: null, duration: 316, isrc: null, kind: 'probable', why: 'otra versión', decision: 'no', fileId: vogue },
        { position: 2, artist: 'Virus', title: 'Wadu Wadu', album: null, duration: 200, isrc: null, kind: 'none', why: '', decision: null, fileId: null },
      ] })
      expect(det.items.map((i) => i.state)).toEqual(['falta', 'falta'])
      const csv = wanted.export('napia-csv').text
      expect(csv.split('\r\n')[0]).toContain('Other Version')
      const leido = parseCsv(csv).entries
      expect(leido.find((e) => e.title === 'Vogue')?.otraVersion).toBe(true)
      expect(leido.find((e) => e.title === 'Wadu Wadu')?.otraVersion).toBeUndefined()
    } finally { db.close(); fs.rmSync(d, { recursive: true, force: true }) }
    // sin nada marcado, el CSV para NAPIA no cambia
    expect(napiaCsv([{ artist: 'A', title: 'B' }])).toBe('Artist,Title,Album\r\nA,B,\r\n')
  })
})

describe('otra versión que no pediste', () => {
  it('reconoce la acapella, el instrumental, el remix y en vivo; no lo que pediste ni "Original Mix"', () => {
    const salgo = { artist: 'Daddy Yankee', title: "Salgo Pa' la Calle" }
    expect(otraVersion(salgo, 'C:/t/Daddy Yankee - Salgo Pa La Calle (Acapella).mp3')).toBe('acapella')
    expect(otraVersion(salgo, 'C:/t/daddy_yankee-salgo_pa_la_calle-a_cappella.mp3')).toBe('acapella')
    expect(otraVersion(salgo, 'C:\\t\\Salgo Pa La Calle [Instrumental].flac')).toBe('instrumental')
    expect(otraVersion(salgo, 'C:/t/Salgo Pa La Calle (DJ Nelson Remix).mp3')).toBe('remix')
    expect(otraVersion(salgo, 'C:/t/Salgo Pa La Calle (En Vivo).mp3')).toBe('en vivo')
    expect(otraVersion(salgo, 'C:/t/Daddy Yankee - Salgo Pa La Calle.mp3')).toBeNull()
    expect(otraVersion(salgo, 'C:/t/Daddy Yankee - Salgo Pa La Calle (Original Mix).mp3')).toBeNull()
    // la carpeta no cuenta: un disco de remixes trae también el original
    expect(otraVersion(salgo, 'C:/Remixes Live/Daddy Yankee - Salgo Pa La Calle.mp3')).toBeNull()
    // si pediste la acapella (o el remix), eso es lo que se quiere
    expect(otraVersion({ artist: 'X', title: 'Tema (Acapella)' }, 'C:/t/X - Tema (Acappella).wav')).toBeNull()
    expect(otraVersion({ artist: 'X', title: 'Tema - Furz Remix' }, 'C:/t/X - Tema (Furz Remix).mp3')).toBeNull()
    expect(otraVersion({ artist: 'X', title: 'Tema - Live' }, 'C:/t/X - Tema (en vivo).mp3')).toBeNull()
  })

  it('al bajar: la acapella se aparta y se busca en otro usuario; si solo hay acapellas, "no se encontró"', async () => {
    const r = await bajarLista(path.join(dir, 'acapella'), 'buena', {
      Salgo: [['ana', a('m320.mp3'), 'como:A - Salgo (Acapella).mp3'], ['beto', a('m320.mp3')]],
      Otro: [['caro', a('m320.mp3'), 'como:A - Otro (Instrumental).mp3'], ['dani', a('m320.mp3'), 'como:A - Otro (Acapella).mp3']],
    }, { arreglar: async () => null })
    const salgo = r.porTitulo('Salgo'), otro = r.porTitulo('Otro')
    expect(salgo).toMatchObject({ state: 'bajado', fuente: 'beto' })
    expect(salgo.calidad).toMatchObject({ estado: 'reemplazado', descartadas: 1, motivo: 'otraVersion', nota: 'B' })
    expect(salgo.calidad?.es).not.toMatch(/otra versión/)
    expect(path.dirname(salgo.path!)).toBe(r.carpeta)
    // solo otras versiones (y después nadie más lo tiene): no se encontró, para buscarlo de otra forma
    expect(otro).toMatchObject({ state: 'noEncontrado', calidad: null })
    expect(otro.detail).toMatch(/otra versión/)
    expect(fs.readdirSync(path.join(r.carpeta, DESCARTADOS)).sort()).toEqual(['A - Otro (Acapella).mp3', 'A - Otro (Instrumental).mp3', 'A - Salgo (Acapella).mp3'])
    expect(resumir(r.tracks)).toMatchObject({ bajados: 1, noEncontrados: 1 })
  }, 120_000)
})

describe('lo bajado llega con nombre', () => {
  it('el nombre de la lista; no si el archivo dice otra versión que la lista no', () => {
    expect(nombreDeLista({ artist: 'Daddy Yankee', title: "Salgo Pa' la Calle" }, 'C:/t/01-daddy_yankee-salgo_pa_la_calle-xyz.MP3')).toEqual({ artist: 'Daddy Yankee', title: "Salgo Pa' la Calle", nombre: "Daddy Yankee - Salgo Pa' la Calle.mp3" })
    expect(nombreDeLista({ artist: 'AC/DC', title: 'T.N.T.' }, 'x.flac')?.nombre).toBe('AC_DC - T.N.T.flac')
    expect(nombreDeLista({ artist: 'X', title: 'Tema' }, 'C:/t/X - Tema (Original Mix).mp3')?.nombre).toBe('X - Tema.mp3')
    expect(nombreDeLista({ artist: 'X', title: 'Tema' }, 'C:/t/X - Tema (Extended Mix).mp3')).toBeNull()
    expect(nombreDeLista({ artist: 'X', title: 'Tema (Extended Mix)' }, 'C:/t/x_tema_extended_mix.mp3')?.nombre).toBe('X - Tema (Extended Mix).mp3')
    expect(nombreDeLista({ artist: '', title: '' }, 'C:/t/x.mp3')).toBeNull()
  })

  it('pone el artista y el título en los tags sin cambiar el sonido, y pasa a la carpeta con ese nombre', async () => {
    const t = path.join(dir, 'tags'); fs.mkdirSync(t, { recursive: true })
    const f = path.join(t, '01-daddy_yankee-salgo-xyz.mp3')
    fs.copyFileSync(a('m320.mp3'), f)
    writeTags(f, { artist: 'www.descargas.com', title: 'track01', album: 'Barrio Fino' })
    const antes = await pcmHash(ffmpeg, f)
    const nombre = await arreglarArchivo(ffmpeg, { artist: 'Daddy Yankee', title: "Salgo Pa' la Calle" }, f)
    expect(nombre).toBe("Daddy Yankee - Salgo Pa' la Calle.mp3")
    expect(readTags(f)).toMatchObject({ artist: 'Daddy Yankee', title: "Salgo Pa' la Calle", album: 'Barrio Fino' })
    expect(await pcmHash(ffmpeg, f)).toBe(antes)
    expect(fs.readdirSync(t)).toEqual(['01-daddy_yankee-salgo-xyz.mp3']) // sin temporales
    const final = entregar(f, path.join(t, 'Lista'), nombre)
    expect(path.basename(final)).toBe("Daddy Yankee - Salgo Pa' la Calle.mp3")
    // sin ffmpeg no se tocan los tags, pero el nombre sí
    const g = path.join(t, 'otro.mp3'); fs.copyFileSync(a('m320.mp3'), g)
    expect(await arreglarArchivo(null, { artist: 'Virus', title: 'Wadu Wadu' }, g)).toBe('Virus - Wadu Wadu.mp3')
    expect(readTags(g).title).toBeNull()
  }, 60_000)

  it('en una bajada: lo que sirve llega como "Artista - Título" (lo descartado queda como vino)', async () => {
    const { arreglarArchivo: arreglar } = await import('@paila/core/sockseek/nombres')
    const r = await bajarLista(path.join(dir, 'nombres'), 'buena', {
      Persiana: [['ana', a('inflado.mp3'), 'como:soda_persiana_320.mp3'], ['beto', a('m320.mp3'), 'como:03 - persiana americana.mp3']],
    }, { artista: 'Soda Stereo', arreglar: (fila, file) => arreglar(ffmpeg, fila, file) })
    const p = r.porTitulo('Persiana')
    expect(path.basename(p.path!)).toBe('Soda Stereo - Persiana.mp3')
    expect(readTags(p.path!)).toMatchObject({ artist: 'Soda Stereo', title: 'Persiana' })
    expect(fs.readdirSync(path.join(r.carpeta, DESCARTADOS))).toEqual(['soda_persiana_320.mp3'])
    // y el índice de sockseek apunta al archivo con su nombre nuevo (la próxima vez lo saltea)
    expect(fs.readFileSync(r.trabajo.indice, 'utf8')).toContain(p.path!.replace(/\\/g, '/'))
  }, 120_000)
})

describe('lo que quedó a medio bajar', () => {
  it('se borran los .incomplete de la lista y de otra fuente; la música no se toca', () => {
    const datos = path.join(dir, 'datos-incompletos')
    const lista = rutasTrabajo(datos, 'Lista').carpeta, otra = rutasTrabajo(datos, 'Lista - otra fuente').carpeta
    fs.mkdirSync(path.join(lista, 'sub'), { recursive: true }); fs.mkdirSync(otra, { recursive: true })
    fs.writeFileSync(path.join(lista, 'A - Lento.flac.incomplete'), 'medio')
    fs.writeFileSync(path.join(lista, 'sub', 'B - Otro.mp3.incomplete'), 'medio')
    fs.writeFileSync(path.join(otra, 'A - Lento.flac.incomplete'), 'medio')
    fs.writeFileSync(path.join(lista, 'C - Bien.mp3'), 'tema')
    expect(limpiarAMedias([lista, otra, path.join(datos, 'no-existe')])).toBe(3)
    expect(fs.readdirSync(lista, { recursive: true }).map(String).sort()).toEqual(['C - Bien.mp3', 'sub'])
    expect(fs.readdirSync(otra)).toEqual([])
  })
})
