// Pantalla Completar desde internet: nombres oficiales (MusicBrainz, Deezer, Discogs, AcoustID), el género (Discogs y Last.fm,
// Genres.tsx) y, con MusicBrainz, los datos que faltan (álbum, año, género, tapas). Todo se propone como cambios pendientes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MbProposal, MbStatus } from '@paila/shared/types'
import type { PageKey } from './nav'
import OfficialNames from './OfficialNames'
import { Plegable, primeraAbierta, type EstadoSeccion } from './Plegable'
import { useAlCambiarCambios } from './hooks/useChanges'
import Genres from './Genres'
import { JobPanel, useJob } from './jobs'
import { n } from './format'
import { toast } from './toast'
import { Aviso, Boton, Pildora, Cabecera } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'

const T = textos({
  pNombres: { es: 'Nombres oficiales', en: 'Official names' },
  pGeneros: { es: 'Géneros', en: 'Genres' },
  faltanN: { es: (k: string) => `faltan ${k} búsquedas`, en: (k: string) => `${k} searches left` },
  paraRevisarN: { es: (k: string) => `${k} para revisar`, en: (k: string) => `${k} to review` },
  listo: { es: 'listo', en: 'done' },
  album: { es: 'Álbum', en: 'Album' },
  year: { es: 'Año', en: 'Year' },
  genre: { es: 'Género', en: 'Genre' },
  seAgregaTip: { es: 'Se va a agregar. Destildá para no agregarlo.', en: 'It will be added. Untick to leave it out.' },
  noSeAgregaTip: { es: 'No se va a agregar. Tildá para agregarlo.', en: 'It will not be added. Tick to add it.' },
  seAgrega: { es: 'se agrega', en: 'will add' },
  yaTieneTip: { es: 'Ya lo tenía: no se toca', en: 'It already had it: left alone' },
  yaTiene: { es: 'ya tiene', en: 'already has' },
  propusieron: { es: (k: string) => `${k} cambios quedaron para aplicar: revisalos arriba y apretá Aplicar.`, en: (k: string) => `${k} changes are ready to apply: review them at the top and press Apply.` },
  retenidos: {
    es: (k: string) => ` ${k} quedaron para mirar a mano en Arreglar nombres: ese dato ya lo había puesto otra herramienta (o vos, a mano).`,
    en: (k: string) => ` ${k} were left to check by hand in Fix names: that field had already been set by another tool (or by you, by hand).`,
  },
  titulo: { es: 'Completar desde internet', en: 'Fill in from the internet' },
  sub: { es: 'Nombres oficiales, años y géneros de internet. Nada cambia hasta que apliques.', en: 'Official names, years and genres from the internet. Nothing changes until you apply.' },
  subMb: { es: 'El álbum, año y género que le falta a cada tema.', en: 'The album, year and genre each track is missing.' },
  h3: { es: 'Álbum, año y género', en: 'Album, year and genre' },
  i1: { es: 'PAILA consulta ', en: 'PAILA checks ' },
  i2: { es: ' (una base de datos musical abierta) para completar el ', en: ' (an open music database) to fill in the ' },
  i3: { es: 'álbum, el año y el género', en: 'album, the year and the genre' },
  i4: { es: ' de los temas que ya tienen artista y título, y ', en: ' of tracks that already have an artist and a title, and ' },
  i5: { es: ' para las tapas. ', en: ' for the covers. ' },
  i6: { es: 'Solo se envía el artista, el título y la duración de cada tema. ', en: 'Only the artist, the title and the length of each track are sent. ' },
  i7: { es: 'Solo completa lo que está vacío', en: 'It only fills in what is empty' },
  i8: { es: ': nunca pisa un tag. Todo pasa por Cambios pendientes.', en: ': it never overwrites a tag. Everything goes through Pending changes.' },
  tienenArtista: { es: ' temas por completar · buscados: ', en: ' tracks to fill in · searched: ' },
  conError: { es: (k: string) => ` (${k} con error)`, en: (k: string) => ` (${k} with errors)` },
  pendientes: { es: ' · faltan: ', en: ' · left: ' },
  mbPermite: {
    es: (m: number) => `MusicBrainz permite un pedido por segundo: unos ${m} min. Podés cambiar de pantalla: el proceso sigue y lo ves acá cuando vuelvas. Se puede cancelar y retomar; lo ya buscado no se vuelve a pedir. Hace falta internet.`,
    en: (m: number) => `MusicBrainz allows one request per second: about ${m} min. You can switch screens: the process keeps going and you will see it here when you come back. You can cancel and pick it up again; what was already searched is not asked for again. You need internet.`,
  },
  temasUnit: { es: 'temas', en: 'tracks' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  buscando: { es: 'Buscando…', en: 'Searching…' },
  seguir: { es: (k: string) => `Seguir buscando (${k} pendientes)`, en: (k: string) => `Keep searching (${k} pending)` },
  buscarN: { es: (k: string) => `Buscar ${k} temas`, en: (k: string) => `Search ${k} tracks` },
  reintentar: { es: (k: string) => `Reintentar los ${k} con error`, en: (k: string) => `Try the ${k} with errors again` },
  sinResultados: { es: 'Todavía no hay resultados.', en: 'No results yet.' },
  encontre: { es: (k: string) => `Revisar datos de ${k} temas`, en: (k: string) => `Review data for ${k} tracks` },
  ocultarProp: { es: 'Ocultar los datos', en: 'Hide the data' },
  c1: { es: 'Cómo leer esta tabla:', en: 'How to read this table:' },
  c2: { es: ' cada fila es un tema y cada columna un dato que le falta. Lo ', en: ' each row is a track and each column is a piece of information it is missing. The ' },
  c3: { es: 'verde con casilla', en: 'green with a box' },
  c4: { es: ' es lo que PAILA ', en: ' is what PAILA would ' },
  c5: { es: 'agregaría', en: 'add' },
  c6: { es: ' (tildado = se agrega). ', en: ' (ticked = it gets added). ' },
  c7: { es: 'Lo ', en: 'The ' },
  c8: { es: 'gris', en: 'grey' },
  c9: { es: ' es lo que el tema ', en: ' is what the track ' },
  c10: { es: 'ya tenía', en: 'already had' },
  c11: { es: ' y no se toca. Nada se escribe en los archivos hasta que apretás Aplicar en Cambios pendientes.', en: ' and is left alone. Nothing is written to your files until you press Apply in Pending changes.' },
  proponer: { es: (a: string, b: string) => `Sumar ${a} cambios en ${b} temas a lo que vas a aplicar`, en: (a: string, b: string) => `Add ${a} changes in ${b} tracks to what you are going to apply` },
  seguroTip: { es: 'Confianza alta y álbum normal; sin el género', en: 'High confidence and a normal album; without the genre' },
  tildarSeguro: { es: 'Tildar lo seguro', en: 'Tick the sure ones' },
  tildarTodo: { es: 'Tildar todo', en: 'Tick all' },
  destildarTodo: { es: 'Destildar todo', en: 'Untick all' },
  mostrarSosp: { es: 'Mostrar álbumes sospechosos (en vivo, recopilaciones)', en: 'Show suspicious albums (live, compilations)' },
  colTema: { es: 'Tema', en: 'Track' },
  colConf: { es: 'Confianza', en: 'Confidence' },
  filaTip: { es: 'Tildar o destildar todo lo de este tema', en: 'Tick or untick everything for this track' },
  alta: { es: 'alta', en: 'high' },
  media: { es: 'media', en: 'medium' },
  baja: { es: 'baja', en: 'low' },
  sospTip: { es: 'El álbum parece un disco en vivo, una recopilación o similar: puede no ser tu versión', en: 'The album looks like a live album, a compilation or similar: it may not be your version' },
  sospechoso: { es: 'sospechoso', en: 'suspicious' },
  masAplica: { es: (k: number) => `… y ${k} más. Aplicá estos y volvé a entrar.`, en: (k: number) => `… and ${k} more. Apply these and come back.` },
})

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
type Field = 'album' | 'year' | 'genre'
const FIELDS: { key: Field; label: string }[] = [{ key: 'album', label: T.album }, { key: 'year', label: T.year }, { key: 'genre', label: T.genre }]

const CONF: Record<string, string> = { get alta() { return T.alta }, get media() { return T.media }, get baja() { return T.baja } }

/** Una celda de la tabla de propuestas: lo nuevo (verde, con casilla), lo que ya tenía (gris) o nada. */
function Cell({ p, field, on, onToggle }: { p: MbProposal; field: Field; on: boolean; onToggle: (v: boolean) => void }) {
  const fill = p.fills.find((f) => f.field === field)
  const have = p.current[field]
  if (fill) {
    return (
      <label className={`mb-new ${on ? 'on' : ''}`} title={on ? T.seAgregaTip : T.noSeAgregaTip}>
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span><i>{T.seAgrega}</i>{fill.value}</span>
      </label>
    )
  }
  return have ? <span className="mb-have" title={T.yaTieneTip}><i>{T.yaTiene}</i>{have}</span> : <span className="muted">—</span>
}

/** Completar desde internet (MusicBrainz y Cover Art Archive): año, álbum, género y tapas. Solo completa lo que está vacío. */
export default function Online({ onStaged, onGo }: { onStaged: () => void; onGo: (p: PageKey) => void }) {
  const mb = useJob('mb')
  const covers = useJob('mbcovers')
  const [st, setSt] = useState<MbStatus | null>(null)
  const [props, setProps] = useState<MbProposal[] | null>(null)
  const [picked, setPicked] = useState<Map<number, Set<Field>>>(new Map())
  const [showSuspicious, setShowSuspicious] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false)

  const refresh = useCallback(async () => {
    setSt(await window.paila.mbStatus())
    const p = await window.paila.mbProposals()
    setProps(p)
    // Los temas nuevos entran con lo seguro tildado (confianza alta, álbum normal, sin el género: las etiquetas de MusicBrainz las ponen usuarios).
    // Lo que ya estaba en la lista conserva lo que el usuario tildó o destildó.
    setPicked((prev) => {
      const m = new Map(prev)
      for (const x of p) {
        if (seen.current.has(x.fileId)) continue
        seen.current.add(x.fileId)
        if (x.confidence === 'alta' && !x.suspicious) m.set(x.fileId, new Set(x.fills.filter((f) => f.field !== 'genre').map((f) => f.field as Field)))
      }
      // lo tildado que ya no se ofrece (se propuso o se aplicó) se saca: si no, "Proponer 2 cambios" seguía contándolo
      const quedan = new Map(p.map((x) => [x.fileId, new Set(x.fills.map((f) => f.field))]))
      for (const [id, fs] of m) { const q = quedan.get(id); if (!q) m.delete(id); else m.set(id, new Set([...fs].filter((f) => q.has(f)))) }
      return m
    })
  }, [])
  const seen = useRef(new Set<number>())
  useEffect(() => { refresh().catch((e) => setMsg(clean(e))) }, [refresh])
  // al terminar un proceso (o al volver a la pantalla con uno ya terminado) se actualiza la lista
  // mientras busca, los resultados van apareciendo para revisarlos sin esperar al final
  useEffect(() => { if (!mb?.running) return; const t = setInterval(() => { refresh().catch(() => {}) }, 8000); return () => clearInterval(t) }, [mb?.running, refresh])
  const wasRunning = useRef(false)
  useEffect(() => {
    const running = !!mb?.running || !!covers?.running
    if (wasRunning.current && !running) refresh()
    wasRunning.current = running
  }, [mb?.running, covers?.running, refresh])

  // lo propuesto, aplicado o descartado arriba sale de esta lista solo (useAlCambiarCambios)
  useAlCambiarCambios(() => { refresh().catch(() => {}) })
  const run = (retry = false) => { setMsg(null); window.paila.mbRun(retry).catch((e) => setMsg(clean(e))) }
  const busy = !!mb?.running || !!covers?.running

  const list = useMemo(() => (props ?? []).filter((p) => showSuspicious || !p.suspicious), [props, showSuspicious])
  const toggle = (id: number, field: Field, on: boolean) => setPicked((m) => { const t = new Map(m); const s = new Set(t.get(id) ?? []); on ? s.add(field) : s.delete(field); t.set(id, s); return t })
  const rowAll = (p: MbProposal, on: boolean) => setPicked((m) => { const t = new Map(m); t.set(p.fileId, on ? new Set(p.fills.map((f) => f.field as Field)) : new Set()); return t })
  const chosen = useMemo(() => [...picked.entries()].filter(([id]) => list.some((p) => p.fileId === id)).reduce((s, [, f]) => s + f.size, 0), [picked, list])
  const chosenRows = useMemo(() => [...picked.entries()].filter(([id, f]) => f.size && list.some((p) => p.fileId === id)).length, [picked, list])

  const setAll = (mode: 'safe' | 'none' | 'all') => setPicked(new Map(mode === 'none' ? [] : (props ?? []).filter((p) => mode === 'all' || (p.confidence === 'alta' && !p.suspicious)).map((p) => [p.fileId, new Set(p.fills.filter((f) => mode === 'all' || f.field !== 'genre').map((f) => f.field as Field))])))

  const stage = async () => {
    const items = [...picked.entries()].filter(([id]) => list.some((p) => p.fileId === id)).map(([fileId, f]) => ({ fileId, fields: [...f] })).filter((i) => i.fields.length)
    const k = await window.paila.mbStage(items)
    toast(T.propusieron(n(k.staged)) + (k.held ? T.retenidos(n(k.held)) : ''))
    onStaged()
  }
  const mins = st ? Math.ceil((st.pending * 1.1) / 60) : 0
  // las tres partes, plegadas: abierta la primera que falta (Plegable.tsx)
  const [estados, setEstados] = useState<(EstadoSeccion | undefined)[]>([])
  const estado = useCallback((i: number) => (e: EstadoSeccion) => setEstados((x) => { if (x[i]?.listo === e.listo && x[i]?.texto === e.texto) return x; const y = [...x]; y[i] = e; return y }), [])
  const [elegida, setElegida] = useState<number | null>(null)
  const abierta = primeraAbierta(elegida, estados)
  const alternar = (i: number) => () => setElegida(abierta === i ? 0 : i)
  const estadoMb: EstadoSeccion | undefined = st ? (st.pending > 0 ? { listo: false, texto: T.faltanN(n(st.pending)) } : props && props.length ? { listo: false, texto: T.paraRevisarN(n(props.length)) } : { listo: true, texto: T.listo }) : undefined
  useEffect(() => { if (estadoMb) estado(2)(estadoMb) }, [estadoMb?.listo, estadoMb?.texto, estado]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} />
      <Plegable n={1} titulo={T.pNombres} estado={estados[0]} abierto={abierta === 1} onToggle={alternar(1)}><OfficialNames onGo={onGo} onEstado={estado(0)} /></Plegable>
      <Plegable n={2} titulo={T.pGeneros} estado={estados[1]} abierto={abierta === 2} onToggle={alternar(2)}><Genres onStaged={onStaged} onGo={onGo} onEstado={estado(1)} /></Plegable>

      <Plegable n={3} titulo={T.h3} estado={estados[2]} abierto={abierta === 3} onToggle={alternar(3)}>
      <Cabecera nivel={3} titulo={null} ayuda={<>
        <p>
          {T.subMb} {T.i1}<b>MusicBrainz</b>{T.i2}<b>{T.i3}</b>{T.i4}<b>Cover Art Archive</b>{/* idioma-ok */}{T.i5}
          {T.i6}<b>{T.i7}</b>{T.i8}
        </p>
        {st && st.pending > 0 && <p className="muted small">{T.mbPermite(mins)}</p>}
        <p className="muted small"><b>{T.c1}</b>{T.c2}<span className="mb-key new">{T.c3}</span>{T.c4}<b>{T.c5}</b>{T.c6}{T.c7}<span className="mb-key have">{T.c8}</span>{T.c9}<b>{T.c10}</b>{T.c11}</p>
      </>} />
      {msg && <Aviso>{msg}</Aviso>}

      {st && !mb?.running && (
        <div className="callout">
          <b>{n(st.candidates)}</b>{T.tienenArtista}<b>{n(st.found + st.none + st.errors)}</b>{st.errors ? T.conError(n(st.errors)) : ''}{T.pendientes}<b>{n(st.pending)}</b>
        </div>
      )}
      {mb && <JobPanel job={mb} unit={T.temasUnit} onDismiss={() => window.paila.dismissJob('mb')}>{mb.running && <Boton variant="ghost" size="sm" disabled={mb.cancelling} onClick={() => window.paila.cancelJob('mb')}>{T.cancelar}</Boton>}</JobPanel>}
      <div className="row">
        <Boton disabled={busy || !st || st.pending === 0} onClick={() => run(false)}>{mb?.running ? T.buscando : st && st.found + st.none > 0 ? T.seguir(st ? n(st.pending) : '') : T.buscarN(st ? n(st.pending) : '')}</Boton>
        {st && st.errors > 0 && <Boton variant="ghost" disabled={busy} onClick={() => run(true)}>{T.reintentar(n(st.errors))}</Boton>}
      </div>

      {props && props.length === 0 && <p className="muted">{T.sinResultados}</p>}
      {props && props.length > 0 && (<>
        <div className="row"><Boton variant={abierto ? 'ghost' : 'primary'} onClick={() => setAbierto(!abierto)}>{abierto ? T.ocultarProp : T.encontre(n(props.length))}</Boton></div>
        {abierto && (<>
        <div className="actionbar">
          <Boton disabled={busy || !chosen} onClick={stage}>{T.proponer(n(chosen), n(chosenRows))}</Boton>
          <Boton variant="ghost" size="sm" onClick={() => setAll('safe')} title={T.seguroTip}>{T.tildarSeguro}</Boton>
          <Boton variant="ghost" size="sm" onClick={() => setAll('all')}>{T.tildarTodo}</Boton>
          <Boton variant="ghost" size="sm" onClick={() => setAll('none')}>{T.destildarTodo}</Boton>
          <label className="small push-right"><input type="checkbox" checked={showSuspicious} onChange={(e) => setShowSuspicious(e.target.checked)} />{T.mostrarSosp}</label>
        </div>
        <div className="mb-table">
          <div className="mb-row mb-head"><span /><span>{T.colTema}</span>{FIELDS.map((f) => <span key={f.key}>{f.label}</span>)}<span>{T.colConf}</span></div>
          {list.slice(0, 400).map((p) => {
            const on = picked.get(p.fileId) ?? new Set<Field>()
            const all = p.fills.every((f) => on.has(f.field as Field))
            return (
              <div key={p.fileId} className="mb-row">
                <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = !all && on.size > 0 }} onChange={(e) => rowAll(p, e.target.checked)} title={T.filaTip} />
                <span className="mb-song" title={p.rel}><b>{p.current.title}</b><br /><span className="muted small">{p.current.artist}</span></span>
                {FIELDS.map((f) => <Cell key={f.key} p={p} field={f.key} on={on.has(f.key)} onToggle={(v) => toggle(p.fileId, f.key, v)} />)}
                <span>
                  <span className={`pill ${p.confidence === 'alta' ? 'pill-green' : 'pill-amber'}`} style={{ marginLeft: 0 }}>{CONF[p.confidence] ?? p.confidence}</span>
                  {p.suspicious && <Pildora tone="atencion" title={T.sospTip}>{T.sospechoso}</Pildora>}
                </span>
              </div>
            )
          })}
        </div>
        {list.length > 400 && <p className="muted">{T.masAplica(list.length - 400)}</p>}
        </>)}
      </>)}
      </Plegable>

    </div>
  )
}
