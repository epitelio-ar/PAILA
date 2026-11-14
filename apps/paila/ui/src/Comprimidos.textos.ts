// Los textos de ZIP y RAR (Comprimidos.tsx), en castellano y en inglés (ver @paila/shared/idioma).
import { textos, cant } from '@paila/shared/idioma'

export const T = textos({
  tipIntro: {
    es: 'Los discos que guardaste en .zip o .rar sin abrir. PAILA mira qué tienen adentro leyendo solo su índice (no los descomprime para escanear), deja escuchar y analizar cada tema sacando solo ese un momento, y los puede sacar a una carpeta al lado. El comprimido no se toca, salvo que ya tengas todo afuera y quieras mandarlo a la papelera (se restaura).',
    en: "The albums you kept as .zip or .rar without opening them. PAILA sees what is inside by reading only their index (it doesn't unpack them to scan), lets you listen to and analyze each track by taking out just that one for a moment, and can take them out to a folder next to the file. The compressed file isn't touched, unless you already have everything outside and want to send it to the trash (you can restore it).",
  },
  tipLeer: {
    es: 'Saca un tema por vez a una carpeta temporal, lee sus tags, la nota de calidad, el BPM y el tono, y lo borra enseguida: no llena el disco.',
    en: "Takes out one track at a time to a temporary folder, reads its tags, quality grade, BPM and key, and deletes it right away: it doesn't fill your disk.",
  },
  tipSacar: {
    es: 'La música (con sus tapas, la hoja .cue y los textos del disco) va a una carpeta al lado del comprimido. Primero ves adónde va cada archivo. Queda en el Historial y se puede deshacer. El comprimido queda igual.',
    en: "The music (with its covers, the .cue sheet and the album's text files) goes to a folder next to the compressed file. First you see where each file goes. It is saved in History and can be undone. The compressed file stays as it is.",
  },
  tipAfuera: {
    es: 'Temas de adentro que ya están en tu Música (mismo tamaño y formato). Si están todos, ya lo abriste alguna vez: el comprimido ocupa lugar de más.',
    en: 'Tracks inside that are already in your Music (same size and format). If they all are, you already opened it at some point: the compressed file takes up extra room.',
  },
  tipPapelera: {
    es: 'Si todos los temas de adentro ya están afuera, el comprimido sobra. Esto lo manda a la papelera de PAILA: primero ves qué archivos van, no se borra nada y lo podés restaurar desde el Historial. Un rar partido va con todas sus partes.',
    en: "If all the tracks inside are already outside, the compressed file is not needed. This sends it to PAILA's trash: first you see which files go, nothing is deleted and you can restore it from History. A split rar goes with all its parts.",
  },
  tipSolido: {
    es: 'Un RAR "sólido" comprime todo junto: para sacar un tema del final hay que leer todo lo de antes. Tarda un poco más.',
    en: 'A "solid" RAR compresses everything together: to take out a track from the end, everything before it has to be read. It takes a little longer.',
  },
  tipSample: {
    es: 'Material de producción (sample packs, drum kits): PAILA lo muestra pero nunca lo saca, mueve ni cambia.',
    en: 'Production material (sample packs, drum kits): PAILA shows it but never takes it out, moves or changes it.',
  },
  tipNota: {
    es: 'La nota de calidad, de A+ (mejor que CD) a F (muy comprimido o falso). Pasá el mouse para ver por qué.',
    en: 'The quality grade, from A+ (better than CD) to F (heavily compressed or fake). Hover to see why.',
  },
  tipBpm: {
    es: 'BPM: golpes por minuto (la velocidad del tema). Tono: la nota en la que está, en el sistema Camelot de los DJs.',
    en: "BPM: beats per minute (the speed of the track). Key: the note it is in, in the DJs' Camelot system.",
  },
  sPuede: { es: 'Se puede abrir', en: 'Can be opened' },
  sClave: { es: 'Con clave', en: 'Password-protected' },
  sRoto: { es: 'Dañado', en: 'Damaged' },
  sFalta: { es: 'Le falta una parte', en: 'A part is missing' },
  sSinMusica: { es: 'Sin música', en: 'No music' },
  sacados: {
    es: (k: number, folder: string) => `${k} ${k === 1 ? 'archivo sacado' : 'archivos sacados'} a «${folder}».`,
    en: (k: number, folder: string) => `${cant(k, 'file', 'files')} taken out to «${folder}».`,
  },
  aPapelera: {
    es: (k: number, b: string) => `${k === 1 ? 'Comprimido mandado' : `${k} archivos mandados`} (${b}).`,
    en: (k: number, b: string) => `${k === 1 ? 'Compressed file sent' : `${k} files sent`} (${b}).`,
  },
  noPapelera: { es: 'No se mandó nada a la papelera.', en: "Nothing was sent to the trash." },
  vaciaTitulo: { es: 'No hay ZIP ni RAR en tu biblioteca', en: 'There are no ZIP or RAR files in your library' },
  vaciaCuerpo: {
    es: 'Cuando escanees, PAILA anota los .zip y .rar que haya en tu Música y te muestra la música que tienen adentro, sin abrirlos.',
    en: 'When you scan, PAILA notes the .zip and .rar files in your Music and shows you the music inside them, without opening them.',
  },
  carpetaPrincipal: { es: '(carpeta principal)', en: '(main folder)' },
  temas: { es: (k: number) => `${k} ${k === 1 ? 'tema' : 'temas'}`, en: (k: number) => cant(k, 'track', 'tracks') },
  enPartes: { es: (k: number) => ` en ${k} partes`, en: (k: number) => ` in ${k} parts` },
  samplePack: { es: 'Sample pack', en: 'Sample pack' }, // idioma-ok
  solido: { es: 'Sólido', en: 'Solid' },
  yaAfuera: { es: 'Ya está afuera', en: 'Already outside' },
  nYaAfuera: { es: (k: number) => `${k} ya afuera`, en: (k: number) => `${k} already outside` },
  sacadoPil: { es: 'Sacado', en: 'Taken out' },
  sacadoTip: { es: (a: string) => `Sacado con PAILA a ${a}`, en: (a: string) => `Taken out with PAILA to ${a}` },
  desconectado: { es: 'Disco desconectado', en: 'Drive disconnected' },
  leerFalta: { es: 'Leer lo que falta', en: 'Read what is left' },
  leerAnalizar: { es: 'Leer y analizar', en: 'Read and analyze' },
  sacarAlLado: { es: 'Sacar al lado…', en: 'Take out next to it…' },
  mandarComprimido: { es: 'Mandar el comprimido a la papelera…', en: 'Send the compressed file to the trash…' },
  mostrar: { es: 'Mostrar en la carpeta', en: 'Show in folder' },
  abrirSacado: { es: 'Abrir lo sacado', en: 'Open what was taken out' },
  titulo: { es: 'ZIP y RAR', en: 'ZIP and RAR' },
  resumen: {
    es: (c: number, t: number) => `**${c}** ${c === 1 ? 'comprimido' : 'comprimidos'} con **${t}** temas adentro`,
    en: (c: number, t: number) => `**${c}** compressed ${c === 1 ? 'file' : 'files'} with **${t}** tracks inside`,
  },
  resumenAbiertos: {
    es: (k: number, b: string) => ` · **${k}** ya ${k === 1 ? 'está abierto' : 'están abiertos'} afuera (${b} que podrías liberar) {info}`,
    en: (k: number, b: string) => ` · **${k}** ${k === 1 ? 'is' : 'are'} already open outside (${b} you could free up) {info}`,
  },
  resumenSamples: {
    es: (k: number) => ` · ${k} ${k === 1 ? 'sample pack' : 'sample packs'} que no se tocan`,
    en: (k: number) => ` · ${k} ${k === 1 ? 'sample pack' : 'sample packs'} that are not touched`,
  },
  leerTodos: { es: (k: number) => `Leer y analizar todos (${k} temas)`, en: (k: number) => `Read and analyze all (${k} tracks)` },
  unidadTemas: { es: 'temas', en: 'tracks' },
  unidadArchivos: { es: 'archivos', en: 'files' },
  verSamples: {
    es: (mostrar: boolean, k: number) => `${mostrar ? 'Ocultar' : 'Ver'} los sample packs (${k})`,
    en: (mostrar: boolean, k: number) => `${mostrar ? 'Hide' : 'See'} the sample packs (${k})`,
  },
  // ventana de la papelera
  tTitulo: { es: (n: string) => `Mandar «${n}» a la papelera`, en: (n: string) => `Send «${n}» to the trash` },
  tTexto: {
    es: (a: number, partes: number, b: string) => `Los **${a}** ${a === 1 ? 'tema' : 'temas'} de adentro ya ${a === 1 ? 'está' : 'están'} afuera, en tu Música. ${partes === 1 ? 'El comprimido pasa' : `Las ${partes} partes pasan`} a la papelera de PAILA y libera${partes === 1 ? '' : 'n'} **${b}**. No se borra nada: se restaura desde el Historial.`,
    en: (a: number, partes: number, b: string) => `The **${a}** ${a === 1 ? 'track' : 'tracks'} inside ${a === 1 ? 'is' : 'are'} already outside, in your Music. ${partes === 1 ? 'The compressed file goes' : `The ${partes} parts go`} to PAILA's trash and ${partes === 1 ? 'frees' : 'free'} **${b}**. Nothing is deleted: it can be restored from History.`,
  },
  cerrar: { es: 'Cerrar', en: 'Close' },
  mandarPapelera: { es: 'Mandar a la papelera', en: 'Send to the trash' },
  mandando: { es: 'Mandando…', en: 'Sending…' },
  papeleraPreg: { es: (k: number) => (k === 1 ? '¿Mandar el comprimido a la papelera?' : `¿Mandar las ${k} partes a la papelera?`), en: (k: number) => (k === 1 ? 'Send the compressed file to the trash?' : `Send the ${k} parts to the trash?`) },
  // lista de temas
  cTema: { es: 'Tema', en: 'Track' },
  cDuracion: { es: 'Duración', en: 'Length' },
  cFormato: { es: 'Formato', en: 'Format' },
  cNota: { es: 'Nota', en: 'Grade' },
  cTono: { es: 'Tono', en: 'Key' },
  escuchar: { es: 'Escuchar (saca solo este tema un momento)', en: 'Listen (takes out only this track for a moment)' },
  noSeAbre: { es: 'No se abre', en: "Can't be opened" },
  yaAfueraCorto: { es: 'Ya afuera', en: 'Already outside' },
  ademas: { es: 'Además: ', en: 'Also: ' },
  yMas: { es: (k: number) => ` y ${k} más`, en: (k: number) => ` and ${k} more` },
  // ventana de sacar
  pTitulo: { es: (n: string) => `Sacar «${n}» al lado`, en: (n: string) => `Take «${n}» out next to it` },
  pTexto: {
    es: (a: number, extra: number, b: string, existe: boolean) => `Van **${a}** ${a === 1 ? 'tema' : 'temas'}${extra > 0 ? ` y ${extra} archivos más (tapas, textos)` : ''} (${b}) a la carpeta {carpeta}${existe ? ', que ya existe: no se pisa nada' : ''}. El comprimido queda igual.`,
    en: (a: number, extra: number, b: string, existe: boolean) => `**${a}** ${a === 1 ? 'track' : 'tracks'}${extra > 0 ? ` and ${extra} more files (covers, texts)` : ''} (${b}) will go to the folder {carpeta}${existe ? ', which already exists: nothing is overwritten' : ''}. The compressed file stays as it is.`,
  },
  sinLugar: {
    es: (hace: string, queda: string) => `No hay lugar en el disco: hacen falta ${hace} y quedan ${queda}.`,
    en: (hace: string, queda: string) => `There isn't enough room on the disk: ${hace} needed and ${queda} left.`,
  },
  noVan: {
    es: (k: number, l: string, mas: boolean) => `No van (${k}): ${l}${mas ? '…' : ''}`,
    en: (k: number, l: string, mas: boolean) => `Not included (${k}): ${l}${mas ? '…' : ''}`,
  },
  sacarN: {
    es: (k: number) => `Sacar ${k} ${k === 1 ? 'archivo' : 'archivos'}`,
    en: (k: number) => `Take out ${cant(k, 'file', 'files')}`,
  },
  sacando: { es: 'Sacando…', en: 'Taking out…' },
  sacarPreg: { es: (k: number) => `¿Sacar ${k} ${k === 1 ? 'archivo' : 'archivos'} al lado del comprimido?`, en: (k: number) => `Take out ${cant(k, 'file', 'files')} next to the compressed file?` },
})
