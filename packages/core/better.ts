// Cuándo un archivo que llega es claramente mejor que la copia que ya tenés del mismo tema (el autor, 24/10; docs/DECISIONES.md):
// mejor nota, o la misma nota con más calidad real y sin errores al leerlo; y uno con cortes nunca reemplaza a uno limpio. Además
// no satura más que el tuyo ni dura distinto. Es una sola vara para la Bandeja de PAILA (inboxflow.ts, verify) y para NAPIA cuando
// baja algo para reemplazar una copia tuya (sockseek/calidad.ts, esMejor), así lo que NAPIA trae como mejor la Bandeja no lo
// rechaza después. Tests: tests/bandeja-repaso.test.ts y tests/napia-reemplazo.test.ts.

const ORDER = ['F', 'D', 'C', 'B', 'A', 'A+']

/** Una copia del tema, para compararla con otra. */
export interface Copy {
  /** La nota de PAILA (A+ … F); null si no se pudo analizar. */
  grade: string | null
  /** La calidad real en kbps (1411 = CD), si se sabe. */
  effKbps: number | null
  /** Las marcas del análisis; acá importan "damaged" (dañado) y "gaps" (tiene cortes: pedazos que no se pueden leer). */
  flags: readonly string[]
}

/** ¿La nueva tiene cortes y la tuya no? Entonces no la reemplaza, aunque tenga mejor nota ("entre una con huecos y una limpia, la limpia"). */
export const gapsOverClean = (nueva: Copy, tuya: Copy): boolean => nueva.flags.includes('gaps') && !tuya.flags.includes('gaps')

/**
 * ¿Gana por calidad? Con mejor nota, sí; con la misma, solo si suena con más calidad real (más kbps) y se lee entera (sin
 * cortes ni daño). Tu copia sin nota (no se pudo analizar): no hay con qué comparar, cualquiera gana.
 */
export function beatsOnQuality(nueva: Copy, tuya: Copy): boolean {
  const n = ORDER.indexOf(nueva.grade ?? ''), v = ORDER.indexOf(tuya.grade ?? '')
  if (v < 0) return true
  if (n !== v) return n > v
  const clean = !nueva.flags.includes('gaps') && !nueva.flags.includes('damaged')
  return clean && tuya.effKbps != null && nueva.effKbps != null && nueva.effKbps > tuya.effKbps
}

/** ¿Es claramente mejor que la tuya? */
export const clearlyBetter = (nueva: Copy, tuya: Copy): boolean => !gapsOverClean(nueva, tuya) && beatsOnQuality(nueva, tuya)

/** Las marcas guardadas en la base ("low_bitrate,gaps") como lista. */
export const flagList = (flags: string | null | undefined): string[] => (flags ?? '').split(',').filter(Boolean)

/** Recortes de volumen: menos de 20 es ruido (es el mismo umbral que la marca "clipping" del análisis). */
export const CLIP_NOISE = 20
/**
 * Más recortes solo cuentan si además el nuevo suena más fuerte (otro master, más comprimido). Con el mismo volumen, que
 * un lossless cuente más recortes que un MP3 es un efecto del MP3 (redondea las crestas): corrida del 20/10, "Blues de la
 * libertad" en FLAC daba 207 contra 56 con 0,2 dB de diferencia.
 */
export const LOUDER_DB = 1
/** Diferencia de duración que se tolera (plan aprobado el 20/10): más es otra versión, o una copia cortada. */
export const DURATION_SECONDS = 2

/** El volumen de una copia: tramos con la señal aplastada contra el techo (3 muestras seguidas al máximo) y LUFS. */
export interface Volumen { clipEvents: number | null; lufs: number | null }

/** ¿Satura más que la tuya? Bastantes recortes más (de 20 para arriba) y al menos 1 dB más fuerte: otro master, más aplastado. */
export function saturaMas(nueva: Volumen, tuya: Volumen): boolean {
  const nc = nueva.clipEvents ?? 0, oc = tuya.clipEvents ?? 0
  const louder = tuya.lufs != null && nueva.lufs != null && nueva.lufs - tuya.lufs >= LOUDER_DB
  return nc >= CLIP_NOISE && nc > oc + Math.max(5, oc * 0.1) && louder
}

/** ¿Dura distinto que la tuya (más de 2 s)? Sin una de las dos duraciones, no se sabe: no. */
export const duraDistinto = (nueva: number | null | undefined, tuya: number | null | undefined): boolean =>
  nueva != null && tuya != null && Math.abs(nueva - tuya) > DURATION_SECONDS
