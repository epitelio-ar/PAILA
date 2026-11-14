// Los textos del Chequeo (core/chequeo.ts), en castellano e inglés: qué se mira, cómo está, qué consecuencia tiene y cómo se
// arregla. Simples, sin jerga; cada término técnico tiene su ⓘ. Los del firewall de NAPIA están en @paila/shared/firewall.
import { textos } from '@paila/shared/idioma'

export const T = textos({
  // programas
  programas: { es: 'ffmpeg y ffprobe', en: 'ffmpeg and ffprobe' },
  programasTip: {
    es: 'Los dos programas que PAILA usa por dentro para leer, escuchar y analizar tu música. Vienen con PAILA.',
    en: 'The two programs PAILA uses inside to read, play and analyze your music. They come with PAILA.',
  },
  programasOk: { es: 'Están y responden.', en: "They're there and they answer." },
  falta: { es: (cual: string) => `Falta ${cual}.`, en: (cual: string) => `${cual} is missing.` },
  noResponde: { es: (cual: string) => `${cual} no responde.`, en: (cual: string) => `${cual} doesn't answer.` },
  programasPorQue: {
    es: 'Sin ellos PAILA no puede leer los temas nuevos, analizarlos ni hacerlos sonar.',
    en: "Without them PAILA can't read new tracks, analyze them or play them.",
  },
  reinstalar: {
    es: 'Se arregla instalando PAILA de nuevo, encima de la que tenés: tu música, tus playlists y tu historial no se tocan.',
    en: "You fix it by installing PAILA again, over the one you have: your music, your playlists and your history aren't touched.",
  },
  // carpetas de la biblioteca
  carpetas: { es: 'Escribir en tu Música', en: 'Writing to your Music' },
  carpetasTip: {
    es: 'PAILA necesita poder escribir en las carpetas de tu biblioteca para guardar tags, ordenar y para su papelera (_PAILA). La prueba crea un archivito vacío y lo borra al instante.',
    en: 'PAILA needs to be able to write to your library folders to save tags, organize, and for its trash (_PAILA). The test creates a tiny empty file and deletes it right away.',
  },
  carpetasOk: { es: (n: number) => (n === 1 ? 'Se puede escribir en tu carpeta de música.' : `Se puede escribir en las ${n} carpetas de música.`), en: (n: number) => (n === 1 ? 'Your music folder can be written to.' : `All ${n} music folders can be written to.`) },
  sinCarpetas: { es: 'Todavía no elegiste una carpeta de música.', en: "You haven't chosen a music folder yet." },
  noConectado: { es: (c: string) => `No está conectado: ${c}.`, en: (c: string) => `Not connected: ${c}.` },
  noConectadoPorQue: {
    es: 'Mientras no esté, PAILA muestra sus temas pero no puede tocarlos. Enchufalo y volvé a revisar.',
    en: "While it's away, PAILA shows its tracks but can't touch them. Plug it in and check again.",
  },
  noSeEscribe: { es: (c: string, m: string) => `No se puede escribir en ${c} (${m}).`, en: (c: string, m: string) => `${c} can't be written to (${m}).` },
  noSeEscribePorQue: {
    es: 'Así PAILA no puede guardar tags, ordenar ni mandar nada a su papelera. Fijate que el disco no esté protegido contra escritura (algunas tarjetas y pendrives tienen una trabita) y que tu usuario de Windows tenga permiso en esa carpeta.',
    en: "So PAILA can't save tags, organize or send anything to its trash. Check that the drive isn't write-protected (some cards and USB sticks have a little switch) and that your Windows user has permission on that folder.",
  },
  soloMirar: { es: 'No se probó: PAILA está abierta solo para mirar.', en: 'Not tested: PAILA is open just for looking.' },
  sinPermiso: { es: 'no hay permiso', en: 'no permission' },
  soloLectura: { es: 'el disco es de solo lectura', en: 'the drive is read-only' },
  lleno: { es: 'el disco está lleno', en: 'the drive is full' },
  // datos
  datos: { es: 'La carpeta de datos de PAILA', en: "PAILA's data folder" },
  datosTip: {
    es: 'Donde PAILA guarda su base (lo que sabe de cada tema), las tapas y los respaldos. No es tu música.',
    en: "Where PAILA keeps its database (what it knows about each track), covers and backups. It isn't your music.",
  },
  datosOk: { es: 'Se puede escribir.', en: 'It can be written to.' },
  datosMal: { es: (m: string) => `No se puede escribir (${m}).`, en: (m: string) => `It can't be written to (${m}).` },
  datosPorQue: {
    es: 'Sin eso PAILA no puede guardar lo que hacés. Cerrá PAILA y volvé a abrirla; si sigue, puede ser que el disco esté lleno o que un antivirus la esté frenando.',
    en: "Without it PAILA can't save what you do. Close PAILA and open it again; if it keeps happening, the drive may be full or an antivirus may be blocking it.",
  },
  // espacio
  espacio: { es: 'Lugar en el disco', en: 'Disk space' },
  espacioTip: {
    es: 'PAILA necesita algo de lugar para su base, para los respaldos que hace antes de cambiar un archivo y para convertir.',
    en: 'PAILA needs some room for its database, for the backups it makes before changing a file, and for converting.',
  },
  espacioOk: { es: (l: string) => `Hay lugar: ${l}.`, en: (l: string) => `There's room: ${l}.` },
  libres: { es: (d: string, g: string) => `${d} ${g} libres`, en: (d: string, g: string) => `${d} ${g} free` },
  pocoLugar: { es: (l: string) => `Queda poco lugar: ${l}.`, en: (l: string) => `Little room left: ${l}.` },
  espacioPorQue: {
    es: 'Con el disco lleno no se pueden guardar cambios ni respaldos, y PAILA puede quedar a medias. En Espacio ves qué ocupa más y qué se puede achicar; la Papelera de PAILA se vacía a mano.',
    en: "With a full drive, changes and backups can't be saved, and PAILA may be left halfway. In Space you see what takes up the most and what can be shrunk; PAILA's Trash is emptied by hand.",
  },
  irEspacio: { es: 'Ir a Espacio', en: 'Go to Space' },
  irPapelera: { es: 'Ir a la Papelera', en: 'Go to Trash' },
  // claves
  clave: { es: (s: string) => `Clave de ${s}`, en: (s: string) => `${s} key` },
  discogsTip: { es: 'Discogs: una base enorme de discos. PAILA la usa para los nombres oficiales y los géneros.', en: 'Discogs: a huge database of records. PAILA uses it for official names and genres.' },
  acoustidTip: { es: 'AcoustID: reconoce un tema por cómo suena (su huella), aunque el archivo no tenga nombre.', en: "AcoustID: recognizes a track by how it sounds (its fingerprint), even if the file has no name." },
  lastfmTip: { es: 'Last.fm: PAILA usa sus etiquetas para proponer géneros. Es opcional.', en: 'Last.fm: PAILA uses its tags to suggest genres. It is optional.' },
  claveOk: { es: 'Responde bien.', en: 'It answers fine.' },
  sinClave: { es: (s: string) => `Sin clave (es opcional): PAILA busca sin ${s}.`, en: (s: string) => `No key (it's optional): PAILA searches without ${s}.` },
  claveMal: { es: (s: string) => `${s} no aceptó la clave.`, en: (s: string) => `${s} didn't accept the key.` },
  claveMalPorQue: {
    es: (s: string) => `Puede estar mal copiada o vencida. Mientras tanto, PAILA busca sin ${s}.`,
    en: (s: string) => `It may be copied wrong or expired. Meanwhile, PAILA searches without ${s}.`,
  },
  sinInternet: { es: (s: string) => `No hay internet, o ${s} no responde.`, en: (s: string) => `There's no internet, or ${s} isn't answering.` },
  sinInternetPorQue: {
    es: 'Revisá que haya internet. Si hay, puede ser que el servicio esté caído un rato o que un antivirus lo frene.',
    en: 'Check that there is internet. If there is, the service may be down for a while or an antivirus may be blocking it.',
  },
  ponerClave: { es: 'Poner una clave', en: 'Add a key' },
  revisarClave: { es: 'Revisar la clave', en: 'Check the key' },
  // MusicBrainz
  mbTip: {
    es: 'La base libre de música de donde PAILA saca nombres oficiales, discos y tapas. No pide clave.',
    en: 'The free music database PAILA gets official names, albums and covers from. It needs no key.',
  },
  mbOk: { es: 'Se llega bien.', en: 'It can be reached.' },
  mbEnUso: { es: 'Se está usando ahora (anda).', en: "It's being used right now (it works)." },
  mbOcupado: { es: 'Contesta, pero ahora está ocupado.', en: "It answers, but it's busy right now." },
  mbOcupadoPorQue: {
    es: 'MusicBrainz es gratis y lo usa mucha gente: cuando está lleno pide ir más despacio. PAILA espera sola; probá de nuevo en un rato.',
    en: 'MusicBrainz is free and lots of people use it: when it is full it asks to slow down. PAILA waits on its own; try again in a while.',
  },
  mbMal: { es: (m: string) => `No responde (${m}).`, en: (m: string) => `It isn't answering (${m}).` },
  mbPorQue: {
    es: 'Sin MusicBrainz no se completan nombres ni discos desde internet; lo demás anda igual.',
    en: "Without MusicBrainz, names and albums aren't filled in from the internet; everything else works the same.",
  },
  // base
  base: { es: 'La base de PAILA', en: "PAILA's database" },
  baseTip: {
    es: 'El archivo donde PAILA guarda todo lo que sabe de tu música: análisis, playlists, historial. La revisión mira que no tenga partes dañadas y no cambia nada.',
    en: "The file where PAILA keeps everything it knows about your music: analysis, playlists, history. The check looks for damaged parts and changes nothing.",
  },
  baseOk: { es: 'Está sana.', en: "It's healthy." },
  baseMal: { es: 'Tiene partes dañadas.', en: 'It has damaged parts.' },
  basePorQue: {
    es: 'Puede pasar por un corte de luz o un disco que falla. PAILA guarda un respaldo de la base cada día (en su carpeta de datos, en "respaldos"). Exportá el diagnóstico y mandáselo a quien te ayuda: con eso se ve cómo recuperarla.',
    en: 'It can happen after a power cut or a failing drive. PAILA keeps a backup of the database every day (in its data folder, under "respaldos"). Export the diagnostic and send it to whoever helps you: with it, they can see how to recover it.',
  },
  baseNose: { es: (m: string) => `No se pudo revisar (${m}).`, en: (m: string) => `It couldn't be checked (${m}).` },
  irDiagnostico: { es: 'Exportar el diagnóstico', en: 'Export the diagnostic' },
  // NAPIA
  napiaFirewall: { es: 'Permiso de Windows para NAPIA', en: 'Windows permission for NAPIA' },
  napiaFirewallNose: { es: 'No se pudo mirar el firewall de Windows.', en: "The Windows firewall couldn't be checked." },
  napiaPuerto: { es: 'El puerto de NAPIA', en: "NAPIA's port" },
  napiaPuertoTip: {
    es: 'Por dónde los demás usuarios de Soulseek se conectan con sockseek para mandarte temas. NAPIA le pide a tu router que lo abra mientras baja (con UPnP) y lo cierra al terminar.',
    en: 'Where other Soulseek users connect to sockseek to send you tracks. NAPIA asks your router to open it while downloading (with UPnP) and closes it when done.',
  },
  puertoOk: { es: 'Tu router deja que NAPIA lo abra sola mientras baja.', en: 'Your router lets NAPIA open it on its own while downloading.' },
  puertoBajando: { es: 'NAPIA está bajando ahora: el puerto lo maneja ella.', en: "NAPIA is downloading right now: it's handling the port." },
  puertoDobleNat: { es: 'Hay otro aparato entre tu router e internet: abrir el puerto no alcanza.', en: "There's another device between your router and the internet: opening the port isn't enough." },
  puertoNo: { es: 'Tu router no deja que NAPIA abra el puerto sola.', en: "Your router won't let NAPIA open the port on its own." },
  puertoPorQue: {
    es: 'Igual se baja: sockseek llama a los demás. Si lo abrís, también te pueden llamar ellos y se baja de más gente. En NAPIA, «Ver el detalle» → «Cómo mejorarlo» tiene los pasos para tu router.',
    en: 'It downloads anyway: sockseek calls the others. If you open it, they can call you too and you download from more people. In NAPIA, "See details" → "How to improve it" has the steps for your router.',
  },
  // en común
  repetir: { es: 'Probar de nuevo', en: 'Try again' },
  tardo: { es: 'tardó demasiado', en: 'it took too long' },
})
