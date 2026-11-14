// NAPIA: la calidad real de lo que baja, no la que dice el archivo. sockseek elige por lo que anuncia cada archivo ("320 kbps",
// "FLAC"), así que un MP3 de 128 inflado a 320 o un FLAC hecho de un MP3 se bajan igual. Apenas termina cada tema, NAPIA le
// pasa el análisis de calidad de PAILA (core/analysis: el espectro y la nota de A+ a F, sin BPM, tono ni huellas) y decide si
// es trucho. Lo que se hace con un trucho (apartarlo, buscar otra fuente) está en control.ts. Tests: tests/napia-calidad.test.ts.
// Trucho es:
// - un MP3 (u otro con pérdida) inflado: dice más kbps de los que suena (`upscaled`);
// - un "sin pérdida" falso: un FLAC, WAV o AIFF que por dentro es un MP3 (`fake_lossless`, `maybe_transcoded`);
// - un archivo dañado (más de 3 tropiezos al leerlo, como en PAILA: DANADO_DE_VERDAD);
// - una nota mucho peor que la pedida: con "320 o sin pérdida", D o F; con "solo sin pérdida", menos de B.
// Con "cualquier calidad", solo lo que miente (inflado, sin pérdida falso) o está dañado.
// Si viene a reemplazar una copia que ya tenés (la lista «Faltan o suenan mal» manda su nota), además tiene que ser claramente mejor
// que esa (esMejor); si no, se trata igual que un trucho: a descartados y otra fuente.
import path from 'node:path'
import { analyzeFile, type AnalyzeJob, type RawAnalysis } from '../analysis/analyze'
import { grade, isLossless, type Grade, type Verdict } from '../analysis/grade'
import type { Clues } from '../analysis/clues'
import { probe } from '../probe'
import { clearlyBetter, duraDistinto, saturaMas, type Copy } from '../better'
import type { Calidad, CopiaTuya, MotivoTrucho } from '@paila/shared/napia'

const ORDEN: Grade[] = ['F', 'D', 'C', 'B', 'A', 'A+']

/** La nota más baja que se acepta según la calidad pedida (null: cualquiera). Un MP3 de 320 real es B; uno de 192, C. */
export const NOTA_MINIMA: Record<Calidad, Grade | null> = { cualquiera: null, buena: 'C', sinperdida: 'B' }

/** Por qué es trucho, o null si sirve. */
export function juzgar(calidad: Calidad, v: Pick<Verdict, 'grade' | 'flags'>, lossless: boolean): MotivoTrucho | null {
  if (v.flags.includes('damaged')) return 'danado'
  if (v.flags.includes('upscaled')) return 'inflado'
  if (lossless && (v.flags.includes('fake_lossless') || v.flags.includes('maybe_transcoded'))) return 'sinPerdidaFalso'
  if (calidad === 'sinperdida' && !lossless) return 'peorQuePedido'
  const min = NOTA_MINIMA[calidad]
  if (min && ORDEN.indexOf(v.grade) < ORDEN.indexOf(min)) return 'peorQuePedido'
  return null
}

/**
 * ¿Es claramente mejor que la copia que ya tenés? (cuando la bajada viene a reemplazarla: Faltan o suenan mal). La misma vara que
 * la Bandeja de PAILA (core/better.ts e inboxflow.verify), así lo que NAPIA trae como mejor la Bandeja no lo rechaza después:
 * mejor nota, o la misma con más calidad real y entera (sin huecos ni daño); una con huecos no reemplaza a una limpia; y no puede
 * saturar más que la tuya ni durar distinto. Si no, va a descartados y se busca otra fuente. Para reemplazar no alcanza con que
 * sea buena (el autor, 24/10; docs/DECISIONES.md).
 */
export function esMejor(r: Pick<Revision, 'nota' | 'effKbps' | 'marcas' | 'recortes' | 'lufs' | 'duracion'>, tuya: CopiaTuya): boolean {
  const nueva: Copy = { grade: r.nota, effKbps: r.effKbps, flags: r.marcas }
  const vieja: Copy = { grade: tuya.nota, effKbps: tuya.kbps, flags: tuya.marcas ?? [] }
  return clearlyBetter(nueva, vieja) && !saturaMas({ clipEvents: r.recortes, lufs: r.lufs }, { clipEvents: tuya.recortes ?? null, lufs: tuya.lufs ?? null })
    && !duraDistinto(r.duracion, tuya.duracion)
}

/** Lo que dice la revisión de un archivo. */
export interface Revision {
  nota: Grade
  /** Lo que dice ser ("MP3 · 320 kbps") y lo que es en realidad, en el idioma de ahora. */
  dice: string
  es: string
  motivo: MotivoTrucho | null
  /** La calidad real en kbps (1411 = CD). */
  effKbps: number
  /** Las marcas del análisis ("gaps": huecos, "damaged": dañado…), los tramos que satura, su volumen y la duración: para
   *  compararla con tu copia cuando viene a reemplazarla (esMejor). */
  marcas: string[]
  recortes: number
  lufs: number | null
  duracion: number | null
  /** La huella acústica (comprimida, como la guarda PAILA): para ver si es el mismo audio que tu copia o el tema pedido (huella.ts). */
  huella?: string | null
  ms: number
}

export interface RevisarDeps {
  ffmpeg: string
  ffprobe: string
  /** El análisis (en la app, un proceso aparte con prioridad baja; en los tests, directo). */
  full?: (job: AnalyzeJob) => Promise<RawAnalysis>
}

/** Analiza un archivo bajado (solo el espectro y la nota) y dice si es trucho para la calidad pedida. */
export async function revisarArchivo(file: string, calidad: Calidad, deps: RevisarDeps): Promise<Revision> {
  const t0 = Date.now()
  const m = await probe(deps.ffprobe, file)
  const ext = path.extname(file).slice(1).toLowerCase()
  const info = { codec: m.codec, ext, lossless: isLossless(m.codec, ext), kbps: m.kbps, sampleRate: m.sampleRate, bits: m.bits, channels: m.channels }
  const raw = await (deps.full ?? analyzeFile)({ ffmpeg: deps.ffmpeg, file, ...info, duration: m.duration, withDj: false, withPrints: true })
  // las pistas que da el archivo solo (su nombre, sus tags y el año): las mismas que usa PAILA para decidir los casos dudosos
  const y = Number((m.year ?? '').slice(0, 4))
  const clues: Clues = { names: [{ text: path.basename(file), from: 'archivo' }, ...[m.title, m.artist, m.album].filter((t): t is string => !!t).map((text) => ({ text, from: 'tags' as const }))], year: y >= 1900 && y <= 2100 ? y : null }
  const v = grade(info, raw.decodeErrors <= DANADO_DE_VERDAD ? { ...raw, decodeErrors: 0 } : raw, clues)
  return {
    nota: v.grade, dice: v.says, es: v.is, motivo: juzgar(calidad, v, info.lossless), effKbps: v.effKbps,
    marcas: v.flags, recortes: raw.clipEvents, lufs: raw.lufs, duracion: m.duration, huella: raw.prints?.chromaprint ?? null, ms: Date.now() - t0,
  }
}

/**
 * Hasta cuántos tropiezos al leerlo no cuentan como "dañado" para NAPIA: los mismos que para PAILA (core/analysis/grade.ts, más
 * de 3 es "Dañado"), así lo que NAPIA deja pasar la Bandeja no lo rechaza por dañado. En la prueba real del 24/10 un MP3 de 320
 * genuino (Bad Bunny, llega a 20,3 kHz) con 2 tropiezos en los primeros 26 ms salía F, porque ffmpeg 6.1 escribe dos marcas por
 * cada tropiezo y se contaban las marcas; NAPIA lo esquivó contando hasta 20. Desde el repaso de criterios del 24/10 se cuentan
 * tropiezos (core/analysis/decodeerrors.ts): ese MP3 da 2, y uno roto de verdad, decenas.
 */
export const DANADO_DE_VERDAD = 3
