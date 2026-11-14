// Cuántas veces tropezó ffmpeg al leer un tema entero (más de 3 = "Dañado", core/analysis/grade.ts), sin contar el tropiezo
// del final que provoca un tag viejo de MP3 (ID3v1) pegado a un archivo que no es MP3.
import fs from 'node:fs'

/**
 * La línea con que ffmpeg cierra cada tropiezo del decodificador: "Error submitting packet to decoder: …" y "Decoding error: …"
 * (6.1 en adelante) o "Error while decoding stream" (6.0, el de Mac). Solo en un renglón de ffmpeg, que empieza con "[mp3float @ …]":
 * los tags que ffmpeg muestra al abrir el archivo van con espacios adelante y no cuentan.
 */
const EVENT = /^(?:\[[^\]\n]*\]\s*)?(?:Error submitting packet to decoder|Decoding error|Error while decoding stream)/i
/**
 * "[mp3float @ …] overread, skip -5 enddists: -4 -4": un cuadro del MP3 que trae más datos de los que dice y se lee igual, con
 * errores. No cierra con "Error submitting packet", pero cuenta: en la Música del autor hay discos enteros con cientos (Malpaso,
 * Callejeros), que ya eran "Dañado" y lo siguen siendo (repaso de criterios del 24/10).
 */
const OVERREAD = /^\[[^\]\n]*\]\s*overread\b/i
/** "Last message repeated 3 times": ffmpeg junta las líneas iguales seguidas. */
const REPEATED = /^\s*Last message repeated (\d+) times?/i

/**
 * Los tropiezos al leer el tema entero (más de 3 = "Dañado", core/analysis/grade.ts): uno por cada vez que el decodificador no
 * pudo con un pedazo. Hasta el 24/10 se contaban las PALABRAS de error de todo lo que escribe ffmpeg, y eso daba "Dañado" a temas
 * enteros: un tropiezo son dos palabras ("Error … Invalid data"), y la letra de "Under Pressure" guardada en el tag ("It's the
 * terror of knowing…", cuatro veces) daba 4 (repaso de criterios del 24/10).
 *
 * Un archivo que no es MP3 con un tag viejo de MP3 (ID3v1, "TAG" + 125 bytes) pegado al final tropieza una vez justo al
 * terminar: el decodificador lee esos 128 bytes como si fueran audio ("invalid sync code"), aunque el tema esté entero. Pasaba
 * con 4 FLAC de la Música (Barbie Girl, Don't Start Now…, 22/10/2026): sin el tag, 0 errores. Ese último tropiezo no cuenta.
 */
export function countDecodeErrors(stderr: string, file: string): number {
  let n = 0, afterEvent = false
  for (const line of stderr.split(/\r?\n/)) {
    if (EVENT.test(line) || OVERREAD.test(line)) { n++; afterEvent = true; continue }
    const rep = afterEvent ? line.match(REPEATED) : null
    if (rep) { n += Number(rep[1]); continue }
    afterEvent = false
  }
  if (!n || /\.mp3$/i.test(file) || !endsWithId3v1(file)) return n
  return n - 1
}

/** Cuántos cuadros no se pudieron leer (sin los "overread", que se leen igual): si hay, se busca dónde (core/analysis/gaps.ts). */
export function countDropped(stderr: string): number {
  let n = 0, afterEvent = false
  for (const line of stderr.split(/\r?\n/)) {
    if (EVENT.test(line)) { n++; afterEvent = true; continue }
    const rep = afterEvent ? line.match(REPEATED) : null
    if (rep) { n += Number(rep[1]); continue }
    afterEvent = false
  }
  return n
}

/** ¿Termina con un tag ID3v1 ("TAG" en los últimos 128 bytes)? */
export function endsWithId3v1(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const size = fs.fstatSync(fd).size
      if (size < 256) return false
      const b = Buffer.alloc(3)
      fs.readSync(fd, b, 0, 3, size - 128)
      return b.toString('latin1') === 'TAG'
    } finally { fs.closeSync(fd) }
  } catch { return false }
}
