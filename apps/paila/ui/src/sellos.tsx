// Los sellos de calidad del estilo historieta: una palabra estampada que dice qué es el archivo de verdad
// (SUENA A ~128, TRUCHO, SIN PÉRDIDA, COMO FUE GRABADO, PUEDE VENIR DE UN MP3). En el estilo sobrio no se ven (la tabla muestra «→ ~128»).
import type { Track } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'
import { hasFlag } from './problems'
import { format } from './format'

const T = textos({
  trucho: { es: 'Trucho', en: 'Bogus' },
  truchoAyuda: { es: 'Dice ser sin pérdida, pero adentro es un MP3 convertido: ocupa mucho y suena como el MP3.', en: "It says it's lossless, but inside it's a converted MP3: it takes up a lot of space and sounds like the MP3." },
  hiresTrucho: { es: 'Hi-Res trucho', en: 'Bogus Hi-Res' },
  hiresAyuda: { es: 'Dice ser Hi-Res (más que un CD), pero el sonido es de calidad de CD: ocupa de más.', en: "It says it's Hi-Res (better than a CD), but the sound is CD quality: it takes up more space than it needs." },
  suena: { es: (k: number) => `Suena a ~${k}`, en: (k: number) => `Sounds like ~${k}` },
  suenaAyuda: { es: (dice: number, k: number) => `Dice ${dice} kbps, pero el sonido es de unos ${k}: está inflado.`, en: (dice: number, k: number) => `It says ${dice} kbps, but the sound is about ${k}: it's been inflated.` },
  grabado: { es: 'Como fue grabado', en: 'As recorded' },
  grabadoAyuda: { es: 'No llega hasta arriba de todo, pero sin rastro de MP3: así se grabó (vinilo, cinta, master). Está bien.', en: "It doesn't reach the very top, but there's no trace of MP3: that's how it was recorded (vinyl, tape, master). It's fine." },
  mp3: { es: 'Puede venir de un MP3', en: 'May come from an MP3' },
  mp3Ayuda: {
    es: 'Suena completo, pero los agudos se cortan de golpe en 19,5 kHz, justo donde los corta un MP3 de muy buena calidad (unos 256 kbps). Puede ser el master (algunos CD vienen así) o un MP3 que alguien pasó a FLAC: no hay ningún otro rastro de MP3. Para escuchar está bien. Si querés el original sin pérdida, buscalo con NAPIA o la Bandeja.',
    en: "It sounds complete, but the highs cut off sharply at 19.5 kHz, right where a very good MP3 (about 256 kbps) cuts them. It may be the master (some CDs come like that) or an MP3 someone converted to FLAC: there's no other trace of MP3. It's fine for listening. If you want the lossless original, look for it with NAPIA or the Inbox.",
  },
  sinPerdida: { es: 'Sin pérdida', en: 'Lossless' },
  sinPerdidaAyuda: { es: 'Sin pérdida de verdad: calidad de CD o mejor.', en: 'Truly lossless: CD quality or better.' },
})

const LOSSLESS = ['FLAC', 'WAV', 'AIFF', 'ALAC']

/** El sello de un tema, o null si no hay nada que decir (la mayoría: MP3 de buena calidad). */
export function selloDe(t: Track): { texto: string; tono: 'mal' | 'bien' | 'info'; ayuda: string } | null {
  if (hasFlag(t, 'fake_lossless', 'maybe_transcoded')) return { texto: T.trucho, tono: 'mal', ayuda: T.truchoAyuda }
  if (hasFlag(t, 'fake_hires')) return { texto: T.hiresTrucho, tono: 'mal', ayuda: T.hiresAyuda }
  // en un sin pérdida los kbps dependen de la música: no dicen nada de la calidad
  if (!LOSSLESS.includes(format(t)) && t.kbps != null && t.effKbps != null && t.effKbps < t.kbps * 0.85) return { texto: T.suena(Math.round(t.effKbps)), tono: 'mal', ayuda: T.suenaAyuda(t.kbps, Math.round(t.effKbps)) }
  // el corte de golpe en 20 kHz, en tres casos (decisión del 23/10/2026): con evidencia del disco, "como fue grabado"; en seco donde
  // corta un MP3 de ~256, "puede venir de un MP3"; en otra frecuencia, sin sello (B "Suena completo" ya alcanza)
  if (hasFlag(t, 'as_recorded', 'cut20_trusted')) return { texto: T.grabado, tono: 'info', ayuda: T.grabadoAyuda }
  if (hasFlag(t, 'cut20_mp3like')) return { texto: T.mp3, tono: 'info', ayuda: T.mp3Ayuda }
  if (LOSSLESS.includes(format(t)) && (t.grade === 'A' || t.grade === 'A+')) return { texto: T.sinPerdida, tono: 'bien', ayuda: T.sinPerdidaAyuda }
  return null
}

export function Sello({ t }: { t: Track }) {
  const s = selloDe(t)
  return s ? <span className={`sello sello-${s.tono} solo-historieta`} title={s.ayuda}>{s.texto}</span> : null
}
