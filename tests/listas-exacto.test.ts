// "Traer una lista": la coincidencia exacta (core/listmatch.ts, PENDIENTES 7, 24/10). Una lista pegada sin duraciones dejaba
// "para confirmar" hasta los temas que coinciden exacto; ahora entran solos, salvo las trampas (otra versión, un disco en
// vivo con el título pelado, un artista de menos, un alias, un título genérico, dos largos distintos).
import { describe, expect, it } from 'vitest'
import { parseList } from '@paila/core/listparse'
import { ListMatcher, type LibTrack } from '@paila/core/listmatch'
import { stateOf } from '@paila/core/requests'

const t = (id: number, artist: string | null, title: string | null, duration: number | null, extra: Partial<LibTrack> = {}): LibTrack =>
  ({ id, rel: `M/${artist} - ${title}.mp3`, ext: 'mp3', artist, title, duration, grade: 'B', flags: null, isrc: null, ...extra })
const e = (artist: string, title: string, duration: number | null) => ({ position: 1, artist, title, album: null, duration, isrc: null, path: null })

describe('lo exacto', () => {
  it('probable: el nombre coincide, pero no letra por letra (un artista de menos, un alias, el título sin su subtítulo)', () => {
    const p = new ListMatcher([
      t(1, 'Tears for Fears, Oleta Adams', 'Woman in Chains', 391),
      t(2, 'Simple Minds', "Don't You", 260),
      t(3, 'J Balvin', 'Mi Gente', 189),
      t(4, 'Daft Punk', 'Intro', 60),
    ], { aliases: (n) => (n === 'Balvin' ? ['J Balvin'] : []) })
    expect(p.match(e('Tears for Fears', 'Woman in Chains', 391))).toMatchObject({ kind: 'probable', fileId: 1 })
    expect(p.match(e('Simple Minds', "Don't You (Forget About Me)", 260))).toMatchObject({ kind: 'probable', fileId: 2 })
    expect(p.match(e('Balvin', 'Mi Gente', 189))).toMatchObject({ kind: 'probable', fileId: 3 }) // "Balvin" no es "J Balvin" sin confirmar
    expect(p.match(e('Daft Punk', 'Intro', null))).toMatchObject({ kind: 'probable', fileId: 4 }) // un título que se repite en muchos discos
  })
  // la prueba del 23/10: una lista pegada (sin duraciones) dejaba "para confirmar" hasta a Virus, "Pronta Entrega", en FLAC A
  it('lista pegada sin duración: lo exacto con una sola versión entra; varias copias, la mejor nota; dos versiones, a confirmar', () => {
    const lib = [
      t(1, 'Virus', 'Pronta Entrega', 228, { ext: 'flac', grade: 'A' }),
      t(2, 'Virus', 'Pronta Entrega (En Vivo)', 262),
      t(3, 'Soda Stereo', 'De Música Ligera', 210, { grade: 'C' }), t(4, 'Soda Stereo', 'De Musica Ligera', 211, { ext: 'flac', grade: 'A' }),
      t(5, 'Los Abuelos de la Nada', 'Mil Horas', 190),
      t(6, 'Charly García', 'Demoliendo Hoteles', 240), t(7, 'Charly García', 'Demoliendo Hoteles', 421), // la del disco y una larga, sin decirlo
      t(8, 'Sumo', 'La Rubia Tarada (Remix)', 300),
      t(9, 'Fito Páez', '11 y 6', 200),
    ]
    const pasted = [
      'Virus - Pronta Entrega', 'SODA STEREO - De música ligera', 'Los Abuelos de la Nada - Mil Horas', 'Charly Garcia - Demoliendo Hoteles',
      'Sumo - La Rubia Tarada', 'Fito Paez - 11 y 6', 'Patricio Rey y sus Redonditos de Ricota - Ji Ji Ji', 'Virus - Pronta Entrega (En Vivo)',
    ].join('\n')
    const { entries } = parseList(pasted)
    expect(entries.every((x) => x.duration == null)).toBe(true)
    const pm = new ListMatcher(lib)
    const got = entries.map((x) => pm.match(x))
    expect(got.map((r) => [r.kind, r.fileId])).toEqual([
      ['exacto', 1], ['exacto', 4], ['exacto', 5], ['probable', 6], ['version', 8], ['exacto', 9], ['none', null], ['exacto', 2],
    ])
    expect(got[0].why).toBe('El mismo artista y el mismo título, y es la única versión que tenés')
    expect(got[1].copies).toBe(1) // la FLAC A, no la C
    expect(got.map((r) => stateOf(r.kind, null, r.fileId ? { low: false } : null))).toEqual(['tenes', 'tenes', 'tenes', 'revisar', 'revisar', 'tenes', 'falta', 'tenes'])
  })
  it('trampas: lo que se parece pero no es exacto sigue como hoy', () => {
    const pm = new ListMatcher([
      t(1, 'Virus', 'Pronta Entrega (En Vivo)', 262), // solo la en vivo
      t(2, 'Los Twist', 'Pensé que se trataba de cieguitos (En Vivo)', 200, { guess: { artist: 'Los Twist', title: 'Pensé que se trataba de cieguitos' } }),
      t(3, 'Viejas Locas', 'Intro', 70),
      t(4, 'Soda Stereo, Gustavo Cerati', 'Té para tres', 190),
      t(5, 'Bad Bunny', 'MIA (feat. Drake)', 210),
      t(6, 'Virus Syndicate', 'Sharp Shooter', 220),
      t(7, 'Babasónicos', 'Irresponsables', 180), t(8, 'Babasónicos', 'Irresponsables (Versión Acústica)', 200),
    ])
    // "Pronta Entrega" no es "Pronta Entrega (en vivo)", ni al revés
    expect(pm.match(e('Virus', 'Pronta Entrega', null))).toMatchObject({ kind: 'version', fileId: 1 })
    // el nombre del archivo no dice "en vivo", pero el tag sí: mandan los tags (no es exacto)
    expect(pm.match(e('Los Twist', 'Pensé que se trataba de cieguitos', null)).kind).not.toBe('exacto')
    expect(pm.match(e('Viejas Locas', 'Intro', null))).toMatchObject({ kind: 'probable', fileId: 3 })
    expect(pm.match(e('Soda Stereo', 'Té para tres', null))).toMatchObject({ kind: 'probable', fileId: 4 }) // un artista de menos
    expect(pm.match(e('Bad Bunny, Drake', 'MIA', null))).toMatchObject({ kind: 'exacto', fileId: 5 }) // el feat. en el título cuenta igual
    expect(pm.match(e('Bad Bunny feat. Drake', 'Mía', null))).toMatchObject({ kind: 'exacto', fileId: 5 })
    expect(pm.match(e('Virus', 'Sharp Shooter', null)).kind).toBe('none')
    // con dos versiones en la biblioteca, la que dice la lista
    expect(pm.match(e('Babasonicos', 'Irresponsables', null))).toMatchObject({ kind: 'exacto', fileId: 7 })
    expect(pm.match(e('Babasonicos', 'Irresponsables - Versión Acústica', null))).toMatchObject({ kind: 'exacto', fileId: 8 })
    // con duración, que no coincida sigue siendo otra versión
    expect(pm.match(e('Babasonicos', 'Irresponsables', 240))).toMatchObject({ kind: 'version' })
  })
  it('trampa de la corrida del 24/10: un disco en vivo con el título pelado no es la versión común', () => {
    const ao = 'Patricio Rey y sus Redonditos de Ricota'
    const vivo = t(1, ao, 'Jijiji', 342, { ext: 'flac', grade: 'A', album: 'Estadio Chateau Carreras 2001, CD2', rel: 'Redondos/Recitales y otros/2001 - Chateau Carreras/CD 2/13 - Jijiji.flac' })
    const oktubre = t(2, ao, 'Jijiji', 343, { ext: 'flac', grade: 'A', album: 'Oktubre', rel: 'Redondos/1986 - Oktubre/07 - Jijiji.flac' })
    expect(new ListMatcher([vivo, oktubre]).match(e(ao, 'Ji Ji Ji', null))).toMatchObject({ kind: 'exacto', fileId: 2, copies: 0 })
    // solo el en vivo (por el disco o por la carpeta): se confirma a mano, como antes
    expect(new ListMatcher([vivo]).match(e(ao, 'Jijiji', null))).toMatchObject({ kind: 'probable', fileId: 1 })
    expect(new ListMatcher([{ ...vivo, album: null }]).match(e(ao, 'Jijiji', null))).toMatchObject({ kind: 'probable', fileId: 1 })
    expect(new ListMatcher([t(3, 'Charly García', 'Rezo por vos', 300, { album: 'MTV Unplugged' })]).match(e('Charly Garcia', 'Rezo por vos', null)).kind).toBe('probable')
  })
})
