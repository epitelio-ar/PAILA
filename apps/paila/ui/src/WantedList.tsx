// La lista «Faltan o suenan mal» por tema: qué conviene conseguir en mejor calidad (o qué te falta), con estados y exportación
// en .txt o .csv para llevarla a donde compres o consigas la música. PAILA no descarga música.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PlaylistNode, WantedCriteria, WantedFormat, WantedItem, WantedQue, WantedReason, WantedStatus } from '@paila/shared/types'
import { duration, n } from './format'
import { toast } from './toast'
import { Nota, Boton, Info } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'

/** Lo mismo que core/wanted.ts soloQue: "calidad", un tema que ya tenés; "faltan", uno que no. */
const enQue = (i: WantedItem, que: WantedQue) => que === 'todo' || (que === 'calidad') === (i.fileId != null)
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const T = textos({
  discogs: { es: 'Discogs (vinilos y CDs)', en: 'Discogs (vinyl and CDs)' },
  buscarEn: { es: 'Buscar en…', en: 'Search on…' },
  buscarEnTip: { es: 'Abre la búsqueda en esa tienda, en el navegador', en: 'Opens the search on that store, in your browser' },
  sPendiente: { es: 'Pendiente', en: 'Pending' },
  sPendienteH: { es: 'Todavía no lo pediste ni lo exportaste', en: "You haven't requested or exported it yet" },
  sPedido: { es: 'Pedido', en: 'Requested' },
  sPedidoH: { es: 'Ya salió en una lista exportada: lo estás buscando', en: "It's already been in an exported list: you're looking for it" },
  sLlego: { es: 'Llegó', en: 'Arrived' },
  sLlegoH: { es: 'La Bandeja encontró el archivo y es mejor: falta aplicarlo (en Sonido de un vistazo o en la barra de arriba)', en: 'The Inbox found the file and it is better: it still needs applying (in Sound at a glance or in the bar at the top)' },
  sReemplazado: { es: 'Reemplazado', en: 'Replaced' },
  sReemplazadoH: { es: 'Ya está reemplazado: no sale más en la lista que exportás', en: "It's already replaced: it no longer shows up in the list you export" },
  sIgnorar: { es: 'Ignorar', en: 'Ignore' },
  sIgnorarH: { es: 'No vale la pena (por ejemplo una grabación vieja que no existe mejor): nunca sale en la lista', en: "Not worth it (for example an old recording that doesn't exist in better quality): it never shows up in the list" },
  rNota: { es: 'mala nota', en: 'poor grade' },
  rNotaH: { es: 'La nota de calidad (de A+ a F) es baja: con auriculares o un buen equipo se nota.', en: 'The quality grade (A+ to F) is low: you can hear it with headphones or good gear.' },
  rFalso: { es: 'lossless falso', en: 'fake lossless' },
  rFalsoH: { es: 'Dice ser sin pérdida (FLAC, WAV) pero es un MP3 convertido: ocupa como un CD y suena como el MP3.', en: "It claims to be lossless (FLAC, WAV) but it's a converted MP3: it takes up as much space as a CD and sounds like the MP3." },
  rInflado: { es: 'inflado', en: 'inflated' },
  rInfladoH: { es: 'Un MP3 de pocos kbps re-codificado a más (por ejemplo 128 → 320): pesa más pero no suena mejor.', en: 'A low-kbps MP3 re-encoded to a higher rate (for example 128 → 320): it weighs more but sounds no better.' },
  rRekordbox: { es: 'Rekordbox no lo lee', en: "Rekordbox can't read it" },
  rRekordboxH: { es: 'Ni Rekordbox ni las CDJ leen este formato (WMA, OGG, Opus…). También podés convertirlo en "Programas de DJ".', en: 'Neither Rekordbox nor CDJs read this format (WMA, OGG, Opus…). You can also convert it in "DJ software".' },
  rFalta: { es: 'te falta', en: 'missing' },
  rFaltaH: { es: 'No lo tenés: está en una lista que trajiste, o un archivo tuyo tiene este título pero suena como otro tema (lo encontró Duplicados).', en: "You don't have it: it's on a list you brought in, or one of your files has this title but sounds like another track (found by Duplicates)." },
  rFaltaDisco: { es: 'falta del disco', en: 'missing from album' },
  rFaltaDiscoH: { es: 'Le falta a un disco tuyo: está en su lista de temas oficial y no lo tenés (lo encontró Discos completos).', en: "It's missing from one of your albums: it's on its official track list and you don't have it (found by Complete albums)." },
  rMp3: { es: 'puede venir de un MP3', en: 'may come from an MP3' },
  rMp3H: { es: 'Suena completo (B), pero se corta de golpe en 19,5 kHz, justo donde corta un MP3 de unos 256 kbps: puede ser el master o un MP3 pasado a FLAC. Conviene buscar el original sin pérdida.', en: "It sounds complete (B), but it cuts off sharply at 19.5 kHz, right where a ~256 kbps MP3 cuts: it may be the master or an MP3 converted to FLAC. It's worth looking for the lossless original." },
  cMp3: { es: 'Sin pérdida que pueden venir de un MP3 (buscar el original)', en: 'Lossless that may come from an MP3 (look for the original)' },
  cBad: { es: 'Nota D o F', en: 'Grade D or F' },
  cBadH: { es: 'Calidad baja de verdad: conviene conseguir otra.', en: 'Really poor quality: worth getting another one.' },
  cFair: { es: 'También nota C', en: 'Also grade C' },
  cFairH: { es: 'Calidad aceptable (por ejemplo un MP3 de 192): mejorable, pero no urgente.', en: 'Acceptable quality (for example a 192 MP3): could be better, but not urgent.' },
  cFakes: { es: 'Lossless falsos e inflados', en: 'Fake and inflated lossless' },
  cRekordbox: { es: 'Formatos que Rekordbox no lee', en: "Formats Rekordbox can't read" },
  limpiando: { es: 'Limpiando los nombres…', en: 'Cleaning up the names…' },
  limpiandoTip: { es: 'Por ahora ves los nombres como están en los tags. PAILA los está limpiando como haría "Arreglar nombres" (sin tocar tus archivos); en unos segundos se actualizan solos.', en: 'For now you see the names as they are in the tags. PAILA is cleaning them up the way "Fix names" would (without touching your files); in a few seconds they update by themselves.' },
  queIncluir: { es: 'Qué incluir', en: 'What to include' },
  bajarNapia: { es: 'Bajar con NAPIA', en: 'Download with NAPIA' },
  qCalidad: { es: (k: string) => `Mejorar lo que tengo (${k})`, en: (k: string) => `Improve what I have (${k})` },
  qCalidadTip: { es: 'Temas que ya tenés pero suenan mal o son truchos: se busca una copia mejor', en: 'Tracks you already have that sound bad or are fake: a better copy is searched for' },
  qFaltan: { es: (k: string) => `Lo que me falta (${k})`, en: (k: string) => `What I'm missing (${k})` },
  qFaltanTip: { es: 'Temas que no tenés: los que les faltan a tus discos, los de listas traídas y los que sumaste a mano', en: "Tracks you don't have: the ones missing from your albums, from lists you brought in and the ones you added by hand" },
  qTodo: { es: (k: string) => `Todo (${k})`, en: (k: string) => `Everything (${k})` },
  noSoulseek: { es: (d: string) => `No está en Soulseek (${d})`, en: (d: string) => `Not on Soulseek (${d})` },
  noSoulseekTip: { es: 'La última vez que NAPIA lo buscó no lo consiguió: probá «Buscar en…» o más adelante', en: "The last time NAPIA searched for it, it didn't find it: try «Search on…» or later" },
  qTodoTip: { es: 'Las dos cosas juntas', en: 'Both together' },
  bajarNapiaTip: { es: 'Abre NAPIA (el panel para sockseek que viene con PAILA) con esta lista ya cargada', en: 'Opens NAPIA (the sockseek panel that comes with PAILA) with this list already loaded' },
  soloPlaylist: { es: 'Solo de esta playlist', en: 'Only from this playlist' },
  soloPlaylistTip: { es: 'Muestra, y exporta o manda a NAPIA, solo lo que pide esa playlist: lo que le falta (si la trajiste con "Traer una lista") y los temas suyos de mala calidad, según las casillas de arriba. Sin esto, entra todo lo malo de tu Música.', en: 'Shows, and exports or sends to NAPIA, only what that playlist asks for: what it is missing (if you brought it in with "Bring in a list") and its own poor-quality tracks, according to the boxes above. Without this, everything poor in your Music is included.' },
  elegirPlaylist: { es: 'Elegí una playlist…', en: 'Pick a playlist…' },
  napiaInfo: { es: 'NAPIA es el programa hermano de PAILA: le pasa la lista a sockseek, que la busca y la baja de Soulseek (PAILA no baja nada). Lo que baja queda en Música\\NAPIA; si la Bandeja vigila esa carpeta, PAILA revisa si es mejor que lo que tenés.', en: "NAPIA is PAILA's sister program: it hands the list to sockseek, which looks for it and downloads it from Soulseek (PAILA downloads nothing). What it downloads ends up in Música\\NAPIA; if the Inbox watches that folder, PAILA checks whether it's better than what you have." },
  expTxt: { es: 'Exportar .txt', en: 'Export .txt' },
  expTxtTip: { es: 'Un tema por línea: Artista - Título', en: 'One track per line: Artist - Title' },
  expCsv: { es: 'Exportar .csv', en: 'Export .csv' },
  expCsvTip: { es: 'Para abrir en una planilla (Excel, Google Sheets): artista, título, álbum, duración, calidad actual y la que conviene conseguir', en: 'To open in a spreadsheet (Excel, Google Sheets): artist, title, album, length, current quality and the quality worth getting' },
  paraSockseek: { es: 'Para sockseek ', en: 'For sockseek ' },
  sockseekInfo: { es: 'sockseek baja música de Soulseek (PAILA no baja nada). Esta lista es lo que falta, en el formato que lee: el .txt con un s:"Artista - Tema" por línea y el .csv con artista, título, álbum y duración en segundos.', en: 'sockseek downloads music from Soulseek (PAILA downloads nothing). This list is what is missing, in the format it reads: the .txt with one s:"Artist - Track" per line and the .csv with artist, title, album and length in seconds.' },
  soloNuevos: { es: ' Solo los que todavía no pediste', en: " Only the ones you haven't requested yet" },
  soloNuevosTip: { es: 'Entran los temas "pendientes" y los "pedidos" (o solo los pendientes). Los reemplazados y los ignorados nunca. Al exportar, los pendientes pasan a "pedido".', en: 'Tracks that are "pending" and "requested" are included (or only the pending ones). Replaced and ignored ones never are. When you export, the pending ones become "requested".' },
  paraExportar: { es: (c: string) => `${c} para exportar`, en: (c: string) => `${c} to export` },
  todosEstados: { es: (c: string) => `Todos los estados (${c})`, en: (c: string) => `All statuses (${c})` },
  buscarPh: { es: 'Buscar artista, título o álbum', en: 'Search artist, title or album' },
  armando: { es: 'Armando la lista…', en: 'Building the list…' },
  nada: { es: 'No hay temas para mostrar.', en: 'No tracks to show.' },
  tablaLabel: { es: 'Temas para conseguir', en: 'Tracks to get' },
  colNota: { es: 'Nota', en: 'Grade' },
  colTema: { es: 'Tema · carpeta', en: 'Track · folder' },
  colAhora: { es: 'Ahora', en: 'Now' },
  colPorQue: { es: 'Por qué', en: 'Why' },
  colBuscar: { es: 'Buscar', en: 'Search' },
  colEstado: { es: 'Estado', en: 'Status' },
  tienePeroOtro: { es: (f: string) => `«${f}» tiene este título pero suena como otro tema`, en: (f: string) => `«${f}» has this title but sounds like another track` },
  llegoArchivo: { es: (f: string) => `llegó: ${f}`, en: (f: string) => `arrived: ${f}` },
  notaHoy: { es: 'La nota de calidad de hoy', en: "Today's quality grade" },
  desconocido: { es: 'Artista desconocido', en: 'Unknown artist' },
  conviene: { es: (w: string) => `Conviene: ${w}`, en: (w: string) => `Worth getting: ${w}` },
  deLista: { es: 'Viene de una lista que trajiste (Traer una lista): cuando llegue por la Bandeja, entra solo a esa playlist', en: "Comes from a list you brought in (Bring in a list): when it arrives through the Inbox, it goes into that playlist by itself" },
  ymas: { es: (c: string) => `… y ${c} más. Usá la búsqueda o el filtro de estado.`, en: (c: string) => `… and ${c} more. Use the search or the status filter.` },
  guardada: { es: (c: string, m: string) => `Lista guardada: ${c} temas${m ? ` (${m} nuevos quedaron "pedidos")` : ''}.`, en: (c: string, m: string) => `List saved: ${c} tracks${m ? ` (${m} new ones are now "requested")` : ''}.` },
  bandejaNapia: { es: (d: string) => ` La Bandeja ahora vigila ${d}: lo que baje NAPIA aparece ahí para pasarlo a tu Música.`, en: (d: string) => ` The Inbox now watches ${d}: what NAPIA downloads shows up there, ready to move into your Music.` },
  abriendoNapia: { es: (c: string) => `Abriendo NAPIA con ${c} temas. Ahí elegís dónde guardar y tocás "Bajar".`, en: (c: string) => `Opening NAPIA with ${c} tracks. There you pick where to save and tap "Download".` },
})
// idioma-ok (nombres de tiendas)
export const SITES = [
  { id: 'bandcamp', label: 'Bandcamp' }, { id: 'qobuz', label: 'Qobuz' }, { id: '7digital', label: '7digital' }, // idioma-ok
  { id: 'hdtracks', label: 'HDtracks' }, { id: 'discogs', get label() { return T.discogs } }, // idioma-ok
]
/** "Buscar en…": abre la búsqueda en la tienda que elijas (un menú en vez de cinco links por fila). */
export function BuscarEn({ onSite }: { onSite: (site: string) => void }) {
  return (
    <select className="buscar-en" value="" onChange={(e) => { if (e.target.value) onSite(e.target.value) }} title={T.buscarEnTip}>
      <option value="">{T.buscarEn}</option>
      {SITES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  )
}
const STATUS: { id: WantedStatus; label: string; help: string }[] = [
  { id: 'pendiente', label: T.sPendiente, help: T.sPendienteH },
  { id: 'pedido', label: T.sPedido, help: T.sPedidoH },
  { id: 'llego', label: T.sLlego, help: T.sLlegoH },
  { id: 'reemplazado', label: T.sReemplazado, help: T.sReemplazadoH },
  { id: 'ignorar', label: T.sIgnorar, help: T.sIgnorarH },
]
const REASON: Record<WantedReason, { label: string; help: string }> = {
  nota: { label: T.rNota, help: T.rNotaH },
  lossless_falso: { label: T.rFalso, help: T.rFalsoH },
  inflado: { label: T.rInflado, help: T.rInfladoH },
  rekordbox: { label: T.rRekordbox, help: T.rRekordboxH },
  falta: { label: T.rFalta, help: T.rFaltaH },
  falta_disco: { label: T.rFaltaDisco, help: T.rFaltaDiscoH },
  puede_mp3: { label: T.rMp3, help: T.rMp3H },
}
const CRITERIA: { key: keyof WantedCriteria; label: string; help: string }[] = [
  { key: 'bad', label: T.cBad, help: T.cBadH },
  { key: 'fair', label: T.cFair, help: T.cFairH },
  { key: 'fakes', label: T.cFakes, help: `${REASON.lossless_falso.help} ${REASON.inflado.help}` },
  { key: 'rekordbox', label: T.cRekordbox, help: REASON.rekordbox.help },
  { key: 'mp3like', label: T.cMp3, help: REASON.puede_mp3.help },
]

/** Lista por tema, con casillas de qué entra, estados y exportación. */
export function WantedList() {
  const [crit, setCrit] = useState<WantedCriteria | null>(null)
  const [items, setItems] = useState<WantedItem[] | null>(null)
  const [filter, setFilter] = useState<WantedStatus | 'todos'>('todos')
  const [q, setQ] = useState('')
  const [onlyNew, setOnlyNew] = useState(false)
  // qué parte: mejorar lo que ya tenés, lo que te falta o todo (el autor, 1/11: quería bajar primero lo que mejora lo que tiene)
  const [que, setQue] = useState<WantedQue>('calidad')
  // "Solo de esta playlist": con la casilla tildada y una playlist elegida, todo (la tabla, Bajar con NAPIA y Exportar) es solo de esa
  const [listas, setListas] = useState<PlaylistNode[]>([])
  const [soloLista, setSoloLista] = useState(false)
  const [lista, setLista] = useState<number | null>(null)
  const playlistId = soloLista ? lista : null
  useEffect(() => {
    const f = () => { window.paila.playlists().then((p) => setListas(p.filter((x) => x.kind !== 'folder'))).catch(() => null) }
    f(); window.addEventListener('paila:playlists', f); return () => window.removeEventListener('paila:playlists', f)
  }, [])
  useEffect(() => { window.paila.wantedCriteria().then(setCrit) }, [])
  const load = useCallback(async (c: WantedCriteria) => { try { setItems(await window.paila.wanted(c, playlistId)) } catch (e) { toast(clean(e), 'error') } }, [playlistId])
  useEffect(() => { if (crit) void load(crit) }, [crit, load])
  // la lista llega con los nombres de los tags; cuando el hilo termina de limpiarlos, se vuelve a pedir (P1, 27/10)
  const [limpiando, setLimpiando] = useState(false)
  useEffect(() => window.paila.onWantedLimpios((l) => { setLimpiando(l); if (!l && crit) void load(crit) }), [crit, load])

  const counts = useMemo(() => Object.fromEntries(STATUS.map((s) => [s.id, (items ?? []).filter((i) => i.status === s.id).length])) as Record<WantedStatus, number>, [items])
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (items ?? []).filter((i) => enQue(i, que) && (filter === 'todos' || i.status === filter) && words.every((w) => `${i.artist} ${i.title} ${i.album ?? ''}`.toLowerCase().includes(w)))
  }, [items, filter, q, que])
  const exportable = (i: WantedItem) => i.status === 'pendiente' || (!onlyNew && i.status === 'pedido')
  const porQue = (x: WantedQue) => (items ?? []).filter((i) => exportable(i) && enQue(i, x)).length
  const toExport = porQue(que)

  const setStatus = async (i: WantedItem, s: WantedStatus) => { await window.paila.setWantedStatus(i.key, s); if (crit) load(crit) }
  const exportAs = async (format: WantedFormat) => {
    try {
      const r = await window.paila.exportWanted(format, onlyNew, playlistId, que)
      if (!r) return
      toast(T.guardada(n(r.count), r.marked ? n(r.marked) : ''))
      if (crit) load(crit)
    } catch (e) { toast(clean(e), 'error') }
  }

  const toNapia = async () => {
    try {
      const r = await window.paila.wantedToNapia(onlyNew, playlistId, que)
      if (!r) return
      toast(T.abriendoNapia(n(r.count)) + (r.bandeja ? T.bandejaNapia(r.bandeja) : ''))
      if (crit) load(crit)
    } catch (e) { toast(clean(e), 'error') }
  }

  return (
    <>
      {/* lo principal primero: bajar con NAPIA o exportar; qué incluir queda plegado y la explicación va en el ⓘ de la
          pestaña, para que los temas se vean sin bajar en una pantalla chica (usabilidad, 27/10/2026) */}
      <div className="row wl-que" role="group">
        {(['calidad', 'faltan', 'todo'] as const).map((x) => (
          <Boton key={x} variant="ghost" selected={que === x} onClick={() => setQue(x)} title={T[x === 'calidad' ? 'qCalidadTip' : x === 'faltan' ? 'qFaltanTip' : 'qTodoTip']}>
            {T[x === 'calidad' ? 'qCalidad' : x === 'faltan' ? 'qFaltan' : 'qTodo'](n(porQue(x)))}
          </Boton>
        ))}
      </div>
      <div className="row wl-acciones">
        <Boton disabled={!toExport} onClick={toNapia} title={T.bajarNapiaTip}>{T.bajarNapia}</Boton>
        <Info tip={T.napiaInfo} />
        <Boton variant="ghost" disabled={!toExport} onClick={() => exportAs('txt')} title={T.expTxtTip}>{T.expTxt}</Boton>
        <Boton variant="ghost" disabled={!toExport} onClick={() => exportAs('csv')} title={T.expCsvTip}>{T.expCsv}</Boton>
        <span className="small muted">{T.paraSockseek}<Info tip={T.sockseekInfo} />:</span>
        <Boton variant="ghost" size="sm" disabled={!toExport} onClick={() => exportAs('sockseek-txt')}>.txt</Boton>
        <Boton variant="ghost" size="sm" disabled={!toExport} onClick={() => exportAs('sockseek-csv')}>.csv</Boton>
        <label className="small"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />{T.soloNuevos}</label>
        <span className="info" title={T.soloNuevosTip}>ⓘ</span>
        <span className="muted small">{T.paraExportar(n(toExport))}</span>
      </div>
      <div className="row wl-filtros">
        <select value={filter} onChange={(e) => setFilter(e.target.value as WantedStatus | 'todos')}>
          <option value="todos">{T.todosEstados(n(items?.length ?? 0))}</option>
          {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label} ({counts[s.id] ?? 0})</option>)}
        </select>
        <input type="text" style={{ minWidth: 260 }} placeholder={T.buscarPh} value={q} onChange={(e) => setQ(e.target.value)} />
        <details className="wl-incluir">
          <summary>{T.queIncluir}</summary>
        {crit && (
          <div className="row">
            {CRITERIA.map((c) => (
              <label key={c.key} className="small" title={c.help}>
                <input type="checkbox" checked={!!crit[c.key]} onChange={(e) => setCrit({ ...crit, [c.key]: e.target.checked })} /> {c.label}<span className="info">ⓘ</span>
              </label>
            ))}
          </div>
        )}
        <div className="row">
          <label className="small"><input type="checkbox" checked={soloLista} onChange={(e) => { setSoloLista(e.target.checked); if (e.target.checked && lista == null) setLista(listas[0]?.id ?? null) }} /> {T.soloPlaylist}</label>
          <Info tip={T.soloPlaylistTip} />
          {soloLista && <select value={lista ?? ''} onChange={(e) => setLista(e.target.value ? Number(e.target.value) : null)}>
            {lista == null && <option value="">{T.elegirPlaylist}</option>}
            {listas.map((p) => <option key={p.id} value={p.id}>{p.name} ({n(p.count)})</option>)}
          </select>}
        </div>
        </details>
        {limpiando && <span className="muted small">{T.limpiando} <Info tip={T.limpiandoTip} /></span>}
      </div>

      {items == null && <p className="muted">{T.armando}</p>}
      {items && shown.length === 0 && <p className="muted">{T.nada}</p>}
      {shown.length > 0 && (
        <div className="wl-tabla" role="table" aria-label={T.tablaLabel}>
          <div className="wl-fila wl-cab" role="row">
            <span>{T.colNota}</span><span>{T.colTema}</span><span>{T.colAhora}</span><span>{T.colPorQue}</span><span>{T.colBuscar}</span><span>{T.colEstado}</span>
          </div>
          {shown.slice(0, 400).map((i) => {
            const donde = [i.rel, i.refRel ? T.tienePeroOtro(i.refRel.split('/').pop() ?? '') : '', i.arrivedPath ? T.llegoArchivo(i.arrivedPath.split(/[\\/]/).pop() ?? '') : ''].filter(Boolean).join(' · ')
            return (
              <div key={i.key} role="row" className={`wl-fila ${i.status === 'ignorar' || i.status === 'reemplazado' ? 'skipped' : ''}`}>
                <span>{i.grade ? <Nota grade={i.grade} title={T.notaHoy} /> : <b className="grade">–</b>}</span>
                <span className="wl-tema" title={`${i.artist} — ${i.title}${donde ? `\n${donde}` : ''}`}>
                  <span className="ellipsis"><b>{i.artist || T.desconocido}</b> — {i.title}</span>
                  {donde && <span className="ellipsis muted small">{donde}</span>}
                </span>
                {/* la nota ya tiene su columna: no se repite acá */}
                <span className="small num" title={T.conviene(i.want)}>{i.quality.replace(/\s*·\s*(nota|grade)\s+\S+/, '')}{i.duration ? <span className="muted"> · {duration(i.duration)}</span> : null}</span>
                <span className="wl-por">
                  {i.reasons.map((r) => <span key={r} className="pill" title={REASON[r].help}>{REASON[r].label}</span>)}
                  {i.note.startsWith('no_soulseek:') && <span className="pill pill-amber" title={T.noSoulseekTip}>{T.noSoulseek(i.note.slice(12).split('-').reverse().slice(0, 2).join('/'))}</span>}
                  {i.requests.map((r) => <span key={r} className="pill pill-blue" title={T.deLista}>«{r}»</span>)}
                </span>
                <BuscarEn onSite={(s) => window.paila.openWishSearch(s, i.artist, i.title)} />
                <select value={i.status} onChange={(e) => setStatus(i, e.target.value as WantedStatus)} title={STATUS.find((s) => s.id === i.status)?.help}>
                  {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            )
          })}
        </div>
      )}
      {shown.length > 400 && <p className="muted">{T.ymas(n(shown.length - 400))}</p>}
    </>
  )
}
