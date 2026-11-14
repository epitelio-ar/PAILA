// Los textos de la pestaña "Celular" de Llevar la música, en castellano y en inglés (ver @paila/shared/idioma).
import { textos } from '@paila/shared/idioma'

export const T = textos({
  aac: {
    es: 'AAC (.m4a) es el formato del iPhone y de Apple Music, y lo lee cualquier Android. A la misma cantidad de kbps suena un poco mejor que el MP3.',
    en: 'AAC (.m4a) is the format used by iPhone and Apple Music, and any Android can play it. At the same kbps it sounds a bit better than MP3.',
  },
  mp3: {
    es: 'MP3 lo lee absolutamente todo: celulares viejos, autos, parlantes. A igual tamaño suena un poquito peor que AAC.',
    en: 'Absolutely everything plays MP3: old phones, cars, speakers. At the same size it sounds slightly worse than AAC.',
  },
  kb: {
    es: 'kbps (kilobits por segundo) dice cuánta información guarda cada segundo de audio: más kbps, mejor sonido y más espacio. 192 kbps ya suena muy bien con auriculares; 128 está bien para el colectivo; 256 o 320 casi no se distinguen del original.',
    en: 'kbps (kilobits per second) tells you how much information is kept for each second of audio: more kbps means better sound and more space. 192 kbps already sounds very good on headphones; 128 is fine for the bus; 256 or 320 are almost impossible to tell apart from the original.',
  },
  techo: {
    es: 'La calidad que elegís es un techo, no un objetivo: solo se achica lo que ocupa mucho; lo que ya está en menor calidad se copia como está, nunca se agranda.',
    en: "The quality you pick is a ceiling, not a target: only what takes up a lot of space gets smaller; anything already at a lower quality is copied as it is and never made bigger.",
  },
  copiar: {
    es: 'Si un tema ya es MP3 o AAC y no pesa más que la calidad elegida, se copia tal cual: convertirlo de nuevo no ahorra casi nada y suena un poco peor. Y nunca se agranda: pasar un tema de 128 a 320 kbps no lo hace sonar mejor, solo ocupa más.',
    en: "If a track is already MP3 or AAC and isn't bigger than the quality you picked, it is copied as it is: converting it again saves almost nothing and sounds a little worse. And it is never made bigger: taking a track from 128 to 320 kbps doesn't make it sound better, it just takes more space.",
  },
  original: {
    es: 'Copia cada tema tal cual está en tu compu, sin convertir: ocupa lo mismo que acá. Sirve si al celular le sobra lugar. Ojo: algunos formatos (WMA, AIFF…) muchos celulares no los leen.',
    en: "Copies each track exactly as it is on your computer, without converting: it takes the same space as here. Good if your phone has room to spare. Careful: many phones can't play some formats (WMA, AIFF…).",
  },
  mtp: {
    es: 'Un Android conectado por cable no aparece como un disco con letra (como un pendrive): Windows lo ve como "dispositivo portátil". PAILA lo encuentra igual y copia directo; primero prepara los temas en una carpeta temporal de la compu y después los pasa, verificando que cada uno llegue entero.',
    en: 'An Android connected by cable does not show up as a drive with a letter (like a USB stick): Windows sees it as a "portable device". PAILA finds it anyway and copies straight to it; first it prepares the tracks in a temporary folder on your computer and then sends them, checking that each one arrives complete.',
  },
  layoutL: {
    es: 'Una sola carpeta con los temas numerados en el orden de la playlist, más el archivo de la playlist. Es lo más simple para pasar al celular.',
    en: 'A single folder with the tracks numbered in playlist order, plus the playlist file. This is the simplest way to put them on your phone.',
  },
  layoutD: {
    es: 'Carpetas Artista/Álbum, como una biblioteca. Los reproductores del celular las muestran ordenadas por artista y disco; la playlist va igual, en la carpeta de arriba.',
    en: 'Artist/Album folders, like a library. Phone players show them sorted by artist and album; the playlist is included too, in the folder above.',
  },
  qChica: { es: 'Ocupa poco', en: 'Small size' },
  qNormal: { es: 'Buena', en: 'Good' },
  qAlta: { es: 'Muy alta', en: 'Very high' },
  qOriginal: { es: 'Original (copiar sin convertir)', en: 'Original (copy without converting)' },
  hasta: { es: (k: number) => ` (hasta ${k} kbps)`, en: (k: number) => ` (up to ${k} kbps)` },
  pickDestino: {
    es: 'Elegí la carpeta de destino (por ejemplo, una carpeta para pasarle después al celular)',
    en: 'Pick the destination folder (for example, a folder you will copy to your phone later)',
  },
  intro: {
    es: 'Lleva una playlist al celular, directo por cable o a una carpeta de la compu, con los tags y la tapa. Lo que ocupa mucho se achica; lo que ya es chico se copia como está, nunca se agranda {info}. **Tus originales no se tocan.**',
    en: 'Takes a playlist to your phone, straight over a cable or to a folder on your computer, with tags and cover. What takes up a lot of space gets smaller; what is already small is copied as it is and never made bigger {info}. **Your originals are not touched.**',
  },
  paso1: { es: '1. Qué y adónde', en: '1. What and where' },
  adonde: { es: 'Adónde:', en: 'Where to:' },
  alCelular: { es: 'Al celular conectado por cable', en: 'To a phone connected by cable' },
  aCarpeta: { es: 'A una carpeta de la compu', en: 'To a folder on the computer' },
  celular: { es: 'Celular:', en: 'Phone:' },
  elegi: { es: 'Elegí…', en: 'Pick…' },
  donde: { es: 'Dónde:', en: 'Where:' },
  libres: { es: (b: string) => ` (${b} libres)`, en: (b: string) => ` (${b} free)` },
  carpeta: { es: 'Carpeta:', en: 'Folder:' },
  carpetaTip: {
    es: 'Adentro de esta carpeta del celular se crea una con el nombre de la playlist. Music es donde la buscan los reproductores.',
    en: "Inside this folder on the phone, one named after the playlist is created. Music is where players look for it.",
  },
  buscarDeNuevo: { es: 'Buscar de nuevo', en: 'Search again' },
  noDeja: {
    es: (nombres: string) => `${nombres}: no deja ver sus archivos. Desbloquealo y, en el aviso del celular, elegí **Transferencia de archivos**; después tocá Buscar de nuevo.`,
    en: (nombres: string) => `${nombres}: it won't let me see its files. Unlock it and, in the notice on the phone, pick **File transfer**; then tap Search again.`,
  },
  ninguno: {
    es: 'No veo ningún celular conectado. Conectalo por cable, desbloquealo y, en el aviso que aparece en el celular, elegí **Transferencia de archivos** (a veces dice "MTP"). {boton}',
    en: 'I can\'t see any connected phone. Plug it in with a cable, unlock it and, in the notice that appears on the phone, pick **File transfer** (it sometimes says "MTP"). {boton}',
  },
  ningunoSi: { es: 'Si no, elegí "A una carpeta de la compu" y pasala después.', en: 'If not, pick "To a folder on the computer" and copy it over afterwards.' },
  buscando: { es: 'Buscando celulares conectados…', en: 'Looking for connected phones…' },
  apple: {
    es: (nombres: string) => `${nombres}: por cable, el iPhone solo deja pasar fotos. Elegí una carpeta de la compu y después arrastrala a Apple Music o iTunes (abajo dice cómo).`,
    en: (nombres: string) => `${nombres}: over a cable, an iPhone only lets photos through. Pick a folder on the computer and then drag it into Apple Music or iTunes (the steps are below).`,
  },
  cambiarCarpeta: { es: 'Cambiar carpeta…', en: 'Change folder…' },
  elegirDestino: { es: 'Elegir la carpeta de destino…', en: 'Pick the destination folder…' },
  sinDestino: { es: 'Todavía no elegiste dónde guardar', en: "You haven't picked where to save yet" },
  paso2: { es: '2. Cómo', en: '2. How' },
  calidad: { es: 'Calidad:', en: 'Quality:' },
  tal: { es: 'Se copia todo tal cual, sin convertir: ocupa lo mismo que en tu compu.', en: 'Everything is copied as it is, without converting: it takes the same space as on your computer.' },
  achica: {
    es: '**Solo se achica lo que ocupa mucho**; lo que ya está en menor calidad se copia como está, **nunca se agranda** {info}',
    en: '**Only what takes up a lot of space gets smaller**; anything already at a lower quality is copied as it is and **never made bigger** {info}',
  },
  formato: { es: 'Formato:', en: 'Format:' },
  sinConvertir: { es: '(con Original no se convierte nada)', en: '(with Original nothing gets converted)' },
  carpetas: { es: 'Carpetas:', en: 'Folders:' },
  unaCarpeta: { es: 'Una carpeta, en orden', en: 'One folder, in order' },
  artistaAlbum: { es: 'Artista / Álbum', en: 'Artist / Album' },
  numerar: {
    es: 'Numerar los archivos (001 - Artista - Título) para que queden en orden aunque el reproductor no lea la playlist',
    en: "Number the files (001 - Artist - Title) so they stay in order even if the player doesn't read the playlist",
  },
  planCabeza: {
    es: (c: string, carpeta: string | null) => `**${c}** temas${carpeta ? ` a **${carpeta}**` : ''}:`,
    en: (c: string, carpeta: string | null) => `**${c}** tracks${carpeta ? ` to **${carpeta}**` : ''}:`,
  },
  planAchican: {
    es: (c: string, fmt: string, kb: number | null) => `**${c}** se achican (pasan a ${fmt} de hasta ${kb} kbps) · `,
    en: (c: string, fmt: string, kb: number | null) => `**${c}** get smaller (they become ${fmt} at up to ${kb} kbps) · `,
  },
  planCopian: { es: (c: string) => `**${c}** se copian tal cual {info}`, en: (c: string) => `**${c}** are copied as they are {info}` },
  planOcupan: {
    es: (total: string, orig: string | null) => `van a ocupar **${total}**${orig ? ` (en tu compu ocupan ${orig})` : ''}`,
    en: (total: string, orig: string | null) => `will take up **${total}**${orig ? ` (on your computer they take up ${orig})` : ''}`,
  },
  planLibre: {
    es: (b: string, enCel: boolean) => ` · lugar libre${enCel ? ' en el celular' : ''}: ${b}`,
    en: (b: string, enCel: boolean) => ` · free space${enCel ? ' on the phone' : ''}: ${b}`,
  },
  saltean: { es: (c: string, lista: string) => `${c} se saltean: ${lista}`, en: (c: string, lista: string) => `${c} skipped: ${lista}` },
  ymas: { es: (c: string) => `… y ${c} más`, en: (c: string) => `… and ${c} more` },
  archivos: { es: 'archivos', en: 'files' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  pasarPreg: {
    es: (alCel: boolean, c: string) => `¿${alCel ? 'Pasar' : 'Copiar'} ${c} temas${alCel ? ' al celular' : ''}?`,
    en: (alCel: boolean, c: string) => `${alCel ? 'Send' : 'Copy'} ${c} tracks${alCel ? ' to the phone' : ''}?`,
  },
  pasando: { es: 'Pasando…', en: 'Copying…' },
  // el pie fijo de abajo (usabilidad, 2.ª tanda, P4): qué va a pasar y el botón, siempre a la vista
  pieQue: {
    es: (alCel: boolean, c: string, de: string, a: string) => `${alCel ? 'Pasar' : 'Copiar'} ${c} temas de «${de}» ${alCel ? 'al celular' : 'a'} ${a}`,
    en: (alCel: boolean, c: string, de: string, a: string) => `${alCel ? 'Send' : 'Copy'} ${c} tracks from «${de}» ${alCel ? 'to the phone' : 'to'} ${a}`,
  },
  pieFaltaQue: { es: 'Elegí qué llevar (paso 1)', en: 'Pick what to take (step 1)' },
  pieFaltaDonde: { es: (alCel: boolean): string => alCel ? 'Elegí el celular (paso 1)' : 'Elegí la carpeta de destino (paso 1)', en: (alCel: boolean): string => alCel ? 'Pick the phone (step 1)' : 'Pick the destination folder (step 1)' },
  pieArmando: { es: 'Mirando qué hay que copiar…', en: 'Checking what needs copying…' },
  pieBoton: { es: (alCel: boolean): string => alCel ? 'Pasar al celular' : 'Copiar temas', en: (alCel: boolean): string => alCel ? 'Send to the phone' : 'Copy tracks' },
  siLoCortas: { es: 'Si lo cortás, la próxima vez sigue donde quedó.', en: 'If you stop it, next time it picks up where it left off.' },
  noDesconectes: { es: ' No desconectes ni bloquees el celular mientras pasa.', en: " Don't unplug or lock the phone while it's copying." },
  aMano: { es: 'Cómo pasarlo al celular a mano', en: 'How to put it on your phone by hand' },
  android: { es: 'Android:', en: 'Android:' },
  androidT: {
    es: 'lo más fácil es "Al celular conectado por cable", acá arriba. A mano: conectalo, elegí "Transferencia de archivos" en el celular y copiá la carpeta a {music}. Reproductores como Poweramp, Musicolet o el de Samsung leen la playlist (.m3u8) solos.',
    en: 'the easiest way is "To a phone connected by cable", up above. By hand: plug it in, pick "File transfer" on the phone and copy the folder to {music}. Players like Poweramp, Musicolet or Samsung\'s own read the playlist (.m3u8) by themselves.',
  },
  iphone: { es: 'iPhone:', en: 'iPhone:' },
  iphoneT: {
    es: 'en la compu, abrí Apple Music o iTunes, arrastrá la carpeta a la biblioteca y sincronizá el iPhone; o pasala a la app Archivos y abrila con un reproductor como VLC.',
    en: 'on the computer, open Apple Music or iTunes, drag the folder into the library and sync the iPhone; or copy it to the Files app and open it with a player like VLC.',
  },
  // El resultado
  resCabeza: {
    es: (conv: string, cop: string, ya: string | null) => `${conv} convertidos y ${cop} copiados tal cual${ya ? `, ${ya} ya estaban` : ''}`,
    en: (conv: string, cop: string, ya: string | null) => `${conv} converted and ${cop} copied as they are${ya ? `, ${ya} already there` : ''}`,
  },
  resCel: {
    es: (sent: string, ya: string | null, carpeta: string) => ` Al celular llegaron ${sent} archivos${ya ? ` (${ya} ya estaban)` : ''}, verificados por tamaño, en ${carpeta}.`,
    en: (sent: string, ya: string | null, carpeta: string) => ` ${sent} files reached the phone${ya ? ` (${ya} were already there)` : ''}, checked by size, in ${carpeta}.`,
  },
  abrirCarpeta: { es: 'Abrir la carpeta', en: 'Open the folder' },
  resAvisosMas: { es: (c: string) => `… y ${c} avisos más`, en: (c: string) => `… and ${c} more notices` },
  resFesteja: { es: (cabeza: string) => `Listo: ${cabeza}.`, en: (cabeza: string) => `Done: ${cabeza}.` },
  resAvisos: { es: (c: string) => `${c} avisos sobre algunos archivos.`, en: (c: string) => `${c} notices about some files.` },
  resIntactos: { es: 'Tus archivos originales no se tocaron.', en: "Your original files weren't touched." },
  // Qué llevar
  queLlevar: { es: 'Qué llevar:', en: 'What to take:' },
  elegiPlaylist: { es: 'Elegí una playlist…', en: 'Pick a playlist…' },
  losElegidos: { es: (c: string) => `Los ${c} temas que elegiste en la Biblioteca`, en: (c: string) => `The ${c} tracks you picked in the Library` },
  nombreCarpeta: { es: 'Nombre de la carpeta:', en: 'Folder name:' },
})
