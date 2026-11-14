// Ventana principal: barra de arriba (búsqueda y escaneo), barra lateral, la página elegida, paneles de detalle y ventanas.
// El estado vive en hooks por área (ui/src/hooks/): biblioteca, cambios pendientes, playlists, vista de la tabla,
// selección y eventos de la ventana.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { KINDS, type CollectionKind, type PlaylistNode, type SmartRules, type TagAction, type RootInfo, type ScanStatus, type Track } from '@paila/shared/types'
import Wizard from './Wizard'
import TrackTable, { useColumns } from './TrackTable'
import { TablaAcciones, toExcel } from './ViewTools'
import { useSavedViews } from './hooks/useSavedViews'

/** Un rekordbox.xml soltado en la ventana va a Rekordbox (traer tus playlists), no a "Traer una lista". */
const isXml = (p: string) => /\.xml$/i.test(p)
import Home from './Home'
import Detail from './Detail'
import Player, { type PlayRequest } from './Player'
import ChangesBar from './ChangesBar'
import MultiEdit from './MultiEdit'
import Progress from './Progress'
import { Duplicates, TrashPage } from './Cleanup'
import Organize from './Organize'; import Ordenar from './Ordenar'
import FolderPlaylists from './FolderPlaylists'
import RekordboxPage from './Rekordbox'
import SetBuilder from './SetBuilder'
import SepararVoz from './SepararVoz'
import Tracklist from './Tracklist'
import Comprimidos from './Comprimidos'
import Tidy from './Tidy'
import Wishlist from './Wishlist'; import Sonido from './Sonido'
import Albums from './Albums'
import Volume from './Volume'
import Silencios from './Silencios'
import Requests from './Requests'
import Inbox from './Inbox'
import Space from './Space'
import Online from './Online'
import Settings from './Settings'
import Stats from './Stats'
import ProblemCenter from './ProblemCenter'
import AtajosAyuda from './AtajosAyuda'
import Replace from './Replace'
import History from './History'
import { CleanModal, ExportModal, ImproveModal, MergeModal } from './PlaylistTools'
import Carry from './Carry'
import { AddToPlaylist, PlaylistBar } from './Playlists'
import Sidebar from './Sidebar'
import CommandPalette from './CommandPalette'
import { ToastHost, toast } from './toast'
import UpdateNotice from './UpdateNotice'
import AvisoChequeo from './AvisoChequeo'
import { Icon } from './icons'
import { JobsChip } from './jobs'; import Pestanas from './Pestanas'
import logo from './assets/logo.png'
import { paginaAlRecargar, type PageKey } from './nav'
import { etaText, useEta } from './eta'
import { PROBLEMS } from './problems'
import { bytes, n } from './format'
import { fechaHora } from '@paila/shared/idioma'
import { T } from './App.textos'
import { useLibrary } from './hooks/useLibrary'
import { useChanges } from './hooks/useChanges'
import { usePlaylists } from './hooks/usePlaylists'
import { usePlaylistsUso } from './playlistsUso'
import PlaylistsPage from './PlaylistsPage'
import { useTableView } from './hooks/useTableView'
import { useSelection, useSigueLoQueSuena } from './hooks/useSelection'
import Inspector from './Inspector'
import ColaAnalisis from './ColaAnalisis'
import RegistroOps from './RegistroOps'
import Muestrario from '@paila/diseno/muestrario'
import { useWindowEvents } from './hooks/useWindowEvents'
import { useIntensityNotices } from './Intensity'
import { Barra, Boton, Info } from '@paila/diseno'
import { useProfile } from './profile'
import DjOffer from './DjOffer'
import { irAlContenido, useFocoEnPantalla, useIrA } from './atajos'
import Recorrido, { pedirRecorrido } from './Recorrido'
import Anotar from './Anotar'
import { pasada, textoPausa } from './pausa'; import { alBuscar } from './buscarEn'; import { conTeclado } from './conTeclado'

type View = { mode: 'library' } | { mode: 'add' } | { mode: 'adjust'; root: RootInfo }
/** Escanear: si otra operación está moviendo o escribiendo archivos, PAILA dice qué y no escanea. */
const startScan = () => window.paila.scanStart().then((why) => { if (why) toast(why, 'error') })

export default function App() {
  const [view, setView] = useState<View>({ mode: 'library' })
  const { checkOffer } = useProfile()
  const [page, setPageRaw] = useState<PageKey>(() => paginaAlRecargar() ?? 'home')
  // de dónde se vino a "Escuchando" (para volver con Esc)
  const [before, setBefore] = useState<PageKey>('home')
  const setPage = (p: PageKey) => { if ((p === 'escuchando' || p === 'ficha') && page !== p) setBefore(page); setPageRaw(p) }
  useIrA(setPage)
  const [playReq, setPlayReq] = useState<PlayRequest | null>(null)
  const [playingId, setPlayingId] = useState<number | null>(null)
  const [upNext, setUpNext] = useState<number[]>([])
  const [usbFor, setUsbFor] = useState<PlaylistNode | null>(null)
  const [improveFor, setImproveFor] = useState<PlaylistNode | null>(null)
  const [cleanFor, setCleanFor] = useState<PlaylistNode | null>(null)
  const [mergeFor, setMergeFor] = useState<PlaylistNode | null>(null)
  const [replacing, setReplacing] = useState<Track | null>(null)
  const [replaceFile, setReplaceFile] = useState<string | undefined>(undefined)

  const library = useLibrary()
  const { state, scan, stats, counts, version, loadTracks, refresh, trackById } = library
  const { pending, setPending, ultimo, loadChanges, stage, asResult } = useChanges(loadTracks)
  // lo último del Historial puede cambiar desde cualquier pantalla (organizar, reemplazar…): se vuelve a pedir al cambiar de pantalla
  useEffect(() => { void loadChanges() }, [page, loadChanges])
  const { plNodes, setPlNodes, activePl, setActivePl, plIds, setPlIds, activeNode, reloadPlaylists, addToPlaylist, plAction } = usePlaylists(version)
  const { kind, setKind, problem, setProblem, query, setQuery, sort, setSort, rows } = useTableView(library, activePl != null ? plIds : null)
  const { selected, setSelected, multi, setMulti, onSelect, picked, pickedCount, dragIds } = useSelection(rows)
  const [shown, toggleCol, setCols] = useColumns()
  const vistas = useSavedViews({ kind, setKind, problem, setProblem, query, setQuery, sort, setSort }, { shown, setAll: setCols }, () => { setActivePl(null); setPage('library') }, activePl != null)
  const [listPath, setListPath] = useState<{ path: string; at: number } | null>(null)
  const { dropped, setDropped, dragging, palette, setPalette } = useWindowEvents(() => setPage('inbox'), (p) => { setListPath({ path: p, at: Date.now() }); setPage(isXml(p) ? 'rekordbox' : 'requests') }, () => setPage('muestrario'))
  useIntensityNotices()
  const scanning = !!(scan ?? state?.scan)?.running
  useEffect(() => { if (!scanning) checkOffer() }, [scanning, checkOffer])
  // "Ver en PAILA" desde NAPIA: la Bandeja, mostrando solo lo que llegó a esa carpeta
  const [bandejaDe, setBandejaDe] = useState<string | null>(null)
  useEffect(() => {
    const ir = (f: string) => { if (f.startsWith('?')) { setKind('todo'); setProblem(null); setActivePl(null); setQuery(f.slice(1)); setPageRaw('library') } else { setBandejaDe(f); setPageRaw('inbox') } }
    void window.paila.bandejaPedida().then((f) => { if (f) ir(f) })
    void window.paila.rekordboxPedido().then((f) => { if (f) { setListPath({ path: f, at: Date.now() }); setPageRaw('rekordbox') } })
    const sinBuscar = alBuscar((q) => ir(`?${q}`)), sinIr = window.paila.onIrBandeja(ir); return () => { sinBuscar(); sinIr() }
  }, [])
  const eta = useEta(scan || ({ running: false, paused: false, job: null, phase: '', toProbe: 0, probed: 0, startedAt: null } as ScanStatus))

  const pendingMap = useMemo(() => new Map(pending.map((c) => [`${c.fileId}:${c.field}`, c.after])), [pending])
  // el tema elegido y el que suena pueden no estar a la vista (en una biblioteca grande se piden aparte)
  useEffect(() => { const want = [selected, playingId].filter((x): x is number => x != null); if (want.length) rows.need(want) }, [selected, playingId, rows]); useSigueLoQueSuena(playingId, selected, setSelected)
  const selectedTrack = (selected != null && rows.get(selected)) || null
  // reproducir: la lista de la que sigue es la que se está viendo (búsqueda, colección o playlist)
  const viewLabel = activeNode ? T.laPlaylist(activeNode.name) : query ? T.tuBusqueda(query) : kind === 'todo' ? T.todaBiblioteca : KINDS[kind].label
  const playId = (id: number) => setPlayReq({ kind: 'play', id, ids: rows.ids, label: viewLabel, at: Date.now() })
  const queueId = (id: number, where: 'next' | 'end') => { setPlayReq({ kind: where, id, at: Date.now() }); if (playingId != null) toast(where === 'next' ? T.suenaLuego : T.alFinal, 'ok') }
  const note = (m: string | null, kind: 'ok' | 'info' | 'error' = 'ok') => { if (m) toast(m, kind) }
  useFocoEnPantalla(page)
  const showLibrary = (k: CollectionKind | 'todo') => { setKind(k); setProblem(null); setActivePl(null); setSort((s) => (s.key === 'order' ? { key: 'artist', dir: 1 } : s)); setPage('library') }
  const uso = usePlaylistsUso()
  useEffect(() => { if (activePl != null) uso.usada(activePl) }, [activePl, uso.usada])
  const importPlaylist = async () => { const m = await window.paila.importPlaylist(); if (m) { note(m); setPlNodes(await window.paila.playlists()) } }
  const playPlaylist = async (id: number) => { const ids = await window.paila.playlistTracks(id); const pl = plNodes.find((x) => x.id === id); if (ids.length) setPlayReq({ kind: 'play', id: ids[0], ids, label: T.laPlaylist(pl?.name ?? ''), at: Date.now() }) }
  const openPlaylist = (id: number) => { setActivePl(id); setProblem(null); setQuery(''); setSort({ key: 'order', dir: 1 }); setPage('library') }
  /** Borra una playlist (o carpeta) ya confirmada; si la abierta era esa o estaba adentro, vuelve a la biblioteca. */
  const deletePlaylist = (id: number) => plAction(async () => {
    const t = await window.paila.deletePlaylist(id)
    if (activePl != null && !t.some((n) => n.id === activePl)) { setActivePl(null); setSort({ key: 'artist', dir: 1 }) }
    return t
  })

  if (!state) return <div className="wizard center"><div className="spinner" /></div>
  if (view.mode === 'add' || !state.roots.length) {
    return <><Wizard primera={!state.roots.length} onDone={() => { if (!state.roots.length) pedirRecorrido(); setView({ mode: 'library' }); refresh() }} onCancel={state.roots.length ? () => setView({ mode: 'library' }) : undefined} /><UpdateNotice /></>
  }
  if (view.mode === 'adjust') {
    return <Wizard existing={view.root} onDone={() => { setView({ mode: 'library' }); refresh() }} onCancel={() => setView({ mode: 'library' })} />
  }

  const s = scan || state.scan
  const pct = s.toProbe ? Math.round((s.probed * 100) / s.toProbe) : 0
  const openTrack = (id: number) => { setKind('todo'); setProblem(null); setQuery(''); setActivePl(null); setSelected(id); setMulti(new Set()); setPage('library') }

  // Las pantallas que son solo su componente (la ficha, el avance, el inicio y la biblioteca se arman abajo).
  const screens: Partial<Record<PageKey, () => ReactNode>> = {
    escuchando: () => <div className="page" />,
    muestrario: () => <Muestrario />,
    inspector: () => <Inspector elegido={selected} />,
    cola: () => <ColaAnalisis onInspect={(id) => { setSelected(id); setPage('inspector') }} />,
    registro: () => <RegistroOps />,
    problemas: () => <ProblemCenter stats={stats} onGo={setPage} onProblem={(p) => { setKind('musica'); setProblem(p); setPage('library') }} />,
    carry: () => <Carry playlists={plNodes} selection={picked ? picked.map((t) => t.id) : selected != null ? [selected] : []} onGo={setPage} />,
    online: () => <Online onStaged={() => { void loadChanges() }} onGo={setPage} />,
    settings: () => <Settings onGo={setPage} />,
    stats: () => <Stats />,
    space: () => <Space onChanged={loadTracks} onOpenTrack={openTrack} />,
    inbox: () => <Inbox onSonido={() => setPage('sonido')} soloDe={bandejaDe} onVerTodo={() => setBandejaDe(null)} dropped={dropped} onClearDropped={() => setDropped([])} onReplace={(id, file) => { void trackById(id).then((t) => { if (t) { setReplaceFile(file); setReplacing(t) } }) }} />,
    sonido: () => <Sonido onGo={setPage} onStaged={loadChanges} onApply={(ids) => asResult(() => window.paila.applyChanges(ids))} />, wishlist: () => <Wishlist />,
    albums: () => <Albums onGo={setPage} onStaged={() => { void loadChanges() }} />,
    volumen: () => <Volume onStaged={loadChanges} />,
    silencios: () => <Silencios onStaged={loadChanges} />,
    requests: () => <Requests onGo={setPage} onOpenPlaylist={openPlaylist} onPlaylistsChanged={() => reloadPlaylists()} openPath={listPath && !isXml(listPath.path) ? listPath : null} />,
    tidy: () => <Tidy total={stats.music.total} onStaged={() => { void loadChanges() }} onGo={setPage} />,
    rekordbox: () => <RekordboxPage playlists={plNodes} onPlaylistsChanged={() => reloadPlaylists()} onGo={setPage} onStaged={loadChanges} openXml={listPath && isXml(listPath.path) ? listPath : null} />,
    separar: () => <SepararVoz onPlay={playId} />,
    setbuilder: () => <SetBuilder playlists={plNodes} onPlay={(id) => setPlayReq({ kind: 'play', id, ids: [id], label: T.tuEnergia, at: Date.now() })} onChanged={loadTracks} />,
    tracklist: () => <Tracklist onStaged={loadChanges} />,
    comprimidos: () => <Comprimidos />,
    playlists: () => <PlaylistsPage nodes={plNodes} fijadas={uso.fijadas} recientes={uso.recientes} onFijar={uso.fijar} onOpen={openPlaylist} onPlay={playPlaylist} onMerge={setMergeFor}
      onDrop={addToPlaylist} onDelete={deletePlaylist} onImport={importPlaylist} onGo={setPage}
      onCreate={(name, k, parentId) => plAction(async () => { const t = await window.paila.createPlaylist(name, k, parentId); const mine = t.filter((x) => x.name === name).pop(); if (mine && parentId == null) openPlaylist(mine.id); return t })} />,
    folderpl: () => <FolderPlaylists onCreated={() => reloadPlaylists()} />,
    ordenar: () => <Ordenar onApply={() => asResult(() => window.paila.applyChanges())} onStaged={() => { void loadChanges() }} onGo={setPage} onPlay={playId} />,
    organize: () => <Organize stats={stats} onGo={setPage} pending={pending} onStaged={loadChanges} />,
    dups: () => <Duplicates total={stats.music.total} pending={pending} onStaged={loadChanges} />,
    trash: () => <TrashPage onChanged={loadTracks} />,
    history: () => <History onChanged={() => { loadTracks(); loadChanges() }} />,
  }
  const screen = screens[page]

  return (
    <div className={`app ${(selectedTrack && page !== 'ficha') || pickedCount > 1 ? 'with-detail' : ''}`}>
      <header className="top"><button className="saltar" onClick={irAlContenido}>{T.saltar}</button>
        <button type="button" className="brand" title={T.irInicio} onClick={() => setPage('home')}><img src={logo} alt="" /><span className="brand-name">PAILA</span></button>
        <div className="searchbox">
          <Icon name="search" size={15} />
          <input type="search" placeholder={T.buscar} value={query}
            onChange={(e) => { setQuery(e.target.value); setPage('library') }} />
        </div>
        <JobsChip onGo={(k) => { const to: Record<string, PageKey> = { mb: 'online', mbcovers: 'online', names: 'online', shrink: 'space', djconvert: 'rekordbox', grid: 'rekordbox', dups: 'dups', organize: 'organize', separar: 'separar', 'separar-modelo': 'separar' }; if (to[k]) setPage(to[k]) }} />
        <Anotar page={page} />
        <div className="scanbox">
          {s.running ? (
            <>
              <div className="scan-text clickable" onClick={() => setPage('progress')} {...conTeclado(() => setPage('progress'))} title={T.verAnalizando}>
                <b title={s.paused ? `${pasada(s)}${s.heldBy ? `. ${T.pausaSigue}` : ''}` : undefined}>{s.paused ? textoPausa(s) : s.phase}</b>
                <span className="muted small">
                  {s.toProbe ? `${T.avance(n(s.probed), n(s.toProbe), pct)}${s.paused ? '' : T.faltaTiempo(etaText(eta.minutes, eta.doubtful))}` : `${T.encontrados(n(s.found))}${s.current ? T.mirando(s.current.split(/[\/]/).slice(-2).join('/')) : ''}`}
                </span>
              </div>
              <Barra value={pct} onClick={() => setPage('progress')} title={T.verAnalizando} />
              {s.paused
                ? <Boton onClick={() => window.paila.scanResume()}>{T.seguir}</Boton>
                : <Boton variant="ghost" onClick={() => window.paila.scanPause()}>{T.pausar}</Boton>}
              <Boton variant="ghost" disabled={s.stopping} onClick={() => window.paila.scanCancel()}>{s.stopping ? T.deteniendo : T.detener}</Boton>
            </>
          ) : (
            <>
              <span className="muted small" title={s.finishedAt ? fechaHora(s.finishedAt) : ''}>{s.phase}</span>
              <Boton variant="ghost" size="sm" onClick={() => startScan()} title={T.escanearTip}>{T.escanear}</Boton><Info tip={T.escanearTip} />
            </>
          )}
        </div>
      </header><Pestanas page={page} onPage={setPage} stats={stats} scan={s} />

      <Sidebar
        page={page} onPage={setPage} kind={kind} activePl={activePl} onKind={showLibrary} counts={counts} droppedCount={dropped.length}
        playlists={plNodes} onOpenPlaylist={openPlaylist} onDropToPlaylist={addToPlaylist} onDeletePlaylist={deletePlaylist} vistas={vistas} uso={uso}
        onCreatePlaylist={(name, k, parentId) => plAction(async () => { const t = await window.paila.createPlaylist(name, k, parentId); const mine = t.filter((x) => x.name === name).pop(); if (mine) openPlaylist(mine.id); return t })}
        onImportPlaylist={importPlaylist}
        roots={state.roots} onAdjust={(r) => setView({ mode: 'adjust', root: r })} onAddFolder={() => setView({ mode: 'add' })} />

      <main className="main" tabIndex={-1}>
        <ChangesBar pending={pending} ultimo={ultimo} analyzing={s.running && s.job === 'analysis'}
          avisos={[...s.warnings.slice(0, 3), ...(s.warnings.length > 3 ? [T.avisosMas(s.warnings.length - 3)] : [])]}
          onApply={(ids) => asResult(() => window.paila.applyChanges(ids))}
          onDiscard={async (ids) => setPending(await window.paila.discardChanges(ids))}
          onUndo={(e) => asResult(() => window.paila.historyUndo(e.kind, e.id))} />
        {page === 'ficha' ? (
          <div className="page ficha-page">
            <button className="link" onClick={() => setPage(before === 'ficha' ? 'library' : before)}><Icon name="chevron" size={13} className="vuelta" /> {T.volver}</button>
            {selectedTrack ? <Detail grande t={selectedTrack} onReplace={() => setReplacing(selectedTrack)} onPlay={playId} onQueue={(where) => queueId(selectedTrack.id, where)} pending={pending.filter((c) => c.fileId === selectedTrack.id)} onCoverStaged={loadChanges} onStage={(f, v) => stage([selectedTrack.id], f, v)} />
              : <p className="muted">{T.elegiTema}</p>}
          </div>
        ) : screen ? screen() : page === 'progress' ? (
          <Progress scan={s} eta={eta} onClose={() => setPage('home')} onOpenTrack={(id) => { setKind('todo'); setProblem(null); setQuery(''); setSelected(id); setMulti(new Set()); setPage('library') }} />
        ) : page === 'home' ? (
          <Home stats={stats} scan={s} playlists={plNodes} pendientes={pending.length} playingId={playingId} upNext={upNext} onGo={setPage} onOpenPlaylist={openPlaylist}
            onPlayPlaylist={playPlaylist}
            onPlayAlbum={async (id, name) => { const ids = await window.paila.playerAlbum(id); setPlayReq({ kind: 'play', id: ids[0] ?? id, ids, label: T.elDisco(name), at: Date.now() }) }}
            onProblem={(p) => { setKind('musica'); setProblem(p); setPage('library') }} />
        ) : (<>
        {!activeNode && (
          <div className="biblio-cab">
            <span className="titulo">{query ? T.busqueda : kind === 'todo' ? T.todaBibliotecaTitulo : KINDS[kind].label}</span>
            <span className="muted num">{query ? T.busquedaN(query, rows.ids.length) : T.temasPeso(counts[kind]?.n ?? rows.ids.length, bytes(counts[kind]?.bytes ?? 0))}</span>
            <TablaAcciones suggested={query || (problem ? PROBLEMS.find((p) => p.key === problem)!.label : kind === 'todo' ? T.todaBibliotecaTitulo : KINDS[kind].label)} active={vistas.views.find((v) => v.id === vistas.active)?.name ?? null}
              onSave={vistas.save} onExcel={() => toExcel(rows.ids, shown, query ? T.hojaBusqueda(query) : kind === 'todo' ? T.hojaBiblioteca : KINDS[kind].label)} />
          </div>
        )}
        {problem && (
          <div className="filter-bar">
            {T.mostrandoSolo} <b>{PROBLEMS.find((p) => p.key === problem)!.label}</b> {T.en} {kind === 'todo' ? T.todaBiblioteca : KINDS[kind].label}
            <span className="muted"> · {PROBLEMS.find((p) => p.key === problem)!.help}</span>
            <button className="link" onClick={() => setProblem(null)}>{T.quitarFiltro} <Icon name="close" size={14} /></button>
          </div>
        )}
        {activeNode && (
          <PlaylistBar node={activeNode} selectedInList={selected != null && plIds.includes(selected)}
            onPlay={() => { if (plIds.length) setPlayReq({ kind: 'play', id: plIds[0], ids: plIds, label: T.laPlaylist(activeNode.name), at: Date.now() }) }}
            onRename={(n) => plAction(() => window.paila.renamePlaylist(activeNode.id, n))}
            onDelete={() => deletePlaylist(activeNode.id)}
            onHarmonic={async () => { await window.paila.harmonicSort(activeNode.id); setPlIds(await window.paila.playlistTracks(activeNode.id)); setSort({ key: 'order', dir: 1 }); note(T.harmonicListo) }} onUsb={() => setUsbFor(activeNode)} onImprove={() => setImproveFor(activeNode)} onClean={() => setCleanFor(activeNode)} onMerge={() => setMergeFor(activeNode)}
            onExport={async () => { const m = await window.paila.exportPlaylist(activeNode.id); if (m) note(m) }} onExcel={() => toExcel(rows.ids, shown, activeNode.name)}
            onRemoveTracks={async () => { if (selected != null) { await window.paila.removeFromPlaylist(activeNode.id, multi.size > 1 ? [...multi] : [selected]); setPlNodes(await window.paila.playlists()) } }}
            onMove={async (dir) => { if (selected != null) { const i = plIds.indexOf(selected); await window.paila.moveInPlaylist(activeNode.id, selected, i + dir); setPlIds(await window.paila.playlistTracks(activeNode.id)) } }}
            onRules={(r: SmartRules) => plAction(() => window.paila.setPlaylistRules(activeNode.id, r))} />
        )}
        <TrackTable
          rows={rows}
          sort={sort}
          onSort={(key) => setSort((p) => ({ key, dir: p.key === key ? (p.dir === 1 ? -1 : 1) : 1 }))}
          selected={selected}
          multi={multi}
          dragIds={dragIds}
          pending={pendingMap}
          onEdit={(id, f, v) => stage([id], f, v)}
          onSelect={onSelect}
          onOpen={playId}
          shown={shown}
          onToggleCol={toggleCol}
        />
        </>)}
      </main>

      {pickedCount > 1 && (
        <aside className="detail">
          <button className="close" onClick={() => setMulti(new Set())} title={T.cerrar}><Icon name="close" size={14} /></button>
          {!picked ? <div className="center"><div className="spinner" /><p className="muted small">{T.cargando(n(pickedCount))}</p></div> : (<>
          <AddToPlaylist nodes={plNodes} onAdd={(id) => addToPlaylist(id, picked.map((t) => t.id))} />
          <MultiEdit tracks={picked} pending={pending} onClose={() => setMulti(new Set())}
            onStage={stage}
            onAction={async (a: TagAction) => { const n = await window.paila.runAction(picked.map((t) => t.id), a); setPending(await window.paila.pendingChanges()); return n }} />
          </>)}
        </aside>
      )}
      {pickedCount <= 1 && selectedTrack && page !== 'ficha' && (
        <aside className="detail">
          <button className="close" onClick={() => setSelected(null)} title={T.cerrar}><Icon name="close" size={14} /></button>
          <AddToPlaylist nodes={plNodes} onAdd={(id) => addToPlaylist(id, [selectedTrack.id])} />
          <Detail t={selectedTrack} onReplace={() => setReplacing(selectedTrack)} onPlay={playId} onQueue={(where) => queueId(selectedTrack.id, where)} pending={pending.filter((c) => c.fileId === selectedTrack.id)} onCoverStaged={loadChanges} onStage={(f, v) => stage([selectedTrack.id], f, v)} onGrande={() => setPage('ficha')} />
        </aside>
      )}

      {usbFor && <ExportModal node={usbFor} onClose={() => setUsbFor(null)} />}
      {cleanFor && <CleanModal node={cleanFor} onClose={() => setCleanFor(null)} onDone={() => { reloadPlaylists(); void window.paila.playlistTracks(cleanFor.id).then(setPlIds) }} />}
      {mergeFor && <MergeModal node={mergeFor} all={plNodes} onClose={() => setMergeFor(null)} onDone={(id) => { reloadPlaylists(); setActivePl(id) }} />}
      {improveFor && <ImproveModal node={improveFor} onClose={() => setImproveFor(null)} onDone={() => reloadPlaylists()} />}
      <ToastHost />
      <UpdateNotice />
      <AvisoChequeo onGo={setPage} />
      <DjOffer />
      <Recorrido listo={!s.running && counts.todo.n > 0} onPage={setPage} />
      {palette && <CommandPalette playlists={plNodes} scanning={s.running} onClose={() => setPalette(false)} onPage={(p) => { setPage(p); }} onPlaylist={openPlaylist} onScan={() => startScan()} onReanalyze={selected != null ? () => { void window.paila.advReanalyze(selected).then((m) => toast(m, 'ok')) } : undefined} />}
      {dragging && <div className="drop-overlay">{T.soltar}</div>}
      {replacing && <Replace track={replacing} initialFile={replaceFile} onClose={() => { setReplacing(null); setReplaceFile(undefined) }} onDone={() => { loadTracks(); loadChanges() }} />}

      <Player request={playReq} selected={selected} onPlaySelected={() => selected != null && playId(selected)} onEnqueueSelected={(where) => selected != null && queueId(selected, where)} onCurrent={setPlayingId}
        expanded={page === 'escuchando'} onExpand={(open) => setPage(open ? 'escuchando' : before)}
        onUpcoming={setUpNext}
        onOpenTrack={(id) => { setSelected(id); setMulti(new Set()); setPage('ficha') }} />

      <AtajosAyuda />
      <footer className="statusbar">
        <span>{T.enLaVista(rows.ids.length)}</span>
        <span>·</span>
        <span>{T.bibliotecaPeso(n(counts.todo.n), bytes(counts.todo.bytes))}</span>
      </footer>
    </div>
  )
}
