// Tests de la corrida supervisada de grillas con tempo que se mueve (cierre del masterplan 2, 21/10): con los golpes
// reales que marcó Beat This! en temas de la colección (tests/fixtures/grilla), la regla "recta o variable", lo que va al
// rekordbox.xml cuando la de Rekordbox es fija, el plan que también escucha esos temas y el BPM honesto de la tabla.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fitGrid, gridBeats, tempoRange, type GridSegment } from '@paila/core/analysis/grid'
import { BEATTHIS_LATENCY, beatThisGrid, envelopes } from '@paila/core/analysis/gridscan'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Rekordbox } from '@paila/core/rekordbox'
import { parseRbXml } from '@paila/core/rbxml'
import { gridPlan } from '@paila/core/gridrun'
import { MIGRATIONS } from '@paila/core/migrations'
import { TRACK_FIELDS } from '@paila/shared/types'
import { bpmShown } from '../apps/paila/ui/src/tempo'

interface Golpes { tema: string; dur: number; windows: [number, number][]; sparse: { beats: number[]; downbeats: number[] }; whole: { beats: number[]; downbeats: number[] } }
const golpes = (n: string): Golpes => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'grilla', `${n}.json`), 'utf8'))
const fit = (g: { beats: number[]; downbeats: number[] }, sparse = false) => fitGrid(g.beats, { downbeats: g.downbeats, latency: BEATTHIS_LATENCY, sparse })
/** Lo mismo que hace la app: primero los 3 pedazos y, si el tempo no es parejo, el tema entero. */
const app = async (g: Golpes) => {
  const env = envelopes(new Float32Array(Math.round(g.dur * 22050)), 22050)
  return (await beatThisGrid(g.dur, env, g.windows, async (ws) => (ws === g.windows ? g.sparse : g.whole), true)).grid
}

describe('corrida supervisada de grillas 21/10: recta o variable', () => {
  it('"Barbazul" (Redondos, 1985): en los 3 pedazos solo un tercio de los golpes cae en la recta, así que se escucha entero y va variable', async () => {
    const g = golpes('barbazul')
    // antes: grilla recta a 118,16 (la mediana de los golpes que sí caían era baja) y se corría hasta 50 ms
    expect(fit(g.sparse, true)).toBeNull()
    const grid = (await app(g))!
    expect(grid.variable).toBe(true)
    expect(grid.segments.length).toBeGreaterThan(50)
    const r = tempoRange(grid.segments)!
    expect(r.lo).toBeGreaterThan(110); expect(r.hi).toBeLessThan(128); expect(r.hi - r.lo).toBeGreaterThan(1)
  })

  it('"Jijiji" (en vivo, Chateau 2001): en los pedazos parecía parejo (64 % de los golpes en la recta); entero se mueve', () => {
    const g = golpes('jijiji')
    expect(fit(g.sparse, true)).toBeNull()
    expect(fit(g.whole)!.variable).toBe(true)
  })

  it('una entrevista hablada no tiene grilla (antes salía a 192 BPM)', async () => {
    const g = golpes('entrevista')
    expect(fit(g.whole)).toBeNull()
    expect(await app(g)).toBeNull()
  })

  it('"La danza del humo": 84,99 y no 85 redondo, que en 4 minutos se corría 30 ms', async () => {
    const grid = (await app(golpes('danza-del-humo')))!
    expect(grid.variable).toBe(false)
    expect(grid.bpm).toBeCloseTo(84.99, 2)
  })

  // Juguetes perdidos también es parejo, pero el 1 se corre: se escucha entero (tests/grilla-vivo-2.test.ts)
  it.each(['pogo', 'astilleros', 'trigonometry'])('"%s" tiene el tempo parejo: sigue con grilla recta, sin escuchar entero', async (n) => {
    const g = golpes(n)
    const grid = fit(g.sparse, true)!
    expect(grid.variable).toBe(false)
    expect(grid.segments).toHaveLength(1)
    expect((await app(g))!.bpm).toBe(grid.bpm)
  })

  // revisado a oído en Rekordbox el 22/10: el pulso caía bien pero el 1 del compás no
  const uno = (g: Golpes) => {
    const grid = fit(g.whole)!
    const ones = gridBeats(grid.segments, 0, g.dur).filter((b) => b.beat === 1).map((b) => b.time)
    const db = g.whole.downbeats.map((x) => x - BEATTHIS_LATENCY)
    return { grid, share: db.filter((d) => ones.some((o) => Math.abs(o - d) < 0.07)).length / db.length }
  }
  it('"Jijiji": el 1 del compás cae en el primero de compás de Beat This! (antes, una negra antes: 1 %)', () => {
    expect(uno(golpes('jijiji')).share).toBeGreaterThan(0.85)
  })
  it('"La nave del olvido": la intro a 80 BPM y una "patinada" a los 117 s no dejan la grilla corrida', () => {
    const { grid, share } = uno(golpes('nave-del-olvido'))
    expect(share).toBeGreaterThan(0.7) // antes 8 %
    // antes no había tramos nuevos entre los 116 y los 143 s (la grilla quedaba 300 ms corrida)
    const starts = grid.segments.map((x) => x.start)
    expect(starts.some((x) => x > 120 && x < 140)).toBe(true)
  })

  it('el electrónico producido a BPM redondo sigue redondo', () => { expect(fit(golpes('trigonometry').sparse, true)!.bpm).toBe(130) })

  it('el rango de un tema que se mueve no se estira por un compás suelto', () => {
    const segs: GridSegment[] = Array.from({ length: 40 }, (_, i) => ({ start: i * 2, bpm: i === 7 ? 140 : 118 + (i % 5) * 0.5, beat: 1 }))
    expect(tempoRange(segs)).toEqual({ lo: 118, hi: 120 })
    expect(tempoRange([{ start: 0, bpm: 120, beat: 1 }])).toBeNull()
  })
})

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
let rb: Rekordbox
const idOf = (n: string) => lib.tracks().find((r) => String(r[2]).endsWith(n))![0] as number
const variable: GridSegment[] = Array.from({ length: 12 }, (_, i) => ({ start: 0.2 + i * 2.02, bpm: 118 + (i % 4), beat: 1 }))

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-grilla-vivo-'))
  for (const n of ['rock.flac', 'dinamico.flac', 'nuevo.flac']) {
    fs.mkdirSync(path.join(dir, 'M'), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=30', path.join(dir, 'M', n)])
  }
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  rb = new Rekordbox(lib.db, (i) => lib.trackPath(i), new Playlists(lib.db, (i) => lib.trackPath(i)))
  const loc = (n: string) => `file://localhost/${path.join(dir, 'M', n).replace(/\\/g, '/')}`
  // "rock": la grilla fija del análisis normal de Rekordbox (varios puntos, todos al mismo BPM, como Barbazul en un XML
  // real); "dinamico": una del análisis dinámico (el BPM cambia)
  fs.writeFileSync(path.join(dir, 'rb.xml'), `<?xml version="1.0" encoding="UTF-8"?><DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="2">
    <TRACK TrackID="11" Name="Rock" Location="${loc('rock.flac')}"><TEMPO Inizio="0.036" Bpm="118.77" Metro="4/4" Battito="1"/><TEMPO Inizio="7.109" Bpm="118.77" Metro="4/4" Battito="3"/><TEMPO Inizio="12.47" Bpm="118.77" Metro="4/4" Battito="1"/></TRACK>
    <TRACK TrackID="12" Name="Dinámico" Location="${loc('dinamico.flac')}"><TEMPO Inizio="0.1" Bpm="120.00" Metro="4/4" Battito="1"/><TEMPO Inizio="8.1" Bpm="122.50" Metro="4/4" Battito="1"/><TEMPO Inizio="16" Bpm="119.00" Metro="4/4" Battito="1"/></TRACK>
    </COLLECTION></DJ_PLAYLISTS>`)
  rb.dj.importRekordbox(path.join(dir, 'rb.xml'))
  for (const n of ['rock.flac', 'dinamico.flac', 'nuevo.flac']) rb.dj.saveGrid(idOf(n), 'beatthis', { grid: { bpm: 119.5, segments: variable, errorMs: 12, variable: true }, barEnergy: [] }, null)
}, 90_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('corrida supervisada de grillas 21/10: la grilla de Rekordbox y la de PAILA', () => {
  it('una grilla de Rekordbox con varios puntos al mismo BPM no cuenta como variable (antes contaban 25 de 38)', () => {
    const [own, paila] = [rb.dj.grids(idOf('rock.flac')).find((g) => g.method === 'rekordbox')!, rb.dj.grids(idOf('dinamico.flac')).find((g) => g.method === 'rekordbox')!]
    expect(own.variable).toBe(false)
    expect(paila.variable).toBe(true)
  })

  it('al exportar gana la de Rekordbox; con "rehacer", en los que se mueven va la variable de PAILA (solo si la de Rekordbox es fija)', () => {
    const dest = path.join(dir, 'out.xml')
    const grid = (opts: object, n: string) => { rb.export({ scope: 'todo', playlistIds: [], dest, ...opts }); return parseRbXml(fs.readFileSync(dest, 'utf8')).find((t) => t.path.endsWith(n))!.grid }
    expect(grid({}, 'rock.flac').map((s) => s.bpm)).toEqual([118.77, 118.77, 118.77])
    const near = (a: { start: number; bpm: number }[]) => a.map((s) => [Math.round(s.start * 1000), s.bpm])
    expect(near(grid({ pailaWhenMoving: true }, 'rock.flac'))).toEqual(near(variable))
    expect(grid({ pailaWhenMoving: true }, 'dinamico.flac').map((s) => s.bpm)).toEqual([120, 122.5, 119]) // la dinámica de Rekordbox queda
    expect(near(grid({ pailaWhenMoving: true }, 'nuevo.flac'))).toEqual(near(variable))
  })

  it('el plan puede escuchar también los que ya tienen grilla de Rekordbox (para encontrar los que se mueven)', () => {
    expect(gridPlan(lib.db, rb.dj, null, 'gpu', true).todo).toEqual([idOf('nuevo.flac')])
    expect(gridPlan(lib.db, rb.dj, null, 'gpu', true, true).todo).toHaveLength(3)
  })

  it('la fila de la tabla trae entre qué BPM se mueve el tema', () => {
    const row = (n: string) => Object.fromEntries(TRACK_FIELDS.map((f, i) => [f, lib.tracks(idOf(n))[0][i]]))
    expect(row('nuevo.flac').tempo).toBe('118.0,121.0,119.5')
    // con las dos, manda la de PAILA (que escuchó el tema); la dinámica de Rekordbox sola también cuenta
    expect(row('rock.flac').tempo).toBe('118.0,121.0,119.5')
  })
})

describe('cues sugeridos con los nombres de Rekordbox (decisión del 22/10)', () => {
  it('los ya guardados con los nombres viejos pasan a Intro, Drop y Outro, y la migración se puede volver a correr', () => {
    const id = idOf('nuevo.flac')
    rb.dj.saveSuggested(id, [{ role: 'inicio', time: 0.5, bar: 0 }, { role: 'drop', time: 16.5, bar: 8 }])
    lib.db.prepare("UPDATE dj_cues SET name = CASE name WHEN 'Intro' THEN 'Inicio' WHEN 'Drop' THEN 'Entra todo' ELSE name END WHERE file_id = ?").run(id)
    const v28 = MIGRATIONS.find((m) => m.includes('dj_tempo'))!
    lib.db.exec(v28); lib.db.exec(v28)
    expect(rb.dj.cues(id).map((c) => c.name)).toEqual(['Intro', 'Drop'])
  })
})

describe('el BPM que se muestra', () => {
  it('un rango si el tempo se mueve, llevado a la octava del BPM del tema', () => {
    expect(bpmShown({ bpm: 118.4, tempo: '112.2,121.4,118.6' })!.text).toBe('112–121')
    expect(bpmShown({ bpm: 130, tempo: '63.1,66.2,65' })!.text).toBe('126–132')
    expect(bpmShown({ bpm: 120, tempo: '119.6,120.4,120' })!.text).toBe('≈120')
    expect(bpmShown({ bpm: 118.4, tempo: '112.2,121.4,118.6' })!.title).toContain('va de 112 a 121 BPM')
  })
  it('un número si es parejo, y nada si no hay BPM', () => {
    expect(bpmShown({ bpm: 124.5, tempo: null })).toEqual({ text: '124,5', title: null })
    expect(bpmShown({ bpm: null, tempo: null })).toBeNull()
  })
})
