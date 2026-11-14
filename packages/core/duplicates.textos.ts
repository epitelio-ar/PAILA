// Los textos de Duplicados que arma el núcleo (fases, títulos de grupo, por qué están juntos y avisos), en castellano y
// en inglés (ver @paila/shared/idioma). Solo se muestran: nada de esto se escribe en los archivos ni se compara.
import { textos } from '@paila/shared/idioma'

export const T = textos({
  // fases de la búsqueda
  buscandoIdenticos: { es: 'Buscando archivos idénticos…', en: 'Looking for identical files…' },
  comparando: { es: 'Comparando cómo suena cada tema…', en: 'Comparing how each track sounds…' },
  leyendoHuellas: { es: 'Leyendo la huella acústica de cada tema…', en: 'Reading the acoustic fingerprint of each track…' },
  buscandoParecidos: { es: 'Buscando los que suenan parecido…', en: 'Looking for tracks that sound alike…' },
  buscandoMismoTema: { es: 'Buscando el mismo tema en distintos archivos…', en: 'Looking for the same track in different files…' },
  armando: { es: 'Armando los grupos…', en: 'Putting the groups together…' },
  // por qué dos son versiones
  suenanDistinto: { es: 'mismo nombre y duración, pero suenan distinto', en: 'same name and length, but they sound different' },
  otraVersion: { es: 'mismo tema, otra versión', en: 'same track, another version' },
  compartenPedazo: {
    es: (s: number, moved: string) => `comparten un pedazo de ${s} s (una intro, un sample o un estribillo)${moved}`,
    en: (s: number, moved: string) => `they share a ${s} s piece (an intro, a sample or a chorus)${moved}`,
  },
  compartenAudio: { es: (s: number, moved: string) => `comparten ${s} s de audio${moved}`, en: (s: number, moved: string) => `they share ${s} s of audio${moved}` },
  corrido: { es: (s: number) => `, corrido ${s} s`, en: (s: number) => `, shifted ${s} s` },
  // avisos
  titulosDistintos: {
    es: 'Los títulos dicen temas distintos: puede haber un archivo mal nombrado (y quizás el otro tema no lo tenés). Escuchalos antes de elegir.',
    en: "The titles say they're different tracks: one file may be misnamed (and maybe you don't have the other track). Listen to them before you choose.",
  },
  muyCortos: {
    es: 'Son muy cortos para comparar cómo suenan: se juntaron por el nombre y la duración. Escuchalos antes de elegir.',
    en: "They're too short to compare how they sound: they were grouped by name and length. Listen to them before you choose.",
  },
  unoDuraMas: {
    es: (varios: boolean, s: string) => `${varios ? 'El más largo dura' : 'Uno dura'} ${s} más que ${varios ? 'el más corto' : 'el otro'} (la intro de un video, aplausos o silencio): escuchalos antes de elegir.`,
    en: (varios: boolean, s: string) => `${varios ? 'The longest one is' : 'One is'} ${s} longer than ${varios ? 'the shortest' : 'the other'} (a video intro, applause or silence): listen to them before you choose.`,
  },
  // por qué están juntos (un grupo puede tener varias razones)
  porArchivo: { es: 'hay copias idénticas, byte a byte', en: 'there are identical copies, byte for byte' },
  porAudio: { es: 'el mismo audio, bit a bit (cambian los tags, el nombre o el formato)', en: 'the same audio, bit for bit (only the tags, the name or the format change)' },
  porSonido: {
    es: 'suenan igual de principio a fin y duran lo mismo: el mismo audio guardado con otra calidad',
    en: 'they sound the same from start to finish and are the same length: the same audio saved at another quality',
  },
  porNombre: {
    es: 'mismos artista, título y duración según los tags (sin huella, o la huella no alcanza para confirmarlo a oído)',
    en: "same artist, title and length according to the tags (no fingerprint, or the fingerprint isn't enough to confirm it by ear)",
  },
  porLargo: { es: 'mismos artista y título, y suenan igual, pero uno dura unos segundos más', en: 'same artist and title, and they sound the same, but one is a few seconds longer' },
  porCorto: {
    es: 'mismo nombre y casi la misma duración (duran menos de 12 s: muy poco para la huella acústica)',
    en: 'same name and almost the same length (under 12 s: too short for the acoustic fingerprint)',
  },
  // títulos de los grupos
  exact: { es: 'Idénticos', en: 'Identical' },
  quality: { es: 'Mismo audio, otra calidad', en: 'Same audio, other quality' },
  probable: { es: 'Probables por nombre', en: 'Probable by name' },
  version: { es: 'Versiones (no son duplicados)', en: "Versions (they're not duplicates)" },
  soloNombre: { es: 'Se llaman igual, pero son dos pistas del mismo disco: no se tiran', en: 'Same name, but two tracks of the same album: they are not thrown away' },
})
