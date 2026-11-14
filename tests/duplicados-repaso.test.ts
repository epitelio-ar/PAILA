// Lo que encontró el repaso de criterios del 24/10 en Duplicados (docs/pruebas/2026-10-24-repaso-criterios.md): "satura" como sí
// o no dejaba decidir a la ruta más corta entre dos copias que saturan, y entre un MP3 y un WMA de la misma nota ganaba el WMA.
import { describe, expect, it } from 'vitest'
import { pickKeeper } from '@paila/core/duplicates'
import type { DupItem } from '@paila/shared/types'

const item = (id: number, rel: string, over: Partial<DupItem> = {}): DupItem => ({
  id, rel, ext: 'mp3', size: 1, kbps: 320, duration: 200, grade: 'B', kind: 'musica', tagged: true, artist: 'A', title: 'T', playlists: [], ...over,
})

describe('repaso de criterios: Duplicados', () => {
  it('entre dos copias que saturan se queda la que satura menos (no la de la ruta más corta)', () => {
    // "TODOS CON EL CELU": la de DISCO CUMPLE tiene 703 recortes y suena 2,3 dB más fuerte; la de Louta, 130
    const fuerte = item(3942, 'DISCO CUMPLE/TRAP SET/03  TODOS CON EL CELU.mp3', { clipEvents: 703, lufs: -5.1 })
    const menos = item(4525, 'Chengue y Trap/Cachengue 2/LOUTA - TODOS CON EL CELU.mp3', { clipEvents: 130, lufs: -7.4 })
    expect(pickKeeper([fuerte, menos])).toBe(4525)
    // "TiK ToK": 311 recortes a −6,4 LUFS contra 98 a −7,5
    expect(pickKeeper([item(1, 'DISCO CUMPLE/pop/53. Kesha - TiK ToK.mp3', { clipEvents: 311, lufs: -6.4 }),
      item(2, 'pendrive/musica/Musica vieja/noelectronica/pop/Ke$ha - TiK ToK [www.slider.kz].mp3', { clipEvents: 98, lufs: -7.5 })])).toBe(2)
  })

  it('unos recortes más con el mismo volumen no son otro master: decide lo de siempre', () => {
    // "Noise" de Denis Horvat: 6 recortes contra 1, los dos a −9,8 LUFS; no satura ninguna (y al final gana la de tienda)
    const a = item(1, 'Electronica/Techno/1.Melodic Techno/Denis Horvat - Noise (feat Lelah) [Afterlife Records].mp3', { clipEvents: 6, lufs: -9.8 })
    const b = item(2, 'Electronica/Techno/1.Melodic Techno/Denis Horvat feat. Lelah - Noise [www.slider.kz].mp3', { clipEvents: 1, lufs: -9.8 })
    expect(pickKeeper([a, b])).toBe(1)
    // y 8 recortes con 2,4 dB más (otro master) sí cuentan: "Yesterdays" de Guns N' Roses, como decidió el ensayo
    expect(pickKeeper([item(3, 'Rock/Guns N\' Roses/03 Yesterdays (2).mp3', { kbps: 128, grade: 'D', clipEvents: 0, lufs: -12.6 }),
      item(4, 'Rock/Guns N\' Roses/11 Yesterdays.mp3', { kbps: 128, grade: 'D', clipEvents: 8, lufs: -10.2 })])).toBe(3)
  })

  it('a igual nota, el MP3 le gana al WMA aunque el WMA tenga tags y sature menos', () => {
    // "04 Panic show" de La Renga: los dos D, 128; el MP3 sin tags, el WMA con tags y 18 recortes (0,3 dB más)
    const mp3 = item(2605, 'Rock/La Renga/04 - Panic show.mp3', { kbps: 128, grade: 'D', tagged: false, clipEvents: 0, lufs: -8.3 })
    const wma = item(2609, 'Rock/La Renga/04 Panic show.wma', { ext: 'wma', kbps: 128, grade: 'D', clipEvents: 18, lufs: -8.0 })
    expect(pickKeeper([mp3, wma])).toBe(2605)
    // "01 En la vida, las mismas calles": el WMA satura más y antes igual ganaba (tenía tags)
    expect(pickKeeper([item(1, 'Rock/La Renga/01 - la vida las mismas calles.mp3', { kbps: 128, grade: 'D', tagged: false, clipEvents: 18, lufs: -7.9 }),
      item(2, 'Rock/La Renga/01 En la vida, las mismas calles.wma', { ext: 'wma', kbps: 128, grade: 'D', clipEvents: 163, lufs: -7.7 })])).toBe(1)
    // la nota sigue mandando: un OGG de 160 (C) le gana a un MP3 de 128 (D)
    expect(pickKeeper([item(5, 'a.mp3', { kbps: 128, grade: 'D' }), item(6, 'b.ogg', { ext: 'ogg', kbps: 160, grade: 'C' })])).toBe(6)
  })
})

describe('repaso de criterios: lo que contestó el autor (24/10)', () => {
  it('entre una copia con huecos y otra limpia de menos calidad, se queda la limpia ("The Crunge")', () => {
    const roto = item(1, 'Rock/Led Zeppelin/04 - the crunge.mp3', { kbps: 320, grade: 'B', gaps: true })
    const limpio = item(2, 'Rock/Led Zeppelin/04 The Crunge.mp3', { kbps: 128, grade: 'D' })
    expect(pickKeeper([roto, limpio])).toBe(2)
  })

  it('a igual nota, formato y saturación, desempata el análisis: LAME antes que ffmpeg, y un MP3 a 48 kHz pierde', () => {
    // "Una Wacha Piola": la de DISCO CUMPLE recomprimida con ffmpeg (Lavc58.35), la de slider.kz con LAME
    expect(pickKeeper([item(1, 'DISCO CUMPLE/Chengue/De La Calle - Una Wacha Piola [www.slider.kz].mp3', { encoder: 'Lavc58.35', cutoff: 15149 }),
      item(2, 'pendrive/musica/Musica vieja/noelectronica/cumbia/De La Calle - Una Wacha Piola [www.slider.kz].mp3', { encoder: 'LAME3.99r', cutoff: 15149 })])).toBe(2)
    // "El Amanecer": un MP3 a 48 kHz (sale de un video de YouTube) contra uno a 44,1 kHz
    expect(pickKeeper([item(3, 'DISCO CUMPLE/TRAP SET/04 EL AMANECER.mp3', { sampleRate: 48000, encoder: 'Lavc58.53' }),
      item(4, 'Chengue y Trap/Trap/04 - YSY A - El Amanecer _ ANTEZANA 247.mp3', { sampleRate: 44100, encoder: 'Lavc58.13' })])).toBe(4)
  })

  it('el corte de agudos desempata en 256 kbps o más, no en 128 (LAME corta en 16 kHz a propósito)', () => {
    expect(pickKeeper([item(1, 'a/Tema.mp3', { cutoff: 19400 }), item(2, 'b/Tema largo de nombre.mp3', { cutoff: 20250 })])).toBe(2)
    // "Transparente" de Las Pelotas: los dos MP3 de 128; el que llega a 20 kHz no es mejor
    expect(pickKeeper([item(3, 'Rock/Las Pelotas/01 - las pelotas - transparente.mp3', { kbps: 128, grade: 'D', cutoff: 16182 }),
      item(4, 'Rock/Las Pelotas/las pelotas - 01 - transparente.mp3', { kbps: 128, grade: 'D', cutoff: 20090 })])).toBe(3)
  })

  it('con todo lo demás igual, la de tienda antes que la de una página de descargas ("Noise" de Denis Horvat)', () => {
    const slider = item(1, 'Electronica/Techno/1.Melodic Techno/Denis Horvat feat. Lelah - Noise [www.slider.kz].mp3', { encoder: 'Lavf', cutoff: 20252, clipEvents: 1, lufs: -9.8 })
    const tienda = item(2, 'Electronica/Techno/1.Melodic Techno/Denis Horvat - Noise (feat Lelah) [Afterlife Records].mp3', { encoder: 'Lavf', cutoff: 20252, clipEvents: 6, lufs: -9.8 })
    expect(pickKeeper([slider, tienda])).toBe(2)
    // pero la carpeta del disco sigue antes ("El universo en tus ojos" de Veeyam, la de slider.kz está en su disco)
    expect(pickKeeper([item(3, 'Rap - Varios/Veeyam/Veeyam - El universo en tus ojos [www.slider.kz].mp3', { inAlbum: true }), item(4, 'Rap - Varios/Rap Set/Veeyam - El universo en tus ojos.mp3')])).toBe(3)
  })
})
