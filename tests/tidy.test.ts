// Tests de Arreglar nombres y tags (core/tidy.ts): perfiles, nombres de DJ y la pantalla de propuestas.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { tidy, tidyFirst, tidyProfiles, tidyScreen, toProposals } from '@paila/core/tidy'
import { TidyProfilesRunner, type ProfilesJob } from '@paila/core/tidyserver'
import { PROFILES, rulesOf } from '@paila/shared/tidy-profiles'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
const tone = (rel: string, meta: Record<string, string> = {}) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-tidy-'))
  // carpeta con "01 - Artista - Título" y sin tags
  tone('Mezcla/01 - La Renga - Uno [HD].mp3'); tone('Mezcla/02 - Divididos - Dos.mp3'); tone('Mezcla/03 - Sumo - Tres.mp3')
  // tags con caracteres rotos
  tone('Rock/a.mp3', { artist: 'GarcÃ­a', title: 'Canción (Official Video)' })
  // álbum con tags a medias
  for (let i = 1; i <= 3; i++) tone(`Gardelitos/2008 - Oxigeno/0${i}.mp3`, { artist: 'Los Gardelitos', title: `T${i}` })
  // sin información útil
  tone('Descargas/track.mp3')
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('asistente Arreglar nombres y tags', () => {
  it('completa lo que falta, limpia y no inventa', () => {
    const r = tidy(lib.db)
    const get = (rel: string, f: string) => r.changes.find((c) => c.rel.endsWith(rel) && c.field === f)?.to
    expect(get('01 - La Renga - Uno [HD].mp3', 'artist')).toBe('La Renga')
    expect(get('01 - La Renga - Uno [HD].mp3', 'title')).toBe('Uno') // y sin el [HD]
    expect(get('01 - La Renga - Uno [HD].mp3', 'track')).toBe('1')
    expect(get('02 - Divididos - Dos.mp3', 'artist')).toBe('Divididos')
    expect(get('a.mp3', 'artist')).toBe('García')
    expect(get('a.mp3', 'title')).toBe('Canción')
    expect(get('0' + 1 + '.mp3', 'album')).toBe('Oxigeno')
    expect(get('01.mp3', 'year')).toBe('2008')
    expect(r.changes.some((c) => c.rel.includes('Descargas'))).toBe(false)
    expect(r.leftover.sample).toEqual(['Descargas/track.mp3'])
    expect(r.after.artist).toBeGreaterThan(r.before.artist)
    expect(r.steps.map((s) => s.key)).toEqual(['mojibake', 'filename', 'junk', 'style', 'folder', 'extension', 'filenames', 'djtags'])
  })

  it('se puede correr por pasos y nunca pisa un tag que ya estaba bien', () => {
    expect(tidy(lib.db, ['mojibake']).changes.every((c) => c.step === 'mojibake')).toBe(true)
    const r = tidy(lib.db)
    expect(r.changes.some((c) => c.rel.endsWith('Rock/a.mp3') && c.field === 'album')).toBe(false)
    expect(r.changes.some((c) => c.rel.includes('Oxigeno') && c.field === 'title')).toBe(false) // T1, T2 y T3 se quedan
  })

  it('los cambios se pueden pasar a cambios pendientes y aplicar', async () => {
    const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg)
    const props = toProposals(tidy(lib.db, ['mojibake', 'junk']).changes)
    ch.stageMany(props)
    expect(ch.list().length).toBe(props.length)
    const a = await ch.apply()
    expect(a.failed).toEqual([])
    expect(tidy(lib.db, ['mojibake', 'junk']).changes).toEqual([]) // ya quedó limpio
  })
})

describe('nombres de DJ', () => {
  it('prepName saca BPM y tonos del principio', async () => {
    const { prepName } = await import('@paila/core/names')
    expect(prepName('x/100 BPM - Adios - Maria Becerra.mp3')).toBe('x/Adios - Maria Becerra.mp3')
    expect(prepName('124 - 8A - Tema - Artista.wav')).toBe('Tema - Artista.wav')
    expect(prepName('8A - Uno.mp3')).toBe('Uno.mp3')
    expect(prepName('Artista - Tema.mp3')).toBe('Artista - Tema.mp3')
  })
})

describe('pantalla de Arreglar nombres', () => {
  it('cuenta cada perfil igual que calcularlo aparte (el elegido no se recalcula)', () => {
    for (const chosen of ['minimo', 'prolijo', 'rajatabla'] as const) {
      const s = tidyScreen(lib.db, () => null, rulesOf(chosen))
      expect(s.total).toBe(tidy(lib.db, undefined, () => null, rulesOf(chosen)).changes.length)
      for (const p of PROFILES.filter((x) => !x.soon)) {
        const alone = tidy(lib.db, undefined, () => null, p.rules).changes
        expect(s.profiles.find((x) => x.key === p.key)?.count).toBe(alone.length)
      }
    }
  })

  it('se abre con el perfil elegido y los demás números, aparte, dan lo mismo que la pantalla entera', () => {
    for (const chosen of ['minimo', 'prolijo', 'rajatabla'] as const) {
      const whole = tidyScreen(lib.db, () => null, rulesOf(chosen))
      const { screen, changes } = tidyFirst(lib.db, () => null, rulesOf(chosen))
      expect(screen.profiles).toEqual([{ key: chosen, count: changes.length, tracks: new Set(changes.map((x) => x.id)).size, extra: [] }])
      expect({ ...screen, profiles: [] }).toEqual({ ...whole, profiles: [] })
      // con lo ya calculado del elegido (como en la app) o calculándolo de nuevo: lo mismo
      expect(tidyProfiles(lib.db, () => null, rulesOf(chosen), changes)).toEqual(whole.profiles)
      expect(tidyProfiles(lib.db, () => null, rulesOf(chosen))).toEqual(whole.profiles)
    }
    // reglas "a medida": no hay perfil elegido que mostrar al abrir
    const custom = rulesOf('prolijo').filter((r) => r !== 'acentos')
    expect(tidyFirst(lib.db, () => null, custom).screen.profiles).toEqual([])
  })

  it('el hilo de los perfiles: vale solo el último pedido', async () => {
    // un hilo de mentira que tarda lo que se le pide y devuelve las reglas como resultado
    const script = path.join(dir, 'hilo-perfiles.mjs')
    fs.writeFileSync(script, [
      "import { parentPort, workerData } from 'node:worker_threads'",
      "setTimeout(() => workerData.file === 'falla' ? process.exit(1) : parentPort.postMessage({ ok: true, result: workerData.rules }), workerData.roots[0])",
    ].join('\n'))
    const job = (ms: number, rules: string[], file = 'x') => ({ file, roots: { 0: ms }, idioma: 'es', rules }) as unknown as ProfilesJob
    const runner = new TidyProfilesRunner(script)
    const first = runner.run(job(2000, ['viejo']))
    const second = runner.run(job(10, ['nuevo']))
    expect(await first).toBeNull()
    expect(await second).toEqual(['nuevo'])
    await expect(runner.run(job(10, [], 'falla'))).rejects.toThrow()
  })
})

describe('la cara del vinilo adelante del artista', () => {
  it('"A1 Bodeler" → "Bodeler" con pruebas; "C4 Pedro" queda para mirar a mano', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-vinilo-'))
    const mk = (rel: string, meta: Record<string, string>) => {
      const out = path.join(d, 'M', ...rel.split('/'))
      fs.mkdirSync(path.dirname(out), { recursive: true })
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
    }
    // como en la Música real: tags de una tienda de vinilos
    mk('House/A1 Bodeler - Philypop VINYL ONLY  [Psyfunk].mp3', { artist: 'A1 Bodeler', title: 'Philypop VINYL ONLY' })
    mk('Tranqui/B1 Cuartero - Floor Paca.mp3', { artist: 'B1 Cuartero', title: 'Floor Paca', track: 'B1' })
    mk('EP/x1.mp3', { artist: 'A2 Mikhu', title: 'Sorry' }); mk('EP/x2.mp3', { artist: 'B1 Funk E', title: 'My Straw' })
    mk('Kuduro/C4 Pedro - Vamos ser felizes.mp3', { artist: 'C4 Pedro', title: 'Vamos ser felizes' })
    mk('Otros/A1 - tema.mp3', { artist: 'A1', title: 'Tema' })
    const l = new Library(path.join(d, 'paila.db'), findFfprobe())
    try {
      await l.addRoot(path.join(d, 'M'), [{ rel: '', kind: 'musica' }])
      await l.scan()
      const r = tidy(l.db)
      const to = (rel: string) => r.changes.find((c) => c.rel.endsWith(rel) && c.field === 'artist')?.to
      expect(to('Philypop VINYL ONLY  [Psyfunk].mp3')).toBe('Bodeler')
      expect(to('Floor Paca.mp3')).toBe('Cuartero')
      expect(to('x1.mp3')).toBe('Mikhu'); expect(to('x2.mp3')).toBe('Funk E')
      expect(to('Vamos ser felizes.mp3')).toBeUndefined()
      expect(r.review.find((v) => v.rel.endsWith('Vamos ser felizes.mp3') && v.field === 'artist')?.to).toBe('Pedro')
      expect(to('A1 - tema.mp3')).toBeUndefined()
    } finally { l.close(); fs.rmSync(d, { recursive: true, force: true }) }
  })

  // decidido el 22/10: "VINYL ONLY" y la cara se sacan del título y del artista, y el dato queda aparte
  it('"VINYL ONLY" sale del título, el artista y el álbum; la cara del título también; queda la marca "vinilo"', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-vinilo2-'))
    const mk = (rel: string, meta: Record<string, string>) => {
      const out = path.join(d, 'M', ...rel.split('/'))
      fs.mkdirSync(path.dirname(out), { recursive: true })
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
    }
    // tal cual vienen en la Música real (Electronica/House y Tech)
    mk('House/A1 Bodeler - Philypop VINYL ONLY  [Psyfunk].mp3', { artist: 'A1 Bodeler', title: 'Philypop VINYL ONLY', album: 'Various Artists 01 (Vinyl Only) PSYFUNK003' })
    mk('Tech/Rhymos - B2 Mi Casa Su Casa (Ben Rau Remix VINYL ONLY) [Meta].mp3', { artist: 'Rhymos', title: 'B2 Mi Casa Su Casa (Ben Rau Remix) VINYL ONLY', album: 'Seizure EP (Vinyl Only) META001' })
    mk('Tech/Lucianno Villarreal - A11 VINYL ONLY [Rationalism Records].mp3', { artist: 'Lucianno Villarreal', title: 'A11 VINYL ONLY' })
    mk('Love Filter/Thomas Wood - Feel It (Raw Mix VINYL ONLY) [TW Limited].mp3', { artist: 'Thomas Wood', title: 'Feel It (Raw Mix VINYL ONLY)', track: 'A1' })
    mk('Love Filter/Thomas Wood - 1440 VINYL ONLY [TW Limited].mp3', { artist: 'Thomas Wood', title: '1440 VINYL ONLY', track: 'B2' })
    // el código de catálogo repetido (corrida supervisada del 22/10: "FUN007 (Vinyl Only) FUN007")
    mk('VA - FUN007/Barem & Cabri - A1 Fun007.1 VINYL ONLY  [Fun].mp3', { artist: 'Barem & Cabri', title: 'A1 Fun007.1 VINYL ONLY', album: 'FUN007 (Vinyl Only) FUN007' })
    // sin ninguna prueba de vinilo: "B2 Bomber" puede ser un título
    mk('Varios/B2 Bomber.mp3', { artist: 'Motorhead', title: 'B2 Bomber' })
    const l = new Library(path.join(d, 'paila.db'), findFfprobe())
    try {
      await l.addRoot(path.join(d, 'M'), [{ rel: '', kind: 'musica' }])
      await l.scan()
      const r = tidy(l.db)
      const to = (rel: string, f: string) => r.changes.find((c) => c.rel.endsWith(rel) && c.field === f)?.to
      expect(to('Philypop VINYL ONLY  [Psyfunk].mp3', 'artist')).toBe('Bodeler')
      expect(to('Philypop VINYL ONLY  [Psyfunk].mp3', 'title')).toBe('Philypop')
      expect(to('Philypop VINYL ONLY  [Psyfunk].mp3', 'album')).toBe('Various Artists 01 PSYFUNK003')
      expect(to('[Meta].mp3', 'title')).toBe('Mi Casa Su Casa (Ben Rau Remix)')
      expect(to('[Meta].mp3', 'album')).toBe('Seizure EP META001')
      expect(to('[Rationalism Records].mp3', 'title')).toBe('A11')
      expect(to('Feel It (Raw Mix VINYL ONLY) [TW Limited].mp3', 'title')).toBe('Feel It (Raw Mix)')
      expect(to('1440 VINYL ONLY [TW Limited].mp3', 'title')).toBe('1440')
      expect(to('[Fun].mp3', 'album')).toBe('FUN007')
      expect(to('[Fun].mp3', 'title')).toBe('Fun007.1')
      expect(to('B2 Bomber.mp3', 'title')).toBeUndefined()
      expect(r.review.find((v) => v.rel.endsWith('B2 Bomber.mp3'))?.to).toBe('Bomber')
      expect(r.byRule.vinilo?.count).toBeGreaterThanOrEqual(8)
      // la marca "vinilo", con la cara
      const marks = Object.fromEntries((l.db.prepare('SELECT f.rel_path AS rel, v.side FROM vinyl v JOIN files f ON f.id = v.file_id').all() as { rel: string; side: string | null }[]).map((m) => [m.rel.split('/').pop(), m.side]))
      expect(marks).toEqual({
        'A1 Bodeler - Philypop VINYL ONLY  [Psyfunk].mp3': 'A1', 'Rhymos - B2 Mi Casa Su Casa (Ben Rau Remix VINYL ONLY) [Meta].mp3': 'B2',
        'Lucianno Villarreal - A11 VINYL ONLY [Rationalism Records].mp3': 'A11', 'Thomas Wood - Feel It (Raw Mix VINYL ONLY) [TW Limited].mp3': 'A1',
        'Thomas Wood - 1440 VINYL ONLY [TW Limited].mp3': 'B2', 'Barem & Cabri - A1 Fun007.1 VINYL ONLY  [Fun].mp3': 'A1',
      })
      // la casilla destildada: no se toca nada de esto
      const off = tidy(l.db, undefined, undefined, rulesOf('prolijo').filter((x) => x !== 'vinilo'))
      // (el nombre del archivo no es parte de la regla: el paso de nombres de archivo saca el sello entre corchetes)
      expect(off.changes.filter((c) => c.field !== 'filename' && /VINYL|A1 Bodeler|B2 Mi Casa/i.test(c.from ?? ''))).toEqual([])
    } finally { l.close(); fs.rmSync(d, { recursive: true, force: true }) }
  })
})
