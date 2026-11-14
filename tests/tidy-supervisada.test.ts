// Casos de la corrida supervisada del 20/10/2026 sobre la biblioteca real (docs/archivo/pruebas/2026-10-20-arreglar-nombres.md),
// rearmados con archivos de prueba: cada uno es un error que se vio en una propuesta y no tiene que volver.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { keepKey, setKept, tidy, toProposals } from '@paila/core/tidy'
import { PROFILES, profileOf, rulesOf } from '@paila/shared/tidy-profiles'
import { ponerIdioma } from '@paila/shared/idioma'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
const tone = (rel: string, meta: Record<string, string> = {}) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-tidy2-'))
  // nombres que las reglas viejas cortaban mal
  tone('Techno/Fur Coat, Julian Wassermann - 3.33 [www.slider.kz].mp3'); tone('Techno/Closed I - 91-DIVOC [V1].mp3')
  tone('Trap/y2mate.com - Rusherking - LOBA Official Video.mp3'); tone('Trap/Aaron Smith - Dancin (feat. Luvli) (Krono Remix).mp3')
  tone('Trap/Dj Lauuh - Ñeri.mp3'); tone('Trap/Vladimir Dubyshkin - Machines Behave Badly [www.slider.kz] (1).mp3')
  tone('Trap/E.C. Scott (1995) - Come Get Your Love.mp3'); tone('Trap/Duki - BICI feat Ak4_20, Juhn & Juanka.mp3')
  // al revés: del otro lado hay un artista conocido
  tone('Cumbia/Llego tu papi - Sabroso.mp3'); tone('Cumbia/Sabroso - Al Olvido.mp3', { artist: 'Sabroso', title: 'Al Olvido' })
  tone('Cumbia/Sabroso - Otro.mp3', { artist: 'Sabroso', title: 'Otro' })
  // con el BPM adelante decide el lado con pinta de lista de artistas; si no hay pistas, no se adivina
  tone('Pista/98 BPM - Exclusivos - Lele Pons, Guaynaa.mp3'); tone('Pista/100 BPM - Dime - La Nueva Luna.mp3')
  // todo en minúscula / todo en mayúscula, y nombres estilizados
  tone('Rock/divididos - nene de antes.mp3'); tone('Rock/CALLEJEROS - SE QUE NO SE.mp3'); tone('Trap/WOS - CANGURO.mp3')
  // "Rock/El Bordo" es la carpeta del artista, no un disco
  tone('Rock/El Bordo/a.mp3', { artist: 'El Bordo', title: 'A' }); tone('Rock/El Bordo/b.mp3', { artist: 'El Bordo', title: 'B' })
  tone('Rock/El Bordo/05 El Carnaval.mp3', { title: 'El Carnaval' })
  // un compilado ("VA - …") y un disco de un artista con invitados
  for (const [a, n] of [['Guti', 1], ['Morgan, Guti', 2], ['Guti, Leo Garcia', 3]] as const) tone(`Conga/VA - The Year Of The Conga/${n}.mp3`, { artist: a, title: `T${n}`, album: 'The Year Of The Conga' })
  for (const [a, n] of [['flowanastasia and nymfo', 1], ['flowanastasia and loko', 2], ['flowanastasia', 3]] as const) tone(`DnB/Face Yourself/${n}.mp3`, { artist: a, title: `F${n}`, album: 'Face Yourself' })
  // un enganchado largo y un "type beat"
  tone('Previa/MIX CUARTETO 2024 - LO MAS ESCUCHADO _ Luck Ra.mp3'); tone('Beats/Kendrick lamar ft. dr. dre - type beat-mind expansion.mp3')
  // un "artista" que es una página
  tone('Gardelitos/los gardelitos - los querandies.mp3', { artist: 'm.youtube.com', title: 'los gardelitos - los querandies' })
  // "Track03" es el n.º de tema; "AL046" es el catálogo del sello; "Cd2 05" es disco y tema
  tone('Luca/Track03 - Cada día.mp3'); tone('Melodic/AL046 - KASST - Hope Im Alone.mp3'); tone('Toto/Cd2 05 - Cindy Lauper - Girls Just Want To Have Fun.mp3')
  // título con la lista completa de artistas adelante
  tone('Emilia/Emilia, TINI - La_Original.mp3', { artist: 'Emilia', title: 'Emilia, TINI - La_Original.mp3' })
  // nombres de archivo con basura (el paso "Limpiar nombres de archivo")
  tone('Baby/Ozric Tentacles - Saucers [www.slider.kz].mp3', { artist: 'Ozric Tentacles', title: 'Saucers' })
  tone('Baby/Bizarrap, Nathy Peluso - Nathy Peluso_ Bzrp Music Sessions, Vol. 36 [www.slider.kz].mp3')
  tone('Fiestita/Emilia - Jagger.mp3 (Official Video).mp3', { artist: 'Emilia', title: 'Jagger.mp3' })
  tone('Dup/Tema [www.slider.kz].mp3', { artist: 'X', title: 'Tema' }); tone('Dup/Tema.mp3', { artist: 'X', title: 'Tema' })
  tone('Samples/loop [www.slider.kz].mp3')
  tone('Varios/Ella Baila Sola - (Video Oficial) - Eslabon Armado.mp3', { artist: 'Eslabon Armado', title: 'Ella Baila Sola' })
  tone('Varios/las pelotas    Será .mp3', { artist: 'Las Pelotas', title: 'Será' })
  // "_" que no se sabe qué era
  tone('Rock/AC_DC - Back In Black.mp3', { artist: 'AC_DC', title: 'Back In Black' })
  // perfiles (decisiones del 20/10): marcas propias, el mismo artista con y sin acentos, un recital largo y un sample largo
  tone('Prog/The Foreigners - New Dawn (Original Mix) MSTRD.mp3', { artist: 'The Foreigners', title: 'New Dawn (Original Mix) MSTRD' })
  tone('Baba/a.mp3', { artist: 'Babasónicos', title: 'Irresponsables' }); tone('Baba/b.mp3', { artist: 'Babasónicos', title: 'Putita' })
  tone('Baba/c.mp3', { artist: 'Babasonicos', title: 'Microdancing' })
  tone('Recitales/La Renga - En Vivo en Huracán.mp3'); tone('Samples/Pack Largo - Loop Live.mp3')
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
  await lib.scan()
  lib.db.prepare("UPDATE files SET duration = 1740 WHERE rel_path LIKE 'Previa/%'").run() // 29 minutos
  lib.db.prepare("UPDATE files SET duration = 1500 WHERE rel_path LIKE 'Recitales/%' OR rel_path LIKE 'Samples/Pack Largo%'").run() // 25 minutos
}, 90_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

const get = (r: ReturnType<typeof tidy>, rel: string, f: string) => r.changes.find((c) => c.rel.endsWith(rel) && c.field === f)?.to

describe('corrida supervisada de Arreglar nombres: errores que no tienen que volver', () => {
  it('no se come números ni deja basura de páginas o de copias', () => {
    const r = tidy(lib.db)
    expect(get(r, '3.33 [www.slider.kz].mp3', 'title')).toBe('3.33')
    expect(get(r, '91-DIVOC [V1].mp3', 'title')).toBe('91-DIVOC [V1]')
    expect(get(r, 'LOBA Official Video.mp3', 'artist')).toBe('Rusherking')
    expect(get(r, 'LOBA Official Video.mp3', 'title')).toBe('LOBA')
    expect(get(r, 'Machines Behave Badly [www.slider.kz] (1).mp3', 'title')).toBe('Machines Behave Badly')
    expect(get(r, 'E.C. Scott (1995) - Come Get Your Love.mp3', 'artist')).toBe('E.C. Scott')
    expect(get(r, 'E.C. Scott (1995) - Come Get Your Love.mp3', 'year')).toBe('1995')
  })

  it('feat. en el artista y el título limpio; DJ en mayúsculas', () => {
    const r = tidy(lib.db)
    expect(get(r, 'Dancin (feat. Luvli) (Krono Remix).mp3', 'artist')).toBe('Aaron Smith feat. Luvli')
    expect(get(r, 'Dancin (feat. Luvli) (Krono Remix).mp3', 'title')).toBe('Dancin (Krono Remix)')
    expect(get(r, 'BICI feat Ak4_20, Juhn & Juanka.mp3', 'artist')).toBe('Duki feat. Ak4_20, Juhn & Juanka')
    expect(get(r, 'BICI feat Ak4_20, Juhn & Juanka.mp3', 'title')).toBe('BICI')
    expect(get(r, 'Dj Lauuh - Ñeri.mp3', 'artist')).toBe('DJ Lauuh')
  })

  it('da vuelta "Título - Artista" cuando del otro lado hay un artista conocido o una lista de artistas', () => {
    const r = tidy(lib.db)
    expect(get(r, 'Llego tu papi - Sabroso.mp3', 'artist')).toBe('Sabroso')
    expect(get(r, 'Llego tu papi - Sabroso.mp3', 'title')).toBe('Llego tu papi')
    expect(get(r, 'Exclusivos - Lele Pons, Guaynaa.mp3', 'artist')).toBe('Lele Pons, Guaynaa')
    expect(get(r, 'Dime - La Nueva Luna.mp3', 'artist')).toBeUndefined()
    expect(r.review.some((x) => !x.staged && x.rel.endsWith('Dime - La Nueva Luna.mp3'))).toBe(true)
  })

  it('el perfil por defecto (Prolijo) respeta las mayúsculas como vienen (decidido el 20/10)', () => {
    const r = tidy(lib.db)
    expect(get(r, 'divididos - nene de antes.mp3', 'artist')).toBe('divididos')
    expect(get(r, 'divididos - nene de antes.mp3', 'title')).toBe('nene de antes')
    expect(get(r, 'CALLEJEROS - SE QUE NO SE.mp3', 'title')).toBe('SE QUE NO SE')
    expect(get(r, 'WOS - CANGURO.mp3', 'title')).toBe('CANGURO') // "hay artistas que ponen los títulos en mayúsculas"
    expect(get(r, 'Dj Lauuh - Ñeri.mp3', 'artist')).toBe('DJ Lauuh') // DJ y MC sí
  })

  it('Rajatabla unifica mayúsculas solo cuando todo el nombre está así, y respeta los nombres estilizados', () => {
    const r = tidy(lib.db, undefined, undefined, rulesOf('rajatabla'))
    expect(get(r, 'divididos - nene de antes.mp3', 'artist')).toBe('Divididos')
    expect(get(r, 'divididos - nene de antes.mp3', 'title')).toBe('Nene de Antes')
    expect(get(r, 'CALLEJEROS - SE QUE NO SE.mp3', 'artist')).toBe('CALLEJEROS') // una sola palabra en mayúscula puede ser estilizada
    expect(get(r, 'CALLEJEROS - SE QUE NO SE.mp3', 'title')).toBe('Se Que No Se')
    expect(get(r, 'WOS - CANGURO.mp3', 'artist')).toBe('WOS')
    expect(get(r, 'WOS - CANGURO.mp3', 'title')).toBe('Canguro')
  })

  it('una carpeta con el nombre del artista no es un disco, pero sí dice quién es el artista', () => {
    const r = tidy(lib.db)
    expect(r.changes.some((c) => c.rel.startsWith('Rock/El Bordo/') && c.field === 'album')).toBe(false)
    expect(get(r, 'El Bordo/05 El Carnaval.mp3', 'artist')).toBe('El Bordo')
  })

  it('compilados en "Varios Artistas", pero no un disco con invitados', () => {
    const r = tidy(lib.db)
    expect(get(r, 'The Year Of The Conga/1.mp3', 'albumArtist')).toBe('Varios Artistas')
    // un disco con invitados no es un compilado: el artista del álbum es el principal (y el Organizador no lo parte)
    expect(r.changes.filter((c) => c.rel.startsWith('DnB/') && c.field === 'albumArtist').map((c) => c.to)).toEqual(['flowanastasia', 'flowanastasia', 'flowanastasia'])
    const raja = tidy(lib.db, undefined, undefined, rulesOf('rajatabla'))
    expect(raja.changes.filter((c) => c.rel.startsWith('DnB/') && c.field === 'albumArtist').map((c) => c.to)).toEqual(['Flowanastasia', 'Flowanastasia', 'Flowanastasia'])
  })

  it('lo dudoso no se propone: enganchados largos (van a "Sets y en vivo") y "type beats"', () => {
    const r = tidy(lib.db)
    expect(r.changes.some((c) => c.rel.startsWith('Previa/') && c.field !== 'filename')).toBe(false)
    expect(r.sets.find((x) => x.rel.startsWith('Previa/'))?.why).toBe('Dura 29 minutos y el nombre dice "previa"') // la carpeta se llama Previa (palabra de set desde el 21/10)
    expect(r.review.some((x) => x.rel.startsWith('Previa/'))).toBe(false) // no es "para mirar a mano": tiene su sección
    expect(r.leftover.sample.some((x) => x.startsWith('Previa/'))).toBe(false)
    expect(get(r, 'type beat-mind expansion.mp3', 'artist')).toBeUndefined()
    expect(toProposals(r.changes).some((p) => p.id && /Kendrick/.test(p.value ?? ''))).toBe(false)
  })

  it('ni el n.º de tema, ni el catálogo, ni el disco se toman como artista', () => {
    const r = tidy(lib.db)
    expect(get(r, 'Track03 - Cada día.mp3', 'artist')).toBeUndefined()
    expect(get(r, 'Track03 - Cada día.mp3', 'title')).toBe('Cada día')
    expect(get(r, 'AL046 - KASST - Hope Im Alone.mp3', 'artist')).toBe('KASST')
    expect(get(r, 'AL046 - KASST - Hope Im Alone.mp3', 'title')).toBe('Hope Im Alone')
    expect(get(r, 'Girls Just Want To Have Fun.mp3', 'artist')).toBe('Cindy Lauper')
  })

  it('"Emilia, TINI - La_Original.mp3" con artista "Emilia": artista completo y el título con su ".mp3"', () => {
    const r = tidy(lib.db)
    expect(get(r, 'Emilia/Emilia, TINI - La_Original.mp3', 'artist')).toBe('Emilia, TINI')
    expect(get(r, 'Emilia/Emilia, TINI - La_Original.mp3', 'title')).toBe('La_Original.mp3')
  })

  it('un artista que es el nombre de una página cuenta como vacío', () => {
    const r = tidy(lib.db)
    expect(get(r, 'los gardelitos - los querandies.mp3', 'artist')).toBe('los gardelitos')
    expect(get(r, 'los gardelitos - los querandies.mp3', 'title')).toBe('los querandies')
    const raja = tidy(lib.db, undefined, undefined, rulesOf('rajatabla'))
    expect(get(raja, 'los gardelitos - los querandies.mp3', 'artist')).toBe('Los Gardelitos')
    expect(get(raja, 'los gardelitos - los querandies.mp3', 'title')).toBe('Los Querandies')
  })

  it('vuelve a calcular lo que PAILA completó mal en una tanda grande, sin tocar lo que alguien cambió después', () => {
    const f = lib.db.prepare("SELECT id, rel_path FROM files WHERE rel_path LIKE '%3.33%'").get() as { id: number; rel_path: string }
    const g = lib.db.prepare("SELECT id, rel_path FROM files WHERE rel_path LIKE '%91-DIVOC%'").get() as { id: number; rel_path: string }
    // como quedó el 19/10: las reglas viejas escribieron "33" y "DIVOC [V1]"; el segundo alguien lo corrigió después a mano
    lib.db.prepare("UPDATE files SET artist = 'Fur Coat, Julian Wassermann', title = '33' WHERE id = ?").run(f.id)
    lib.db.prepare("UPDATE files SET artist = 'Closed I', title = 'Divoc a mano' WHERE id = ?").run(g.id)
    const ins = lib.db.prepare('INSERT INTO journal (batch_id, file_id, rel_path, field, before, after, applied_at) VALUES (1, ?, ?, ?, NULL, ?, ?)')
    const at = '2026-10-19T04:49:30.625Z'
    ins.run(f.id, f.rel_path, 'title', '33', at); ins.run(f.id, f.rel_path, 'artist', 'Fur Coat, Julian Wassermann', at)
    ins.run(g.id, g.rel_path, 'title', 'DIVOC [V1]', at)
    for (let i = 0; i < 20; i++) ins.run(f.id, f.rel_path, 'genre', null, at) // una tanda grande, como las del asistente
    const r = tidy(lib.db)
    const c = r.changes.find((x) => x.id === f.id && x.field === 'title')!
    expect(c.from).toBe('33')
    expect(c.to).toBe('3.33')
    expect(c.note).toMatch(/Lo había completado PAILA/)
    expect(r.changes.some((x) => x.id === g.id && x.field === 'title')).toBe(false) // "Divoc a mano" no lo escribió PAILA
  })
})

describe('Limpiar nombres de archivo (pedido del 20/10: 1.191 nombres con "[www.slider.kz]")', () => {
  it('saca la basura del nombre sin tocar la extensión ni el ".mp3" que es parte del título', () => {
    const r = tidy(lib.db)
    const fn = (rel: string) => r.changes.find((c) => c.rel.endsWith(rel) && c.field === 'filename')
    expect(fn('Ozric Tentacles - Saucers [www.slider.kz].mp3')).toMatchObject({ from: 'Ozric Tentacles - Saucers [www.slider.kz]', to: 'Ozric Tentacles - Saucers', step: 'filenames' })
    expect(fn('Emilia - Jagger.mp3 (Official Video).mp3')?.to).toBe('Emilia - Jagger.mp3')
    expect(r.changes.some((c) => c.rel.endsWith('Jagger.mp3 (Official Video).mp3') && c.field === 'extension')).toBe(false)
    expect(fn('Ella Baila Sola - (Video Oficial) - Eslabon Armado.mp3')?.to).toBe('Ella Baila Sola - Eslabon Armado') // sin "- -"
    expect(fn('las pelotas    Será .mp3')).toBeUndefined() // solo espacios: no se renombra
    expect(fn('y2mate.com - Rusherking - LOBA Official Video.mp3')?.to).toBe('Rusherking - LOBA') // la página de adelante también
  })

  it('en el tag el "_ " vuelve a ser ":", en el nombre del archivo queda lo que Windows permite', () => {
    const r = tidy(lib.db)
    const rel = 'Nathy Peluso_ Bzrp Music Sessions, Vol. 36 [www.slider.kz].mp3'
    expect(get(r, rel, 'title')).toBe('Nathy Peluso: Bzrp Music Sessions, Vol. 36')
    expect(get(r, rel, 'filename')).toBe('Bizarrap, Nathy Peluso - Nathy Peluso_ Bzrp Music Sessions, Vol. 36')
  })

  it('nunca pisa otro archivo de la carpeta ni toca sample packs', () => {
    const r = tidy(lib.db)
    expect(r.changes.some((c) => c.rel === 'Dup/Tema [www.slider.kz].mp3' && c.field === 'filename')).toBe(false)
    expect(r.review.find((x) => x.rel === 'Dup/Tema [www.slider.kz].mp3')?.why).toMatch(/Ya hay otro archivo/)
    // la pantalla lo reconoce por el dato, no por el texto (que se traduce)
    expect(r.review.find((x) => x.rel === 'Dup/Tema [www.slider.kz].mp3')?.blocked).toBe(true)
    expect(r.review.filter((x) => x.blocked).every((x) => x.field === 'filename')).toBe(true)
    expect(r.changes.some((c) => c.rel.startsWith('Samples/'))).toBe(false)
  })

  it('en inglés lo que se escribe en los archivos no cambia: solo los motivos', () => {
    const es = tidy(lib.db, undefined, undefined, rulesOf('rajatabla'))
    ponerIdioma('en')
    try {
      const en = tidy(lib.db, undefined, undefined, rulesOf('rajatabla'))
      const escrito = (r: typeof es) => r.changes.map((c) => `${c.rel}|${c.field}|${c.to}`)
      expect(escrito(en)).toEqual(escrito(es))
      expect(en.changes.filter((c) => c.field === 'albumArtist' && c.to === 'Varios Artistas').length).toBe(es.changes.filter((c) => c.field === 'albumArtist' && c.to === 'Varios Artistas').length)
      expect(en.review.map((x) => `${x.rel}|${x.field}|${x.to}|${!!x.blocked}`)).toEqual(es.review.map((x) => `${x.rel}|${x.field}|${x.to}|${!!x.blocked}`))
      const dup = en.review.find((x) => x.rel === 'Dup/Tema [www.slider.kz].mp3')!
      expect(dup.blocked).toBe(true)
      expect(dup.why).toMatch(/^There is already another file/)
      expect(en.steps.find((s) => s.key === 'junk')!.label).toMatch(/^Clean up junk/)
    } finally { ponerIdioma('es') }
  })

  it('avisa cuántos ya se exportaron a Rekordbox (renombrarlos obliga a relocalizarlos allá)', () => {
    const id = (lib.db.prepare("SELECT id FROM files WHERE rel_path LIKE '%Saucers%'").get() as { id: number }).id
    lib.db.prepare('INSERT INTO rb_exports (file_id, exported_at) VALUES (?, ?)').run(id, '2026-10-19')
    const s = tidy(lib.db).steps.find((x) => x.key === 'filenames')!
    expect(s.warning).toMatch(/^1 de estos temas ya se exportaron a Rekordbox/)
  })

  it('un "_" que no se sabe qué era queda para mirar a mano, con la forma más probable', () => {
    const r = tidy(lib.db)
    expect(r.changes.some((c) => c.rel.startsWith('Rock/AC_DC') && c.field === 'artist')).toBe(false)
    expect(r.review.find((x) => x.rel.startsWith('Rock/AC_DC') && x.field === 'artist')).toMatchObject({ to: 'AC/DC', staged: false })
    expect(r.review.some((x) => x.rel.includes('La_Original'))).toBe(false)
  })
})

// Decisiones sobre la corrida supervisada (20/10/2026): perfiles de nombres, sets y "para mirar a mano".
describe('perfiles de nombres: Mínimo, Prolijo y Rajatabla', () => {
  it('los perfiles van de menos a más, y el de por defecto no toca mayúsculas', () => {
    expect(PROFILES.map((p) => p.key)).toEqual(['minimo', 'prolijo', 'rajatabla', 'oficial'])
    expect(rulesOf('prolijo')).not.toContain('mayusculas')
    expect(profileOf(rulesOf('rajatabla'))).toBe('rajatabla')
    expect(profileOf(['rotos', 'basura', 'feat'])).toBeNull() // a medida
    const count = (p: 'minimo' | 'prolijo' | 'rajatabla') => tidy(lib.db, undefined, undefined, rulesOf(p)).changes.length
    expect(count('minimo')).toBeLessThan(count('prolijo'))
    expect(count('prolijo')).toBeLessThan(count('rajatabla'))
  })

  it('Mínimo: solo caracteres rotos y basura; lo que completa del nombre lo lee bien igual', () => {
    const r = tidy(lib.db, undefined, undefined, rulesOf('minimo'))
    expect(get(r, 'Dancin (feat. Luvli) (Krono Remix).mp3', 'artist')).toBe('Aaron Smith') // el feat. no se mueve
    expect(get(r, 'Dancin (feat. Luvli) (Krono Remix).mp3', 'title')).toBe('Dancin (feat. Luvli) (Krono Remix)')
    expect(get(r, 'Dj Lauuh - Ñeri.mp3', 'artist')).toBe('Dj Lauuh')
    expect(get(r, 'Machines Behave Badly [www.slider.kz] (1).mp3', 'title')).toBe('Machines Behave Badly') // sin "(1)" ni la página
    expect(get(r, 'LOBA Official Video.mp3', 'artist')).toBe('Rusherking')
    expect(r.changes.some((c) => c.step === 'style')).toBe(false)
  })

  it('cada cambio dice qué regla lo hizo; las marcas propias salen solo en Rajatabla', () => {
    const p = tidy(lib.db)
    expect(p.changes.find((c) => c.rel.endsWith('Dj Lauuh - Ñeri.mp3') && c.field === 'artist')).toBeTruthy()
    expect(p.byRule.acentos?.count).toBe(1)
    expect(get(p, 'Baba/c.mp3', 'artist')).toBe('Babasónicos')
    expect(get(p, 'MSTRD.mp3', 'title')).toBeUndefined()
    const r = tidy(lib.db, undefined, undefined, rulesOf('rajatabla'))
    expect(get(r, 'MSTRD.mp3', 'title')).toBe('New Dawn (Original Mix)')
    expect(r.changes.find((c) => c.rel.endsWith('MSTRD.mp3') && c.field === 'title')?.rules).toEqual(['marcas'])
    expect(r.byRule.mayusculas?.count).toBeGreaterThan(0)
    expect(r.byRule.acentos?.count).toBe(1) // los acentos se cuentan como acentos también en Rajatabla
  })
})

describe('"Sets y en vivo" y "para mirar a mano"', () => {
  it('los temas largos con "en vivo" van a la lista de sets; los samples nunca', () => {
    const r = tidy(lib.db)
    expect(r.sets.map((s) => s.rel).sort()).toEqual(['Previa/MIX CUARTETO 2024 - LO MAS ESCUCHADO _ Luck Ra.mp3', 'Recitales/La Renga - En Vivo en Huracán.mp3'])
    expect(r.changes.some((c) => c.rel.startsWith('Recitales/') && c.field !== 'filename')).toBe(false) // no se le inventa artista ni título
  })

  it('pasar a "Sets y en vivo" es una regla por tema (no mueve archivos) y se puede deshacer', () => {
    const f = lib.db.prepare("SELECT id, root_id AS rootId, rel_path AS rel FROM files WHERE rel_path LIKE 'Recitales/%'").get() as { id: number; rootId: number; rel: string }
    lib.setRule(f.rootId, f.rel, 'sets')
    expect((lib.db.prepare('SELECT kind FROM files WHERE id = ?').get(f.id) as { kind: string }).kind).toBe('sets')
    expect(tidy(lib.db).sets.some((s) => s.id === f.id)).toBe(false) // ya no está en Música
    lib.setRule(f.rootId, f.rel, 'musica')
    expect((lib.db.prepare('SELECT kind FROM files WHERE id = ?').get(f.id) as { kind: string }).kind).toBe('musica')
  })

  it('"Dejar como está" saca el tema de la lista (y vuelve si se pide); lo aceptado tampoco se muestra de nuevo', () => {
    const before = tidy(lib.db).review.filter((x) => !x.staged)
    const dime = before.filter((x) => x.rel.endsWith('Dime - La Nueva Luna.mp3'))
    expect(dime.length).toBeGreaterThan(0)
    setKept(lib.db, dime.map(keepKey))
    const r = tidy(lib.db)
    expect(r.review.some((x) => x.rel.endsWith('Dime - La Nueva Luna.mp3'))).toBe(false)
    expect(r.kept).toBe(1)
    setKept(lib.db, [])
    expect(tidy(lib.db).review.some((x) => x.rel.endsWith('Dime - La Nueva Luna.mp3'))).toBe(true)
    // aceptado: queda en Cambios pendientes y no se vuelve a pedir
    const ac = before.find((x) => x.rel.startsWith('Rock/AC_DC') && x.field === 'artist')!
    lib.db.prepare("INSERT INTO pending_changes (file_id, field, before, after, created_at) VALUES (?, 'artist', 'AC_DC', 'AC/DC', '2026-10-20')").run(ac.id)
    expect(tidy(lib.db).review.some((x) => x.id === ac.id && x.field === 'artist')).toBe(false)
    lib.db.prepare('DELETE FROM pending_changes WHERE file_id = ?').run(ac.id)
  })
})
