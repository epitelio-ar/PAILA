// Duplicados: dos grabaciones que la huella no distingue (punto 1 real, 24/10). Un instrumental separado con Demucs y otra letra
// sobre la misma base se iban a la papelera como "mismo audio, otra calidad"; ahora van a Versiones, que nunca se tiran.
import { describe, expect, it } from 'vitest'
import { otherRecording } from '@paila/core/dupnames'

const tema = (rel: string, title: string | null = null, artist: string | null = null) => ({ rel, title, artist })

describe('otra grabación aunque suene igual', () => {
  it('otra letra sobre la misma base ("Alternate Lyrics") no es una copia del original', () => {
    expect(otherRecording(
      tema("Rock/Guns N' Roses/13 Don't Cry [Alternate Lyrics].mp3", "Don't Cry [Alternate Lyrics]", "Guns N' Roses"),
      tema("Rock/Guns N' Roses/04 Don't Cry [Original Version].mp3", "Don't Cry [Original Version]", "Guns N' Roses"),
    )).toBe(true)
  })

  it('los stems de Demucs ("NO_VOCALS_…", "VOCALS_…") no son copias del tema, ni entre ellos', () => {
    const original = tema('Rock/Charly García - Yo Ya Sé (Official Visualizer).mp3')
    const instrumental = tema('NO_VOCALS_130BPM_CMajor_DEM4_charly_garc_a___yo_ya_s___official_visualizer_.mp3')
    const voz = tema('VOCALS_130BPM_CMajor_DEM4_charly_garc_a___yo_ya_s___official_visualizer_.mp3')
    expect(otherRecording(instrumental, original)).toBe(true)
    expect(otherRecording(voz, original)).toBe(true)
    expect(otherRecording(instrumental, voz)).toBe(true)
  })

  it('dos copias del mismo stem, o del mismo tema, siguen siendo copias', () => {
    expect(otherRecording(
      tema('VOCALS_120BPM_tema.mp3'),
      tema('VOCALS_120BPM_tema (1).mp3'),
    )).toBe(false)
    expect(otherRecording(
      tema('Rock/Divididos/Que ves.mp3', 'Qué ves', 'Divididos'),
      tema('pendrive/musica/divididos - que ves.mp3', 'Que Ves', 'Divididos'),
    )).toBe(false)
  })

  it('el instrumental con la palabra en el título o en el nombre del archivo cuenta igual', () => {
    expect(otherRecording(
      tema('Hip Hop/Tema (Instrumental).mp3', 'Tema'),
      tema('Hip Hop/tema.mp3', 'Tema'),
    )).toBe(true)
    expect(otherRecording(
      tema('a/Tema.mp3', 'Tema (Instrumental)'),
      tema('b/Tema instrumental.mp3', 'Tema'),
    )).toBe(false)
  })
})
