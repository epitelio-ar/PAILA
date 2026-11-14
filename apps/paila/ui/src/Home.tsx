// Pantalla de Inicio (salto estético, 22/10): la oreja-termómetro con la limpieza de la Música, seguir escuchando,
// lo que conviene hacer para que PAILA no junte cosas de más (Para hacer), tus playlists con sus tapas y los últimos discos que sumaste. Los gráficos están en "Estadísticas" y los problemas en su centro.
import { useEffect, useMemo, useState } from 'react'
import type { PlaylistNode, RecentAlbum, ScanStatus, Track } from '@paila/shared/types'
import type { LibraryStats } from '@paila/shared/tableview'
import { NIVELES_OREJA, minimoParaVeredicto, oreja } from '@paila/shared/oreja'
import { GRADE_HELP, GRADES, type ProblemKey } from './problems'
import { display, n } from './format'
import type { PageKey } from './nav'
import { Icon } from './icons'
import RecoveryNotice from './RecoveryNotice'
import { toTrack } from './hooks/useBigTable'
import { Mosaico, Tapa } from './Tapas'
import Termometro from './Termometro'
import ParaHacer from './ParaHacer'
import Estado from './Estado'
import { renglones, siguiente } from './Estado.lista'
import { useEstado } from './hooks/useEstado'
import { Boton, Nota } from '@paila/diseno'
import { textos, tr, cant } from '@paila/shared/idioma'
import oreja1 from './assets/oreja-1.png'
import oreja2 from './assets/oreja-2.png'
import oreja3 from './assets/oreja-3.png'
import oreja4 from './assets/oreja-4.png'
import oreja5 from './assets/oreja-5.png'

const OREJAS = [oreja1, oreja2, oreja3, oreja4, oreja5]
/** El título de cada nivel ("Tu música tiene limpia cera" no se dice). */
const TITULO: [string, string][] = tr({
  es: [['Tu música está', 'limpia'], ['Tu música tiene', 'un poquito de cera'], ['Tu música tiene', 'algo de cera'], ['Tu música tiene', 'bastante cera'], ['Tu música es', 'un desastre de cera']] as [string, string][],
  en: [['Your music is', 'clean'], ['Your music has', 'a little bit of wax'], ['Your music has', 'some wax'], ['Your music has', 'quite a lot of wax'], ['Your music is', 'a wax disaster']] as [string, string][],
})
const T = textos({
  seguir: { es: 'Seguir escuchando', en: 'Keep listening' },
  abrir: { es: 'Abrir', en: 'Open' },
  nadaSuena: { es: 'No suena nada. Elegí una playlist o un disco de abajo, o un tema en la biblioteca (doble clic).', en: 'Nothing is playing. Pick a playlist or an album below, or a track in the library (double-click).' },
  abrirEsc: { es: 'Abrir Escuchando', en: 'Open Now playing' },
  siguiente: { es: 'A continuación', en: 'Up next' },
  oreja: { es: (nivel: string) => `Oreja: ${nivel}`, en: (nivel: string) => `Ear: ${nivel}` },
  comoEsta: { es: (n: number) => `Cómo está tu música · ${cant(n, 'tema', 'temas')}`, en: (n: number) => `How your music is doing · ${cant(n, 'track', 'tracks')}` },
  todavia: { es: 'Todavía no hay', en: 'There are no' },
  escuchando: { es: 'PAILA está escuchando', en: 'PAILA is listening' },
  pocos: { es: (a: number, min: number, total: number) => `Ya escuchó ${a} de ${total} temas. La oreja aparece cuando lleve ${min}: con menos, el veredicto no sería justo.`, en: (a: number, min: number, total: number) => `It has listened to ${a} of ${total} tracks. The ear shows up at ${min}: with fewer, the verdict wouldn't be fair.` },
  analizados: { es: 'temas analizados', en: 'analyzed tracks yet' },
  escucha: { es: 'PAILA escucha cada tema para saber su calidad real.', en: 'PAILA listens to every track to find out its real quality.' },
  trabajando: { es: 'Ya está trabajando: la oreja aparece apenas termine los primeros.', en: "It's already working: PAILA shows up as soon as the first ones are done." },
  peores: { es: 'Las peores:', en: 'The worst:' },
  verCuales: { es: 'Ver cuáles', en: 'See which' },
  temasPorNota: { es: 'Temas por nota', en: 'Tracks by grade' },
  notaTip: { es: (g: string, k: number, ayuda: string) => `${g}: ${cant(k, 'tema', 'temas')}. ${ayuda}`, en: (g: string, k: number, ayuda: string) => `${g}: ${cant(k, 'track', 'tracks')}. ${ayuda}` },
  limpiar: { es: 'Limpiar: qué conviene conseguir', en: 'Clean up: what to get' },
  verProblemas: { es: 'Ver los problemas', en: 'See the problems' },
  tusPlaylists: { es: 'Tus playlists', en: 'Your playlists' },
  nPlaylists: { es: (k: number) => cant(k, 'playlist', 'playlists'), en: (k: number) => cant(k, 'playlist', 'playlists') },
  abrirX: { es: (x: string) => `Abrir «${x}»`, en: (x: string) => `Open "${x}"` },
  escucharX: { es: (x: string) => `Escuchar «${x}»`, en: (x: string) => `Listen to "${x}"` },
  escucharXAria: { es: (x: string) => `Escuchar ${x}`, en: (x: string) => `Listen to ${x}` },
  nTemas: { es: (k: number) => cant(k, 'tema', 'temas'), en: (k: number) => cant(k, 'track', 'tracks') },
  llegaron: { es: 'Llegaron hace poco', en: 'Just arrived' },
  ultimos: { es: 'los últimos discos que sumaste', en: 'the latest albums you added' },
  verDiscos: { es: 'Ver los discos', en: 'See the albums' },
  varios: { es: 'Varios', en: 'Various' },
})
const GRADE_VAR: Record<string, string> = { 'A+': 'var(--g-ap)', A: 'var(--g-a)', B: 'var(--g-b)', C: 'var(--g-c)', D: 'var(--g-d)', F: 'var(--g-f)' }

interface Props {
  stats: LibraryStats; scan: ScanStatus; playlists: PlaylistNode[]
  /** Cambios pendientes sin aplicar (para "Para hacer") */
  pendientes: number
  playingId: number | null; upNext: number[]
  onProblem: (key: ProblemKey) => void; onGo: (page: PageKey) => void
  onOpenPlaylist: (id: number) => void; onPlayPlaylist: (id: number) => void; onPlayAlbum: (trackId: number, name: string) => void
}

/** Lo que suena y lo que viene en la cola. */
function SeguirEscuchando({ playingId, upNext, onGo }: { playingId: number | null; upNext: number[]; onGo: (p: PageKey) => void }) {
  const [info, setInfo] = useState<Map<number, Track>>(new Map())
  const ids = useMemo(() => [playingId, ...upNext].filter((x): x is number => x != null), [playingId, upNext])
  useEffect(() => {
    if (!ids.length) return
    void window.paila.playerTracks(ids).then((rows) => setInfo(new Map(rows.map((r) => { const t = toTrack(r); return [t.id, t] }))))
  }, [ids])
  const now = playingId != null ? info.get(playingId) : undefined
  const d = now && display(now)
  return (
    <section className="seguir">
      <div className="seguir-cab"><span className="rotulo">{T.seguir}</span>{playingId != null && <button className="link" onClick={() => onGo('escuchando')}>{T.abrir}</button>}</div>
      {playingId == null || !d ? (
        <p className="muted small">{T.nadaSuena}</p>
      ) : (<>
        <button className="seguir-ahora" onClick={() => onGo('escuchando')} title={T.abrirEsc}>
          <Tapa id={playingId} name={d.artist || d.title} className="seguir-tapa" />
          <div className="seguir-txt" title={`${d.title} · ${d.artist}`}><div className="titulo">{d.title}</div><div className="muted">{d.artist}</div></div>
        </button>
        {upNext.length > 0 && <div className="rotulo seguir-sig">{T.siguiente}</div>}
        {upNext.map((id) => { const t = info.get(id); const x = t && display(t); return (
          <div key={id} className="seguir-fila">
            <Tapa id={id} name={x?.artist || x?.title || '?'} className="seguir-mini" />
            <div className="seguir-txt" title={x ? `${x.title} · ${x.artist}` : undefined}><b>{x?.title ?? '…'}</b><span className="muted">{x?.artist}</span></div>
            {t?.grade && <Nota grade={t.grade} title={GRADE_HELP[t.grade]} />}
          </div>
        ) })}
      </>)}
    </section>
  )
}

export default function Home({ stats: all, scan, playlists, pendientes, playingId, upNext, onProblem, onGo, onOpenPlaylist, onPlayPlaylist, onPlayAlbum }: Props) {
  const m = all.music
  const ore = oreja(m.byGrade)
  const nivel = NIVELES_OREJA[ore.nivel]
  const total = m.total
  const peores = (m.byGrade.D ?? 0) + (m.byGrade.F ?? 0)
  const analyzing = scan.running && scan.job === 'analysis'
  const [discos, setDiscos] = useState<RecentAlbum[] | null>(null)
  useEffect(() => { void window.paila.recentAlbums(10).then(setDiscos, () => setDiscos([])) }, [total])
  const estado = useEstado(all)
  const falta = !!estado && siguiente(renglones(estado)) != null
  const pls = playlists.filter((p) => p.kind !== 'folder' && p.count > 0).sort((a, b) => b.count - a.count).slice(0, 7)

  return (
    <div className="home inicio">
      <RecoveryNotice />

      {/* cómo está la colección, contado de la música, con un solo botón para lo que sigue (MASTERPLAN-5, 2.3): va primero */}
      {total > 0 && estado && <Estado e={estado} onGo={onGo} />}

      <div className="inicio-arriba">
        <section className="heroe">
          <div className="heroe-oreja">
            <img src={OREJAS[ore.nivel]} alt={T.oreja(nivel.nombre.toLowerCase())} />
          </div>
          <div className="heroe-txt">
            <div className="rotulo">{T.comoEsta(total)}</div>
            {ore.limpieza == null ? (<>
              <div className="titulo heroe-titulo">{T.todavia}<br /><span className="acento">{T.analizados}</span></div>
              <p className="muted">{T.escucha} {analyzing ? T.trabajando : ''}</p>
            </>) : ore.analizados < minimoParaVeredicto(total) ? (<>
              <div className="titulo heroe-titulo">{T.escuchando}<br /><span className="acento">…</span></div>
              <p className="muted">{T.escucha} {T.pocos(ore.analizados, minimoParaVeredicto(total), total)}</p>
            </>) : (<>
              <div className="titulo heroe-titulo">{TITULO[ore.nivel][0]}<br /><span className="acento">{TITULO[ore.nivel][1]}</span></div>
              <Termometro limpieza={ore.limpieza} nivel={ore.nivel} analizados={ore.analizados} analizando={analyzing} />
              {peores > 0 && (
                <div className="heroe-peores">{T.peores} <Nota grade="D" /> {n(m.byGrade.D ?? 0)} <Nota grade="F" /> {n(m.byGrade.F ?? 0)} <button className="link" onClick={() => onProblem('low')}>{T.verCuales}</button></div>
              )}
              <div className="barra-notas" role="img" aria-label={T.temasPorNota}>
                {GRADES.map((g) => <i key={g} style={{ flex: m.byGrade[g] || 0, background: GRADE_VAR[g] }} title={T.notaTip(g, m.byGrade[g] || 0, GRADE_HELP[g])} />)}
              </div>
              <div className="ley-notas">{GRADES.map((g) => <span key={g} title={GRADE_HELP[g]}><Nota grade={g} /> {n(m.byGrade[g] || 0)}</span>)}</div>
            </>)}
            {/* mientras falte algo, el botón principal es el de la tarjeta del estado: acá uno solo, secundario (usabilidad, 27/10/2026) */}
            <div className="heroe-botones">
              {falta
                ? <Boton variant="ghost" onClick={() => onGo('problemas')}>{T.verProblemas}</Boton>
                : <><Boton onClick={() => onGo('wishlist')}>{T.limpiar}</Boton><Boton variant="ghost" onClick={() => onGo('problemas')}>{T.verProblemas}</Boton></>}
            </div>
          </div>
        </section>
        <SeguirEscuchando playingId={playingId} upNext={upNext} onGo={onGo} />
      </div>

      <ParaHacer pendientes={pendientes} scan={scan} onGo={onGo} />

      {pls.length > 0 && (<>
        <h2 className="inicio-h"><span className="titulo">{T.tusPlaylists}</span><span className="muted small">{T.nPlaylists(playlists.filter((p) => p.kind !== 'folder').length)}</span></h2>
        <div className="grilla-tapas">
          {pls.map((p) => (
            <div key={p.id} className="tarjeta">
              <button className="tarjeta-tapa" onClick={() => onOpenPlaylist(p.id)} title={T.abrirX(p.name)}><Mosaico node={p} /></button>
              <button className="tarjeta-play" onClick={() => onPlayPlaylist(p.id)} title={T.escucharX(p.name)} aria-label={T.escucharXAria(p.name)}><Icon name="play" size={16} /></button>
              <b>{p.name}</b><span className="muted small">{T.nTemas(p.count)}</span>
            </div>
          ))}
        </div>
      </>)}

      {discos && discos.length > 0 && (<>
        <h2 className="inicio-h"><span className="titulo">{T.llegaron}</span><span className="muted small">{T.ultimos}</span><button className="link" onClick={() => onGo('albums')}>{T.verDiscos}</button></h2>
        <div className="grilla-tapas discos">
          {discos.map((dsc) => (
            <div key={`${dsc.trackId}`} className="tarjeta">
              <button className="tarjeta-tapa" onClick={() => onPlayAlbum(dsc.trackId, dsc.album)} title={T.escucharX(dsc.album)}>
                <Tapa id={dsc.trackId} name={dsc.artist || dsc.album} />
                {dsc.grade && <span className="tarjeta-nota"><Nota grade={dsc.grade} title={GRADE_HELP[dsc.grade as keyof typeof GRADE_HELP]} /></span>}
              </button>
              <b>{dsc.album}</b><span className="muted small">{dsc.artist ?? T.varios}{dsc.year ? ` · ${dsc.year}` : ''}</span>
            </div>
          ))}
        </div>
      </>)}
    </div>
  )
}
