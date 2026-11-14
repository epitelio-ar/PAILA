// Los textos de Configuración (claves de internet, diccionario de artistas, pantalla), en castellano y en inglés (ver @paila/shared/idioma).
import { textos, cant } from '@paila/shared/idioma'

export const T = textos({
  // Claves
  usasTuClave: { es: 'Usás tu clave', en: 'You use your own key' },
  claveDePaila: { es: 'Usa la clave que viene con PAILA', en: "Uses the key that comes with PAILA" },
  sinClave: { es: 'Sin clave: no se usa', en: 'No key: not used' },
  probadaEl: { es: (cuando: string) => `Probada el ${cuando}`, en: (cuando: string) => `Tested on ${cuando}` },
  funciona: { es: ' funciona', en: ' works' },
  guardadaYProbada: { es: 'Guardada y probada: funciona.', en: 'Saved and tested: it works.' },
  guardadaFallo: { es: (msg: string) => `Se guardó, pero la prueba falló: ${msg}`, en: (msg: string) => `It was saved, but the test failed: ${msg}` },
  funcionaPunto: { es: 'Funciona.', en: 'It works.' },
  seBorro: { es: 'Se borró tu clave.', en: 'Your key was deleted.' },
  claveApp: { es: 'Clave de aplicación (Consumer Key + Consumer Secret)', en: 'Application key (Consumer Key + Consumer Secret)' },
  codigoPersonal: { es: 'Código personal', en: 'Personal token' },
  codigoPersonalTip: {
    es: "El 'token' que da Discogs en Configuración → Desarrolladores → Generar código personal. Sirve igual para buscar.",
    en: "The 'token' Discogs gives you under Settings → Developers → Generate personal access token. It works just as well for searching.",
  },
  phLastfm: { es: 'API key de Last.fm', en: 'Last.fm API key' },
  phAudd: { es: 'Clave de AudD', en: 'AudD key' },
  phAcoustid: { es: 'Clave de aplicación de AcoustID', en: 'AcoustID application key' },
  phDiscogsToken: { es: 'Código personal de Discogs', en: 'Discogs personal token' },
  guardarYProbar: { es: 'Guardar y probar', en: 'Save and test' },
  probando: { es: 'Probando…', en: 'Testing…' },
  probar: { es: 'Probar', en: 'Test' },
  borrarMiClave: { es: 'Borrar mi clave', en: 'Delete my key' },
  // Diccionario
  seAgregaron: {
    es: (agregados: number, iguales: number, choques: number, ejemplos: string) =>
      `Se agregaron ${cant(agregados, 'nombre', 'nombres')}${iguales ? `; ${iguales} ya los tenías igual` : ''}${choques ? `; ${choques} los tenías distinto y quedaron como los tenías (${ejemplos})` : ''}`,
    en: (agregados: number, iguales: number, choques: number, ejemplos: string) =>
      `${cant(agregados, 'name', 'names')} added${iguales ? `; ${iguales} you already had the same` : ''}${choques ? `; ${choques} you had differently and were left as you had them (${ejemplos})` : ''}`,
  },
  choque: {
    es: (de: string, mio: string, suyo: string) => `${de}: tuyo "${mio}", del archivo "${suyo}"`,
    en: (de: string, mio: string, suyo: string) => `${de}: yours "${mio}", from the file "${suyo}"`,
  },
  origenEdicion: { es: 'lo corregiste a mano', en: 'you corrected it by hand' },
  origenAceptado: { es: 'lo aceptaste', en: 'you accepted it' },
  origenImportado: { es: 'importado', en: 'imported' },
  origenAMano: { es: 'lo agregaste acá', en: 'you added it here' },
  dicIntro: {
    es: 'Cada vez que corregís el nombre de un artista (en la tabla, en Editar varios o aceptando algo de "para mirar a mano"), PAILA se lo acuerda y el asistente **Arreglar nombres y tags** lo propone solo en los demás temas (regla "Tu diccionario de artistas"). Solo aprende correcciones del mismo nombre ("Balvin" → "J Balvin"); si cambiás a otro artista, no. Una línea "X → X" quiere decir "así está bien".',
    en: 'Every time you correct an artist\'s name (in the table, in Edit several, or by accepting something from "to check by hand"), PAILA remembers it and the **Fix names and tags** assistant suggests it by itself on your other tracks (the "Your artist dictionary" rule). It only learns corrections of the same name ("Balvin" → "J Balvin"); if you change it to a different artist, it doesn\'t. A line "X → X" means "this is fine as it is".',
  },
  phComoAparece: { es: 'Como aparece (Balvin)', en: 'As it appears (Balvin)' },
  phComoDebe: { es: 'Como tiene que ser (J Balvin)', en: 'How it should be (J Balvin)' },
  agregar: { es: 'Agregar', en: 'Add' },
  exportar: { es: 'Exportar', en: 'Export' },
  exportarTip: { es: 'Guarda un archivo .json para pasárselo a otra persona o para tenerlo de respaldo', en: 'Saves a .json file to give to someone else or keep as a backup' },
  importar: { es: 'Importar', en: 'Import' },
  importarTip: { es: 'Suma los nombres de un archivo exportado. Los que ya tenés distinto no se pisan.', en: "Adds the names from an exported file. The ones you already have differently aren't overwritten." },
  vacio: { es: 'Todavía está vacío.', en: "It's still empty." },
  buscarDic: { es: 'Buscar en el diccionario', en: 'Search the dictionary' },
  asiEstaBien: { es: '(así está bien)', en: '(this is fine)' },
  sacar: { es: 'Sacar', en: 'Remove' },
  sacarTip: { es: 'Sacar del diccionario (no cambia ningún tema)', en: "Remove from the dictionary (doesn't change any track)" },
  nombres: { es: (c: number) => cant(c, 'nombre', 'nombres'), en: (c: number) => cant(c, 'name', 'names') },
  // La pantalla
  titulo: { es: 'Configuración', en: 'Settings' },
  sub: {
    es: 'Cómo se ve y en qué idioma, el sonido, los respaldos, las claves de internet, tu diccionario de artistas, pasar PAILA a otra compu y las actualizaciones.',
    en: 'How it looks and in which language, the sound, backups, internet keys, your artist dictionary, moving PAILA to another computer and updates.',
  },
  indice: { es: 'Secciones de Configuración', en: 'Settings sections' },
  prenderHerramientas: { es: 'Prender las herramientas', en: 'Turn on the tools' },
  prenderDetalle: {
    es: 'BPM y tono en la tabla y en la ficha, la sección DJ y producción (programas de DJ, armar un set), el botón Cabina y el rango de BPM por género. También está abajo en la barra lateral y en Ctrl+K.',
    en: 'BPM and key in the table and in the track details, the DJ and production section (DJ software, building a set), the Booth button and the BPM range per genre. It is also at the bottom of the sidebar and in Ctrl+K.',
  },
  prenderAviso: {
    es: 'Al prender o apagar, las columnas de la tabla vuelven a las de fábrica (las cambiás con el botón ⋯ de la tabla). Nada se pierde: lo que no se ve en la barra lateral sigue disponible con Ctrl+K.',
    en: 'When you turn them on or off, the table columns go back to the defaults (you change them with the ⋯ button on the table). Nothing is lost: whatever is not shown in the sidebar is still available with Ctrl+K.',
  },
  pantalla: { es: 'Pantalla', en: 'Display' },
  estilo: { es: 'Estilo', en: 'Style' },
  estiloTip: {
    es: 'Cómo se ve PAILA (y NAPIA, que lo hereda). Los dos son oscuros y hacen lo mismo: cambia el dibujo, no lo que podés hacer.',
    en: "How PAILA looks (and NAPIA, which inherits it). Both are dark and do the same thing: the look changes, not what you can do.",
  },
  verRecorrido: { es: 'Ver el recorrido', en: 'Take the tour' },
  recorridoDetalle: { es: 'La oreja te muestra, paso a paso, lo que podés hacer con tu música.', en: 'PAILA shows you, step by step, what you can do with your music.' },
  cabina: { es: 'Modo cabina', en: 'Booth mode' },
  cabinaDetalle: {
    es: 'Fondo negro, texto blanco y letra más grande, para leer de lejos o con poca luz (tocando, en un escenario). Se prende y apaga también con Ctrl+Mayús+C.',
    en: 'Black background, white text and bigger type, to read from far away or in low light (while playing, on a stage). You can also turn it on and off with Ctrl+Shift+C.',
  },
  cabinaTip: {
    es: 'Alto contraste: los textos y los bordes se ven más fuerte, y la letra y las filas de la tabla son más grandes. Solo cambia cómo se ve PAILA en esta PC.',
    en: 'High contrast: text and borders look stronger, and the type and table rows are bigger. It only changes how PAILA looks on this computer.',
  },
  atajoG: { es: 'Ir a una pantalla con G y una letra', en: 'Go to a screen with G and a letter' },
  atajoGDetalle: {
    es: (lista: string) => `Apretás G y después la letra: ${lista}… (la lista entera, con Ctrl+/).`,
    en: (lista: string) => `Press G and then the letter: ${lista}… (the full list, with Ctrl+/).`,
  },
  atajoGTip: {
    es: 'Como en Gmail: dos teclas seguidas, sin Ctrl. No hace nada mientras escribís en un campo. Viene apagado para que nadie cambie de pantalla sin querer.',
    en: "Like in Gmail: two keys in a row, no Ctrl. It does nothing while you type in a field. It comes turned off so nobody changes screen by accident.",
  },
  avanzado: { es: 'Modo avanzado', en: 'Advanced mode' },
  avanzadoDetalle: {
    es: 'Suma a la barra lateral el inspector de un tema (los datos crudos), la cola del análisis, el registro de operaciones y el muestrario de diseño. Para quien programa o usa agentes de código.',
    en: 'Adds to the sidebar the track inspector (the raw data), the analysis queue, the operations log and the design showcase. For people who code or use coding agents.',
  },
  avanzadoTip: {
    es: 'Solo muestra más cosas: no cambia cómo trabaja PAILA ni toca tus archivos. Viene apagado. También se prende y apaga con Ctrl+K.',
    en: "It only shows more things: it doesn't change how PAILA works or touch your files. It comes turned off. You can also turn it on and off with Ctrl+K.",
  },
  reproductor: { es: 'Reproductor', en: 'Player' },
  atajosReproductor: { es: 'Atajos del reproductor', en: 'Player shortcuts' },
  // Servicios
  servicios: { es: 'Servicios de internet', en: 'Internet services' },
  serviciosTip: {
    es: 'PAILA busca nombres oficiales, álbumes y tapas en bases de datos de música. Solo manda el artista, el título y la duración de cada tema (o su huella acústica): nunca tus archivos ni tus carpetas.',
    en: 'PAILA looks up official names, albums and covers in music databases. It only sends the artist, title and length of each track (or its acoustic fingerprint): never your files or your folders.',
  },
  clavesIntro: {
    es: 'Las claves son gratis y las sacás vos en la página de cada servicio. Se guardan **cifradas con tu usuario de Windows**{noCifra} y no se muestran nunca más.',
    en: 'The keys are free and you get them yourself on each service\'s website. They are stored **encrypted with your Windows user**{noCifra} and are never shown again.',
  },
  noCifra: { es: ' (en esta PC no se pudo cifrar: quedan en la base de PAILA)', en: " (on this computer they couldn't be encrypted: they stay in PAILA's database)" },
  sinClaveP: { es: 'no necesita clave', en: 'no key needed' },
  opcional: { es: 'opcional', en: 'optional' },
  mbDetalle: {
    es: 'Base de datos abierta de música: nombres oficiales, alias ("Los Redondos" → Patricio Rey y sus Redonditos de Ricota), álbum y año. Permite un pedido por segundo.',
    en: 'Open music database: official names, aliases ("Los Redondos" → Patricio Rey y sus Redonditos de Ricota), album and year. It allows one request per second.',
  },
  deezerDetalle: {
    es: 'Usar Deezer para confirmar nombres y títulos (como los cargan los sellos). PAILA le pide de a poco, a un ritmo tranquilo.',
    en: 'Use Deezer to confirm names and titles (as the labels enter them). PAILA asks it a little at a time, at a relaxed pace.',
  },
  discogsTip: {
    es: 'Lo mejor para electrónica, cumbia y vinilos. Con clave permite 60 búsquedas por minuto. La clave de aplicación (Consumer Key y Secret) se crea en discogs.com → Configuración → Desarrolladores → Crear una aplicación; el código personal, en la misma página.',
    en: 'Best for electronic music, cumbia and vinyl. With a key it allows 60 searches per minute. The application key (Consumer Key and Secret) is created at discogs.com → Settings → Developers → Create an application; the personal token, on the same page.',
  },
  auddTip: {
    es: "Reconocedor tipo Shazam: escucha 15 segundos del medio del tema. Solo se usa para los temas sin nombre que no reconocieron MusicBrainz, Deezer, Discogs ni AcoustID. Lo que encuentra va a 'para mirar a mano'. La clave se saca en audd.io (Dashboard); es un servicio pago por uso.",
    en: "A Shazam-style recognizer: it listens to 15 seconds from the middle of the track. It's only used for unnamed tracks that MusicBrainz, Deezer, Discogs and AcoustID didn't recognize. What it finds goes to 'to check by hand'. You get the key at audd.io (Dashboard); it's a pay-per-use service.",
  },
  auddDetalle: {
    es: 'Usar AudD para los temas que nada más reconoció. **Manda 15 segundos de audio de cada uno** a AudD (no el archivo entero ni su nombre).',
    en: 'Use AudD for the tracks nothing else recognized. **It sends 15 seconds of audio from each one** to AudD (not the whole file or its name).',
  },
  acoustidTip: {
    es: 'Reconoce un tema por su sonido (su huella acústica), aunque no tenga nombre ni tags. La clave de aplicación se pide gratis en acoustid.org → Applications → Register.',
    en: 'Recognizes a track by its sound (its acoustic fingerprint), even if it has no name or tags. The application key is free at acoustid.org → Applications → Register.',
  },
  lastfmTip: {
    es: "Las etiquetas que la gente le pone a cada tema y a cada artista en Last.fm. PAILA las usa para proponer el género, junto con los estilos de Discogs, y solo toma las que son géneros (nada de 'seen live' o 'favorites'). Sin esta clave, los géneros salen solo de Discogs. La clave (API key) se pide gratis en last.fm/api/account/create: con nombre y descripción alcanza; la 'Shared secret' no hace falta.",
    en: "The tags people put on each track and each artist on Last.fm. PAILA uses them to suggest the genre, together with Discogs styles, and only takes the ones that are genres (no 'seen live' or 'favorites'). Without this key, genres come only from Discogs. The key (API key) is free at last.fm/api/account/create: a name and a description are enough; the 'Shared secret' isn't needed.",
  },
  lastfmDetalle: {
    es: 'Para proponer el género de los temas que no lo tienen (Completar desde internet → Género). Se manda solo el artista y el título.',
    en: 'To suggest the genre of tracks that have none (Fill in from the internet → Genre). Only the artist and the title are sent.',
  },
  dicTitulo: { es: 'Diccionario de artistas', en: 'Artist dictionary' },
  dicTip: { es: 'Tus correcciones de nombres de artistas, para que PAILA las aplique sola en los demás temas.', en: "Your corrections to artist names, so PAILA applies them by itself on your other tracks." },
  bpmTitulo: { es: 'Rango de BPM por género', en: 'BPM range per genre' },
  paraDjs: { es: 'para DJs', en: 'for DJs' },
  bpmTip: {
    es: 'BPM: golpes por minuto, la velocidad del tema. Los programas que lo calculan a veces dan el doble o la mitad del real; acá elegís en qué rango tiene que quedar cada estilo.',
    en: "BPM: beats per minute, the speed of the track. Programs that calculate it sometimes give double or half the real value; here you choose which range each style should land in.",
  },
})
