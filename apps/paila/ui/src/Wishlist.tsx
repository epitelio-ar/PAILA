// Pantalla Faltan o suenan mal: por tema (WantedList.tsx, con exportación) y por disco (los álbumes con temas de mala calidad).
// PAILA no descarga música: arma la lista y abre la búsqueda en la tienda que elijas.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WishGroup, WishStatus } from '@paila/shared/types'
import { bytes, n } from './format'
import { BuscarEn, WantedList } from './WantedList'
import { Nota, Cabecera, Info } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { NapiaArriba } from './NapiaBanda'

const T = textos({
  titulo: { es: 'Faltan o suenan mal', en: 'Missing or low quality' },
  sub: { es: 'Lo que conviene conseguir en mejor calidad, para exportar.', en: 'What is worth getting in better quality, ready to export.' },
  porTema: { es: 'Por tema', en: 'By track' },
  porTemaTip: { es: 'Cada tema por separado, con estados (pendiente, pedido, llegó, reemplazado) y para exportar en .txt o .csv', en: 'Each track on its own, with statuses (pending, requested, arrived, replaced) and ready to export as .txt or .csv' },
  porDisco: { es: 'Por disco', en: 'By album' },
  porDiscoTip: { es: 'Los álbumes que tienen temas de mala calidad, para conseguir el disco entero', en: 'Albums that have poor-quality tracks, to get the whole album' },
  pendiente: { es: 'Pendiente', en: 'Pending' },
  pendienteH: { es: 'Todavía no empezaste a buscarlo', en: "You haven't started looking for it yet" },
  buscando: { es: 'Pedido', en: 'Requested' },
  buscandoH: { es: 'Lo estás buscando o ya lo pediste', en: "You're looking for it or already asked for it" },
  conseguido: { es: 'Llegó', en: 'Arrived' },
  conseguidoH: { es: 'Ya lo tenés: falta aplicar las copias mejores (en Sonido de un vistazo)', en: 'You have it: the better copies still need applying (in Sound at a glance)' },
  reemplazado: { es: 'Reemplazado', en: 'Replaced' },
  reemplazadoH: { es: 'Ya reemplazaste los temas', en: 'You already replaced the tracks' },
  ignorar: { es: 'Ignorar', en: 'Ignore' },
  ignorarH: { es: 'No vale la pena (por ejemplo una grabación vieja que no existe mejor)', en: "Not worth it (for example an old recording that doesn't exist in better quality)" },
  // la explicación de cada pestaña va en un ⓘ al lado (antes era un párrafo arriba): los temas se ven sin bajar (27/10)
  introTema: {
    es: 'Cada tema que conviene conseguir en mejor calidad, con un nombre limpio Artista - Título. Exportá la lista y usala donde compres o consigas tu música. Cuando el archivo llegue a la carpeta de la Bandeja, PAILA lo reconoce, revisa que sea mejor y te lo propone en Sonido de un vistazo y en la barra de arriba.',
    en: 'Each track that is worth getting in better quality, with a clean Artist - Title name. Export the list and use it wherever you buy or get your music. When the file reaches the Inbox folder, PAILA recognizes it, checks that it is better and proposes it in Sound at a glance and in the bar at the top.',
  },
  introDisco: {
    es: 'Los álbumes donde hay temas de mala calidad, para ir a conseguir mejores versiones. "Buscar en…" abre la búsqueda en la tienda que elijas. PAILA no descarga música: cuando consigas el archivo, arrastralo a la Bandeja y compará antes de reemplazar.',
    en: "Albums that have poor-quality tracks, so you can go and get better versions. \"Search on…\" opens the search in the store you pick. PAILA doesn't download music: when you get the file, drag it to the Inbox and compare before replacing.",
  },
  queEs: { es: 'Qué es esto', en: 'What is this' },
  mostrarNota: { es: 'Mostrar temas con nota', en: 'Show tracks with grade' },
  cOPeor: { es: 'C o peor', en: 'C or worse' },
  dOPeor: { es: 'D o peor', en: 'D or worse' },
  soloF: { es: 'solo F', en: 'only F' },
  todosEstados: { es: 'Todos los estados', en: 'All statuses' },
  enLista: { es: (c: string) => `${c} álbumes en la lista`, en: (c: string) => `${c} albums on the list` },
  sinAlbumes: { es: 'No hay álbumes para mostrar.', en: 'No albums to show.' },
  tablaLabel: { es: 'Discos para conseguir', en: 'Albums to get' },
  colNota: { es: 'Nota', en: 'Grade' },
  colDisco: { es: 'Disco · algunos temas', en: 'Album · some tracks' },
  colTemas: { es: 'Temas', en: 'Tracks' },
  colBuscar: { es: 'Buscar', en: 'Search' },
  colEstado: { es: 'Estado', en: 'Status' },
  peorNota: { es: 'La peor nota de los temas del álbum', en: "The worst grade among the album's tracks" },
  desconocido: { es: 'Artista desconocido', en: 'Unknown artist' },
  sueltos: { es: '(temas sueltos)', en: '(loose tracks)' },
  yaNoQuedan: { es: 'Ya no quedan temas malos · ', en: 'No bad tracks left · ' },
  ymas: { es: (c: number) => `… y ${c} más. Ordenados por estado y por la peor nota.`, en: (c: number) => `… and ${c} more. Sorted by status and by the worst grade.` },
})

const STATUS: { id: WishStatus; label: string; help: string }[] = [
  { id: 'pendiente', label: T.pendiente, help: T.pendienteH },
  { id: 'buscando', label: T.buscando, help: T.buscandoH },
  { id: 'conseguido', label: T.conseguido, help: T.conseguidoH },
  { id: 'reemplazado', label: T.reemplazado, help: T.reemplazadoH },
  { id: 'ignorar', label: T.ignorar, help: T.ignorarH },
]

/** Faltan o suenan mal: por tema (lo nuevo, con exportación y la Bandeja) o por disco (como antes). */
export default function Wishlist() {
  const [tab, setTab] = useState<'tema' | 'disco'>('tema')
  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} />
      <NapiaArriba />
      <div className="tabs">
        <button className={`tab ${tab === 'tema' ? 'on' : ''}`} onClick={() => setTab('tema')} title={T.porTemaTip}>{T.porTema}</button>
        <button className={`tab ${tab === 'disco' ? 'on' : ''}`} onClick={() => setTab('disco')} title={T.porDiscoTip}>{T.porDisco}</button>
        <span className="tabs-info" aria-label={T.queEs}><Info tip={tab === 'tema' ? T.introTema : T.introDisco} /></span>
      </div>
      {tab === 'tema' ? <WantedList /> : <ByAlbum />}
    </div>
  )
}

/** Lista por álbum: lo que tiene mala nota, con botones de búsqueda en tiendas. */
function ByAlbum() {
  const [grade, setGrade] = useState<'C' | 'D' | 'F'>('D')
  const [groups, setGroups] = useState<WishGroup[] | null>(null)
  const [filter, setFilter] = useState<WishStatus | 'todos'>('todos')
  const load = useCallback(() => window.paila.wishlist(grade).then(setGroups), [grade])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => (groups ?? []).filter((g) => filter === 'todos' || g.status === filter), [groups, filter])
  const counts = useMemo(() => Object.fromEntries(STATUS.map((s) => [s.id, (groups ?? []).filter((g) => g.status === s.id).length])) as Record<WishStatus, number>, [groups])
  const setStatus = async (g: WishGroup, status: WishStatus) => { await window.paila.setWishStatus(g.key, status); load() }

  return (
    <>
      <div className="row">
        <label className="small">{T.mostrarNota}
          <select value={grade} onChange={(e) => setGrade(e.target.value as 'C' | 'D' | 'F')} style={{ marginLeft: 8 }}>
            <option value="C">{T.cOPeor}</option><option value="D">{T.dOPeor}</option><option value="F">{T.soloF}</option>
          </select>
        </label>
        <select value={filter} onChange={(e) => setFilter(e.target.value as WishStatus | 'todos')}>
          <option value="todos">{T.todosEstados}</option>
          {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label} ({counts[s.id] ?? 0})</option>)}
        </select>
        {groups && <span className="muted small">{T.enLista(n(groups.length))}</span>}
      </div>

      {groups && shown.length === 0 && <p className="muted">{T.sinAlbumes}</p>}
      {shown.length > 0 && (
        <div className="wl-tabla wl-discos" role="table" aria-label={T.tablaLabel}>
          <div className="wl-fila wl-cab" role="row"><span>{T.colNota}</span><span>{T.colDisco}</span><span>{T.colTemas}</span><span>{T.colBuscar}</span><span>{T.colEstado}</span></div>
          {shown.slice(0, 300).map((g) => (
            <div key={g.key} role="row" className={`wl-fila ${g.status === 'ignorar' || g.fixed ? 'skipped' : ''}`}>
              <span><Nota grade={g.worst} title={T.peorNota} /></span>
              <span className="wl-tema" title={g.sample.join('\n')}>
                <span className="ellipsis"><b>{g.artist || T.desconocido}</b> — {g.album || T.sueltos}</span>
                <span className="ellipsis muted small">{g.fixed ? T.yaNoQuedan : ''}{g.sample.join(' · ')}</span>
              </span>
              <span className="small num">{n(g.tracks)} <span className="muted">· {bytes(g.bytes)}</span></span>
              <BuscarEn onSite={(s) => { window.paila.openWishSearch(s, g.artist, g.album); if (g.status === 'pendiente') setStatus(g, 'buscando') }} />
              <select value={g.status} onChange={(e) => setStatus(g, e.target.value as WishStatus)} title={STATUS.find((s) => s.id === g.status)?.help}>
                {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {shown.length > 300 && <p className="muted">{T.ymas(shown.length - 300)}</p>}
    </>
  )
}
