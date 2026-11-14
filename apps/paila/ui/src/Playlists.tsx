// Piezas de la lista de playlists en la barra lateral: crear, importar, elegir, arrastrar temas y la barra de acciones.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Grade, PlaylistKind, PlaylistNode, SmartRules } from '@paila/shared/types'
import { Icon, type IconName } from './icons'
import { Boton } from '@paila/diseno'
import { textos, cant } from '@paila/shared/idioma'
import { Mosaico } from './Tapas'

const T = textos({
  nuevaPlaylist: { es: 'Nueva playlist', en: 'New playlist' },
  nuevaCarpeta: { es: 'Nueva carpeta de playlists', en: 'New playlist folder' },
  nuevaInteligente: {
    es: 'Nueva playlist inteligente: se llena sola con reglas, por ejemplo House, BPM 120–128, nota B o mejor',
    en: 'New smart playlist: it fills itself using rules, for example House, BPM 120–128, grade B or better',
  },
  importar: { es: 'Importar una playlist de un archivo .m3u o .m3u8', en: 'Import a playlist from an .m3u or .m3u8 file' },
  nombreCarpeta: { es: 'Nombre de la carpeta', en: 'Folder name' },
  nombreInteligente: { es: 'Nombre (después elegís las reglas)', en: 'Name (you pick the rules afterwards)' },
  nombrePlaylist: { es: 'Nombre de la playlist', en: 'Playlist name' },
  creaDentro: { es: (nombre: string) => `Se crea dentro de "${nombre}". `, en: (nombre: string) => `It will be created inside "${nombre}". ` },
  enterCrear: { es: 'Enter para crear, Esc para cancelar.', en: 'Enter to create, Esc to cancel.' },
  tituloInteligente: { es: 'Playlist inteligente: se llena sola con reglas', en: 'Smart playlist: it fills itself using rules' },
  tituloCarpeta: { es: 'Carpeta de playlists', en: 'Playlist folder' },
  tituloLista: { es: 'Soltá temas acá para agregarlos', en: 'Drop tracks here to add them' },
  vacio: { es: 'Todavía no hay playlists. Usá los botones de arriba.', en: 'There are no playlists yet. Use the buttons above.' },
  rotuloInteligente: { es: 'Playlist inteligente', en: 'Smart playlist' },
  rotuloLista: { es: 'Playlist', en: 'Playlist' },
  cuenta: { es: (c: number) => ` · ${c} temas`, en: (c: number) => ` · ${cant(c, 'track', 'tracks')}` },
  dobleClic: { es: 'Doble clic para renombrar', en: 'Double-click to rename' },
  escuchar: { es: 'Escuchar', en: 'Play' },
  escucharTip: { es: 'Escuchar la playlist desde el principio', en: 'Play the playlist from the beginning' },
  mejorar: { es: 'Mejorar…', en: 'Improve…' },
  mejorarTip: { es: 'Cambia los temas por una versión mejor que ya tengas en la biblioteca', en: 'Swaps the tracks for a better version you already have in the library' },
  limpiar: { es: 'Limpiar…', en: 'Clean up…' },
  limpiarTip: {
    es: 'Saca los temas repetidos en otra calidad (deja el mejor) y los que desaparecieron hace rato. Muestra antes qué saca y se puede deshacer',
    en: 'Removes tracks repeated in another quality (keeps the best one) and the ones that went missing a while ago. It shows you what it removes first, and you can undo it',
  },
  fusionar: { es: 'Fusionar…', en: 'Merge…' },
  fusionarTip: { es: 'Arma una playlist nueva con esta y otras, sin repetidos', en: 'Makes a new playlist from this one and others, with no repeats' },
  ordenar: { es: 'Ordenar por tono y BPM', en: 'Sort by key and BPM' },
  ordenarTip: { es: 'Ordena la lista para que cada tema combine con el siguiente por tono y BPM', en: 'Sorts the list so each track blends with the next one by key and BPM' },
  aPendrive: { es: 'A pendrive o carpeta…', en: 'To a USB stick or folder…' },
  aPendriveTip: { es: 'Copia los temas a un pendrive o carpeta, en orden, para tocar sin Rekordbox', en: 'Copies the tracks to a USB stick or folder, in order, so you can play without Rekordbox' },
  masTip: { es: 'Renombrar, exportar o borrar', en: 'Rename, export or delete' },
  renombrar: { es: 'Renombrar', en: 'Rename' },
  exportar: { es: 'Exportar .m3u8', en: 'Export .m3u8' },
  exportarTip: { es: 'Guarda un archivo .m3u8 que abre casi cualquier reproductor', en: 'Saves an .m3u8 file that almost any player can open' },
  aExcel: { es: 'A Excel (.csv)', en: 'To Excel (.csv)' },
  aExcelTip: {
    es: 'Guarda la playlist como la ves (en su orden y con las columnas que se ven) en un .csv que abre Excel con doble clic',
    en: 'Saves the playlist as you see it (in its order and with the visible columns) in a .csv that opens in Excel with a double-click',
  },
  borrarPregunta: {
    es: (carpeta: boolean) => `¿Borrar${carpeta ? ' con todo lo que tiene adentro' : ''}? Los temas no se borran.`,
    en: (carpeta: boolean) => `Delete${carpeta ? ' with everything inside it' : ''}? The tracks are not deleted.`,
  },
  borrarDeshacer: { es: 'Se puede deshacer desde el Historial.', en: 'It can be undone from the History.' },
  borrarPedidos: {
    es: 'Lo que le falta sigue en la lista «Faltan o suenan mal», pero ya no se puede filtrar por esta playlist.',
    en: "What it's missing stays on the Wanted list, but you can no longer filter it by this playlist.",
  },
  siBorrar: { es: 'Sí, borrar', en: 'Yes, delete' },
  no: { es: 'No', en: 'No' },
  borrarLista: { es: 'Borrar la playlist', en: 'Delete the playlist' },
  borrarCarpeta: { es: 'Borrar la carpeta', en: 'Delete the folder' },
  borrarAtajo: { es: 'Clic derecho o Supr para borrar', en: 'Right-click or Delete to remove it' },
  subeTip: { es: 'Sube el tema elegido en la lista', en: 'Moves the chosen track up in the list' },
  bajaTip: { es: 'Baja el tema elegido en la lista', en: 'Moves the chosen track down in the list' },
  sacar: { es: 'Sacar de la playlist', en: 'Remove from playlist' },
  sacarTip: { es: 'Saca el tema de esta playlist. El archivo no se toca.', en: "Removes the track from this playlist. The file isn't touched." },
  texto: { es: 'Texto', en: 'Text' },
  textoPh: { es: 'artista, título, álbum…', en: 'artist, title, album…' },
  genero: { es: 'Género', en: 'Genre' },
  generoPh: { es: 'House, Cumbia…', en: 'House, Cumbia…' },
  bpmTip: { es: 'Golpes por minuto', en: 'Beats per minute' },
  bpmDe: { es: 'BPM de', en: 'BPM from' },
  a: { es: 'a', en: 'to' },
  notaMinTip: { es: 'Nota mínima: B incluye A+, A y B', en: 'Minimum grade: B includes A+, A and B' },
  notaMin: { es: 'Nota mínima', en: 'Minimum grade' },
  cualquiera: { es: 'cualquiera', en: 'any' },
  oMejor: { es: (g: string) => `${g} o mejor`, en: (g: string) => `${g} or better` },
  tonoTip: { es: 'Tono en notación Camelot, por ejemplo 8A', en: 'Key in Camelot notation, for example 8A' },
  tono: { es: 'Tono', en: 'Key' },
  agregados: { es: 'Agregados en los últimos', en: 'Added in the last' },
  dias: { es: 'días', en: 'days' },
  agregarTip: { es: 'Suma el tema a una playlist. El archivo no se copia ni se mueve.', en: "Adds the track to a playlist. The file isn't copied or moved." },
  agregarA: { es: '+ Agregar a playlist…', en: '+ Add to playlist…' },
})

export const DRAG_TYPE = 'application/x-paila-tracks'

const ICON: Record<PlaylistKind, IconName> = { list: 'list', folder: 'folder', smart: 'sparkle' }

/** Botones de crear playlist, carpeta, inteligente e importar: van en el título del grupo "Playlists". */
export function PlaylistTools({ nodes, activeId, onCreate, onImport }: {
  nodes: PlaylistNode[]; activeId: number | null
  onCreate: (name: string, kind: PlaylistKind, parentId: number | null) => void
  onImport: () => void
}) {
  const [adding, setAdding] = useState<PlaylistKind | null>(null)
  const [name, setName] = useState('')
  const active = nodes.find((n) => n.id === activeId)
  // Si hay una carpeta elegida, lo nuevo se crea adentro.
  const parentId = active?.kind === 'folder' ? active.id : null
  const submit = () => { if (adding && name.trim()) { onCreate(name.trim(), adding, parentId); setName(''); setAdding(null) } }
  return (
    <>
      <div className="side-mini-tools">
        <button className="mini-btn" onClick={() => setAdding('list')} title={T.nuevaPlaylist}><Icon name="list" size={13} /></button>
        <button className="mini-btn" onClick={() => setAdding('folder')} title={T.nuevaCarpeta}><Icon name="folder" size={13} /></button>
        <button className="mini-btn" onClick={() => setAdding('smart')} title={T.nuevaInteligente}><Icon name="sparkle" size={13} /></button>
        <button className="mini-btn" onClick={onImport} title={T.importar}><Icon name="import" size={13} /></button>
      </div>
      {adding && (
        <div className="pl-new">
          <input autoFocus placeholder={adding === 'folder' ? T.nombreCarpeta : adding === 'smart' ? T.nombreInteligente : T.nombrePlaylist}
            value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (!name.trim()) setAdding(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setAdding(null); setName('') } }} />
          <div className="muted small">{parentId ? T.creaDentro(active!.name) : ''}{T.enterCrear}</div>
        </div>
      )}
    </>
  )
}

/**
 * La pregunta antes de borrar una playlist (desde el ⋯, el clic derecho o Supr): si armaba un pedido de "Traer una lista",
 * avisa que lo que le falta queda en la lista «Faltan o suenan mal» sin poder filtrarse por ella (uso real del 24/10).
 */
export function BorrarPregunta({ node, onYes, onNo }: { node: PlaylistNode; onYes: () => void; onNo: () => void }) {
  const [pedidos, setPedidos] = useState(0)
  useEffect(() => { let vivo = true; window.paila.deletePlaylistInfo(node.id).then((r) => { if (vivo) setPedidos(r.requests) }).catch(() => {}); return () => { vivo = false } }, [node.id])
  return (
    <div className="pl-borrar">
      <span className="small">{T.borrarPregunta(node.kind === 'folder')} {pedidos > 0 && T.borrarPedidos} {T.borrarDeshacer}</span>
      <Boton size="sm" autoFocus onClick={onYes}>{T.siBorrar}</Boton><Boton variant="ghost" size="sm" onClick={onNo}>{T.no}</Boton>
    </div>
  )
}

/** Lista de playlists de la barra lateral. Se puede soltar temas de la tabla encima para agregarlos; clic derecho o Supr, borrar. */
export function PlaylistList({ nodes, activeId, ids, onSelect, onDrop, onDelete }: {
  nodes: PlaylistNode[]; activeId: number | null
  /** Solo estas, en este orden y sin carpetas (la barra lateral muestra unas pocas); sin esto, el árbol entero. */
  ids?: number[]
  onSelect: (id: number) => void
  onDrop: (id: number, trackIds: number[]) => void
  onDelete: (id: number) => void
}) {
  const [over, setOver] = useState<number | null>(null)
  // el menú del clic derecho (o la pregunta directa, con Supr), donde se abrió
  const [menu, setMenu] = useState<{ node: PlaylistNode; x: number; y: number; confirm: boolean } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const clic = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', clic); document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('mousedown', clic); document.removeEventListener('keydown', tecla) }
  }, [menu])
  const render = (parent: number | null, depth: number): React.ReactNode =>
    (ids ? ids.map((id) => nodes.find((n) => n.id === id)).filter((n): n is PlaylistNode => !!n) : nodes.filter((n) => n.parentId === parent)).map((n) => (
      <div key={n.id}>
        <button
          className={`side-item pl-item ${activeId === n.id ? 'on' : ''} ${over === n.id ? 'drop' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => onSelect(n.id)}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ node: n, x: e.clientX, y: e.clientY, confirm: false }) }}
          onKeyDown={(e) => { if (e.key === 'Delete') { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ node: n, x: r.left + 12, y: r.bottom, confirm: true }) } }}
          onDragOver={(e) => { if (n.kind === 'list' && e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(n.id) } }}
          onDragLeave={() => setOver((o) => (o === n.id ? null : o))}
          onDrop={(e) => { e.preventDefault(); setOver(null); try { onDrop(n.id, JSON.parse(e.dataTransfer.getData(DRAG_TYPE))) } catch { /* nada */ } }}
          title={`${n.kind === 'smart' ? T.tituloInteligente : n.kind === 'folder' ? T.tituloCarpeta : T.tituloLista}. ${T.borrarAtajo}`}
        >
          <Icon name={ICON[n.kind]} className="side-ico" />
          <span className="side-label">{n.name}</span>
          {n.kind !== 'folder' && <span className="count">{n.count}</span>}
        </button>
        {n.kind === 'folder' && !ids && render(n.id, depth + 1)}
      </div>
    ))
  return <>
    {render(null, 0)}{!nodes.length && <div className="muted side-hint">{T.vacio}</div>}
    {/* en el cuerpo de la página: dentro de la barra lateral (con su propio scroll) quedaba cortado o corrido */}
    {menu && createPortal(
      <div className="pl-menu pl-menu-flota" ref={menuRef} style={{ left: Math.min(menu.x, window.innerWidth - 330), top: Math.min(menu.y, window.innerHeight - 160) }}>
        {menu.confirm
          ? <BorrarPregunta node={menu.node} onYes={() => { setMenu(null); onDelete(menu.node.id) }} onNo={() => setMenu(null)} />
          : <button onClick={() => setMenu({ ...menu, confirm: true })}>{menu.node.kind === 'folder' ? T.borrarCarpeta : T.borrarLista}…</button>}
      </div>, document.body,
    )}
  </>
}

const GRADES: Grade[] = ['A+', 'A', 'B', 'C', 'D', 'F']
const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')))

/** Barra de la playlist elegida: nombre, exportar, borrar, ordenar y reglas (si es inteligente). */
export function PlaylistBar({ node, selectedInList, onPlay, onRename, onDelete, onExport, onExcel, onUsb, onImprove, onClean, onMerge, onHarmonic, onRemoveTracks, onMove, onRules }: {
  node: PlaylistNode; selectedInList: boolean
  /** Escuchar la playlist desde el principio. */
  onPlay: () => void
  onRename: (name: string) => void; onDelete: () => void; onExport: () => void; /** La playlist a un .csv para Excel, con las columnas que se ven. */ onExcel: () => void; onUsb: () => void; onImprove: () => void; onClean: () => void; onMerge: () => void; onHarmonic: () => void
  onRemoveTracks: () => void; onMove: (dir: -1 | 1) => void; onRules: (r: SmartRules) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [mas, setMas] = useState(false)
  const masRef = useRef<HTMLSpanElement>(null)
  // el menú ⋯ se cierra con un clic afuera o con Esc
  useEffect(() => {
    if (!mas) return
    const cerrar = () => { setMas(false); setConfirmDel(false) }
    const clic = (e: MouseEvent) => { if (!masRef.current?.contains(e.target as Node)) cerrar() }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    document.addEventListener('mousedown', clic); document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('mousedown', clic); document.removeEventListener('keydown', tecla) }
  }, [mas])
  const r = node.rules ?? {}
  const set = (patch: Partial<SmartRules>) => onRules({ ...r, ...patch })
  const lista = node.kind === 'list', conTemas = node.kind !== 'folder'

  return (
    <div className="pl-bar">
      <div className="pl-cab">
        {conTemas ? <div className="pl-tapa"><Mosaico node={node} /></div> : <Icon name={ICON[node.kind]} size={20} className="pl-icon" />}
        <div className="pl-txt">
          <span className="rotulo">{node.kind === 'smart' ? T.rotuloInteligente : node.kind === 'folder' ? T.tituloCarpeta : T.rotuloLista}{conTemas ? T.cuenta(node.count) : ''}</span>
          {renaming ? (
            <input autoFocus defaultValue={node.name} onBlur={(e) => { setRenaming(false); if (e.target.value.trim() && e.target.value !== node.name) onRename(e.target.value) }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(false) }} />
          ) : <b className="pl-name titulo" onDoubleClick={() => setRenaming(true)} title={T.dobleClic}>{node.name}</b>}
          <div className="pl-acciones">
            {conTemas && <Boton size="sm" onClick={onPlay} disabled={!node.count} title={T.escucharTip}><Icon name="play" size={13} /> {T.escuchar}</Boton>}
            {conTemas && <span className="pl-sep" />}
            {lista && <Boton variant="ghost" size="sm" onClick={onImprove} title={T.mejorarTip}>{T.mejorar}</Boton>}
            {lista && <Boton variant="ghost" size="sm" onClick={onClean} title={T.limpiarTip}>{T.limpiar}</Boton>}
            {conTemas && <Boton variant="ghost" size="sm" onClick={onMerge} title={T.fusionarTip}>{T.fusionar}</Boton>}
            {lista && <Boton variant="ghost" size="sm" onClick={onHarmonic} title={T.ordenarTip}>{T.ordenar}</Boton>}
            {conTemas && <span className="pl-sep" />}
            {conTemas && <Boton variant="ghost" size="sm" onClick={onUsb} title={T.aPendriveTip}>{T.aPendrive}</Boton>}
            <span className="pl-mas" ref={masRef}>
              <Boton variant="ghost" size="sm" onClick={() => setMas((m) => !m)} aria-expanded={mas} title={T.masTip}>⋯</Boton>
              {mas && (
                <div className="pl-menu">
                  <button onClick={() => { setMas(false); setRenaming(true) }}>{T.renombrar}</button>
                  {conTemas && <button onClick={() => { setMas(false); onExport() }} title={T.exportarTip}>{T.exportar}</button>}
                  {conTemas && <button onClick={() => { setMas(false); onExcel() }} title={T.aExcelTip}>{T.aExcel}</button>}
                  {confirmDel
                    ? <BorrarPregunta node={node} onYes={() => { setConfirmDel(false); setMas(false); onDelete() }} onNo={() => setConfirmDel(false)} />
                    : <button onClick={() => setConfirmDel(true)}>{node.kind === 'folder' ? T.borrarCarpeta : T.borrarLista}</button>}
                </div>
              )}
            </span>
            {lista && selectedInList && (<span className="pl-elegido">
              <Boton variant="ghost" size="sm" onClick={() => onMove(-1)} title={T.subeTip}>↑</Boton>
              <Boton variant="ghost" size="sm" onClick={() => onMove(1)} title={T.bajaTip}>↓</Boton>
              <Boton variant="ghost" size="sm" onClick={onRemoveTracks} title={T.sacarTip}>{T.sacar}</Boton>
            </span>)}
          </div>
        </div>
      </div>
      {node.kind === 'smart' && (
        <div className="pl-rules">
          <label>{T.texto}<input defaultValue={r.text ?? ''} placeholder={T.textoPh} onBlur={(e) => set({ text: e.target.value.trim() || undefined })} /></label>
          <label>{T.genero}<input defaultValue={r.genre ?? ''} placeholder={T.generoPh} onBlur={(e) => set({ genre: e.target.value.trim() || undefined })} /></label>
          <label title={T.bpmTip}>{T.bpmDe}<input className="narrow" defaultValue={r.bpmMin ?? ''} onBlur={(e) => set({ bpmMin: num(e.target.value) })} /></label>
          <label>{T.a}<input className="narrow" defaultValue={r.bpmMax ?? ''} onBlur={(e) => set({ bpmMax: num(e.target.value) })} /></label>
          <label title={T.notaMinTip}>{T.notaMin}
            <select value={r.gradeMin ?? ''} onChange={(e) => set({ gradeMin: (e.target.value || undefined) as Grade | undefined })}>
              <option value="">{T.cualquiera}</option>{GRADES.map((g) => <option key={g} value={g}>{T.oMejor(g)}</option>)}
            </select></label>
          <label title={T.tonoTip}>{T.tono}<input className="narrow" defaultValue={r.camelot ?? ''} placeholder="8A" onBlur={(e) => set({ camelot: e.target.value.trim().toUpperCase() || undefined })} /></label>
          <label>{T.agregados}<input className="narrow" defaultValue={r.addedDays ?? ''} onBlur={(e) => set({ addedDays: num(e.target.value) })} /> {T.dias}</label>
        </div>
      )}
    </div>
  )
}

/** Selector "Agregar a playlist…" para el panel de la derecha. */
export function AddToPlaylist({ nodes, onAdd }: { nodes: PlaylistNode[]; onAdd: (id: number) => void }) {
  const lists = nodes.filter((n) => n.kind === 'list')
  if (!lists.length) return null
  return (
    <div className="add-pl">
      <select value="" onChange={(e) => { if (e.target.value) onAdd(Number(e.target.value)) }} title={T.agregarTip}>
        <option value="">{T.agregarA}</option>
        {lists.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
      </select>
    </div>
  )
}
