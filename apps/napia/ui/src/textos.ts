// Las palabras de NAPIA (las mismas que PAILA, docs/GLOSARIO.md), en castellano y en inglés (ver @paila/shared/idioma): cómo se dice cada estado de un tema y las ⓘ de los términos.
import type { TonoPildora } from '@paila/diseno'
import type { TrackState } from '@paila/shared/napia'
import { num, textos } from '@paila/shared/idioma'

const E = textos({
  espera: { es: 'En espera', en: 'Waiting' },
  buscando: { es: 'Buscando', en: 'Searching' },
  bajando: { es: 'Bajando', en: 'Downloading' },
  bajado: { es: 'Bajado', en: 'Downloaded' },
  yaEstaba: { es: 'Ya estaba', en: 'Already had it' },
  noEncontrado: { es: 'No se encontró', en: 'Not found' },
  fallo: { es: 'No se pudo', en: "Couldn't get it" },
  cancelado: { es: 'Cortado', en: 'Stopped' },
})

export const ESTADO: Record<TrackState, { tone: TonoPildora; label: string }> = {
  espera: { tone: 'neutro', get label() { return E.espera } },
  buscando: { tone: 'neutro', get label() { return E.buscando } },
  bajando: { tone: 'acento', get label() { return E.bajando } },
  bajado: { tone: 'ok', get label() { return E.bajado } },
  yaEstaba: { tone: 'info', get label() { return E.yaEstaba } },
  noEncontrado: { tone: 'atencion', get label() { return E.noEncontrado } },
  fallo: { tone: 'error', get label() { return E.fallo } },
  cancelado: { tone: 'neutro', get label() { return E.cancelado } },
}

export const TIP = textos({
  sockseek: {
    es: 'El programa que busca y baja de Soulseek. NAPIA no baja nada: le arma la lista a sockseek, lo corre y te muestra cómo va.',
    en: "The program that searches and downloads from Soulseek. NAPIA doesn't download anything: it builds the list for sockseek, runs it and shows you how it's going.",
  },
  soulseek: {
    es: 'Una red donde la gente comparte su música, compu a compu. Se entra con una cuenta (usuario y contraseña).',
    en: 'A network where people share their music, computer to computer. You sign in with an account (username and password).',
  },
  config: {
    es: 'El archivo donde sockseek guarda tu cuenta de Soulseek y sus preferencias (sockseek.conf). NAPIA no lee ni guarda tu contraseña: solo mira si está puesta.',
    en: "The file where sockseek keeps your Soulseek account and its preferences (sockseek.conf). NAPIA doesn't read or store your password: it only checks whether one is set.",
  },
  lista: {
    es: 'Una lista de temas: un CSV bajado de Exportify, Chosic o TuneMyMusic (por ejemplo de una playlist de Spotify), un texto con un "Artista - Tema" por renglón, o lo que exporta PAILA desde la lista «Faltan o suenan mal».',
    en: 'A list of tracks: a CSV from Exportify, Chosic or TuneMyMusic (for example from a Spotify playlist), a text with one "Artist - Track" per line, or what PAILA exports from the "Missing or low quality" list.',
  },
  nombre: {
    es: 'sockseek guarda todo en una carpeta con este nombre y anota ahí lo que bajó (_index.csv). Con el mismo nombre, la próxima vez saltea lo que ya bajó.',
    en: "sockseek saves everything in a folder with this name and keeps a note there of what it downloaded (_index.csv). With the same name, next time it skips what's already downloaded.",
  },
  kbps: {
    es: 'kbps: cuánta información por segundo guarda un MP3. 320 es lo máximo; con menos se pierden detalles que en un buen equipo se notan.',
    en: 'kbps: how much information per second an MP3 keeps. 320 is the maximum; with less you lose details that you can hear on good speakers.',
  },
  laQueHaya: {
    es: 'No descarta nada, pero entre lo que encuentra elige en este orden: primero sin pérdida (FLAC, WAV, AIFF), después MP3 de 320 kbps y, si no hay, lo que haya. Igual, NAPIA revisa la calidad real de cada tema: lo que dice ser algo que no es (un MP3 inflado, un FLAC falso) lo aparta y busca otra copia.',
    en: "It doesn't rule anything out, but among what it finds it picks in this order: lossless first (FLAC, WAV, AIFF), then 320 kbps MP3 and, if there's none, whatever is there. NAPIA still checks the real quality of each track: anything that claims to be something it isn't (an inflated MP3, a fake FLAC) is set aside and another copy is looked for.",
  },
  sinPerdida: {
    es: 'Sin pérdida (FLAC, WAV, AIFF): el sonido completo, como en el disco original. Pesan más y hay menos.',
    en: 'Lossless (FLAC, WAV, AIFF): the full sound, just like the original record. The files are bigger and there are fewer of them.',
  },
  remaster: {
    es: 'Spotify agrega cosas como "- 2011 Remaster" a muchos títulos y en Soulseek casi nadie los nombra así. Sacarlo ayuda a encontrarlos.',
    en: 'Spotify adds things like "- 2011 Remaster" to many titles, and on Soulseek almost nobody names them that way. Removing it helps find them.',
  },
  yaTenes: {
    es: 'NAPIA mira la biblioteca de PAILA (sin tocarla) y no baja los temas que ya tenés bien: mismo artista, mismo título, la misma duración y buena calidad (nota A o B). Lo que tenés en mala calidad se baja igual y se queda solo si es claramente mejor que tu copia. Si lo que tenés es otra versión (en vivo, remix), o en la lista «Faltan o suenan mal» dijiste que «No es», ese sí se baja.',
    en: "NAPIA looks at PAILA's library (without touching it) and doesn't download tracks you already have in good shape: same artist, same title, same length and good quality (grade A or B). What you have in poor quality is downloaded anyway and kept only if it's clearly better than your copy. If what you have is another version (live, remix), or in the \"Missing or low quality\" list you said “It's not”, that one is downloaded.",
  },
  nombres: {
    es: 'En Soulseek los archivos se llaman de cualquier forma y los tags vienen vacíos o rotos. Con esto, lo que llega se llama como en la lista y lleva ese artista y ese título en los tags (se revisa que el sonido quede idéntico). Si el archivo dice otra versión («Extended Mix»), se deja como vino. El resto (mayúsculas, disco, tapa) lo arregla PAILA desde la Bandeja.',
    en: "On Soulseek files are named any old way and their tags come empty or broken. With this, what arrives is named like in the list and carries that artist and title in its tags (the sound is checked to stay identical). If the file says it's another version (“Extended Mix”), it's left as it came. The rest (capitals, album, cover) PAILA fixes from the Inbox.",
  },
  probar: {
    es: 'Baja solo los primeros 5 para ver que encuentra bien. Después bajá la lista entera: lo que ya bajó lo saltea.',
    en: "Downloads only the first 5 so you can check it finds them well. Then download the whole list: what's already downloaded is skipped.",
  },
  bandeja: {
    es: 'La Bandeja de PAILA vigila una carpeta: lo que llega ahí lo reconoce por cómo suena, te dice si es mejor que lo que tenés y te deja reemplazarlo.',
    en: "PAILA's Inbox watches a folder: whatever arrives there is recognized by how it sounds, and it tells you if it's better than what you have and lets you replace it.",
  },
  cortes: {
    es: 'En Soulseek es normal que algunos usuarios no respondan o corten la conexión. sockseek prueba solo con otro: no hace falta hacer nada.',
    en: "On Soulseek it's normal for some users not to answer or to drop the connection. sockseek tries another one on its own: you don't need to do anything.",
  },
  aMedias: {
    es: 'Archivos que terminan en .incomplete: quedaron a medio bajar (por ejemplo si se cortó). Se retoman la próxima vez que bajes la misma lista.',
    en: 'Files that end in .incomplete: they were left half-downloaded (for example if it was stopped). They resume the next time you download the same list.',
  },
  noEncontrado: {
    es: 'Nadie los tenía compartidos con ese nombre, o no en la calidad pedida. Probá más tarde, con otra calidad, o corregí el nombre en la lista.',
    en: "Nobody had them shared under that name, or not in the quality you asked for. Try later, with another quality, or fix the name in the list.",
  },
  noSePudo: {
    es: 'sockseek los encontró, pero no pudo bajarlos: los que los tenían no respondieron o no se pudo conectar con ellos. Si pasa con todos, el aviso de arriba dice por qué y cómo se arregla.',
    en: "sockseek found them but couldn't download them: the people who had them didn't answer or it couldn't connect to them. If it happens with all of them, the notice above says why and how to fix it.",
  },
  puerto: {
    es: 'Para bajar, sockseek llama a los que tienen el tema; si tu router deja, ellos también te pueden llamar a vos, y se baja de más gente. NAPIA se lo pide sola a tu router mientras bajás y lo vuelve a cerrar al terminar: no tenés que tocar nada. Este cuadro solo aparece si de verdad no hubo forma.',
    en: "To download, sockseek calls the people who have the track; if your router allows it, they can also call you, and you download from more people. NAPIA asks your router for this on its own while you download and closes it again when it's done: you don't have to touch anything. This box only shows up if there was really no way.",
  },
  numeroPuerto: {
    es: 'Puerto: el número por el que los demás usuarios de Soulseek llegan a tu compu (como el número de una puerta).',
    en: "Port: the number other Soulseek users use to reach your computer (like a door number).",
  },
  carpeta: {
    es: 'sockseek baja cada tema en una carpeta de trabajo de NAPIA (con sus archivos de control, como el _index.csv) y, cuando termina, NAPIA lo pasa a la carpeta de la lista. Así en tu música no queda nada a medio bajar ni archivos que no son música.',
    en: "sockseek downloads each track into a NAPIA working folder (with its control files, like _index.csv) and, when it's done, NAPIA moves it to the list's folder. That way nothing half-downloaded and no non-music files end up in your music.",
  },
  modificada: {
    es: 'Es una versión modificada de sockseek (y de la librería Soulseek.NET), armada para NAPIA con un freno de conexiones: no es la oficial ni la mantienen o avalan sus autores. Se identifica ante Soulseek con su propio número de cliente. Detalle y licencias: recursos\\sockseek\\AVISO.txt.',
    en: "It's a modified version of sockseek (and of the Soulseek.NET library), built for NAPIA with a connection brake: it isn't the official one and its authors don't maintain or endorse it. It identifies itself to Soulseek with its own client number. Details and licenses: recursos\\sockseek\\AVISO.txt.",
  },
  freno: {
    es: 'Con el puerto cerrado, cada usuario que tiene lo que buscás pide que lo llames, y sockseek los llama a todos a la vez: miles. El sockseek con freno de NAPIA los llama de a pocos, así el router no se traba.',
    en: "With the port closed, every user who has what you're looking for asks you to call them, and sockseek calls them all at once: thousands. NAPIA's sockseek with the brake calls just a few at a time, so the router doesn't choke.",
  },
  upnp: {
    es: 'UPnP: una opción del router que deja que los programas de tu compu le pidan abrir un puerto solos. La usan las consolas de juegos, muchos programas para compartir y NAPIA.',
    en: 'UPnP: a router option that lets programs on your computer ask it to open a port on their own. Game consoles, many sharing programs and NAPIA use it.',
  },
  tanda: {
    es: 'Una tanda son varias listas que NAPIA baja una detrás de otra, sin que tengas que volver a apretar nada. Cada una queda en su propia carpeta. Podés sumar listas también mientras baja. Si pasa algo que frenaría a todas (por ejemplo la cuenta de Soulseek o el router trabado), la tanda se para y lo que falta queda esperando.',
    en: "A batch is several lists that NAPIA downloads one after another, without you having to press anything again. Each one ends up in its own folder. You can add lists while it's downloading too. If something happens that would stop all of them (for example the Soulseek account or a stuck router), the batch stops and what's left stays waiting.",
  },
  historial: {
    es: 'NAPIA anota cada lista que termina: cuándo, cuántos temas llegaron, cuáles no y adónde fueron. Se guarda en esta compu, en la carpeta de datos de NAPIA.',
    en: "NAPIA notes every list that finishes: when, how many tracks arrived, which ones didn't and where they went. It's saved on this computer, in NAPIA's data folder.",
  },
  reintento: {
    es: 'Sin agregados: sin el «feat.» y sin cosas como «(Remastered 2011)» u «(Original Mix)». Solo título y artista principal: además, solo el primer artista y sin lo que va entre paréntesis. La versión original: si era un remix, un edit o en vivo, busca el tema original. Se busca con la misma calidad que elegiste.',
    en: "Without extras: without the “feat.” and without things like “(Remastered 2011)” or “(Original Mix)”. Only title and main artist: also only the first artist and nothing in parentheses. The original version: if it was a remix, an edit or live, it looks for the original track. It searches with the same quality you chose.",
  },
  ipPublica: {
    es: 'Una dirección de internet propia. Muchas empresas comparten una entre varios clientes (se llama CGNAT): así nadie puede conectarse con tu compu desde afuera.',
    en: "An internet address of your own. Many providers share one among several customers (it's called CGNAT): that way nobody can connect to your computer from outside.",
  },
  yaEstabanTip: {
    es: 'Se habían bajado antes con esta misma lista: no se bajan de nuevo.',
    en: "They were downloaded before with this same list: they aren't downloaded again.",
  },
  yaEstabanCifra: {
    es: 'Se bajaron antes con esta misma lista: sockseek los saltea.',
    en: 'They were downloaded before with this same list: sockseek skips them.',
  },
})

/** "1.234" con punto de miles en castellano, "1,234" en inglés (como en PAILA). */
export const n = (x: number) => num(x)
export const mmss = (s: number | null) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
