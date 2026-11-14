// Tests de la lista única de palabras de otra versión (core/versionwords.ts): que una palabra nueva valga para Duplicados,
// las listas, Arreglar nombres y las palabras aprendidas, con los matices de cada uno, y que nadie vuelva a tener la suya.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { titleCore } from '@paila/core/dupnames'
import { VERSION } from '@paila/core/junkwords'
import { sameSong, titleParts } from '@paila/core/listmatch'
import { VERSION_WORD, versionParens } from '@paila/core/names'
import { VERSION_GROUPS, versionRe, versionWords } from '@paila/core/versionwords'

describe('palabras de otra versión', () => {
  it('"REBASSED" (sumada una vez) vale en todos lados', () => {
    // las listas: ya no es el mismo tema que el original (lo vio la corrida de playlists del 22/10)
    expect(titleParts('Bad Blood (REBASSED)').versions).toEqual(['rebassed'])
    expect(sameSong({ artist: 'Taylor Swift', title: 'Bad Blood (REBASSED)' }, { artist: 'Taylor Swift', title: 'Bad Blood' })).toBe(false)
    // Duplicados: es otra versión del mismo tema
    expect(titleCore('Bad Blood - Rebassed', 'Taylor Swift')).toBe(titleCore('Bad Blood', 'Taylor Swift'))
    // Arreglar nombres: la versión suelta al final va entre paréntesis
    expect(versionParens('Bad Blood - DJSNT Rebassed')).toBe('Bad Blood (DJSNT Rebassed)')
    // palabras aprendidas: nunca es basura
    expect(VERSION.test('rebassed')).toBe(true)
  })

  it('acepta tildes y mayúsculas, y busca palabras enteras', () => {
    const re = versionRe(['mezcla', 'grabacion', 'remaster'])
    for (const s of ['Versión larga', 'ACÚSTICO', 'remasterizado 2015', 'Re-Edit']) expect(re.test(s), s).toBe(true)
    for (const s of ['Remixed', 'Demolición', 'Clubber']) expect(re.test(s), s).toBe(false)
  })

  it('cada uno deja afuera lo que no le sirve, con su motivo', () => {
    // Arreglar nombres: "Radio" o "Club" solos al final son parte del título; "Club Edit" sí es una versión
    expect(VERSION_WORD.test('Pirate Radio')).toBe(false)
    expect(VERSION_WORD.test('Club Edit')).toBe(true)
    expect(versionParens('Bersuit - Pirate Radio')).toBe('Bersuit - Pirate Radio')
    // Duplicados no borra "Club" de los títulos: "Fight Club" no es "Fight"
    expect(titleCore('Fight Club')).not.toBe(titleCore('Fight'))
    // y si el título es solo una palabra de versión, es el título
    expect(titleCore('Karaoke (Capri Remix)')).toBe('karaoke')
    expect(versionWords(['mezcla'], { except: ['club'], extra: ['medley'] })).toContain('medley')
    expect(versionWords(['mezcla'], { except: ['club'] })).not.toContain('club')
  })

  it('una versión karaoke o demo se junta con su tema en Duplicados', () => {
    expect(titleCore('Guitarras Blancas Karaoke')).toBe(titleCore('Guitarras Blancas'))
    expect(titleCore('Los libros de la buena memoria - Demo')).toBe(titleCore('Los libros de la buena memoria'))
  })

  it('las palabras están en minúscula y sin tildes, y no se repiten entre grupos', () => {
    const all = Object.values(VERSION_GROUPS).flat()
    expect(all.filter((w) => w !== w.toLowerCase() || w !== w.normalize('NFD').replace(/[̀-ͯ]/g, ''))).toEqual([])
    expect(all.filter((w, i) => all.indexOf(w) !== i)).toEqual([])
  })

  it('ningún otro archivo del núcleo tiene su propia lista de palabras de versión', () => {
    // Las que quedan son otra cosa: discos en vivo o recopilaciones (musicbrainz.ts) y palabras que no sirven para
    // buscar en internet (official.ts).
    const otras = new Set(['versionwords.ts', 'musicbrainz.ts', 'official.ts'])
    const core = path.join(__dirname, '..', 'packages', 'core')
    const files = fs.readdirSync(core, { recursive: true }).map(String).filter((f) => f.endsWith('.ts') && !otras.has(path.basename(f)))
    expect(files.filter((f) => /\bremix\b[^\n]*\|[^\n]*\bedit\b|\bedit\b[^\n]*\|[^\n]*\bremix\b/.test(fs.readFileSync(path.join(core, f), 'utf8')))).toEqual([])
  })
})
