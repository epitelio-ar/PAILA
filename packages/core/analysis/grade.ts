// Convierte las mediciones en una nota de A+ a F con una explicación (en el idioma de PAILA: grade.textos.ts).
import type { RawAnalysis } from './analyze'
import { lossyClues, readClues, trustedClues, type Clues } from './clues'
import { enCadaIdioma, idioma, num, type Idioma } from '@paila/shared/idioma'
import { T } from './grade.textos'

export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'
export type Flag =
  | 'fake_lossless' | 'maybe_transcoded' | 'upscaled' | 'reencoded' | 'fake_hires' | 'fake_24bit' | 'damaged'
  | 'clipping' | 'very_loud' | 'fake_stereo' | 'mono' | 'low_bitrate' | 'gaps' // gaps: cuadros que no se pueden leer (huecos)
  | 'soft_cutoff' | 'step16' | 'low_samplerate'
  | 'as_recorded' | 'cut20' // B sin rastros de compresión: corte suave (como fue grabado) o arriba de ~19,5 kHz
  // el corte de golpe (cut20) en tres casos (decisión del 23/10/2026): con evidencia de que es del disco (cut20_trusted, "como
  // fue grabado"); en seco justo donde corta un MP3 de ~256 (cut20_mp3like, "puede venir de un MP3"); o en otra frecuencia (solo cut20)
  | 'cut20_trusted' | 'cut20_mp3like'

export interface Verdict {
  grade: Grade
  says: string // lo que dice ser
  is: string // lo que es en realidad
  why: string[] // por qué (en el idioma de PAILA al analizar)
  confidence: 'alta' | 'media' | 'baja'
  flags: Flag[]
  effKbps: number // calidad equivalente (1411 = CD)
  sound: string[] // observaciones de sonido (no bajan la nota)
}

export interface GradeInput {
  codec: string | null
  ext: string
  lossless: boolean
  kbps: number | null
  sampleRate: number | null
  bits: number | null
  channels: number | null
}

const LOSSLESS_CODECS = ['flac', 'alac', 'ape', 'wavpack', 'tta', 'wmalossless']
/** El formato es sin pérdida (FLAC, WAV, AIFF, ALAC…), según el códec que dice ffprobe o, si no dice, la extensión. */
export const isLossless = (codec: string | null, ext: string) =>
  LOSSLESS_CODECS.includes(codec || '') || (codec || '').startsWith('pcm_') || (!codec && ['wav', 'aif', 'aiff', 'flac'].includes(ext))

const FULL_BAND = 20800

// Forma del corte (Fase E, docs/archivo/pruebas/2026-10-20-analisis-2.md): un MP3 o AAC corta de golpe (cae 15 dB o más en medio kHz);
// un vinilo, una cinta o un master viejo bajan de a poco. Medido en 155 WAV/FLAC/AIFF con nota D o F de la biblioteca real.
const SOFT_SHARP = 12 // dB en medio kHz: hasta acá, el corte es suave
const SOFT_SHARE = 0.4 // y esa caída es menos del 40 % de la caída total
const MP3_FLICKER = 3.5 // los agudos saltan 3,5 veces más que los medios: huecos de MP3
const FLICKER_OK = 3 // hasta acá, los agudos se mueven como en un tema genuino (1,4–2,3 medido en FLAC reales)
const STEP_LOSSLESS = 12 // dB de escalón en 16 kHz que delatan un MP3/AAC en un archivo sin pérdida
const STEP_WEAK = 8 // escalón chico: en temas genuinos medidos va de -2 a 4 dB (corrida del 22/10/2026)
const OPUS_TOP = 20400 // el audio de YouTube (Opus, 48 kHz) se corta de golpe en 20 kHz: se mide entre 20,0 y 20,4
const STEP_STRONG = 18 // escalón tan grande que arriba de 16 kHz no queda casi nada: vale como un corte en 16 kHz
// el corte de un MP3 de ~256 kbps de LAME (19,6 kHz) medido en un sin pérdida: hasta 19,7 kHz (comparación con Fakin' The Funk).
// Desde abajo empieza donde empieza el corte de golpe que es B (19,4 kHz, cutoffToKbps): más abajo ya es un MP3 de ~192 (F)
const MP3LIKE_LO = 19400
const MP3LIKE_HI = 19700
const MODERN_YEAR = 1985 // desde acá, un archivo sin pérdida de 32 kHz no tiene excusa: los discos y las tiendas son de 44,1 kHz o más

/** El corte baja de a poco (vinilo, cinta, master viejo) en vez de golpe (MP3). */
function softCutoff(c: RawAnalysis['cutoff'], flicker: number | null): boolean {
  if (c.sharp == null || !c.fall) return false
  return c.sharp <= SOFT_SHARP && c.sharp / c.fall <= SOFT_SHARE && (flicker == null || flicker < FLICKER_OK) && (c.step16 ?? 0) < STEP_LOSSLESS
}
const khz = (hz: number) => `${num(hz / 1000, { maximumFractionDigits: 1 })} kHz`

/**
 * Corte típico de LAME/AAC según bitrate (igual criterio que Fakin' The Funk). Los MP3 de 128 genuinos se miden entre 15,4 y
 * 16,2 kHz (comparación con Fakin' The Funk, 23/10/2026): desde 15 kHz ya es un 128 y no un 96.
 */
function cutoffToKbps(hz: number): number {
  if (hz >= 20300) return 320
  if (hz >= 19400) return 256
  if (hz >= 18300) return 192
  if (hz >= 17200) return 160
  if (hz >= 15000) return 128
  if (hz >= 14000) return 96
  return 64
}

// Codecs más eficientes que MP3: su bitrate "vale" más.
const EFFICIENCY: Record<string, number> = { opus: 1.6, vorbis: 1.25, aac: 1.25 }
const CODEC_NAME: Record<string, string> = { mp3: 'MP3', aac: 'AAC', vorbis: 'OGG', opus: 'Opus', wmav2: 'WMA', wmav1: 'WMA', flac: 'FLAC', alac: 'ALAC' }


function saysLabel(i: GradeInput): string {
  const name = CODEC_NAME[i.codec || ''] || (i.ext === 'aif' || i.ext === 'aiff' ? 'AIFF' : i.ext === 'wav' ? 'WAV' : (i.codec || i.ext).toUpperCase())
  if (i.lossless) {
    return T.sinPerdida(name, i.bits || 16, i.sampleRate ? khz(i.sampleRate) : '')
  }
  return `${name} · ${i.kbps || '?'} kbps`
}

/**
 * La nota. `clues`: lo que se sabe del archivo fuera del sonido (nombres de hoy y de antes, año; core/analysis/clues.ts). Junto
 * con las etiquetas que leyó ffmpeg (`a.meta`) son las pistas para decidir sola en los casos que el sonido no alcanza:
 * PAILA no manda a nadie a mirar el espectrograma (decidido el 22/10/2026).
 */
export function grade(i: GradeInput, a: RawAnalysis, clues?: Clues): Verdict {
  const found = readClues(clues, a.meta)
  const lossy = lossyClues(found)
  const trusted = trustedClues(found)
  // de una descarga (YouTube, una página): ffmpeg solo no alcanza cuando el sonido dice otra cosa (un corte suave lo puede
  // pasar ffmpeg de un formato sin pérdida a otro)
  const downloaded = lossy.filter((x) => x.kind !== 'converter')
  // la época es una pista menor: solo pesa en los archivos de 32 kHz (sin año, se toma como música de estas décadas)
  const modern = clues?.year == null || clues.year >= MODERN_YEAR
  const why: string[] = []
  const flags: Flag[] = []
  const sound: string[] = []
  const c = a.cutoff
  const drop = c.drop
  let confidence: Verdict['confidence'] = !c.cutoff || c.frames < 20 ? 'baja' : drop === 0 || drop >= 40 ? 'alta' : drop >= 25 ? 'media' : 'baja'
  let g: Grade
  let is: string
  let eff: number

  if (a.decodeErrors > 3) {
    flags.push('damaged')
    why.push(T.errores(a.decodeErrors))
  }

  if (i.lossless) {
    const hiresFormat = (i.sampleRate || 0) > 48000 || (i.bits || 16) > 16
    const h = a.hires
    const cdEdge = h?.cdEdgeDrop != null && h.cdEdgeDrop >= 12
    if (c.cutoff == null) {
      g = 'A'; eff = 1411; is = T.sinVerificar; confidence = 'baja'
      why.push(T.casiNada)
    } else if (c.formatLimit) {
      // 32 kHz o menos: el formato no guarda agudos más altos. Ningún disco ni tienda vende música a 32 kHz: en música de
      // las últimas décadas, o con rastros de descarga, sale de un archivo comprimido (un juego, una radio, una página)
      eff = cutoffToKbps(c.cutoff); confidence = 'alta'; flags.push('low_samplerate')
      why.push(T.archivoDe(khz(i.sampleRate!), khz(c.cutoff)))
      if (lossy.length || modern) {
        g = 'D'; flags.push('maybe_transcoded')
        is = T.comprimidoA(khz(i.sampleRate!))
        why.push(...lossy.map((x) => x.what))
        why.push(T.nadieVende(khz(i.sampleRate!), clues?.year ?? null))
      } else {
        g = 'C'; is = T.sinPerdidaPeroA(khz(i.sampleRate!))
        why.push(T.noDisfrazado)
      }
    } else if (c.cutoff >= FULL_BAND && (c.step16 ?? 0) >= STEP_LOSSLESS) {
      g = 'D'; eff = 256; flags.push('maybe_transcoded', 'step16'); confidence = lossy.length ? 'alta' : 'media'
      is = T.deMp3
      why.push(T.escalon16(c.step16!))
      why.push(T.escalonExplica)
      why.push(...lossy.map((x) => x.what))
    } else if (c.cutoff >= FULL_BAND) {
      if (hiresFormat && h && (h.cutoff ?? 0) > 23000 && !cdEdge && (i.sampleRate || 0) > 48000) {
        g = 'A+'; eff = 2304; is = T.hiRes
        why.push(T.hastaHiRes(khz(h.cutoff!)))
      } else {
        g = 'A'; eff = 1411; is = T.cd
        why.push(T.llegaArriba)
        if ((i.sampleRate || 0) > 48000) {
          flags.push('fake_hires')
          is = T.cdHiResFalso
          why.push(T.estirado(num(i.sampleRate! / 1000)))
        }
      }
      if (a.effBits === 16 && (i.bits || 16) > 16) {
        flags.push('fake_24bit')
        why.push(T.falso24)
      }
    } else if (softCutoff(c, a.flicker)) {
      eff = cutoffToKbps(c.cutoff)
      why.push(T.bajanDePoco(khz(c.cutoff)))
      if (downloaded.length) {
        // la forma del corte es de un vinilo o un master, pero el archivo viene de una descarga: lo que se bajó ya estaba comprimido
        g = 'D'; flags.push('maybe_transcoded'); confidence = 'media'
        is = T.descarga
        why.push(...downloaded.map((x) => x.what))
        why.push(T.descargaExplica)
      } else {
        g = 'B'; eff = 1411; confidence = 'media'; flags.push('as_recorded') // es la grabación tal cual: calidad de CD
        is = T.comoGrabado
        why.push(T.comoGrabadoExplica(a.decodeErrors <= 3))
        why.push(...trusted.map((x) => x.what))
      }
    } else {
      const eq = cutoffToKbps(c.cutoff)
      eff = eq
      const holes = a.flicker != null && a.flicker >= MP3_FLICKER
      const fmt = saysLabel(i).split(' ')[0]
      // rastros chicos en el sonido: solos no alcanzan para hablar de un MP3, pero junto a un corte de golpe sí
      const weak: string[] = []
      if (!holes && a.flicker != null && a.flicker >= FLICKER_OK) weak.push(T.titilan(num(a.flicker, { maximumFractionDigits: 1 })))
      if ((c.step16 ?? 0) >= STEP_WEAK) weak.push(T.escalonChico(c.step16!))
      // el corte de YouTube va como dato, no buscando la palabra en la frase (que cambia con el idioma)
      const opusCut = i.sampleRate === 48000 && c.cutoff >= 19900 && c.cutoff <= OPUS_TOP && (c.sharp ?? 0) >= 15 && !lossy.some((x) => x.kind === 'youtube')
      if (opusCut) weak.push(T.youtube48)
      if (eq >= 256 && !holes && !lossy.length && !weak.length) {
        // Corta de golpe arriba de ~19,5 kHz y no hay ningún otro rastro: puede ser un master o un CD con filtro, o un MP3 de
        // 256–320 pasado a sin pérdida. Las dos cosas suenan bien (un MP3 de 320 también es B) y arriba de 20 kHz casi nadie
        // oye: se decide por lo seguro, B, sin mandar a nadie a mirar nada.
        g = 'B'; confidence = 'media'; flags.push('cut20')
        is = T.completo(khz(c.cutoff))
        const anyGear = a.decodeErrors <= 3
        if (trusted.length) {
          flags.push('cut20_trusted')
          why.push(T.llegaYCorta(khz(c.cutoff)))
          why.push(T.corteDelDisco(trusted.map((x) => x.what).join(' ')))
        } else if (c.cutoff >= MP3LIKE_LO && c.cutoff <= MP3LIKE_HI) {
          // justo el corte de un MP3 de muy buena calidad: suena completo, pero se dice que puede venir de uno (decisión 23/10)
          flags.push('cut20_mp3like')
          why.push(T.mp3likeCorte(khz(c.cutoff)))
          why.push(T.mp3likePuede(fmt, anyGear))
        } else {
          why.push(T.llegaYCorta(khz(c.cutoff)))
          why.push(T.cortanCd(fmt, anyGear))
        }
      } else if (eq >= 256) {
        g = 'D'; flags.push('maybe_transcoded')
        // YouTube o una página de descarga lo dicen con todas las letras; ffmpeg o un rastro chico, casi seguro
        confidence = lossy.some((x) => x.kind !== 'converter') || holes ? 'alta' : 'media'
        const yt = lossy.some((x) => x.kind === 'youtube') || opusCut
        is = yt ? T.youtube : T.deMp3Kbps(eq)
        why.push(T.cortaDeGolpe(khz(c.cutoff)))
        why.push(...lossy.map((x) => x.what), ...weak)
        why.push(yt ? T.youtubeExplica(fmt) : T.comprimidoExplica)
      } else {
        g = 'F'; flags.push('fake_lossless')
        is = T.disfrazado(eq)
        why.push(T.cortaDeGolpe(khz(c.cutoff)))
        why.push(T.alguienConvirtio(eq, fmt))
        why.push(...lossy.map((x) => x.what))
      }
      if (holes) { confidence = 'alta'; why.push(T.huecos) }
      if ((i.sampleRate || 0) > 48000) { flags.push('fake_hires'); why.push(T.estiradoCorte(num(i.sampleRate! / 1000), khz(c.cutoff))) }
    }
  } else {
    const codec = i.codec || ''
    const factor = EFFICIENCY[codec] || 1
    const declared = Math.min(320, Math.round((i.kbps || 0) * factor))
    if (factor > 1) why.push(T.rinde(CODEC_NAME[codec] || codec, i.kbps, declared))
    eff = declared
    is = T.conPerdida(CODEC_NAME[codec] || codec.toUpperCase(), declared)
    if (c.formatLimit) {
      why.push(T.formatoSinAgudos(khz(i.sampleRate!), khz(c.cutoff!)))
    } else if (c.cutoff != null && codec !== 'opus') {
      // un escalón enorme en 16 kHz (arriba casi no queda nada) vale como un corte ahí
      const shelf = c.cutoff >= 18000 && (c.step16 ?? 0) >= STEP_STRONG
      const cut = shelf ? 16000 : c.cutoff
      const eq = cut >= FULL_BAND ? 320 : cutoffToKbps(cut)
      const lame = a.mp3?.lowpassHz
      const soft = !shelf && softCutoff(c, null)
      if (declared >= 192 && declared >= eq * 1.4 && soft && !downloaded.length) {
        flags.push('as_recorded')
        why.push(T.bajanSinInflar(khz(c.cutoff)))
      } else if (declared >= 192 && declared >= eq * 1.4) {
        flags.push('upscaled')
        eff = eq
        is = T.inflado(eq, i.kbps)
        why.push(shelf
          ? T.diceEscalon(i.kbps, c.step16 ?? null, eq)
          : T.diceCorte(i.kbps, khz(c.cutoff), eq))
        why.push(T.recodificaron)
        if (soft) why.push(...downloaded.map((x) => x.what))
      } else if (lame && lame >= 19000 && c.cutoff < lame - 1500 && c.cutoff < FULL_BAND) {
        flags.push('reencoded')
        eff = Math.min(declared, eq)
        is = T.recodificado(eq)
        why.push(T.encoder(khz(lame), khz(c.cutoff)))
      } else if (c.cutoff >= FULL_BAND || eq >= declared * 0.8) {
        why.push(T.esperable(khz(c.cutoff), i.kbps))
      }
    }
    if (eff >= 256 && !flags.includes('upscaled') && !flags.includes('reencoded')) g = 'B'
    else if (eff >= 192) g = 'C'
    else if (eff > 96) g = 'D'
    else g = 'F'
    if (flags.includes('upscaled')) g = eff >= 192 ? 'D' : 'F'
    if (eff <= 128 && !flags.includes('upscaled')) { flags.push('low_bitrate'); why.push(T.baja) }
  }

  // el corte se midió debajo de unas chispas sueltas (core/analysis/fft.ts): decirlo, para que el número no confunda
  if (c.scraps && c.ceiling && flags.some((f) => f === 'fake_lossless' || f === 'upscaled' || f === 'maybe_transcoded' || f === 'reencoded'))
    why.push(T.restos(khz(c.cutoff!), khz(c.ceiling)))

  if (flags.includes('damaged')) { g = 'F'; is = T.danado(is) }

  // Sonido: informa, no baja la nota.
  if (i.channels === 1) { flags.push('mono'); sound.push(T.mono) }
  else if (a.sideRatio != null && a.sideRatio < 1e-5) { flags.push('fake_stereo'); sound.push(T.estereoFalso) }
  // los huecos, con dónde están: "3 cortes de 26 ms: 0:39, 0:49, 1:29" (Duplicados prefiere la copia sin huecos)
  if (a.gaps?.length) {
    flags.push('gaps')
    const ms = new Set(a.gaps.map((x) => x.ms)).size === 1 ? String(a.gaps[0].ms) : `${Math.min(...a.gaps.map((x) => x.ms))}–${Math.max(...a.gaps.map((x) => x.ms))}`
    const at = a.gaps.slice(0, 8).map((x) => `${Math.floor(x.at / 60)}:${String(Math.floor(x.at % 60)).padStart(2, '0')}`).join(', ') + (a.gaps.length > 8 ? '…' : '')
    sound.push(T.cortes(a.gaps.length, ms, at))
  }
  if (a.clipEvents >= 20) { flags.push('clipping'); sound.push(T.clipping(a.clipEvents)) }
  if (a.lufs != null && a.lufs > -7) { flags.push('very_loud'); sound.push(T.muyFuerte(num(a.lufs))) }

  return { grade: g, says: saysLabel(i), is, why, confidence, flags, effKbps: eff, sound }
}

/** Los textos de la nota en el otro idioma (se guardan en `analysis_otro`: al cambiar de idioma se intercambian, core/textosidioma.ts). */
export interface TextosNota { i: Idioma; says: string; is: string; why: string[]; sound: string[] }

/** La nota en el idioma de ahora, con sus textos también en el otro (la misma medición: solo cambian las palabras y los números). */
export function gradeEnLosDos(i: GradeInput, a: RawAnalysis, clues?: Clues): Verdict & { otro: TextosNota } {
  const dos = enCadaIdioma(() => grade(i, a, clues))
  const ahora = idioma(), otro: Idioma = ahora === 'es' ? 'en' : 'es', o = dos[otro]
  return { ...dos[ahora], otro: { i: otro, says: o.says, is: o.is, why: o.why, sound: o.sound } }
}
