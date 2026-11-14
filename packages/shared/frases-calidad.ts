// La calidad dicha con frases humanas (MASTERPLAN-5, 2.4): en vez de "nota D · lossless falso", "suena como un MP3 de 128 aunque
// diga FLAC". Las usa Sonido de PAILA (lo que suena mal, lo que llegó) y se pueden usar en NAPIA. Puras, con tests
// (tests/sonido-frases.test.ts). Los kbps se redondean a los que conoce cualquiera (128, 192, 256, 320).
import type { InboxResult, WantedReason } from './types/wanted'
import { textos } from './idioma'

const T = textos({
  falso: {
    es: (k: string, ext: string) => `Suena como un MP3 de ${k} aunque diga ${ext}: pesa como un CD y suena como el MP3`,
    en: (k: string, ext: string) => `Sounds like a ${k} MP3 even though it says ${ext}: it weighs as much as a CD and sounds like the MP3`,
  },
  inflado: {
    es: (dice: number, k: string) => `Dice ${dice} kbps pero suena como un MP3 de ${k}: lo inflaron, pesa más y no suena mejor`,
    en: (dice: number, k: string) => `It says ${dice} kbps but sounds like a ${k} MP3: it was inflated, it weighs more and sounds no better`,
  },
  infladoSin: { es: 'Lo inflaron: pesa más de lo que suena', en: 'It was inflated: it weighs more than it sounds' },
  puedeMp3: { es: 'Suena completo, pero corta justo donde corta un MP3: puede venir de uno', en: 'It sounds complete, but cuts off right where an MP3 does: it may come from one' },
  rekordbox: { es: (ext: string) => `Rekordbox y las CDJ no leen el ${ext}`, en: (ext: string) => `Rekordbox and CDJs can't read ${ext}` },
  malo: {
    es: (que: string) => `Es ${que}: en el auto suena bien, en un equipo bueno se nota`,
    en: (que: string) => `It's ${que}: fine in the car, but you can tell on good speakers`,
  },
  muyMalo: { es: (que: string) => `Es ${que}: suena apagado, se nota hasta en el celular`, en: (que: string) => `It's ${que}: it sounds dull, you can tell even on a phone` },
  danado: { es: 'Está dañado: se corta o hace ruidos', en: "It's damaged: it skips or makes noises" },
  aceptable: { es: (que: string) => `Es ${que}: está bien, pero se puede conseguir mejor`, en: (que: string) => `It's ${que}: it's fine, but a better one is out there` },
  mejorable: { es: 'Se puede conseguir una copia mejor', en: 'A better copy is out there' },
  unMp3: { es: (k: string) => `un MP3 de ${k}`, en: (k: string) => `a ${k} MP3` },
  unFormato: { es: (ext: string, k: string) => `un ${ext} de ${k}`, en: (ext: string, k: string) => `a ${k} ${ext}` },
  unSolo: { es: (ext: string) => `un ${ext} de baja calidad`, en: (ext: string) => `a low-quality ${ext}` },
  falta: { es: 'No lo tenés', en: "You don't have it" },
  faltaDisco: { es: 'Le falta a un disco tuyo', en: "It's missing from one of your albums" },
  deLista: { es: (l: string) => `Está en tu lista «${l}» y no lo tenés`, en: (l: string) => `It's on your list «${l}» and you don't have it` },
  // lo que llegó (Bandeja o NAPIA)
  llegoMejor: { es: (es: string) => `Llegó una copia mejor (${es}): reemplaza a la tuya`, en: (es: string) => `A better copy arrived (${es}): it replaces yours` },
  llegoNoMejor: { es: (por: string) => `Llegó, pero no es mejor que la tuya${por ? `: ${por}` : ''}`, en: (por: string) => `It arrived, but it's no better than yours${por ? `: ${por}` : ''}` },
  llegoFalta: { es: 'Te faltaba: va a tu Música', en: 'You were missing it: it goes into your Music' },
  llegoMirar: { es: 'Se parece a uno tuyo, pero no es seguro que sea el mismo: miralo vos', en: "It looks like one of yours, but it's not sure it's the same: have a look" },
  llegoSinPareja: { es: 'No se parece a nada tuyo: va a tu Música si querés', en: "It doesn't match anything of yours: it goes into your Music if you want" },
  llegoError: { es: 'No se pudo leer el archivo', en: "The file couldn't be read" },
  trucho: { es: (es: string) => `Llegó trucho: ${es}. NAPIA busca otra copia`, en: (es: string) => `It arrived fake: ${es}. NAPIA looks for another copy` },
  truchoSin: { es: 'Llegó trucho: NAPIA busca otra copia', en: 'It arrived fake: NAPIA looks for another copy' },
  noEsta: { es: 'No está en Soulseek por ahora', en: 'Not on Soulseek for now' },
  otraCopia: { es: 'La primera copia llegó trucha: NAPIA consiguió otra buena, de otra persona', en: 'The first copy arrived fake: NAPIA got a good one from someone else' },
})

const LOSSLESS = new Set(['flac', 'wav', 'aif', 'aiff', 'alac', 'ape', 'wv'])
const PASOS = [64, 96, 128, 160, 192, 224, 256, 320]
/** 131 → "128 kbps": el más cercano de los que se conocen. */
export const kbpsConocidos = (k: number) => `${PASOS.reduce((a, b) => (Math.abs(b - k) < Math.abs(a - k) ? b : a))} kbps`
const nombreExt = (ext: string | null) => (ext ?? '').toUpperCase().replace(/^AIF$/, 'AIFF')

export interface DatosCalidad {
  ext: string | null
  /** Lo que dice el archivo (kbps del contenedor). */
  kbps?: number | null
  /** La calidad real (1411 = CD). */
  effKbps: number | null
  grade: string | null
  reasons?: WantedReason[]
  /** Las listas que lo piden (cuando no lo tenés). */
  requests?: string[]
  fileId?: number | null
}

/** Cómo suena una copia tuya (o por qué te falta), en una frase. */
export function fraseCalidad(d: DatosCalidad): string {
  const r = new Set(d.reasons ?? [])
  if (d.fileId === null || r.has('falta') || r.has('falta_disco')) return d.requests?.length ? T.deLista(d.requests[0]) : r.has('falta_disco') ? T.faltaDisco : T.falta
  const ext = nombreExt(d.ext), lossless = LOSSLESS.has((d.ext ?? '').toLowerCase())
  const real = d.effKbps && d.effKbps < 1000 ? d.effKbps : null
  if (lossless && (r.has('lossless_falso') || real)) return T.falso(kbpsConocidos(real ?? 128), ext || 'FLAC')
  // un MP3 marcado como "sin pérdida falso" es, en palabras, uno inflado
  if (r.has('inflado') || r.has('lossless_falso')) return real && d.kbps && d.kbps > real ? T.inflado(d.kbps, kbpsConocidos(real)) : T.infladoSin
  if (r.has('puede_mp3')) return T.puedeMp3
  if (r.has('rekordbox') && !r.has('nota')) return T.rekordbox(ext)
  const k = real ?? d.kbps ?? null
  const que = !k ? T.unSolo(ext || 'MP3') : ext === 'MP3' || !ext ? T.unMp3(kbpsConocidos(k)) : T.unFormato(ext, kbpsConocidos(k))
  if (d.grade === 'F') return k ? T.muyMalo(que) : T.danado
  if (d.grade === 'D') return T.malo(que)
  if (d.grade === 'C') return T.aceptable(que)
  return T.mejorable
}

/** Qué pasó con algo que llegó a la Bandeja (de NAPIA o de donde sea), en una frase. */
export function fraseLlegada(r: Pick<InboxResult, 'decision' | 'check' | 'ext'>): string {
  switch (r.decision) {
    case 'reemplazar': return T.llegoMejor(r.check?.newLabel || nombreExt(r.ext))
    case 'no-sirve': return T.llegoNoMejor(r.check?.problems[0]?.replace(/\.$/, '') ?? '')
    case 'falta': return T.llegoFalta
    case 'mirar': return T.llegoMirar
    case 'sin-pareja': return T.llegoSinPareja
    default: return T.llegoError
  }
}

/** Lo que NAPIA dice de un tema que terminó: trucho (con lo que es en realidad) o que no estaba. */
export const fraseTrucho = (es: string | null | undefined) => (es ? T.trucho(es.replace(/\.$/, '')) : T.truchoSin)
export const fraseNoEsta = () => T.noEsta
export const fraseOtraCopia = () => T.otraCopia
