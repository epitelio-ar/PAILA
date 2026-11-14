// Los textos de la pantalla Programas de DJ, en castellano y en inglés (ver @paila/shared/idioma).
import { textos, num, plural } from '@paila/shared/idioma'

export const T = textos({
  sub: { es: 'Compatibilidad con tu equipo y exportar a Rekordbox, Traktor, Serato, VirtualDJ o Engine DJ.', en: 'Check your gear and export to Rekordbox, Traktor, Serato, VirtualDJ or Engine DJ.' },
  ayuda: {
    es: 'Rekordbox intercambia la colección y las playlists con un archivo **rekordbox.xml**: es el camino oficial y seguro. PAILA **no toca la base interna de Rekordbox**. El pendrive para las CDJ lo sigue haciendo Rekordbox (su formato es propio; PAILA sí puede leer uno ya armado, en el punto 3); si querés tocar sin Rekordbox, usá **"A pendrive o carpeta…"** en cualquier playlist. Desde ahora el XML lleva también la grilla, los cue points, las estrellas, el color y los "my tags", y cada tema conserva su número entre exportaciones. Ojo: Rekordbox reconoce cada tema por **dónde está**. Si no se movió, al importar lo actualiza; si PAILA lo movió o le cambió el nombre (Organizar, Arreglar nombres), lo agrega como tema nuevo, con su grilla, cues y estrellas, y el viejo queda como "falta archivo": sacalo después desde Rekordbox. Por eso conviene pasar a Rekordbox después de ordenar.',
    en: 'Rekordbox swaps your collection and playlists through a **rekordbox.xml** file: it is the official, safe way. PAILA **does not touch Rekordbox\'s internal database**. The USB drive for CDJs is still made by Rekordbox (its format is its own; PAILA can read one that is already made, in step 3); if you want to play without Rekordbox, use **"To USB drive or folder…"** on any playlist. The XML now also carries the beat grid, cue points, stars, color and "my tags", and each track keeps its number between exports. Note: Rekordbox recognizes each track by **where it is**. If it did not move, importing updates it; if PAILA moved or renamed it (Organize, Fix names), it is added as a new track, with its beat grid, cues and stars, and the old one shows as "missing file": remove it afterwards in Rekordbox. That is why it is best to move to Rekordbox after sorting.',
  },
  // 1. equipo
  h1: { es: '3. ¿Qué equipo usás?', en: '3. Which gear do you use?' },
  orientativo: { es: 'Es orientativo: confirmalo en el manual de tu equipo.', en: 'This is only a guide: confirm it in your gear\'s manual.' },
  altoKhz: {
    es: (k: string) => `Grabados a más de ${k} kHz (calidad de estudio): este equipo llega hasta ${k} kHz`,
    en: (k: string) => `Recorded above ${k} kHz (studio quality): this gear goes up to ${k} kHz`,
  },
  sonaran: { es: '{ok} temas de tu Música van a sonar sin problema · {mal} no.', en: '{ok} tracks from your Music will play without a problem · {mal} won\'t.' },
  renglon: { es: (k: number, motivo: string) => `• ${num(k)} temas — ${motivo}`, en: (k: number, motivo: string) => `• ${num(k)} ${plural(k, 'track', 'tracks')} — ${motivo}` },
  crearPlaylist: { es: (k: number) => `Crear una playlist con estos ${num(k)} temas`, en: (k: number) => `Create a playlist with these ${num(k)} ${plural(k, 'track', 'tracks')}` },
  despuesPendrive: {
    es: 'Después la mandás a un pendrive con conversión (MP3 320 o AIFF). La conversión no mejora la calidad.',
    en: 'Then you send it to a USB drive with conversion (MP3 320 or AIFF). Converting doesn\'t improve the quality.',
  },
  listoPlaylist: {
    es: (k: number) => `Listo: se creó una playlist con los ${num(k)} temas a revisar. Desde ahí podés usar "A pendrive o carpeta…" para convertirlos para tu equipo.`,
    en: (k: number) => `Done: a playlist was created with the ${num(k)} ${plural(k, 'track', 'tracks')} to check. From there you can use "To USB drive or folder…" to convert ${k === 1 ? 'it' : 'them'} for your gear.`,
  },
  // 2. convertir
  h2: { es: '4. Convertir lo que Rekordbox no lee', en: '4. Convert what Rekordbox can\'t read' },
  ninguno: { es: 'Ninguno: toda tu Música está en formatos que Rekordbox lee.', en: 'None: all your Music is in formats Rekordbox can read.' },
  wmaSinPerdida: { es: 'WMA sin pérdida', en: 'Lossless WMA' },
  nTemas: { es: (k: number) => `${num(k)} ${plural(k, 'tema', 'temas')}`, en: (k: number) => `${num(k)} ${plural(k, 'track', 'tracks')}` },
  convIntro: {
    es: 'Rekordbox y las CDJ no los leen, y PAILA tampoco puede escribirles tags. Se convierten **conservando tags, tapa, nombre y playlists**; el original va a la Papelera (Reemplazos), así que se puede deshacer, y sigue ocupando lugar hasta que vacíes la papelera.',
    en: 'Rekordbox and CDJs can\'t read them, and PAILA can\'t write tags to them either. They are converted **keeping tags, cover art, name and playlists**; the original goes to the Trash (Replacements), so it can be undone, and it keeps taking up space until you empty the trash.',
  },
  convWma: { es: ' Los **WMA sin pérdida** pasan siempre a FLAC y se verifican bit a bit.', en: ' The **lossless WMA** files always become FLAC and are checked bit by bit.' },
  mp3: {
    es: '**MP3 320** (recomendado): lo lee cualquier equipo. Pasar de un formato con pérdida a otro pierde un poquito más, casi nada a 320.',
    en: '**MP3 320** (recommended): any gear can read it. Going from one lossy format to another loses a little more, almost nothing at 320.',
  },
  flac: {
    es: '**FLAC**: no se pierde nada más, pero ocupa unas 5 veces más y la calidad sigue siendo la del original. Ojo: las CDJ anteriores a las NXS2 no leen FLAC.',
    en: '**FLAC**: nothing more is lost, but it takes about 5 times the space and the quality stays the same as the original. Careful: CDJs older than the NXS2 can\'t read FLAC.',
  },
  convNota: {
    es: 'Convertir no mejora la calidad: si un tema importa, mejor conseguir una versión mejor (Faltan o suenan mal).',
    en: 'Converting doesn\'t improve the quality: if a track matters, it\'s better to get a better version (the "Missing or low quality" list).',
  },
  unidad: { es: 'temas', en: 'tracks' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  convertirPreg: {
    es: (k: number, fmt: string) => `¿Convertir ${num(k)} temas a ${fmt}?`,
    en: (k: number, fmt: string) => `Convert ${num(k)} ${plural(k, 'track', 'tracks')} to ${fmt}?`,
  },
  convertirAviso: { es: 'Si el análisis está corriendo, se pausa solo.', en: 'If the analysis is running, it pauses on its own.' },
  convertidos: { es: (k: number) => `${plural(k, 'Se convirtió', 'Se convirtieron')} ${num(k)} ${plural(k, 'tema', 'temas')}.`, en: (k: number) => `${num(k)} ${plural(k, 'track was', 'tracks were')} converted.` },
  convertir: { es: (k: number) => `Convertir ${num(k)} temas…`, en: (k: number) => `Convert ${num(k)} ${plural(k, 'track', 'tracks')}…` },
  // 3, 4, 5
  h3: { es: '5. Traer tus playlists de Rekordbox o de un pendrive', en: '5. Import your playlists from Rekordbox or a USB drive' },
  h4: { es: '6. Traer lo que ya hiciste en Rekordbox y Serato', en: '6. Import what you already did in Rekordbox and Serato' },
  h5: { es: '7. Grilla y cue points', en: '7. Beat grid and cue points' },
  // 6. exportar
  h6: { es: '1. Exportar a tu programa de DJ', en: '1. Export to your DJ software' },
  programa: { es: 'Programa', en: 'Software' },
  todoMiMusica: { es: 'Toda mi Música (los temas ordenados en carpetas) y todas mis playlists', en: 'All my Music (tracks sorted into folders) and all my playlists' },
  soloPlaylists: { es: 'Solo los temas de las playlists que elija', en: 'Only the tracks from the playlists I choose' },
  sinPlaylists: { es: 'Todavía no tenés playlists.', en: 'You don\'t have any playlists yet.' },
  conGrilla: {
    es: 'Con la grilla {info} (la de Rekordbox o Serato si la trajiste; si no, la de PAILA)',
    en: 'With the beat grid {info} (the Rekordbox or Serato one if you imported it; otherwise PAILA\'s)',
  },
  grillaVariable: {
    es: '**Recomendado:** donde el tempo se mueve, usar la grilla de PAILA. La fija de Rekordbox se corre de a poco; la de PAILA sigue el tempo {info}{extra}',
    en: '**Recommended:** where the tempo drifts, use PAILA\'s grid. Rekordbox\'s fixed one slowly slips; PAILA\'s follows the tempo {info}{extra}',
  },
  unSoloBpm: { es: ' (este programa acepta un solo BPM por tema: va el general)', en: ' (this software accepts a single BPM per track: the overall one goes in)' },
  cuesSugeridos: {
    es: 'Con los cue points sugeridos {cue} en los temas que no tienen ninguno tuyo: Intro, Drop, Break y Outro, aproximados (como memory cues {memory}: no tocan tus pads)',
    en: 'With suggested cue points {cue} in tracks that have none of yours: Intro, Drop, Break and Outro, approximate (as memory cues {memory}: they don\'t touch your pads)',
  },
  dentroDeArchivos: {
    es: 'Llevar también la grilla y los cues adentro de los archivos, como los guarda Serato {info} (pasan por Cambios pendientes)',
    en: 'Also write the beat grid and cues inside the files, the way Serato stores them {info} (they go through Pending changes)',
  },
  exportando: { es: 'Exportando…', en: 'Exporting…' },
  exportarRb: { es: 'Exportar rekordbox.xml…', en: 'Export rekordbox.xml…' },
  exportarTraktor: { es: 'Exportar para Traktor…', en: 'Export for Traktor…' },
  exportarSerato: { es: 'Exportar a Serato', en: 'Export to Serato' },
  exportarVdj: { es: 'Exportar a VirtualDJ', en: 'Export to VirtualDJ' },
  exportarEngine: { es: 'Exportar a Engine DJ', en: 'Export to Engine DJ' },
  exportarPreg: {
    es: (prog: string, todo: boolean) => `¿Exportar ${todo ? 'toda tu Música' : 'las playlists elegidas'} para ${prog}?`,
    en: (prog: string, todo: boolean) => `Export ${todo ? 'all your Music' : 'the chosen playlists'} for ${prog}?`,
  },
  inteligentes: {
    es: 'Las playlists inteligentes se exportan como comunes, con los temas que tienen hoy.',
    en: 'Smart playlists are exported as regular ones, with the tracks they have today.',
  },
  seGuardo: {
    es: (file: string, t: number, p: number, g: number, c: number) => `Se guardó ${file} con ${num(t)} temas y ${num(p)} playlists (${num(g)} con grilla, ${num(c)} con cue points).`,
    en: (file: string, t: number, p: number, g: number, c: number) => `Saved ${file} with ${num(t)} ${plural(t, 'track', 'tracks')} and ${num(p)} ${plural(p, 'playlist', 'playlists')} (${num(g)} with beat grid, ${num(c)} with cue points).`,
  },
  // 7. guía
  h7: { es: (app: string) => `2. Abrirlo en ${app}, paso a paso`, en: (app: string) => `2. Open it in ${app}, step by step` },
  g1: { es: 'Abrí Rekordbox y andá a **Preferencias → Avanzado → Base de datos**.', en: 'Open Rekordbox and go to **Preferences → Advanced → Database**.' },
  g2: {
    es: 'En **"Biblioteca rekordbox xml"** tocá **Examinar** y elegí el archivo {xml} que exportaste.',
    en: 'Under **"rekordbox xml"**, next to **"Imported Library"**, click **Browse** and choose the {xml} file you exported.',
  },
  g3: {
    es: 'En el panel izquierdo de Rekordbox aparece la sección **"rekordbox xml"** (si no la ves, activala en Preferencias → Vista → Árbol de medios).',
    en: 'In the left panel of Rekordbox the **"rekordbox xml"** section appears (if you don\'t see it, turn it on in Preferences → View → Media Browser).',
  },
  g4: {
    es: 'Abrí tus playlists ahí. Para pasarlas a tu colección, clic derecho sobre la playlist → **"Importar playlist"** (o arrastrá los temas a la colección).',
    en: 'Open your playlists there. To move them into your collection, right-click the playlist → **"Import Playlist"** (or drag the tracks into the collection).',
  },
  g5: {
    es: 'Los temas con grilla de PAILA no hace falta analizarlos: revisá la grilla en un par y, si algo quedó corrido, corregila en Rekordbox. Después armás el pendrive de las CDJ desde Rekordbox, como siempre.',
    en: 'Tracks with a PAILA beat grid don\'t need to be analyzed: check the grid on a couple and, if something is shifted, fix it in Rekordbox. Then you build the USB drive for the CDJs from Rekordbox, as usual.',
  },
  g6: {
    es: 'Si ya tenías esos temas en Rekordbox, antes traé tu rekordbox.xml (paso 5): así PAILA devuelve tu grilla y tus cues tal cual.',
    en: 'If you already had those tracks in Rekordbox, import your rekordbox.xml first (step 5): that way PAILA gives your beat grid and cues back exactly as they were.',
  },
  g7: {
    es: 'Si cambiás playlists en PAILA, volvé a exportar y repetí el paso 3: Rekordbox ve las novedades.',
    en: 'If you change playlists in PAILA, export again and repeat step 3: Rekordbox picks up the changes.',
  },
  avisoMover: {
    es: 'Si PAILA va a **mover, renombrar o reemplazar** un tema que ya exportaste, te avisa antes: en Rekordbox vas a tener que relocalizarlo y podrías perder sus cue points.',
    en: 'If PAILA is going to **move, rename or replace** a track you already exported, it tells you first: in Rekordbox you would have to relocate it and you could lose its cue points.',
  },
})
