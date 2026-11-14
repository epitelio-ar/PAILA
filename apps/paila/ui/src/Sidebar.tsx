// Barra lateral: las partes de la pestaña elegida (secciones.ts), numeradas y en orden; en «Tu música», las colecciones,
// las vistas y las playlists. Abajo, Historial, Papelera, Configuración y los discos.
import { useEffect, useRef, useState } from 'react'
import { KINDS, type CollectionKind, type PlaylistKind, type PlaylistNode, type RootInfo } from '@paila/shared/types'
import { Icon, type IconName } from './icons'
import { NAV_AVANZADO, NAV_GROUPS, NAV_HISTORY, NAV_PLAYLISTS, NAV_SETTINGS, NAV_TOP, NAV_TRASH, type NavItem, type PageKey } from './nav'
import { HERRAMIENTAS, partesDe, recordarParte, seccionDe, SECCIONES } from './secciones'
import { DRAG_TYPE, PlaylistList, PlaylistTools } from './Playlists'
import { soltarParaSeparar } from './separar-soltar'
import { bytes, n } from './format'
import { barraTip, usePapelera } from './papelera'
import { VistasLista, VISTA_TIP } from './ViewTools'
import type { useSavedViews } from './hooks/useSavedViews'
import { Info } from '@paila/diseno'
import { useAvanzado } from './avanzado'
import { useProfile } from './profile'
import { textos } from '@paila/shared/idioma'
import { DiscosPie } from './SidePie'
import { idsDeLaBarra, EN_BARRA, type usePlaylistsUso } from './playlistsUso'
import { useFlechasBarra } from './barraTeclado'

const T = textos({
  biblioteca: { es: 'Biblioteca', en: 'Library' },
  todosTip: { es: 'Todos los archivos de audio', en: 'All the audio files' },
  todo: { es: 'Todo', en: 'All' },
  vistas: { es: 'Vistas guardadas', en: 'Saved views' },
  playlists: { es: 'Playlists', en: 'Playlists' },
  avanzado: { es: 'Modo avanzado', en: 'Advanced mode' },
  herramientas: { es: 'Herramientas', en: 'Tools' },
  herramientasTip: { es: 'Lo que no es parte de ordenar ni de llevar tu música: las estadísticas, el mapa de espacio (y WAV → FLAC) y los ZIP y RAR', en: 'What is not part of organizing or taking your music along: the stats, the space map (and WAV → FLAC) and ZIP and RAR files' },
  verTodas: { es: (k: number) => `Ver todas (${k})`, en: (k: number) => `See all (${k})` },
  verTodasTip: { es: 'Todas tus playlists con sus tapas, para buscar, ordenar y fijar las que más usás', en: 'All your playlists with their covers, to search, sort and pin the ones you use most' },
  soltarAca: { es: 'Soltá el tema en la playlist', en: 'Drop the track on a playlist' },
  pie: { es: 'Historial, papelera, configuración y discos', en: 'History, trash, settings and disks' },
})

/** Cada pantalla con su nombre, ícono y ayuda (nav.ts). */
const ITEM = new Map<PageKey, NavItem>([...NAV_TOP, ...NAV_GROUPS.flatMap((g) => g.items), NAV_PLAYLISTS].map((it) => [it.page, it]))

const COLLECTIONS: CollectionKind[] = ['musica', 'produccion', 'proyectos', 'sets', 'revisar']
/** Cada colección con su ícono (los puntos de color se confundían con los colores de las notas). */
const KIND_ICON: Record<CollectionKind, IconName> = { musica: 'disc', produccion: 'layers', proyectos: 'folder', sets: 'headphones', revisar: 'alert', excluir: 'trash' }

/** Grupos que el usuario puede cerrar; se acuerda cuáles dejó cerrados. `cerradoDeFabrica`: cómo arranca si nunca lo tocó. */
function useCollapsed(id: string, abrirAlCrecer?: number, cerradoDeFabrica = false): [boolean, () => void] {
  const key = `paila.side.${id}`
  const [closed, setClosed] = useState(() => { try { const v = localStorage.getItem(key); return v == null ? cerradoDeFabrica : v === '1' } catch { return cerradoDeFabrica } })
  const toggle = () => setClosed((c) => { const v = !c; try { localStorage.setItem(key, v ? '1' : '0') } catch { /* sin almacenamiento */ } return v })
  // si el grupo estaba cerrado y le llega algo nuevo (una playlist que se acaba de crear, por ejemplo con "Crear la playlist" de
  // Traer una lista), se abre: antes la playlist se creaba bien pero quedaba escondida en el grupo plegado (24/10/2026)
  const antes = useRef(abrirAlCrecer)
  useEffect(() => {
    if (abrirAlCrecer != null && antes.current != null && abrirAlCrecer > antes.current) { setClosed(false); try { localStorage.setItem(key, '0') } catch { /* sin almacenamiento */ } }
    antes.current = abrirAlCrecer
  }, [abrirAlCrecer, key])
  return [closed, toggle]
}

function Group({ id, title, actions, abrirAlCrecer, cerradoDeFabrica, abierto, tip, children }: { id: string; title: string; actions?: React.ReactNode; /** cuántos hay: si sube, el grupo se abre */ abrirAlCrecer?: number; cerradoDeFabrica?: boolean; /** se ve abierto aunque esté plegado (estás en una de sus pantallas) */ abierto?: boolean; tip?: string; children: React.ReactNode }) {
  const [plegado, toggle] = useCollapsed(id, abrirAlCrecer, cerradoDeFabrica)
  const closed = plegado && !abierto
  return (
    <div className="side-group">
      <div className="side-group-head">
        <button className={`side-group-title ${closed ? '' : 'open'}`} onClick={toggle} aria-expanded={!closed} title={tip}><Icon name={closed ? 'chevron' : 'down'} size={11} />{title}</button>
        {actions}
      </div>
      {!closed && children}
    </div>
  )
}

interface Props {
  page: PageKey
  onPage: (p: PageKey) => void
  kind: CollectionKind | 'todo'
  activePl: number | null
  onKind: (k: CollectionKind | 'todo') => void
  counts: Record<string, { n: number; bytes: number }>
  droppedCount: number
  playlists: PlaylistNode[]
  onOpenPlaylist: (id: number) => void
  onCreatePlaylist: (name: string, kind: PlaylistKind, parentId: number | null) => void
  onImportPlaylist: () => void
  onDropToPlaylist: (id: number, trackIds: number[]) => void
  /** Borrar una playlist o carpeta (clic derecho o Supr, ya confirmado). */
  onDeletePlaylist: (id: number) => void
  roots: RootInfo[]
  onAdjust: (r: RootInfo) => void
  onAddFolder: () => void
  /** Las vistas guardadas de la tabla (hooks/useSavedViews.ts). */
  vistas: ReturnType<typeof useSavedViews>
  /** Cuáles playlists se ven en la barra (fijadas y últimas usadas); el resto, en la pantalla Playlists. */
  uso: ReturnType<typeof usePlaylistsUso>
}

/** Barra lateral: lo principal arriba, herramientas agrupadas en el orden en que se usan, y la papelera y los discos abajo. */
export default function Sidebar(p: Props) {
  const { djTools } = useProfile()
  const [avanzado] = useAvanzado()
  // cuánto ocupa la papelera, al lado de "Papelera" (se pone al día al cambiar de pantalla)
  const pap = usePapelera(p.page)
  // un solo Tab para entrar y salir; adentro, flechas ↑↓ (barraTeclado.ts)
  const barra = useRef<HTMLElement>(null)
  useFlechasBarra(barra)
  // a «Separar voz» se le pueden soltar temas arrastrados de la tabla (la sección los toma y avisa si están en baja calidad)
  const [sobre, setSobre] = useState(false)
  const soltable = (it: NavItem) => it.page !== 'separar' ? {} : {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setSobre(true) } },
    onDragLeave: () => setSobre(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setSobre(false); try { soltarParaSeparar(JSON.parse(e.dataTransfer.getData(DRAG_TYPE))); p.onPage('separar') } catch { /* nada */ } },
  }
  // mientras se arrastran temas de la tabla, la barra muestra todas las playlists para poder soltarlos en cualquiera
  const [arrastrando, setArrastrando] = useState(false)
  useEffect(() => {
    const ini = (e: DragEvent) => { if (e.dataTransfer?.types.includes(DRAG_TYPE)) setArrastrando(true) }
    const fin = () => setArrastrando(false)
    window.addEventListener('dragstart', ini); window.addEventListener('dragend', fin); window.addEventListener('drop', fin)
    return () => { window.removeEventListener('dragstart', ini); window.removeEventListener('dragend', fin); window.removeEventListener('drop', fin) }
  }, [])
  const listas = p.playlists.filter((x) => x.kind !== 'folder')
  const enBarra = (() => {
    const ids = idsDeLaBarra(p.uso.fijadas, p.uso.recientes, new Set(listas.map((x) => x.id)))
    return ids.length ? ids : [...listas].sort((a, b) => b.count - a.count).slice(0, EN_BARRA).map((x) => x.id)
  })()
  // `num`: el número de la parte dentro de su pestaña (en vez del ícono)
  const item = (it: NavItem, extra?: React.ReactNode, num?: number) => (
    <button key={it.page} data-page={it.page} className={`side-item ${p.page === it.page ? 'on' : ''} ${it.page === 'separar' && sobre ? 'drop' : ''}`} onClick={() => p.onPage(it.page)} title={it.help} {...soltable(it)}>
      {num ? <span className="side-num">{num}</span> : <Icon name={it.icon} className="side-ico" />}<span className="side-label">{it.label}</span>{extra}
    </button>
  )
  // la pestaña de esta pantalla; Historial, Papelera, Configuración y las herramientas no tienen: se ve la barra de Tu música
  // (antes seguía la de la pestaña anterior y parecía que estabas en dos lugares a la vez, hallazgo 7 de la revisión del 02/11)
  const sec = seccionDe(p.page) ?? SECCIONES.find((x) => x.id === 'musica')!
  useEffect(() => recordarParte(p.page), [p.page])
  // con una vista guardada a la vista, se marca la vista y no la colección
  const libOn = (k: CollectionKind | 'todo') => p.page === 'library' && p.activePl == null && p.kind === k && !p.vistas.active

  return (
    <aside className="side" ref={barra}>
      <nav className="side-scroll">
        {sec.id !== 'musica' && (
          <div className="side-seccion">
            <div className="side-seccion-titulo">{sec.label}</div>
            <p className="side-seccion-ayuda">{sec.help}</p>
            {partesDe(sec, djTools).map((pg, i) => { const it = ITEM.get(pg); return it && item(it, it.page === 'inbox' && p.droppedCount > 0 ? <span className="count">{p.droppedCount}</span> : undefined, i + 1) })}
          </div>
        )}
        {sec.id === 'musica' && <>
        {item(ITEM.get('escuchando')!)}
        {/* Biblioteca arranca plegada: son 6 renglones (Todo, Música, Producción…) que empujaban «Mejorar el sonido» y «Traer y
            llevar» fuera de la vista; las herramientas quedan a la vista sin desplazar (prueba de usabilidad, 2.ª tanda, 27/10/2026) */}
        <Group id="biblioteca" title={T.biblioteca}>
          <button className={`side-item ${libOn('todo') ? 'on' : ''}`} onClick={() => p.onKind('todo')} title={T.todosTip}>
            <Icon name="note" className="side-ico" /><span className="side-label">{T.todo}</span><span className="count">{n(p.counts.todo?.n ?? 0)}</span>
          </button>
          {COLLECTIONS.map((k) => (
            <button key={k} className={`side-item ${libOn(k) ? 'on' : ''}`} onClick={() => p.onKind(k)} title={KINDS[k].help}>
              <Icon name={KIND_ICON[k]} className={`side-ico${k === 'revisar' && (p.counts[k]?.n ?? 0) > 0 ? ' side-ico-atencion' : ''}`} /><span className="side-label">{KINDS[k].label}</span><span className="count">{n(p.counts[k]?.n ?? 0)}</span>
            </button>
          ))}
        </Group>

        {p.vistas.views.length > 0 && (
          <Group id="vistas" title={T.vistas} actions={<Info tip={VISTA_TIP} />}>
            <VistasLista views={p.vistas.views} active={p.page === 'library' ? p.vistas.active : null} onApply={p.vistas.apply} onRemove={p.vistas.remove} onRename={p.vistas.rename} />
          </Group>
        )}

        <Group id="pl" title={T.playlists} abrirAlCrecer={p.playlists.length} actions={<PlaylistTools onCreate={p.onCreatePlaylist} onImport={p.onImportPlaylist} activeId={p.activePl} nodes={p.playlists} />}>
          <div className={arrastrando ? 'side-pl-todas' : undefined} title={arrastrando ? T.soltarAca : undefined}>
            <PlaylistList nodes={p.playlists} ids={arrastrando ? listas.map((x) => x.id) : enBarra} activeId={p.activePl} onSelect={p.onOpenPlaylist}
              onDrop={(id, t) => { p.uso.usada(id); p.onDropToPlaylist(id, t) }} onDelete={p.onDeletePlaylist} />
          </div>
          {listas.length > 0 && (
            <button className={`side-item side-vertodas ${p.page === 'playlists' ? 'on' : ''}`} data-page="playlists" onClick={() => p.onPage('playlists')} title={T.verTodasTip}>
              <Icon name="list" className="side-ico" /><span className="side-label">{T.verTodas(listas.length)}</span><Icon name="chevron" size={11} />
            </button>
          )}
        </Group>

        </>}
        <Group id="herramientas" title={T.herramientas} tip={T.herramientasTip} cerradoDeFabrica abierto={HERRAMIENTAS.includes(p.page)}>{HERRAMIENTAS.map((pg) => { const it = ITEM.get(pg); return it && item(it) })}</Group>
        {avanzado && <Group id="adv" title={T.avanzado}>{NAV_AVANZADO.map((it) => item(it))}</Group>}
      </nav>

      <div className="side-foot" role="toolbar" aria-label={T.pie}>
        <div className="side-iconos">
          {[NAV_HISTORY, NAV_TRASH, NAV_SETTINGS].map((it) => (
            <button key={it.page} data-page={it.page} className={`side-ico-btn side-pie-btn ${p.page === it.page ? 'on' : ''}`} onClick={() => p.onPage(it.page)} title={it.page === 'trash' && pap && pap.bytes > 0 ? `${it.label}: ${barraTip(pap)}` : `${it.label}: ${it.help}`} aria-label={it.label}>
              <Icon name={it.icon} /><span className="side-pie-label">{it.label}</span>{it.page === 'trash' && pap && pap.bytes > 0 && <span className={`count${pap.warn ? ' count-atencion' : ''}`}>{bytes(pap.bytes)}</span>}
            </button>
          ))}
        </div>
        <DiscosPie roots={p.roots} onAdjust={p.onAdjust} onAddFolder={p.onAddFolder} />
      </div>
    </aside>
  )
}
