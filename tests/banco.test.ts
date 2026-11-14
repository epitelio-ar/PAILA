// Tests del banco de pruebas de BPM y tono (core/analysis/bench.ts) y del rango de BPM por género (core/analysis/bpmrange.ts).
import { describe, expect, it } from 'vitest'
import { bpmMatch, camelotText, keyMatch, parseKey, parseRekordboxXml, score } from '@paila/core/analysis/bench'
import { DEFAULT_STYLES, bpmForStyle, foldBpm, parseStyles, styleOf } from '@paila/core/analysis/bpmrange'
import { KF_RATE, keyFinder } from '@paila/core/analysis/keyfinder'
import { BT_CHUNK, BT_FPS, BT_MELS, peaks, predict, readBeats } from '@paila/core/analysis/beatthis'
import { combineBpm } from '@paila/core/analysis/dj'

const k = (s: string) => { const c = parseKey(s); return c ? camelotText(c) : null }

describe('leer tonos escritos de cualquier manera', () => {
  it('nombres de nota', () => {
    expect(k('Am')).toBe('8A')
    expect(k('A m')).toBe('8A')
    expect(k('Amin')).toBe('8A')
    expect(k('A minor')).toBe('8A')
    expect(k('Abm')).toBe('1A')
    expect(k('G#m')).toBe('1A')
    expect(k('Dbm')).toBe('12A')
    expect(k('C#m')).toBe('12A')
    expect(k('C')).toBe('8B')
    expect(k('A#maj')).toBe('6B')
    expect(k('F♯m')).toBe('11A')
    expect(k('D major')).toBe('10B') // como lo escribe GiantSteps
    expect(k('Eb minor')).toBe('2A')
  })
  it('Camelot, Open Key (Traktor) y Mixed In Key', () => {
    expect(k('8A')).toBe('8A')
    expect(k('08B')).toBe('8B')
    expect(k('1m')).toBe('8A')
    expect(k('1d')).toBe('8B')
    expect(k('12m')).toBe('7A')
    expect(k('6m')).toBe('1A')
    expect(k('4A - Energy 6')).toBe('4A')
  })
  it('lo que no es un tono', () => {
    expect(parseKey('')).toBeNull()
    expect(parseKey('H')).toBeNull()
    expect(parseKey('13A')).toBeNull()
    expect(parseKey(null)).toBeNull()
  })
})

describe('comparar', () => {
  it('tono: exacto, vecino en la rueda, relativo y choque', () => {
    const c = (s: string) => parseKey(s)!
    expect(keyMatch(c('8A'), c('Am'))).toBe('exacto')
    expect(keyMatch(c('8A'), c('9A'))).toBe('vecino')
    expect(keyMatch(c('12A'), c('1A'))).toBe('vecino')
    expect(keyMatch(c('8A'), c('8B'))).toBe('relativo')
    expect(keyMatch(c('8A'), c('3B'))).toBe('otro')
  })
  it('BPM: ±1, doble, mitad y 3/2', () => {
    expect(bpmMatch(128.4, 128)).toBe('igual')
    expect(bpmMatch(170, 85)).toBe('doble')
    expect(bpmMatch(87, 174)).toBe('mitad')
    expect(bpmMatch(150, 100)).toBe('tres-medios')
    expect(bpmMatch(120, 128)).toBe('otro')
  })
  it('cuenta solo los temas con dato de los dos lados', () => {
    const s = score([
      { bpm: 128, refBpm: 128, key: '8A', refKey: 'Am' },
      { bpm: 170, refBpm: 85, key: '9A', refKey: 'Am' },
      { bpm: null, refBpm: 100, key: null, refKey: 'C' },
    ])
    expect(s.bpm).toMatchObject({ total: 2, igual: 1, doble: 1 })
    expect(s.key).toMatchObject({ total: 2, exacto: 1, vecino: 1 })
  })
})

describe('rekordbox.xml', () => {
  it('lee ruta, BPM y tono de la colección (no de las playlists)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="2">
      <TRACK TrackID="1" Name="Ojos" Artist="Soda &amp; Cía" AverageBpm="126.00" Tonality="Abm" Location="file://localhost/D:/M%C3%BAsica/Clics/09.%20Ojos.flac"><TEMPO Inizio="0.025" Bpm="126.00"/></TRACK>
      <TRACK TrackID="2" Name="Sin BPM" AverageBpm="0.00" Tonality="" Location="file://localhost/C:/x.mp3" />
    </COLLECTION><PLAYLISTS><NODE Type="1"><TRACK Key="1"/></NODE></PLAYLISTS></DJ_PLAYLISTS>`
    const t = parseRekordboxXml(xml)
    expect(t).toHaveLength(2)
    expect(t[0]).toMatchObject({ path: 'D:/Música/Clics/09. Ojos.flac', bpm: 126, key: 'Abm', artist: 'Soda & Cía' })
    expect(t[1]).toMatchObject({ bpm: null, key: null })
  })
})

describe('rango de BPM por género', () => {
  it('reconoce el estilo por el tag de género o por la carpeta', () => {
    expect(styleOf('Cumbia', null)?.name).toMatch(/Cumbia/)
    expect(styleOf(null, 'Electronica/Techno/Shlomo')?.name).toMatch(/House/)
    expect(styleOf('Drum & Bass', 'Electronica')?.name).toMatch(/Drum/)
    expect(styleOf('Reggaetón; Latin Music', null)?.name).toMatch(/Reggaetón/)
    expect(styleOf('Rock', 'Rock/Iorio')).toBeNull()
  })
  it('una carpeta o un género con dos estilos ("Chengue y Trap") no elige ninguno; "disco" no es un estilo (es un álbum)', () => {
    expect(styleOf(null, 'Musica/cumbia y techno')).toBeNull()
    expect(styleOf('House/Reggaeton', null)).toBeNull()
    expect(styleOf(null, 'Chengue y Trap/Trap')).toBeNull() // trap y rap usan el rango general (en tu Rekordbox van de 80 a 170)
    expect(styleOf(null, 'Pop/El disco de tu corazón')).toBeNull()
  })
  it('no confunde palabras sueltas ("rap" en "trapo", "electro" en "electrónica")', () => {
    expect(styleOf(null, 'Varios/El trapo viejo', [{ name: 'Trap', words: ['trap'], min: 100 }])).toBeNull()
    expect(styleOf(null, 'Electronica')).toBeNull()
  })
  it('una cumbia no sale a 170 ni un drum & bass a 87', () => {
    const cumbia = styleOf('cumbia', null), dnb = styleOf('drum and bass', null)
    expect(bpmForStyle(170, cumbia)).toBe(85)
    expect(bpmForStyle(87, dnb)).toBe(174)
    // un estilo agregado por el usuario
    const trap = { name: 'Trap', words: ['trap'], min: 100 }
    expect(bpmForStyle(70, styleOf('Trap', null, [trap]))).toBe(140)
    expect(bpmForStyle(64, styleOf('techno', null))).toBe(128)
    expect(bpmForStyle(170, null)).toBe(170) // sin género: el rango general (70–180)
  })
  it('foldBpm de siempre', () => {
    expect(foldBpm(64)).toBe(128)
    expect(foldBpm(256)).toBe(128)
    expect(foldBpm(0)).toBe(0)
  })
  it('estilos guardados: los del usuario si están bien, si no los de fábrica', () => {
    const mine = [{ name: 'Cuarteto', words: ['cuarteto'], min: 100 }]
    expect(parseStyles(JSON.stringify(mine))).toEqual(mine)
    expect(parseStyles('no es json')).toBe(DEFAULT_STYLES)
    expect(parseStyles(JSON.stringify([{ name: 'x', words: [], min: 5 }]))).toBe(DEFAULT_STYLES)
    expect(parseStyles(null)).toBe(DEFAULT_STYLES)
  })
})

describe('tono al estilo KeyFinder', () => {
  const chord = (hz: number[], seconds = 20) => {
    const out = new Float32Array(KF_RATE * seconds)
    for (let i = 0; i < out.length; i++) for (const f of hz) out[i] += 0.2 * Math.sin((2 * Math.PI * f * i) / KF_RATE) + 0.1 * Math.sin((2 * Math.PI * f * 2 * i) / KF_RATE)
    return out
  }
  it('La menor (La, Do y Mi parejos) → Am', () => {
    expect(keyFinder(chord([220, 261.63, 329.63]))?.key).toBe('Am')
  })
  it('Do mayor (Do, Mi, Sol + Fa) → C', () => {
    expect(keyFinder(chord([130.81, 261.63, 329.63, 392, 174.61]))?.key).toBe('C')
  })
  it('muy corto o en silencio → null', () => {
    expect(keyFinder(new Float32Array(KF_RATE * 5))).toBeNull()
    expect(keyFinder(new Float32Array(KF_RATE * 20))).toBeNull()
  })
})

describe('Beat This!: lo que hace PAILA alrededor del modelo', () => {
  /** logits con picos cada `every` cuadros (y un primero de compás cada 4) */
  const logits = (frames: number, every: number, offset = 0) => {
    const beat = new Float32Array(frames).fill(-5), down = new Float32Array(frames).fill(-5)
    for (let t = offset, i = 0; t < frames; t += every, i++) { const k = Math.round(t); beat[k] = 3; if (i % 4 === 0) down[k] = 3 }
    return { beat, down }
  }
  it('BPM afinado aunque los golpes caigan en cuadros de 20 ms (128 BPM = un golpe cada 23,4 cuadros)', () => {
    const { beat, down } = logits(90 * BT_FPS, (60 / 128) * BT_FPS)
    const r = readBeats(beat, down)
    expect(Math.abs(r.bpm! - 128)).toBeLessThan(0.15)
    expect(r.beatsPerBar).toBe(4)
  })
  it('picos: máximos con logit positivo; dos pegados cuentan como uno', () => {
    const l = new Float32Array(100).fill(-1)
    l[10] = 2; l[11] = 2; l[50] = 1; l[52] = 3
    expect(peaks(l)).toEqual([10.5 / BT_FPS, 52 / BT_FPS])
  })
  it('pedazos de 30 s que se pisan: cada cuadro sale del primer pedazo que lo cubre y todos tienen valor', async () => {
    const T = 4000
    const spect = new Float32Array(T * BT_MELS)
    for (let t = 0; t < T; t++) spect[t * BT_MELS] = t // la primera banda dice qué cuadro es
    const calls: number[] = []
    const r = await predict(spect, async (x) => {
      expect(x.length).toBe(BT_CHUNK * BT_MELS)
      calls.push(x[6 * BT_MELS])
      const beat = new Float32Array(BT_CHUNK), downbeat = new Float32Array(BT_CHUNK)
      for (let i = 0; i < BT_CHUNK; i++) beat[i] = x[i * BT_MELS] // devuelve el número de cuadro
      return { beat, downbeat }
    })
    expect(calls.length).toBe(3)
    for (const t of [0, 1, 1499, 1500, 2999, 3999]) expect(r.beat[t]).toBe(t)
  })
})

describe('BPM con dos métodos (degara + Percival)', () => {
  it('toma el número fino de Percival con la octava de degara', () => {
    expect(combineBpm(128.4, 64.05)).toEqual({ bpm: 128.1, doubtful: false })
    expect(combineBpm(85.2, 170.6)).toEqual({ bpm: 85.3, doubtful: false })
    expect(combineBpm(120, 121)).toEqual({ bpm: 121, doubtful: false })
  })
  it('si no coinciden ni al doble ni a la mitad: vale degara y queda dudoso', () => {
    expect(combineBpm(120, 100)).toEqual({ bpm: 120, doubtful: true })
    expect(combineBpm(120, null)).toEqual({ bpm: 120, doubtful: false })
  })
})
