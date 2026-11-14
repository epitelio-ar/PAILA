// Pantalla Playlists: todas las playlists con sus tapas, para recorrerlas (la barra lateral muestra solo las fijadas y las últimas).
// Buscar, ordenar, fijar, abrir, escuchar, fusionar, borrar (clic derecho o Supr), crear y entrar en las carpetas. Se les pueden soltar temas.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PlaylistKind, PlaylistNode } from '@paila/shared/types'
import { Boton, Cabecera } from '@paila/diseno'
import { textos, cant } from '@paila/shared/idioma'
import { Icon } from './icons'
import { Mosaico } from './Tapas'
import { BorrarPregunta, DRAG_TYPE, PlaylistTools } from './Playlists'
import { NAV_GROUPS, NAV_PLAYLISTS, type PageKey } from './nav'

const AYUDA = (page: PageKey) => NAV_GROUPS.flatMap((g) => g.items).find((i) => i.page === page)?.help

const T = textos({
  sub: { es: 'Todas tus playlists. Las que fijes con el corazón y las que uses se ven también en la barra lateral.', en: 'All your playlists. The ones you pin with the heart and the ones you use also show in the sidebar.' },
  buscar: { es: 'Buscar una playlist…', en: 'Search a playlist…' },
  ordenar: { es: 'Ordenar', en: 'Sort' },
  porUso: { es: 'Fijadas y últimas usadas', en: 'Pinned and recently used' },
  porNombre: { es: 'Por nombre', en: 'By name' },
  porTemas: { es: 'Más temas primero', en: 'Most tracks first' },
  porNuevas: { es: 'Más nuevas primero', en: 'Newest first' },
  total: { es: (k: number) => cant(k, 'playlist', 'playlists'), en: (k: number) => cant(k, 'playlist', 'playlists') },
  temas: { es: (k: number) => cant(k, 'tema', 'temas'), en: (k: number) => cant(k, 'track', 'tracks') },
  carpeta: { es: 'Carpeta', en: 'Folder' },
  inteligente: { es: 'Inteligente', en: 'Smart' },
  todas: { es: 'Todas', en: 'All' },
  abrirX: { es: (x: string) => `Abrir «${x}»`, en: (x: string) => `Open "${x}"` },
  escucharX: { es: (x: string) => `Escuchar «${x}»`, en: (x: string) => `Listen to "${x}"` },
  fijar: { es: 'Fijar en la barra lateral', en: 'Pin to the sidebar' },
  desfijar: { es: 'Sacar de la barra lateral', en: 'Remove from the sidebar' },
  mas: { es: 'Fusionar o borrar (también con clic derecho)', en: 'Merge or delete (also with right-click)' },
  abrir: { es: 'Abrir', en: 'Open' },
  fusionar: { es: 'Fusionar…', en: 'Merge…' },
  borrarLista: { es: 'Borrar la playlist…', en: 'Delete the playlist…' },
  borrarCarpeta: { es: 'Borrar la carpeta…', en: 'Delete the folder…' },
  ninguna: { es: 'Ninguna playlist se llama así.', en: 'No playlist has that name.' },
  vacia: { es: 'Todavía no hay playlists. Creá una con los botones de arriba, o traé una con «Traer una lista».', en: 'There are no playlists yet. Create one with the buttons above, or bring one in with "Bring in a list".' },
  traer: { es: 'Traer una lista', en: 'Bring in a list' },
  carpetas: { es: 'Carpetas → Playlists', en: 'Folders → Playlists' },
  soltar: { es: 'Soltá temas de la biblioteca sobre una playlist para agregarlos.', en: 'Drop tracks from the library onto a playlist to add them.' },
})

/** El mosaico se arma recién cuando la tarjeta entra en pantalla: con 66 playlists no se piden 66 tapas de golpe. */
function TapaLazy({ node }: { node: PlaylistNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ver, setVer] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setVer(true); return }
    const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVer(true); o.disconnect() } }, { rootMargin: '200px' })
    o.observe(el)
    return () => o.disconnect()
  }, [])
  return <div ref={ref} style={{ width: '100%', height: '100%' }}>{ver ? <Mosaico node={node} /> : null}</div>
}

interface Props {
  nodes: PlaylistNode[]
  fijadas: number[]; recientes: number[]; onFijar: (id: number) => void
  onOpen: (id: number) => void; onPlay: (id: number) => void; onMerge: (n: PlaylistNode) => void
  onDrop: (id: number, trackIds: number[]) => void; onDelete: (id: number) => void
  onCreate: (name: string, kind: PlaylistKind, parentId: number | null) => void; onImport: () => void
  /** Traer una lista y Carpetas → Playlists: son playlists, así que se llega desde acá (MASTERPLAN-5, etapa 6) */
  onGo: (page: PageKey) => void
}

type Orden = 'uso' | 'nombre' | 'temas' | 'nuevas'

export default function PlaylistsPage(p: Props) {
  const [q, setQ] = useState('')
  const [orden, setOrden] = useState<Orden>('uso')
  const [carpeta, setCarpeta] = useState<number | null>(null)
  const [sobre, setSobre] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ node: PlaylistNode; x: number; y: number; confirm: boolean } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const clic = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', clic); document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('mousedown', clic); document.removeEventListener('keydown', tecla) }
  }, [menu])
  // si la carpeta en la que estoy se borra, vuelvo a la raíz
  useEffect(() => { if (carpeta != null && !p.nodes.some((n) => n.id === carpeta)) setCarpeta(null) }, [p.nodes, carpeta])

  const buscando = q.trim() !== ''
  const lista = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const base = buscando ? p.nodes.filter((n) => n.kind !== 'folder' && words.every((w) => n.name.toLowerCase().includes(w))) : p.nodes.filter((n) => n.parentId === carpeta)
    const rango = (id: number) => { const f = p.fijadas.indexOf(id); if (f >= 0) return f; const r = p.recientes.indexOf(id); return r >= 0 ? 1000 + r : 5000 }
    const porNombre = (a: PlaylistNode, b: PlaylistNode) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    const cmp: Record<Orden, (a: PlaylistNode, b: PlaylistNode) => number> = {
      uso: (a, b) => rango(a.id) - rango(b.id) || porNombre(a, b), nombre: porNombre, temas: (a, b) => b.count - a.count || porNombre(a, b), nuevas: (a, b) => b.id - a.id,
    }
    // las carpetas primero
    return [...base].sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || cmp[orden](a, b))
  }, [p.nodes, p.fijadas, p.recientes, q, orden, carpeta, buscando])
  const actual = p.nodes.find((n) => n.id === carpeta)
  const total = p.nodes.filter((n) => n.kind !== 'folder').length

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={NAV_PLAYLISTS.label} sub={T.sub} />
      <div className="pls-barra">
        <input type="search" placeholder={T.buscar} value={q} onChange={(e) => setQ(e.target.value)} aria-label={T.buscar} />
        <label className="small">{T.ordenar}{' '}
          <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
            <option value="uso">{T.porUso}</option><option value="nombre">{T.porNombre}</option><option value="temas">{T.porTemas}</option><option value="nuevas">{T.porNuevas}</option>
          </select>
        </label>
        <span className="muted small">{T.total(total)}</span>
        <Boton variant="ghost" size="sm" onClick={() => p.onGo('requests')} title={AYUDA('requests')}>{T.traer}</Boton>
        <Boton variant="ghost" size="sm" onClick={() => p.onGo('folderpl')} title={AYUDA('folderpl')}>{T.carpetas}</Boton>
        <span style={{ marginLeft: 'auto' }}><PlaylistTools nodes={p.nodes} activeId={carpeta} onCreate={p.onCreate} onImport={p.onImport} /></span>
      </div>
      {actual && !buscando && (
        <div className="pls-ruta">
          <button className="link" onClick={() => setCarpeta(null)}>{T.todas}</button><Icon name="chevron" size={11} /><b>{actual.name}</b>
        </div>
      )}
      {!p.nodes.length ? <p className="muted">{T.vacia}</p> : !lista.length ? <p className="muted">{buscando ? T.ninguna : T.vacia}</p> : (<>
        <div className="pls-grilla">
          {lista.map((n) => {
            const carp = n.kind === 'folder', fija = p.fijadas.includes(n.id)
            const abrir = () => (carp ? setCarpeta(n.id) : p.onOpen(n.id))
            return (
              <div key={n.id} className={`tarjeta ${sobre === n.id ? 'drop' : ''}`}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ node: n, x: e.clientX, y: e.clientY, confirm: false }) }}
                onDragOver={(e) => { if (n.kind === 'list' && e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setSobre(n.id) } }}
                onDragLeave={() => setSobre((o) => (o === n.id ? null : o))}
                onDrop={(e) => { e.preventDefault(); setSobre(null); try { p.onDrop(n.id, JSON.parse(e.dataTransfer.getData(DRAG_TYPE))) } catch { /* nada */ } }}>
                <button className="tarjeta-tapa" onClick={abrir} title={T.abrirX(n.name)}
                  onKeyDown={(e) => { if (e.key === 'Delete') { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ node: n, x: r.left + 12, y: r.bottom, confirm: true }) } }}>
                  {carp ? <div className="pls-carpeta"><Icon name="folder" size={44} /></div> : <TapaLazy node={n} />}
                </button>
                {!carp && <button className={`pls-fijar ${fija ? 'on' : ''}`} onClick={() => p.onFijar(n.id)} title={fija ? T.desfijar : T.fijar} aria-pressed={fija}><Icon name="heart" size={14} /></button>}
                <button className="pls-mas" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ node: n, x: r.left, y: r.bottom, confirm: false }) }} title={T.mas} aria-label={T.mas}>⋯</button>
                {!carp && <button className="tarjeta-play" onClick={() => p.onPlay(n.id)} title={T.escucharX(n.name)} aria-label={T.escucharX(n.name)}><Icon name="play" size={16} /></button>}
                <b title={n.name}>{n.name}</b>
                <span className="muted small">{carp ? T.carpeta : `${n.kind === 'smart' ? `${T.inteligente} · ` : ''}${T.temas(n.count)}`}</span>
              </div>
            )
          })}
        </div>
        <p className="muted small" style={{ marginTop: 'var(--sp-4)' }}>{T.soltar}</p>
      </>)}
      {menu && createPortal(
        <div className="pl-menu pl-menu-flota" ref={menuRef} style={{ left: Math.min(menu.x, window.innerWidth - 330), top: Math.min(menu.y, window.innerHeight - 200) }}>
          {menu.confirm
            ? <BorrarPregunta node={menu.node} onYes={() => { setMenu(null); p.onDelete(menu.node.id) }} onNo={() => setMenu(null)} />
            : (<>
              <button onClick={() => { setMenu(null); if (menu.node.kind === 'folder') setCarpeta(menu.node.id); else p.onOpen(menu.node.id) }}>{T.abrir}</button>
              {menu.node.kind !== 'folder' && <button onClick={() => { setMenu(null); p.onMerge(menu.node) }}>{T.fusionar}</button>}
              <button onClick={() => setMenu({ ...menu, confirm: true })}>{menu.node.kind === 'folder' ? T.borrarCarpeta : T.borrarLista}</button>
            </>)}
        </div>, document.body,
      )}
    </div>
  )
}
