// Los textos de la sección Separar voz (SepararVoz.tsx), en castellano e inglés. Los nombres de los archivos que PAILA
// escribe («(Acapella)», «Acapellas e instrumentales (PAILA)») no se traducen: los arma core/stems/separar.ts.
import { cant, textos } from '@paila/shared/idioma'

export const T = textos({
  titulo: { es: 'Separar voz', en: 'Separate vocals' },
  escucharlo: { es: 'Tocá para escucharlo', en: 'Click to play it' },
  intro: {
    es: 'Saca la **acapella** y el **instrumental** de uno o pocos temas, o los separa en **4 partes**: voz, batería, bajo e instrumental. El tema original no se toca: lo separado va a su propia carpeta y se puede deshacer desde acá o desde el Historial.',
    en: 'Takes the **acapella** and the **instrumental** out of one or a few tracks, or splits them into **4 parts**: vocals, drums, bass and instrumental. The original track is never touched: what you separate goes to its own folder and can be undone here or from the History.',
  },
  introTip: {
    es: 'Lo hace un modelo de inteligencia artificial que corre en tu compu, sin internet: MDX-Net Inst_HQ_3, entrenado por el equipo de Ultimate Vocal Remover (Anjok07 y aufr33), con licencia MIT. Cada tema tarda unas dos veces lo que dura, así que conviene de a pocos. Medido contra las acapellas oficiales de un disco, la voz sale muy parecida a la original.',
    en: 'An artificial intelligence model does it, running on your computer, offline: MDX-Net Inst_HQ_3, trained by the Ultimate Vocal Remover team (Anjok07 and aufr33), MIT license. Each track takes about twice its length, so it works best a few at a time. Measured against the official acapellas of an album, the vocals come out very close to the original.',
  },
  // el modelo
  faltaModelo: { es: (mb: string) => `Primero hay que bajar el modelo y el motor que lo corre: se bajan una sola vez (${mb}) y quedan en tu compu.`, en: (mb: string) => `First you need to download the model and the engine that runs it: they're downloaded only once (${mb}) and stay on your computer.` },
  bajar: { es: (mb: string) => `Bajar (${mb})`, en: (mb: string) => `Download (${mb})` },
  modeloTip: {
    es: 'Se bajan de su lugar original y PAILA revisa que lleguen idénticos (con su huella) antes de usarlos: el modelo, de las descargas de Ultimate Vocal Remover (MIT); el motor, onnxruntime de Microsoft (MIT), que corre en el procesador. No viajan con el instalador para que no pese de más a quien no los usa.',
    en: "They're downloaded from their original place and PAILA checks they arrive identical (by their fingerprint) before using them: the model, from the Ultimate Vocal Remover downloads (MIT); the engine, Microsoft's onnxruntime (MIT), which runs on the processor. They don't come with the installer so it isn't heavier for people who don't use them.",
  },
  modeloListo: { es: 'Modelo listo. {quitar}', en: 'Model ready. {quitar}' },
  quitar: { es: 'Quitarlo', en: 'Remove it' },
  megas: { es: 'MB', en: 'MB' },
  // la carpeta
  vaA: { es: 'Lo separado va a **{carpeta}**. {info}', en: 'What you separate goes to **{carpeta}**. {info}' },
  carpetaTip: {
    es: 'Una carpeta adentro de tu Música, que cuenta como Producción: PAILA nunca la renombra ni la reorganiza, y Duplicados no la compara con tus temas. Cada archivo se llama «Artista - Título (Acapella) 95 BPM Am.flac»: el BPM y el tono van en el nombre, como se acostumbra con las acapellas. En FLAC de 24 bits, sin pérdida, con los tags y la tapa del original.',
    en: 'A folder inside your Music that counts as Production: PAILA never renames or reorganizes it, and Duplicates doesn\'t compare it with your tracks. Each file is named «Artist - Title (Acapella) 95 BPM Am.flac»: the BPM and key go in the name, as is usual with acapellas. In 24-bit FLAC, lossless, with the original\'s tags and cover.',
  },
  cambiar: { es: 'Cambiar', en: 'Change' },
  deFabrica: { es: 'Volver a la de fábrica', en: 'Back to the default' },
  abrirCarpeta: { es: 'Abrir la carpeta', en: 'Open the folder' },
  // elegir temas
  elegir: { es: 'Elegir temas', en: 'Choose tracks' },
  buscar: { es: 'Buscá por artista, título o nombre del archivo', en: 'Search by artist, title or file name' },
  arrastrar: { es: 'También podés arrastrar temas de la Biblioteca hasta «Separar voz», en la barra de la izquierda.', en: 'You can also drag tracks from the Library onto «Separate vocals», in the left bar.' },
  nada: { es: 'No hay temas con eso.', en: 'No tracks match that.' },
  separar: { es: 'Separar', en: 'Separate' },
  enCola: { es: 'En la cola', en: 'In the queue' },
  notaTip: { es: 'La nota de calidad del archivo (de A+ a F). Con un archivo en baja calidad la separación sale peor.', en: 'The quality grade of the file (A+ to F). With a low-quality file the separation comes out worse.' },
  // baja calidad
  bajaUno: {
    es: (nombre: string, nota: string) => `**${nombre}** está en nota ${nota}: la separación sale un poco peor que con una versión buena. ¿Lo mandás a la lista «Faltan o suenan mal» y lo separás cuando llegue uno mejor?`,
    en: (nombre: string, nota: string) => `**${nombre}** is graded ${nota}: the separation comes out a bit worse than with a good version. Send it to the "Missing or low quality" list and separate it when a better one arrives?`,
  },
  bajaVarios: {
    es: (n: number) => `${cant(n, 'tema está', 'temas están')} en baja calidad (nota D o F): la separación sale un poco peor que con una versión buena. ¿Los mandás a la lista «Faltan o suenan mal» y los separás cuando lleguen mejores?`,
    en: (n: number) => `${cant(n, 'track is', 'tracks are')} in low quality (grade D or F): the separation comes out a bit worse than with a good version. Send them to the "Missing or low quality" list and separate them when better ones arrive?`,
  },
  bajaTip: {
    es: 'Medido con un disco contra sus partes oficiales: un MP3 de 320 o de 192 separa igual que el original sin pérdida. Uno de 128 (nota D), o uno de 128 inflado a 320 (nota F), saca la voz y el instrumental un poco menos limpios; uno de 96 (nota F), bastante más. No es dramático: si no conseguís uno mejor, separalo igual.',
    en: 'Measured on an album against its official parts: a 320 or 192 MP3 separates the same as the lossless original. A 128 one (grade D), or a 128 one inflated to 320 (grade F), gets slightly less clean vocals and instrumental; a 96 one (grade F), noticeably more. It isn\'t dramatic: if you can\'t find a better one, separate it anyway.',
  },
  buscarMejor: { es: 'Buscar uno mejor', en: 'Find a better one' },
  separarIgual: { es: 'Separar igual', en: 'Separate anyway' },
  // la cola
  cola: { es: 'Separando', en: 'Separating' },
  unidad: { es: 'pedazos', en: 'chunks' },
  cortar: { es: 'Cortar', en: 'Stop' },
  sacar: { es: 'Sacar', en: 'Remove' },
  tarda: { es: (min: number) => `unos ${min} min`, en: (min: number) => `about ${min} min` },
  ahora: { es: 'ahora', en: 'now' },
  // esperando
  esperando: { es: 'Esperando uno mejor', en: 'Waiting for a better one' },
  esperandoTip: {
    es: 'Están en la lista «Faltan o suenan mal». Cuando reemplaces el archivo por uno mejor (por ejemplo, con la Bandeja), la nota cambia y lo podés separar.',
    en: 'They\'re on the "Missing or low quality" list. When you replace the file with a better one (for example, with the Inbox), its grade changes and you can separate it.',
  },
  desde: { es: (d: string) => `desde el ${d}`, en: (d: string) => `since ${d}` },
  // lo separado
  hechos: { es: 'Ya separados', en: 'Already separated' },
  ningunoHecho: { es: 'Todavía no separaste ningún tema.', en: "You haven't separated any track yet." },
  acapella: { es: 'Acapella', en: 'Acapella' },
  bateria: { es: 'Batería', en: 'Drums' },
  bajo: { es: 'Bajo', en: 'Bass' },
  resto: { es: 'Instrumental', en: 'Instrumental' },
  separarEn: { es: 'Separar en:', en: 'Separate into:' },
  modoVoz: { es: 'Voz e instrumental', en: 'Vocals and instrumental' },
  modoCuatro: { es: '4 partes: voz, batería, bajo e instrumental', en: '4 parts: vocals, drums, bass and instrumental' },
  modoMax: { es: '4 partes, máxima calidad', en: '4 parts, maximum quality' },
  maxTip: {
    es: 'Lo mismo que en 4 partes, con cuatro modelos especialistas (uno por parte) en vez de uno: la voz y la batería salen un poco más limpias. Tarda bastante más: unas cinco veces y media lo que dura el tema y los modelos pesan 1,26 GB.',
    en: 'The same as 4 parts, with four specialist models (one per part) instead of one: vocals and drums come out a bit cleaner. It takes much longer: about five and a half times the length of the track and the models weigh 1.26 GB.',
  },
  faltaMax: { es: (mb: string) => `Para la máxima calidad hacen falta cuatro modelos más, opcionales: se bajan una sola vez (${mb}) y quedan en tu compu.`, en: (mb: string) => `For maximum quality you need four more, optional models: they're downloaded only once (${mb}) and stay on your computer.` },
  listoMax: { es: 'Modelos de máxima calidad listos. {quitar}', en: 'Maximum quality models ready. {quitar}' },
  enMax: { es: 'en 4, máxima calidad', en: 'in 4, maximum quality' },
  modoTip: {
    es: 'Voz e instrumental: la acapella y la pista sin voz (MDX-Net, de UVR). En 4 partes: voz, batería, bajo e instrumental (guitarras, teclados, sintes y lo demás), con HT-Demucs v4, de Meta (licencia MIT). Cada tema tarda más o menos lo que dura, y se separa en tu compu, sin internet.',
    en: 'Vocals and instrumental: the acapella and the track without vocals (MDX-Net, from UVR). In 4 parts: vocals, drums, bass and instrumental (guitars, keys, synths and everything else), with HT-Demucs v4, from Meta (MIT license). Each track takes about as long as it lasts, and it is separated on your computer, offline.',
  },
  falta4: { es: (mb: string) => `Para separar en 4 partes hace falta otro modelo, opcional: se baja una sola vez (${mb}) y queda en tu compu.`, en: (mb: string) => `To separate into 4 parts you need another, optional model: it's downloaded only once (${mb}) and stays on your computer.` },
  listo4: { es: 'Modelo de 4 partes listo. {quitar}', en: '4-part model ready. {quitar}' },
  enCuatro: { es: 'en 4', en: 'in 4' },
  instrumental: { es: 'Instrumental', en: 'Instrumental' },
  escuchar: { es: (que: string) => `Escuchar: ${que}`, en: (que: string) => `Listen: ${que}` },
  mostrar: { es: 'Mostrar en la carpeta', en: 'Show in folder' },
  deshacer: { es: 'Deshacer', en: 'Undo' },
  deshacerPreg: { es: (n: string) => `¿Mandar la acapella y el instrumental de «${n}» a la papelera de PAILA? El tema original sigue igual.`, en: (n: string) => `Send the acapella and the instrumental of «${n}» to PAILA's trash? The original track stays the same.` },
  deshecho: { es: (n: number) => `${cant(n, 'archivo fue', 'archivos fueron')} a la papelera de PAILA`, en: (n: number) => `${cant(n, 'file went', 'files went')} to PAILA's trash` },
  desconectado: { es: 'Disco no conectado', en: 'Disk not connected' },
})
