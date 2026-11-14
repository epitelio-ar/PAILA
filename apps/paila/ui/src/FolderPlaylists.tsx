// Pantalla Carpetas → Playlists: arma una playlist por carpeta de la biblioteca, con vista previa antes de crearlas.
import logo from './assets/logo.png'
import { useMemo, useState } from 'react'
import type { FolderProposal } from '@paila/shared/types'
import { n } from './format'
import { Aviso, Boton, Cabecera, Festejo, Rico } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const T = textos({
  titulo: { es: 'Carpetas → Playlists', en: 'Folders → Playlists' },
  sub: { es: 'Convertí tus carpetas-playlist en playlists de verdad, sin mover archivos.', en: 'Turn your playlist-folders into real playlists, without moving any files.' },
  ayuda: {
    es: 'Muchas veces usás una carpeta como si fuera una playlist (por ejemplo una fecha o un evento). PAILA mira tus carpetas de **Música**, distingue las que son un **álbum** de las que son una **playlist** y te deja crear playlists de verdad con los mismos temas y el mismo orden. **No mueve ni copia archivos**: las carpetas quedan como están. Para ordenarlas después, usá Organizar carpetas.',
    en: "Often you use a folder as if it were a playlist (a date or an event, say). PAILA looks at your **Music** folders, tells the **albums** from the **playlists**, and lets you create real playlists with the same tracks in the same order. **It doesn't move or copy any files**: your folders stay as they are. To tidy them up afterwards, use Organize folders.",
  },
  playlist: { es: 'Playlist', en: 'Playlist' }, // idioma-ok
  playlistAyuda: { es: 'Temas de varios artistas mezclados', en: 'Tracks from several artists mixed together' },
  album: { es: 'Álbum', en: 'Album' },
  albumAyuda: { es: 'Temas de un mismo disco o artista', en: 'Tracks from one album or artist' },
  dudosa: { es: 'Dudosa', en: 'Unsure' },
  dudosaAyuda: { es: 'PAILA no está segura', en: "PAILA isn't sure" },
  mirando: { es: 'Mirando carpetas…', en: 'Looking at folders…' },
  denuevo: { es: 'Analizar de nuevo', en: 'Scan again' },
  analizar: { es: 'Analizar mis carpetas', en: 'Scan my folders' },
  resumen: {
    es: (t: number, p: number, a: number, d: number) => `${t} carpetas con 3 temas o más: ${p} parecen playlists, ${a} álbumes y ${d} dudosas.`,
    en: (t: number, p: number, a: number, d: number) => `${t} folders with 3 tracks or more: ${p} look like playlists, ${a} like albums and ${d} are unsure.`,
  },
  listoTitulo: {
    es: (c: string, t: string) => `Listo: ${c} playlists nuevas con ${t} temas.`,
    en: (c: string, t: string) => `Done: ${c} new playlists with ${t} tracks.`,
  },
  listoCuerpo: { es: 'Mirá la sección Playlists de la barra lateral. No se movió ni copió ningún archivo.', en: 'Look in the Playlists section of the sidebar. No files were moved or copied.' },
  crear: {
    es: (c: string, t: string) => `Crear ${c} playlists (${t} temas)`,
    en: (c: string, t: string) => `Create ${c} playlists (${t} tracks)`,
  },
  todas: { es: 'Mostrar todas', en: 'Show all' },
  soloPlaylists: { es: 'Solo playlists', en: 'Playlists only' },
  soloDudosas: { es: 'Solo dudosas', en: 'Unsure only' },
  soloAlbumes: { es: 'Solo álbumes', en: 'Albums only' },
  yaExiste: { es: 'Si ya existe una playlist con ese nombre, se completa en vez de duplicarla.', en: 'If a playlist with that name already exists, it gets filled in instead of duplicated.' },
  temas: { es: (c: string) => `${c} temas`, en: (c: string) => `${c} tracks` },
  masCarpetas: { es: (k: number) => `… y ${k} carpetas más.`, en: (k: number) => `… and ${k} more folders.` },
  ninguna: { es: 'No encontré carpetas con 3 temas o más en tu Música.', en: "I didn't find any folders with 3 tracks or more in your Music." },
})
const KIND = {
  playlist: { get label() { return T.playlist }, get help() { return T.playlistAyuda } },
  album: { get label() { return T.album }, get help() { return T.albumAyuda } },
  dudosa: { get label() { return T.dudosa }, get help() { return T.dudosaAyuda } },
} as const

/** Asistente Carpetas → Playlists: crea playlists virtuales a partir de las carpetas que en realidad son playlists. No mueve archivos. */
export default function FolderPlaylists({ onCreated }: { onCreated: () => void }) {
  const [props, setProps] = useState<FolderProposal[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; titulo: string; cuerpo?: string } | null>(null)
  const [filter, setFilter] = useState<'todas' | 'playlist' | 'dudosa' | 'album'>('todas')

  const analyze = async () => {
    setBusy(true); setMsg(null)
    try {
      const p = await window.paila.analyzeFolders()
      setProps(p); setPicked(new Set(p.filter((x) => x.kind === 'playlist').map((x) => x.dir)))
    } catch (e) { setMsg({ ok: false, titulo: clean(e) }) } finally { setBusy(false) }
  }
  const create = async () => {
    setBusy(true)
    try {
      const r = await window.paila.createPlaylistsFromFolders([...picked])
      setMsg({ ok: true, titulo: T.listoTitulo(n(r.created), n(r.tracks)), cuerpo: T.listoCuerpo })
      onCreated()
    } catch (e) { setMsg({ ok: false, titulo: clean(e) }) } finally { setBusy(false) }
  }

  const shown = useMemo(() => (props ?? []).filter((p) => filter === 'todas' || p.kind === filter), [props, filter])
  const counts = useMemo(() => ({ playlist: props?.filter((p) => p.kind === 'playlist').length ?? 0, album: props?.filter((p) => p.kind === 'album').length ?? 0, dudosa: props?.filter((p) => p.kind === 'dudosa').length ?? 0 }), [props])
  const total = (props ?? []).filter((p) => picked.has(p.dir)).reduce((s, p) => s + p.count, 0)

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} ayuda={<Rico texto={T.ayuda} />} />
      <div className="row">
        <Boton disabled={busy} onClick={analyze}>{busy && !props ? T.mirando : props ? T.denuevo : T.analizar}</Boton>
        {props && <span className="muted">{T.resumen(props.length, counts.playlist, counts.album, counts.dudosa)}</span>}
      </div>
      {msg && (msg.ok ? <Festejo imagen={logo} titulo={msg.titulo}>{msg.cuerpo}</Festejo> : <Aviso>{msg.titulo}</Aviso>)}

      {props && props.length > 0 && (<>
        <div className="actionbar">
          <Boton disabled={busy || !picked.size} onClick={create}>{T.crear(n(picked.size), n(total))}</Boton>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="todas">{T.todas}</option><option value="playlist">{T.soloPlaylists}</option><option value="dudosa">{T.soloDudosas}</option><option value="album">{T.soloAlbumes}</option>
          </select>
          <span className="muted small">{T.yaExiste}</span>
        </div>
        <div className="box-list">
          {shown.slice(0, 400).map((p) => (
            <label key={p.dir} className="box choice">
              <input type="checkbox" checked={picked.has(p.dir)} onChange={(e) => setPicked((s) => { const t = new Set(s); e.target.checked ? t.add(p.dir) : t.delete(p.dir); return t })} />
              <div className="choice-body">
                <div><b>{p.name}</b> <span className={`pill pill-${{ playlist: "green", album: "blue", dudosa: "amber" }[p.kind]}`} title={KIND[p.kind].help}>{KIND[p.kind].label}</span> <span className="muted small">{T.temas(n(p.count))}</span></div>
                <div className="muted small" title={p.dir}>{p.dir}</div>
                <div className="muted small">{p.reason} · {p.sample.join(' · ')}</div>
              </div>
            </label>
          ))}
          {shown.length > 400 && <p className="muted">{T.masCarpetas(shown.length - 400)}</p>}
        </div>
      </>)}
      {props && props.length === 0 && <p className="muted">{T.ninguna}</p>}
    </div>
  )
}
