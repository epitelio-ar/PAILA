// Los textos de la nota de calidad (lo que dice ser, lo que es en realidad, por qué y el sonido), en castellano y en
// inglés (ver @paila/shared/idioma). Se guardan en la base con el análisis en los dos idiomas (gradeEnLosDos, en grade.ts): solo se muestran,
// nada de esto se compara ni se escribe en los archivos. Los kHz y los LUFS llegan ya escritos con num().
import { textos } from '@paila/shared/idioma'

export const T = textos({
  // lo que dice ser
  sinPerdida: {
    es: (name: string, bits: number, sr: string) => `${name} · ${bits} bits / ${sr} (sin pérdida)`,
    en: (name: string, bits: number, sr: string) => `${name} · ${bits}-bit / ${sr} (lossless)`,
  },
  // dañado
  errores: {
    es: (n: number) => `Al leerlo entero aparecieron ${n} errores: el archivo está dañado o cortado.`,
    en: (n: number) => `Reading it all the way through turned up ${n} errors: the file is damaged or cut short.`,
  },
  danado: { es: (is: string) => `Dañado · ${is}`, en: (is: string) => `Damaged · ${is}` },
  // sin pérdida
  sinVerificar: { es: 'Sin pérdida (no se pudo verificar)', en: "Lossless (couldn't check)" },
  casiNada: { es: 'Casi no hay sonido para analizar, así que se confía en el formato.', en: 'There is almost no sound to analyze, so PAILA trusts the format.' },
  archivoDe: {
    es: (sr: string, cut: string) => `Es un archivo de ${sr}: no puede guardar sonido arriba de ${cut} (un CD llega a ~22 kHz).`,
    en: (sr: string, cut: string) => `It's a ${sr} file: it can't hold sound above ${cut} (a CD goes up to ~22 kHz).`,
  },
  comprimidoA: { es: (sr: string) => `Viene de un archivo comprimido a ${sr}`, en: (sr: string) => `Made from a compressed file at ${sr}` },
  nadieVende: {
    es: (sr: string, year: number | null) => `Ningún disco ni tienda vende música a ${sr}${year ? ` (y este tema es de ${year})` : ''}: se hizo a partir de un archivo comprimido, como el audio de un juego, una radio o una página. Le faltan los agudos y conviene conseguir otra versión.`,
    en: (sr: string, year: number | null) => `No record or store sells music at ${sr}${year ? ` (and this track is from ${year})` : ''}: it was made from a compressed file, like the audio from a game, a radio stream or a website. It's missing the highs, so it's worth getting another version.`,
  },
  sinPerdidaPeroA: { es: (sr: string) => `Sin pérdida, pero a ${sr}`, en: (sr: string) => `Lossless, but at ${sr}` },
  noDisfrazado: {
    es: 'No es un MP3 disfrazado, pero le faltan los agudos más altos. En una grabación vieja puede ser lo único que hay.',
    en: "It isn't an MP3 in disguise, but it's missing the very top highs. For an old recording, this may be all there is.",
  },
  deMp3: { es: 'Viene de un MP3/AAC', en: 'Made from an MP3/AAC' },
  escalon16: {
    es: (db: number) => `El sonido llega arriba, pero tiene un escalón de ${db} dB justo en 16 kHz.`,
    en: (db: number) => `The sound goes all the way up, but there's a ${db} dB step right at 16 kHz.`,
  },
  escalonExplica: {
    es: 'Ese escalón lo dejan los MP3 y AAC (arriba de 16 kHz guardan menos detalle): este archivo sin pérdida se hizo a partir de uno.',
    en: 'MP3 and AAC files leave that step (above 16 kHz they keep less detail): this lossless file was made from one.',
  },
  hiRes: { es: 'Hi-Res real', en: 'Real Hi-Res' },
  hastaHiRes: { es: (k: string) => `Tiene contenido hasta ${k}: más que un CD.`, en: (k: string) => `It has sound up to ${k}: more than a CD.` },
  cd: { es: 'Calidad CD real', en: 'Real CD quality' },
  llegaArriba: { es: 'El sonido llega hasta arriba de todo (~22 kHz), como en un CD.', en: 'The sound goes all the way to the top (~22 kHz), like a CD.' },
  cdHiResFalso: { es: 'Calidad CD (Hi-Res falso)', en: 'CD quality (fake Hi-Res)' },
  estirado: {
    es: (sr: string) => `Dice ser ${sr} kHz, pero el audio termina en ~22 kHz: es un CD "estirado". No tiene más calidad que un CD y ocupa el doble.`,
    en: (sr: string) => `It says ${sr} kHz, but the audio ends at ~22 kHz: it's a "stretched" CD. It's no better than a CD and takes up twice the space.`,
  },
  falso24: {
    es: 'Dice ser de 24 bits, pero los 8 bits de abajo están siempre vacíos: es un archivo de 16 bits rellenado.',
    en: "It says 24-bit, but the bottom 8 bits are always empty: it's a 16-bit file padded out.",
  },
  bajanDePoco: {
    es: (k: string) => `Los agudos bajan de a poco hasta ${k}, sin el corte de golpe de un MP3.`,
    en: (k: string) => `The highs fade out gradually up to ${k}, without the sudden cutoff of an MP3.`,
  },
  descarga: { es: 'Viene de una descarga comprimida', en: 'Made from a compressed download' },
  descargaExplica: {
    es: 'Lo que se baja de ahí está comprimido (como un MP3): pasarlo a sin pérdida no le devuelve lo que perdió.',
    en: "What you download from there is compressed (like an MP3): converting it to lossless doesn't bring back what it lost.",
  },
  comoGrabado: { es: 'Suena como fue grabado', en: 'Sounds as recorded' },
  comoGrabadoExplica: {
    es: (anyGear: boolean) => `Así suenan los vinilos, las cintas y muchos masters (viejos y nuevos): es el sonido de la grabación, no un MP3. No hay rastros de compresión (ni huecos, ni escalón en 16 kHz, ni etiquetas de una descarga).${anyGear ? ' Para escuchar en cualquier equipo está bien.' : ''}`,
    en: (anyGear: boolean) => `That's how vinyl, tapes and many masters (old and new) sound: it's the sound of the recording, not an MP3. There are no signs of compression (no gaps, no step at 16 kHz, no tags from a download).${anyGear ? " It's fine for listening on any system." : ''}`,
  },
  // rastros chicos
  titilan: {
    es: (x: string) => `Los agudos titilan más que en un archivo genuino (${x} veces más que los medios): un rastro chico de MP3.`,
    en: (x: string) => `The highs flicker more than in a genuine file (${x} times more than the mids): a small sign of an MP3.`,
  },
  escalonChico: {
    es: (db: number) => `Tiene un escalón de ${db} dB en 16 kHz, el que dejan los MP3 y AAC.`,
    en: (db: number) => `It has a ${db} dB step at 16 kHz, the kind MP3 and AAC files leave.`,
  },
  youtube48: {
    es: 'Es de 48 kHz y se corta de golpe en 20 kHz: así queda el audio de YouTube (Opus) cuando se pasa a otro formato.',
    en: "It's 48 kHz and cuts off suddenly at 20 kHz: that's how YouTube audio (Opus) ends up when it's converted to another format.",
  },
  // corta arriba de ~19,5 kHz
  completo: { es: (k: string) => `Suena completo (llega a ${k})`, en: (k: string) => `Sounds complete (goes up to ${k})` },
  llegaYCorta: {
    es: (k: string) => `El sonido llega hasta ${k} y ahí se corta: lo que falta está arriba de lo que se oye.`,
    en: (k: string) => `The sound goes up to ${k} and stops there: what's missing is above what you can hear.`,
  },
  corteDelDisco: {
    es: (pistas: string) => `${pistas} Ese corte es del disco o del master, no de un MP3.`,
    en: (pistas: string) => `${pistas} That cutoff comes from the record or the master, not from an MP3.`,
  },
  cortanCd: {
    es: (fmt: string, anyGear: boolean) => `Así cortan algunos CD y masters con filtro, y también un MP3 de 320 pasado a ${fmt}. No hay ningún otro rastro de MP3 (ni huecos, ni escalón en 16 kHz, ni etiquetas de una descarga).${anyGear ? ' Sea cual sea, para escuchar en cualquier equipo está bien.' : ''}`,
    en: (fmt: string, anyGear: boolean) => `Some CDs and filtered masters cut off like this, and so does a 320 MP3 converted to ${fmt}. There are no other signs of an MP3 (no gaps, no step at 16 kHz, no tags from a download).${anyGear ? " Either way, it's fine for listening on any system." : ''}`,
  },
  mp3likeCorte: {
    es: (k: string) => `Suena completo, pero los agudos se cortan de golpe en ${k}, justo donde los corta un MP3 de muy buena calidad (unos 256 kbps).`,
    en: (k: string) => `It sounds complete, but the highs cut off suddenly at ${k}, right where a very good MP3 (about 256 kbps) cuts them.`,
  },
  mp3likePuede: {
    es: (fmt: string, anyGear: boolean) => `Puede ser el master (algunos CD vienen así) o un MP3 que alguien pasó a ${fmt}: no hay ningún otro rastro de MP3 (ni huecos, ni escalón en 16 kHz, ni etiquetas de una descarga).${anyGear ? ' Para escuchar en cualquier equipo está bien. Si querés el original sin pérdida, buscalo con NAPIA o la Bandeja.' : ''}`,
    en: (fmt: string, anyGear: boolean) => `It may be the master (some CDs come like this) or an MP3 someone converted to ${fmt}: there are no other signs of an MP3 (no gaps, no step at 16 kHz, no tags from a download).${anyGear ? " It's fine for listening on any system. If you want the lossless original, look for it with NAPIA or the Inbox." : ''}`,
  },
  restos: {
    es: (k: string, techo: string) => `Arriba de ${k} solo quedan restos sueltos que llegan hasta ${techo}: los deja un MP3 chico cuando lo pasan a otro formato.`,
    en: (k: string, techo: string) => `Above ${k} there are only loose scraps reaching up to ${techo}: a small MP3 leaves them when it gets converted to another format.`,
  },
  youtube: { es: 'Bajado de YouTube', en: 'Downloaded from YouTube' },
  deMp3Kbps: { es: (eq: number) => `Viene de un MP3/AAC de ~${eq} kbps`, en: (eq: number) => `Made from a ~${eq} kbps MP3/AAC` },
  cortaDeGolpe: {
    es: (k: string) => `El sonido se corta de golpe en ${k}. Un archivo sin pérdida de verdad llega hasta ~22 kHz.`,
    en: (k: string) => `The sound cuts off suddenly at ${k}. A truly lossless file goes up to ~22 kHz.`,
  },
  youtubeExplica: {
    es: (fmt: string) => `YouTube guarda el audio comprimido (como un MP3 de ~160 kbps): pasarlo a ${fmt} no le devuelve lo que perdió. Ocupa como sin pérdida, pero suena como lo de YouTube. Para un buen equipo conviene conseguir otra versión.`,
    en: (fmt: string) => `YouTube stores audio compressed (like a ~160 kbps MP3): converting it to ${fmt} doesn't bring back what it lost. It takes up as much space as lossless, but sounds like the YouTube version. For a good sound system, it's worth getting another version.`,
  },
  comprimidoExplica: {
    es: 'Se hizo a partir de un archivo comprimido: ocupa como sin pérdida, pero suena como el MP3. Para un buen equipo conviene conseguir otra versión.',
    en: "It was made from a compressed file: it takes up as much space as lossless, but sounds like the MP3. For a good sound system, it's worth getting another version.",
  },
  // MP3 disfrazado (el nombre empieza con el formato, como en castellano: core/requests.ts y wanted.ts lo miran)
  disfrazado: { es: (eq: number) => `MP3 de ~${eq} kbps disfrazado`, en: (eq: number) => `MP3 at ~${eq} kbps in disguise` },
  alguienConvirtio: {
    es: (eq: number, fmt: string) => `Alguien convirtió un MP3/AAC de ~${eq} kbps a ${fmt}: ocupa como sin pérdida pero suena como el MP3.`,
    en: (eq: number, fmt: string) => `Someone converted a ~${eq} kbps MP3/AAC to ${fmt}: it takes up as much space as lossless but sounds like the MP3.`,
  },
  huecos: {
    es: 'Además, los agudos aparecen y desaparecen a cada rato: son los huecos que deja un MP3.',
    en: 'Also, the highs keep popping in and out: those are the gaps an MP3 leaves.',
  },
  estiradoCorte: {
    es: (sr: string, k: string) => `Dice ser ${sr} kHz, pero no tiene nada arriba de ${k}: el formato está "estirado" y ocupa de más.`,
    en: (sr: string, k: string) => `It says ${sr} kHz, but there's nothing above ${k}: the format is "stretched" and takes up extra space.`,
  },
  // con pérdida (MP3, AAC, OGG…)
  rinde: {
    es: (c: string, kbps: number | null, d: number) => `${c} rinde más que MP3: ${kbps} kbps suenan como un MP3 de ~${d}.`,
    en: (c: string, kbps: number | null, d: number) => `${c} is more efficient than MP3: ${kbps} kbps sounds like a ~${d} kbps MP3.`,
  },
  conPerdida: { es: (c: string, d: number) => `${c} de ~${d} kbps`, en: (c: string, d: number) => `${c} at ~${d} kbps` },
  formatoSinAgudos: {
    es: (sr: string, k: string) => `Es un archivo de ${sr}: no tiene agudos arriba de ${k} por el formato, no porque esté inflado.`,
    en: (sr: string, k: string) => `It's a ${sr} file: it has no highs above ${k} because of the format, not because it's inflated.`,
  },
  bajanSinInflar: {
    es: (k: string) => `Los agudos bajan de a poco hasta ${k}, sin el corte de golpe de un MP3 inflado: así suenan los vinilos, las cintas y muchos masters. No hay rastros de una descarga: se toma como el sonido de la grabación.`,
    en: (k: string) => `The highs fade out gradually up to ${k}, without the sudden cutoff of an inflated MP3: that's how vinyl, tapes and many masters sound. There are no signs of a download: it's taken as the sound of the recording.`,
  },
  inflado: { es: (eq: number, kbps: number | null) => `MP3 de ~${eq} kbps (inflado a ${kbps})`, en: (eq: number, kbps: number | null) => `MP3 at ~${eq} kbps (inflated to ${kbps})` },
  diceEscalon: {
    es: (kbps: number | null, db: number | null, eq: number) => `Dice ${kbps} kbps, pero arriba de 16 kHz casi no hay sonido (un escalón de ${db} dB), como un archivo de ~${eq} kbps.`,
    en: (kbps: number | null, db: number | null, eq: number) => `It says ${kbps} kbps, but there's almost no sound above 16 kHz (a ${db} dB step), like a ~${eq} kbps file.`,
  },
  diceCorte: {
    es: (kbps: number | null, k: string, eq: number) => `Dice ${kbps} kbps, pero el sonido se corta en ${k}, como un archivo de ~${eq} kbps.`,
    en: (kbps: number | null, k: string, eq: number) => `It says ${kbps} kbps, but the sound cuts off at ${k}, like a ~${eq} kbps file.`,
  },
  recodificaron: { es: 'Lo re-codificaron a más kbps: pesa más pero no suena mejor.', en: "It was re-encoded at a higher kbps: it's bigger but doesn't sound better." },
  recodificado: { es: (eq: number) => `Re-codificado (origen ~${eq} kbps)`, en: (eq: number) => `Re-encoded (source ~${eq} kbps)` },
  encoder: {
    es: (l: string, k: string) => `El encoder estaba configurado para cortar en ${l}, pero el audio ya venía cortado en ${k}: es un MP3 hecho a partir de otro MP3.`,
    en: (l: string, k: string) => `The encoder was set to cut off at ${l}, but the audio was already cut at ${k}: it's an MP3 made from another MP3.`,
  },
  esperable: {
    es: (k: string, kbps: number | null) => `El sonido llega hasta ${k}, lo esperable para ${kbps} kbps.`,
    en: (k: string, kbps: number | null) => `The sound goes up to ${k}, as expected for ${kbps} kbps.`,
  },
  baja: {
    es: 'Es una calidad baja: con auriculares o un buen equipo se nota. Conviene conseguir una versión mejor.',
    en: "It's low quality: you'll notice it on headphones or a good sound system. It's worth getting a better version.",
  },
  // sonido (no baja la nota)
  mono: { es: 'Es mono.', en: "It's mono." },
  cortes: {
    es: (n: number, ms: string, at: string) => `Tiene ${n === 1 ? '1 corte' : `${n} cortes`} de ${ms} ms (pedazos que no se pueden leer): ${at}. Conviene conseguir otra copia.`,
    en: (n: number, ms: string, at: string) => `It has ${n === 1 ? '1 gap' : `${n} gaps`} of ${ms} ms (bits that can't be read): ${at}. It's worth getting another copy.`,
  },
  estereoFalso: { es: 'Estéreo falso: los dos canales son idénticos (es un mono duplicado).', en: "Fake stereo: both channels are identical (it's mono copied onto both)." },
  clipping: {
    es: (n: number) => `Tiene ${n} recortes (clipping): partes donde el volumen se pasó del máximo y se distorsiona.`,
    en: (n: number) => `It has ${n} clipped spots (clipping): places where the volume went over the maximum and distorts.`,
  },
  muyFuerte: {
    es: (lufs: string) => `Muy fuerte (${lufs} LUFS): master muy comprimido, típico de la "loudness war".`,
    en: (lufs: string) => `Very loud (${lufs} LUFS): a heavily compressed master, typical of the "loudness war".`,
  },
})
