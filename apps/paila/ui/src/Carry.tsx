// Pantalla "Llevar la música": celular (copiar convirtiendo), auto (pendrive), reproductores de PC (.m3u8) y servidores
// caseros (chequeo "listo para tu servidor"). Los originales nunca se tocan: todo se copia o se escribe en otra carpeta.
import { useState } from 'react'
import type { M3uResult, PlaylistNode } from '@paila/shared/types'
import type { PageKey } from './nav'
import { n } from './format'
import { toast } from './toast'
import { ExportModal } from './PlaylistTools'
import CarryPhone from './CarryPhone'
import CarryServer from './CarryServer'
import { Aviso, Boton, Caja, Info, Cabecera, Rico } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { ConfirmarBoton, Resultado } from './Confirmar'

const T = textos({
  tCelular: { es: 'Celular', en: 'Phone' },
  tCelularAyuda: { es: 'Una playlist (o los temas elegidos) a una carpeta, convertida para que ocupe menos', en: 'A playlist (or the tracks you picked) to a folder, converted to take up less space' },
  tAuto: { es: 'Auto o pendrive', en: 'Car or USB stick' },
  tAutoAyuda: { es: 'Una playlist al pendrive, con nombres cortos y numerados, para el auto o un equipo de DJ', en: 'A playlist to the USB stick, with short numbered names, for the car or a DJ player' },
  tPc: { es: 'Reproductores de PC', en: 'PC players' },
  tPcAyuda: { es: 'Tus playlists como archivos .m3u8 para foobar2000, MusicBee, Apple Music o VLC', en: 'Your playlists as .m3u8 files for foobar2000, MusicBee, Apple Music or VLC' },
  tServidor: { es: 'Servidor casero', en: 'Home server' },
  tServidorAyuda: { es: 'Qué le falta a tu Música para verse bien en Plex, Jellyfin o Navidrome', en: 'What your Music is missing to look good in Plex, Jellyfin or Navidrome' },
  m3u: {
    es: 'Un .m3u8 es una playlist en un archivo de texto: la lista de los temas con dónde está cada uno. Casi todos los reproductores la abren. No lleva la música adentro: los temas tienen que seguir donde están.',
    en: 'An .m3u8 is a playlist in a text file: the list of tracks with where each one is. Almost every player can open it. It does not hold the music itself: the tracks have to stay where they are.',
  },
  rel: {
    es: 'Relativas: cada tema se anota desde la carpeta de la playlist ("..\\Rock\\tema.mp3"). Sirve si después movés la música y las playlists juntas, o si la Música está en un disco que cambia de letra. Si el tema está en otro disco que la playlist, va con la ruta completa igual.',
    en: 'Relative: each track is written from the playlist\'s folder ("..\\Rock\\track.mp3"). It helps if you later move the music and the playlists together, or if your Music is on a drive whose letter changes. If a track is on a different drive than the playlist, it gets the full path anyway.',
  },
  abs: {
    es: 'Completas: cada tema con su ruta entera ("D:\\Música\\Rock\\tema.mp3"). Es lo más seguro si la música no se mueve y el disco siempre tiene la misma letra.',
    en: 'Full: each track with its whole path ("D:\\Music\\Rock\\track.mp3"). This is the safest choice if the music doesn\'t move and the drive always has the same letter.',
  },
  titulo: { es: 'Llevar la música', en: 'Take your music along' },
  sub: { es: 'Al celular, al auto, a otros programas o a tu servidor.', en: 'To your phone, your car, other programs or your server.' },
  ayuda: {
    es: 'Tu música, lista para el celular, el auto, otros programas de la compu o un servidor en tu casa. **Tus archivos no se tocan**: se copian o se anotan en otra carpeta.',
    en: 'Your music, ready for your phone, your car, other programs on your computer or a server at home. **Your files are not touched**: they are copied or listed in another folder.',
  },
  autoTexto1: {
    es: 'Para el estéreo del auto, un parlante con USB o las bandejas de DJ: copia la playlist al pendrive con los temas numerados en orden, nombres cortos que lee cualquier equipo y un',
    en: 'For the car stereo, a USB speaker or DJ decks: it copies the playlist to the USB stick with the tracks numbered in order, short names any player can read and a',
  },
  autoTexto2: {
    es: 'Lo que el equipo no lee (FLAC en equipos viejos, OGG, WMA) se convierte.',
    en: "Anything the player can't read (FLAC on older players, OGG, WMA) gets converted.",
  },
  elegiPlaylist: { es: 'Elegí la playlist', en: 'Pick the playlist' },
  elegiUna: { es: 'Elegí una playlist…', en: 'Pick a playlist…' },
  copiarPendrive: { es: 'Copiar al pendrive…', en: 'Copy to the USB stick…' },
  autoNota1: { es: 'En el auto: la mayoría de los estéreos leen pendrives en FAT32', en: 'In the car: most stereos read USB sticks in FAT32' },
  fat32: {
    es: 'FAT32 es el formato de pendrive más viejo y compatible: lo lee casi cualquier equipo. No admite archivos de más de 4 GB ni nombres muy largos; PAILA ya los acorta.',
    en: "FAT32 is the oldest and most compatible USB stick format: almost any player can read it. It doesn't allow files over 4 GB or very long names; PAILA already shortens them.",
  },
  autoNota2: {
    es: 'y MP3, y algunos también AAC o FLAC. Si tu estéreo no muestra las carpetas en orden, dejá tildado "Numerar los archivos".',
    en: 'and MP3, and some also AAC or FLAC. If your stereo doesn\'t show the folders in order, leave "Number the files" ticked.',
  },
  pcCarpeta: { es: 'Elegí la carpeta donde guardar las playlists', en: 'Pick the folder where the playlists will be saved' },
  pcTexto1: { es: 'Tus playlists de PAILA como archivos', en: 'Your PAILA playlists as' },
  pcTexto2: {
    es: ', para abrirlas en foobar2000, MusicBee, Apple Music (iTunes), VLC, Winamp o el reproductor que uses. La música no se copia: cada lista apunta a tus archivos donde están.',
    en: ', to open them in foobar2000, MusicBee, Apple Music (iTunes), VLC, Winamp or whichever player you use. The music is not copied: each list points to your files where they are.',
  },
  sinPlaylists: { es: 'No hay playlists todavía. Armá una desde la Biblioteca (o con "Carpetas → Playlists") y volvé.', en: 'There are no playlists yet. Make one from the Library (or with "Folders → Playlists") and come back.' },
  playlists: { es: 'Playlists', en: 'Playlists' },
  todas: { es: 'Todas', en: 'All' },
  rutasCompletas: { es: 'Rutas completas (lo más seguro)', en: 'Full paths (the safest)' },
  rutasRelativas: { es: 'Rutas relativas a la carpeta de las playlists', en: 'Paths relative to the playlists folder' },
  guardarN: { es: (c: string) => `Guardar ${c} playlists…`, en: (c: string) => `Save ${c} playlists…` },
  guardarPreg: { es: (c: string) => `¿Guardar ${c} playlists como archivos .m3u8 en una carpeta que vas a elegir?`, en: (c: string) => `Save ${c} playlists as .m3u8 files in a folder you are about to pick?` },
  guardadas: { es: (c: string, dir: string) => `Listo: se guardaron ${c} playlists en ${dir}.`, en: (c: string, dir: string) => `Done: ${c} playlists saved in ${dir}.` },
  faltan: { es: (c: string) => ` ${c} temas no se anotaron porque su disco no está conectado o el archivo ya no está.`, en: (c: string) => ` ${c} tracks were not listed because their drive isn't connected or the file is gone.` },
  otroDisco: { es: (c: string) => ` ${c} temas están en otro disco que las playlists: van con la ruta completa.`, en: (c: string) => ` ${c} tracks are on a different drive than the playlists: they get the full path.` },
  abrirCarpeta: { es: 'Abrir la carpeta', en: 'Open the folder' },
  comoAbrirlas: { es: 'Cómo abrirlas en cada programa', en: 'How to open them in each program' },
  foobar: { es: 'foobar2000:', en: 'foobar2000:' },
  foobarT: { es: 'arrastrá el .m3u8 a la ventana, o Archivo → Cargar playlist.', en: 'drag the .m3u8 onto the window, or File → Load playlist.' },
  musicbee: { es: 'MusicBee:', en: 'MusicBee:' },
  musicbeeT: { es: 'Archivo → Importar playlist (o arrastrá el .m3u8 a la lista de playlists).', en: 'File → Import playlist (or drag the .m3u8 onto the playlist list).' },
  itunes: { es: 'iTunes o Apple Music (Windows):', en: 'iTunes or Apple Music (Windows):' },
  itunesT: { es: 'Archivo → Biblioteca → Importar lista de reproducción. Los temas que no estaban en su biblioteca se suman al importar.', en: "File → Library → Import Playlist. Tracks that weren't in its library are added when you import." },
  vlc: { es: 'VLC y Winamp:', en: 'VLC and Winamp:' },
  vlcT: { es: 'abrí el .m3u8 con doble clic.', en: 'open the .m3u8 with a double-click.' },
  volverGuardar: { es: 'Si cambiás una playlist en PAILA, volvé a guardarla: el archivo se pone al día (las demás no se tocan).', en: "If you change a playlist in PAILA, save it again: the file gets updated (the others aren't touched)." },
})

type Tab = 'celular' | 'auto' | 'pc' | 'servidor'
const TABS: { id: Tab; label: () => string; help: () => string }[] = [
  { id: 'celular', label: () => T.tCelular, help: () => T.tCelularAyuda },
  { id: 'auto', label: () => T.tAuto, help: () => T.tAutoAyuda },
  { id: 'pc', label: () => T.tPc, help: () => T.tPcAyuda },
  { id: 'servidor', label: () => T.tServidor, help: () => T.tServidorAyuda },
]
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

/** La pantalla. `selection`: los temas elegidos en la Biblioteca (pueden ir al celular en vez de una playlist). */
export default function Carry({ playlists, selection, onGo }: { playlists: PlaylistNode[]; selection: number[]; onGo: (p: PageKey) => void }) {
  const [tab, setTab] = useState<Tab>('celular')
  const lists = playlists.filter((p) => p.kind !== 'folder')
  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} ayuda={<Rico texto={T.ayuda} />} />
      <div className="tabs">
        {TABS.map((t) => <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} title={t.help()}>{t.label()}</button>)}
      </div>
      {tab === 'celular' && <CarryPhone lists={lists} selection={selection} />}
      {tab === 'auto' && <CarryCar lists={lists} />}
      {tab === 'pc' && <CarryPc lists={lists} />}
      {tab === 'servidor' && <CarryServer onGo={onGo} />}
    </div>
  )
}

/** Auto o equipo de DJ: es el "A pendrive" de siempre (la misma ventana que en cada playlist). */
function CarryCar({ lists }: { lists: PlaylistNode[] }) {
  const [pick, setPick] = useState<number | ''>('')
  const [open, setOpen] = useState<PlaylistNode | null>(null)
  return (<>
    <p className="muted small">
      {T.autoTexto1} <code>playlist.m3u8</code> <Info tip={T.m3u} />. {T.autoTexto2}
    </p>
    <Caja pad head={<b>{T.elegiPlaylist}</b>}>
      <div className="row">
        <select value={pick} onChange={(e) => setPick(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">{T.elegiUna}</option>
          {lists.map((p) => <option key={p.id} value={p.id}>{p.name} ({n(p.count)})</option>)}
        </select>
        <Boton disabled={pick === ''} onClick={() => setOpen(lists.find((p) => p.id === pick) ?? null)}>{T.copiarPendrive}</Boton>
      </div>
      <p className="muted small">
        {T.autoNota1} <Info tip={T.fat32} />
        {' '}{T.autoNota2}
      </p>
    </Caja>
    {open && <ExportModal node={open} onClose={() => setOpen(null)} />}
  </>)
}

/** Reproductores de PC: un .m3u8 por playlist en la carpeta elegida. */
function CarryPc({ lists }: { lists: PlaylistNode[] }) {
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [relative, setRelative] = useState(false)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<M3uResult | null>(null)
  const all = chosen.size === lists.length && lists.length > 0
  const save = async () => {
    const dir = await window.paila.carryPick(T.pcCarpeta)
    if (!dir) return
    setBusy(true); setRes(null)
    try { setRes(await window.paila.carryM3u(lists.filter((p) => chosen.has(p.id)).map((p) => p.id), { dir, relative })) } catch (e) { toast(clean(e), 'error') } finally { setBusy(false) }
  }
  return (<>
    <p className="muted small">
      {T.pcTexto1} <code>.m3u8</code> <Info tip={T.m3u} />{T.pcTexto2}
    </p>
    {lists.length === 0 ? <Aviso>{T.sinPlaylists}</Aviso> : (
      <Caja pad head={<><b>{T.playlists}</b><label className="small push-right"><input type="checkbox" checked={all} onChange={(e) => setChosen(e.target.checked ? new Set(lists.map((p) => p.id)) : new Set())} /> {T.todas}</label></>}>
        <div className="listbox">
          {lists.map((p) => (
            <label key={p.id} className="listbox-row">
              <span><input type="checkbox" checked={chosen.has(p.id)} onChange={(e) => setChosen((s) => { const t = new Set(s); e.target.checked ? t.add(p.id) : t.delete(p.id); return t })} /> {p.name}</span>
              <span className="muted num">{n(p.count)}</span>
            </label>
          ))}
        </div>
        <div className="rep-opts">
          <label><input type="radio" checked={!relative} onChange={() => setRelative(false)} /> {T.rutasCompletas} <Info tip={T.abs} /></label>
          <label><input type="radio" checked={relative} onChange={() => setRelative(true)} /> {T.rutasRelativas} <Info tip={T.rel} /></label>
        </div>
        <div className="row">
          <ConfirmarBoton disabled={busy || chosen.size === 0} onSi={save} deshacer="copias" pregunta={T.guardarPreg(n(chosen.size))}>{T.guardarN(n(chosen.size))}</ConfirmarBoton>
        </div>
      </Caja>
    )}
    {res && (
      <Resultado r={{
        hechos: T.guardadas(n(res.files.length), res.dir), deshacer: 'copias',
        extra: (<>
          {res.files.some((f) => f.missing) && <div className="warn-inline">{T.faltan(n(res.files.reduce((a, f) => a + f.missing, 0)))}</div>}
          {res.absoluteFallback > 0 && <div className="warn-inline">{T.otroDisco(n(res.absoluteFallback))}</div>}
          <div className="row"><Boton variant="ghost" size="sm" onClick={() => window.paila.openFolder(res.dir)}>{T.abrirCarpeta}</Boton></div>
        </>),
      }} />
    )}
    <Caja pad head={<b>{T.comoAbrirlas}</b>}>
      <ul className="small">
        <li><b>{T.foobar}</b> {T.foobarT}</li>
        <li><b>{T.musicbee}</b> {T.musicbeeT}</li>
        <li><b>{T.itunes}</b> {T.itunesT}</li>
        <li><b>{T.vlc}</b> {T.vlcT}</li>
      </ul>
      <p className="muted small">{T.volverGuardar}</p>
    </Caja>
  </>)
}
