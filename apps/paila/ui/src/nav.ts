// Mapa de la navegación: una sola lista con las pantallas, su ícono y su ayuda. La barra lateral y App.tsx la usan.
import { tr } from '@paila/shared/idioma'
import type { IconName } from './icons'

export type PageKey =
  | 'home' | 'escuchando' | 'library' | 'progress' | 'stats' | 'problemas'
  | 'ordenar' | 'tidy' | 'online' | 'dups' | 'organize'
  | 'requests' | 'inbox' | 'wishlist' | 'albums' | 'volumen' | 'space'
  | 'playlists' | 'rekordbox' | 'setbuilder' | 'separar' | 'folderpl' | 'trash' | 'history' | 'settings'
  | 'carry' | 'tracklist' | 'comprimidos'
  | 'silencios'  // recortar silencios (en Sonido y desde el Centro de problemas)
  | 'sonido'  // Sonido, una sola historia (MASTERPLAN-5, etapa 5): suena mal → NAPIA → llegó → aplicar
  | 'ficha'  // la ficha de un tema en grande (desde el panel o desde Escuchando)
  | 'muestrario'  // pantalla oculta de desarrollo (Ctrl+Mayús+M)
  | 'inspector' | 'cola' | 'registro'  // el modo avanzado (avanzado.ts)

export interface NavItem { page: PageKey; label: string; icon: IconName; help: string }

/** Lo de arriba de todo. */
export const NAV_TOP: NavItem[] = [
  { page: 'home', label: tr({ es: 'Inicio', en: 'Home' }), icon: 'home', help: tr({ es: 'El estado de tu biblioteca de un vistazo', en: 'Your library at a glance' }) },
  { page: 'escuchando', label: tr({ es: 'Escuchando', en: 'Now playing' }), icon: 'play', help: tr({ es: 'Lo que suena, en grande: la tapa, la forma de onda y la cola', en: "What's playing, big: the cover, the waveform and the queue" }) },
  { page: 'problemas', label: tr({ es: 'Centro de problemas', en: 'Problem center' }), icon: 'alert', help: tr({ es: 'Lo que PAILA encontró en tu Música (calidad falsa, sin tags, formatos que no se leen…), en grupos y con el arreglo de cada uno a un clic', en: "What PAILA found in your Music (fake quality, missing tags, formats that can't be read…), grouped, with the fix for each one a click away" }) },
  { page: 'progress', label: tr({ es: 'Análisis', en: 'Analysis' }), icon: 'activity', help: tr({ es: 'Qué se está analizando, con curiosidades de tu biblioteca', en: "What's being analyzed, plus fun facts about your library" }) },
  // "Estadísticas" (antes "Tu colección"): "colección" ya nombra a Música, Producción, Inéditos… (DECISIONES, 24/10)
  { page: 'stats', label: tr({ es: 'Estadísticas', en: 'Stats' }), icon: 'chart', help: tr({ es: 'Tu música por década, género y formato, los artistas con más discos y cuánto está en calidad de CD o mejor', en: 'Your music by decade, genre and format, the artists with the most albums, and how much is CD quality or better' }) },
  { page: 'space', label: tr({ es: 'Espacio', en: 'Space' }), icon: 'pie', help: tr({ es: 'Qué ocupa el disco, coloreado por calidad; archivos que no son música; cuánto se puede ahorrar', en: "What's taking up the disk, colored by quality; files that aren't music; how much you can save" }) },
]

/** Grupos de herramientas = las pestañas Ordenar, Sonido, Llevar y DJ (secciones.ts reparte las pantallas; Inicio y Tu música
 * salen de NAV_TOP). Sonido = el camino
 * conseguir → reemplazar, el volumen parejo y los silencios (reordenado el 22/10; nombres y lugares repasados el 24/10, ver DECISIONES). */
export const NAV_GROUPS: { id: string; title: string; items: NavItem[] }[] = [
  {
    id: 'order', title: tr({ es: 'Ordenar', en: 'Organize' }),
    items: [
      { page: 'ordenar', label: tr({ es: 'Ordenar todo', en: 'Organize everything' }), icon: 'wand', help: tr({ es: 'Todo lo que PAILA propone para tu música (repetidos, nombres, internet, tapas y carpetas) en una sola lista, con lo dudoso aparte y un solo Aplicar', en: 'Everything PAILA suggests for your music (repeats, names, internet, covers and folders) in a single list, with the doubtful things apart and a single Apply' }) },
      { page: 'tidy', label: tr({ es: 'Arreglar nombres y tags', en: 'Fix names and tags' }), icon: 'wand', help: tr({ es: '1. Completa tags y limpia nombres de toda la Música, con vista previa', en: '1. Fills in tags and cleans up names across your whole Music, with a preview' }) },
      { page: 'online', label: tr({ es: 'Completar desde internet', en: 'Fill in from the internet' }), icon: 'globe', help: tr({ es: '2. Nombres oficiales, álbum, año, género y tapas desde MusicBrainz, Deezer, Discogs, Last.fm y AcoustID (necesita internet)', en: '2. Official names, album, year, genre and covers from MusicBrainz, Deezer, Discogs, Last.fm and AcoustID (needs internet)' }) },
      { page: 'dups', label: tr({ es: 'Duplicados', en: 'Duplicates' }), icon: 'copy', help: tr({ es: '3. El mismo archivo o el mismo tema repetido: te quedás con el mejor', en: '3. The same file or the same track more than once: you keep the best one' }) },
      { page: 'organize', label: tr({ es: 'Organizar carpetas', en: 'Organize folders' }), icon: 'tree', help: tr({ es: '4. Acomoda tu Música en carpetas según los tags, con vista previa y deshacer', en: '4. Arranges your Music into folders based on the tags, with a preview and undo' }) },
      { page: 'albums', label: tr({ es: 'Discos y tapas', en: 'Albums and covers' }), icon: 'disc', help: tr({ es: 'Qué temas le faltan a cada disco y tapas en buena resolución', en: 'Which tracks each album is missing, and covers in good resolution' }) },
      { page: 'comprimidos', label: tr({ es: 'ZIP y RAR', en: 'ZIP and RAR' }), icon: 'folder', help: tr({ es: 'La música que tenés guardada en .zip o .rar sin abrir: verla, escucharla y analizarla sin descomprimir todo, y sacarla a una carpeta al lado (con deshacer)', en: 'The music you keep in unopened .zip or .rar files: see it, listen to it and analyze it without unpacking everything, and extract it to a folder next to it (with undo)' }) },
    ],
  },
  {
    // "Mejorar el sonido" (antes "Mejorar la calidad"): además de conseguir mejores versiones, tiene el volumen y los silencios.
    // El camino conseguir → Bandeja va primero, en el orden en que se usa (DECISIONES, 24/10).
    id: 'quality', title: tr({ es: 'Sonido', en: 'Sound' }),
    items: [
      { page: 'sonido', label: tr({ es: 'Sonido de un vistazo', en: 'Sound at a glance' }), icon: 'speaker', help: tr({ es: 'Lo que suena mal, lo que te falta y lo que llegó, en un solo lugar: se lo mandás a NAPIA, ves cómo baja y aplicás sin cambiar de ventana', en: "What sounds bad, what you're missing and what arrived, in one place: you send it to NAPIA, watch it download and apply without switching windows" }) },
      { page: 'wishlist', label: tr({ es: 'Faltan o suenan mal', en: 'Missing or low quality' }), icon: 'heart', help: tr({ es: 'Los temas que conviene conseguir en mejor calidad (o que te faltan), para exportar en .txt o .csv', en: "The tracks worth getting in better quality (or that you're missing), to export as .txt or .csv" }) },
      { page: 'inbox', label: tr({ es: 'Bandeja', en: 'Inbox' }), icon: 'inbox', help: tr({ es: 'La carpeta vigilada: lo que llega se reconoce por cómo suena y se verifica; si es mejor, queda propuesto en Sonido de un vistazo', en: 'The watched folder: whatever arrives is recognized by how it sounds and checked; if it is better, it is proposed in Sound at a glance' }) },
      { page: 'volumen', label: tr({ es: 'Volumen parejo', en: 'Even volume' }), icon: 'speaker', help: tr({ es: 'Que todos tus temas suenen al mismo volumen en los reproductores que lo usan (ReplayGain), sueltos o en disco. Solo se guarda un dato en el tag: el sonido no se toca', en: "Make all your tracks play at the same volume in players that support it (ReplayGain), single tracks or whole albums. Only a value is saved in the tag: the sound itself isn't touched" }) },
      { page: 'silencios', label: tr({ es: 'Recortar silencios', en: 'Trim silences' }), icon: 'scissors', help: tr({ es: 'Que tus temas no tarden en arrancar ni queden callados al final: PAILA corta el silencio largo, sin perder calidad y con vista previa', en: "So your tracks don't take long to start or stay silent at the end: PAILA cuts the long silence, without losing quality and with a preview" }) },
    ],
  },
  {
    id: 'carry', title: tr({ es: 'Llevar', en: 'Take along' }),
    items: [
      { page: 'requests', label: tr({ es: 'Traer una lista', en: 'Bring in a list' }), icon: 'import', help: tr({ es: 'Una playlist de otro programa o página (un .csv, un .m3u o una lista en texto): PAILA la arma con lo que tenés y lo que falta va a la lista «Faltan o suenan mal»', en: "A playlist from another program or website (a .csv, an .m3u or a plain-text list): PAILA builds it from what you have, and what's missing goes to the \"Missing or low quality\" list" }) },
      { page: 'folderpl', label: tr({ es: 'Carpetas → Playlists', en: 'Folders → Playlists' }), icon: 'layers', help: tr({ es: 'Convierte tus carpetas-playlist en playlists de verdad, sin mover ni copiar archivos', en: 'Turns your playlist folders into real playlists, without moving or copying files' }) },
      { page: 'carry', label: tr({ es: 'Llevar la música', en: 'Take your music along' }), icon: 'send', help: tr({ es: 'Al celular (en AAC o MP3, ocupa menos), al auto o a un pendrive, a otros programas de la compu (.m3u8) o a tu servidor casero (Plex, Jellyfin, Navidrome)', en: 'To your phone (as AAC or MP3, takes less space), to the car or a USB drive, to other programs on your computer (.m3u8) or to your home server (Plex, Jellyfin, Navidrome)' }) },
    ],
  },
  {
    // "DJ y producción" (antes "Para DJs"): el mismo nombre que el interruptor que lo muestra. Separar voz vive solo acá:
    // es para uno o pocos temas, sin atajo desde el tema (el autor, 24/10).
    id: 'dj', title: tr({ es: 'DJ y producción', en: 'DJ and production' }),
    items: [
      // "Programas de DJ" (antes "Rekordbox y cabina"): ya trae y lleva a cinco programas, no solo a Rekordbox
      { page: 'rekordbox', label: tr({ es: 'Programas de DJ', en: 'DJ software' }), icon: 'headphones', help: tr({ es: 'Compatibilidad con tu equipo, traer lo de Rekordbox y Serato, grilla y cue points, y exportar a Rekordbox, Traktor, Serato, VirtualDJ o Engine DJ', en: "Compatibility with your gear, bring in what's in Rekordbox and Serato, beat grid and cue points, and export to Rekordbox, Traktor, Serato, VirtualDJ or Engine DJ" }) },
      { page: 'setbuilder', label: tr({ es: 'Armar un set', en: 'Build a set' }), icon: 'chart', help: tr({ es: 'La curva de energía de una playlist, cómo pega cada tema con el siguiente (tono, BPM y energía) y qué poner después', en: "A playlist's energy curve, how well each track flows into the next (key, BPM and energy) and what to play after" }) },
      { page: 'separar', label: tr({ es: 'Separar voz', en: 'Separate vocals' }), icon: 'layers', help: tr({ es: 'La acapella y el instrumental de uno o pocos temas, con un modelo que se baja aparte. Lo separado va a su carpeta y se puede deshacer', en: 'The acapella and the instrumental of one or a few tracks, with a model downloaded separately. What you separate goes to its own folder and can be undone' }) },
      { page: 'tracklist', label: tr({ es: 'Tracklist de sets', en: 'Set tracklists' }), icon: 'list', help: tr({ es: 'Un set, un enganchado o un recital en un solo archivo: PAILA lo escucha y dice qué temas suenan y desde qué minuto', en: 'A DJ set, a mix or a live show in a single file: PAILA listens to it and tells you which tracks play and from what minute' }) },
    ],
  },
]

/** Todas las playlists con sus tapas: se entra desde «Ver todas» de la barra lateral (no es un renglón de la barra). */
export const NAV_PLAYLISTS: NavItem = { page: 'playlists', label: tr({ es: 'Playlists', en: 'Playlists' }), icon: 'list', help: tr({ es: 'Todas tus playlists con sus tapas: buscar, ordenar, fijar las que más usás, fusionar y borrar', en: 'All your playlists with their covers: search, sort, pin the ones you use most, merge and delete' }) }
export const NAV_TRASH: NavItem = { page: 'trash', label: tr({ es: 'Papelera', en: 'Trash' }), icon: 'trash', help: tr({ es: 'Lo que mandaste con PAILA: se puede restaurar', en: 'What you sent there with PAILA: it can be restored' }) }
export const NAV_HISTORY: NavItem = { page: 'history', label: tr({ es: 'Historial', en: 'History' }), icon: 'history', help: tr({ es: 'Todo lo que PAILA hizo en tus archivos, del más nuevo al más viejo, con Deshacer en cada tanda', en: 'Everything PAILA did to your files, newest first, with Undo on each batch' }) }
export const NAV_SETTINGS: NavItem = { page: 'settings', label: tr({ es: 'Configuración', en: 'Settings' }), icon: 'gear', help: tr({ es: 'Las herramientas para DJ, el estilo y el idioma, el sonido (bit perfect), los respaldos, las claves de internet, tu diccionario de artistas, pasar PAILA a otra compu y las actualizaciones', en: 'The DJ tools, style and language, the sound (bit perfect), backups, internet keys, your artist dictionary, moving PAILA to another computer and updates' }) }

/** Lo que suma el modo avanzado (apagado de fábrica): se ve en la barra lateral y en Ctrl+K solo si está prendido. */
export const NAV_AVANZADO: NavItem[] = [
  { page: 'inspector', label: tr({ es: 'Inspeccionar un tema', en: 'Inspect a track' }), icon: 'search', help: tr({ es: 'Todo lo que PAILA ve y decide de un tema, con los datos crudos (lo mismo que «npm run tema»)', en: 'Everything PAILA sees and decides about a track, with the raw data (same as «npm run tema»)' }) },
  { page: 'cola', label: tr({ es: 'Cola del análisis', en: 'Analysis queue' }), icon: 'queue', help: tr({ es: 'Qué espera el análisis, pasada por pasada, y qué temas no se pudieron leer', en: "What the analysis has waiting, pass by pass, and which tracks couldn't be read" }) },
  { page: 'registro', label: tr({ es: 'Registro de operaciones', en: 'Operations log' }), icon: 'history', help: tr({ es: 'El diario de lo que PAILA hizo (o dejó a medias) sobre tus archivos, y los últimos errores', en: 'The log of what PAILA did (or left half-done) to your files, and the latest errors' }) },
  { page: 'muestrario', label: tr({ es: 'Muestrario de diseño', en: 'Design showcase' }), icon: 'sparkle', help: tr({ es: 'Todos los componentes de PAILA y NAPIA en todos sus estados, en los dos estilos y en cabina', en: 'Every PAILA and NAPIA component in all its states, in both styles and in booth mode' }) },
]

/** Las secciones de Configuración: el índice de arriba de esa pantalla y Ctrl+K llevan directo a cada una (repaso del 24/10:
 * Idioma, Respaldos o Pasar a otra compu quedaban al fondo de una página larga, sin otra forma de llegar). `id` es el ancla en
 * Settings.tsx; `soloDj`, la sección que se ve solo con las herramientas para DJ prendidas. */
export const CONFIG_SECCIONES: { id: string; label: string; help: string; soloDj?: boolean }[] = [
  { id: 'cfg-dj', label: tr({ es: 'Herramientas para DJ', en: 'DJ tools' }), help: tr({ es: 'Prender o apagar el BPM, el tono, los programas de DJ y armar un set', en: 'Turn BPM, key, DJ software and set building on or off' }) },
  { id: 'cfg-pantalla', label: tr({ es: 'Pantalla', en: 'Display' }), help: tr({ es: 'El estilo (historieta o sobrio), el idioma, el modo cabina y el recorrido', en: 'The style (comic or studio), the language, booth mode and the tour' }) },
  { id: 'cfg-reproductor', label: tr({ es: 'Reproductor', en: 'Player' }), help: tr({ es: 'Por dónde sale el sonido y la salida bit perfect', en: 'Where the sound goes out and bit perfect output' }) },
  { id: 'cfg-respaldos', label: tr({ es: 'Respaldos', en: 'Backups' }), help: tr({ es: 'Las copias de tus archivos que PAILA guarda antes de cambiarlos', en: 'The copies of your files PAILA keeps before changing them' }) },
  { id: 'cfg-internet', label: tr({ es: 'Servicios de internet', en: 'Internet services' }), help: tr({ es: 'Las claves de Discogs, AcoustID, AudD y Last.fm', en: 'The keys for Discogs, AcoustID, AudD and Last.fm' }) },
  { id: 'cfg-diccionario', label: tr({ es: 'Diccionario de artistas', en: 'Artist dictionary' }), help: tr({ es: 'Cómo se escribe cada artista (Balvin → J Balvin)', en: 'How each artist is spelled (Balvin → J Balvin)' }) },
  { id: 'cfg-bpm', label: tr({ es: 'Rango de BPM por género', en: 'BPM range per genre' }), help: tr({ es: 'Entre qué BPM va cada género, para corregir el doble o la mitad', en: 'Which BPM each genre sits between, to fix double or half tempo' }), soloDj: true },
  { id: 'cfg-mudanza', label: tr({ es: 'Pasar a otra compu', en: 'Move to another computer' }), help: tr({ es: 'Llevar PAILA entero a otra compu o de Windows a Mac', en: 'Take all of PAILA to another computer, or from Windows to Mac' }) },
  { id: 'cfg-actualizaciones', label: tr({ es: 'Actualizaciones', en: 'Updates' }), help: tr({ es: 'Qué versión tenés, qué hay de nuevo y buscar la próxima', en: "Which version you have, what's new and looking for the next one" }) },
  { id: 'cfg-chequeo', label: tr({ es: 'Chequeo', en: 'Health check' }), help: tr({ es: 'Revisar lo que le puede impedir andar a PAILA, con el arreglo de cada cosa', en: 'Check what can keep PAILA from working, with the fix for each thing' }) },
  { id: 'cfg-notas', label: tr({ es: 'Notas de uso', en: 'Usage notes' }), help: tr({ es: 'Lo que anotaste con el botón Anotar, con la pantalla y una captura', en: 'What you noted with the Note button, with the screen and a screenshot' }) },
  { id: 'cfg-diagnostico', label: tr({ es: 'Si algo anda mal', en: 'If something goes wrong' }), help: tr({ es: 'Exportar el diagnóstico para mandárselo a quien te ayuda', en: 'Export the diagnostics to send to whoever helps you' }) },
]

/** Lleva a una sección de Configuración (desde Ctrl+K o el índice). `irA` cambia de pantalla si hace falta; después salta hasta el
 * ancla, sin animación (el desplazamiento suave no avanza con la ventana oculta y molesta a quien apagó las animaciones). */
export function irASeccion(id: string, irA?: () => void) {
  irA?.()
  setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), irA ? 200 : 0)
}

/**
 * Recargar la ventana sin perder dónde estabas (cambiar el idioma recarga para que todos los textos salgan en el nuevo): se
 * anota la pantalla y la sección y, al volver, PAILA abre ahí. Antes mandaba al Inicio (prueba de la persona 1, 31/10). Vale unos
 * segundos: un arranque de verdad, más tarde, empieza en el Inicio como siempre.
 */
const VOLVER = 'paila.volverA'
export function recargarEn(page: PageKey, seccion?: string) {
  try { sessionStorage.setItem(VOLVER, JSON.stringify({ page, seccion, at: Date.now() })) } catch { /* sin almacenamiento: va al Inicio */ }
  location.reload()
}
/** La pantalla a la que hay que volver después de `recargarEn` (y lleva a la sección), o null. */
export function paginaAlRecargar(): PageKey | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(VOLVER) ?? 'null') as { page: PageKey; seccion?: string; at: number } | null
    if (!v || Date.now() - v.at > 15_000) return null
    if (v.seccion) irASeccion(v.seccion, () => {})
    return v.page
  } catch { return null }
}
