// Sección "Género" de Completar desde internet (MASTERPLAN-3, punto 4): busca en Discogs y Last.fm los temas sin género,
// muestra el género propuesto para cada uno (con de dónde salió) y "misma cosa, escrita distinto". Todo va a Cambios pendientes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GenreLevel, GenreProposal, GenreReport, GenresStatus } from '@paila/shared/types'
import type { PageKey } from './nav'
import type { EstadoSeccion } from './Plegable'
import { useAlCambiarCambios } from './hooks/useChanges'
import { JobPanel, useJob } from './jobs'
import { n } from './format'
import { toast } from './toast'
import { Aviso, Boton, Cabecera, Casilla, Info, Pildora } from '@paila/diseno'
import { textos, cant } from '@paila/shared/idioma'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const T = textos({
  disco: { es: 'El disco', en: 'The album' },
  tipQue: {
    es: 'El género que va en el tag de cada tema (lo leen Rekordbox, el celular, la PC). PAILA propone uno solo, de una lista de géneros conocidos, juntando lo que dicen Discogs y Last.fm. Si los otros temas del mismo disco ya tienen un género parejo, propone ese.',
    en: 'The genre that goes in the tag of each track (Rekordbox, your phone and your PC read it). PAILA suggests just one, from a list of known genres, combining what Discogs and Last.fm say. If the other tracks on the same album already share a genre, it suggests that one.',
  },
  tipNivel: {
    es: 'Como tu biblioteca: en cada familia usa lo que vos ya usás (si el rock lo tenés como "Rock" a secas, propone Rock; si la electrónica la tenés por estilo, propone Techno o Deep House). Estilo es lo más preciso (Deep House, Cumbia, Rock Nacional). Género general es lo más grueso (Electronic, Latin, Rock). Podés mirar los tres antes de proponer.',
    en: 'Like your library: in each family it uses what you already use (if your rock is just "Rock", it suggests Rock; if your electronic music is by style, it suggests Techno or Deep House). Style is the most precise (Deep House, Cumbia, Rock Nacional). General genre is the broadest (Electronic, Latin, Rock). You can look at all three before suggesting.',
  },
  tipConf: {
    es: 'Alta: Discogs y Last.fm dicen lo mismo, o varios discos de Discogs coinciden, o el resto del disco ya lo tiene. Media: una sola fuente, o dos géneros parejos. Lo de confianza media viene destildado.',
    en: 'High: Discogs and Last.fm say the same thing, or several Discogs releases agree, or the rest of the album already has it. Medium: a single source, or two similar genres. Medium ones come unticked.',
  },
  tipEscritura: {
    es: 'Temas con el mismo género escrito de otra forma (mayúsculas, acentos o signos: "rock" y "Rock"). Se propone la forma que más usás. Nunca cambia un género por otro ("Rap" no pasa a "Hip-Hop").',
    en: 'Tracks with the same genre written another way (capitals, accents or symbols: "rock" and "Rock"). It suggests the form you use most. It never swaps one genre for another ("Rap" does not become "Hip-Hop").',
  },
  propusieron: { es: (k: string) => `${k} cambios de género quedaron para aplicar: revisalos arriba y apretá Aplicar.`, en: (k: string) => `${k} genre changes are ready to apply: review them at the top and press Apply.` },
  retenidos: {
    es: (k: string) => ` ${k} quedaron para mirar a mano en Arreglar nombres: ese dato ya lo había puesto otra herramienta (o vos, a mano).`,
    en: (k: string) => ` ${k} were left to check by hand in Fix names: that field had already been set by another tool (or by you, by hand).`,
  },
  titulo: { es: 'Género', en: 'Genre' },
  p1: { es: 'PAILA propone ', en: 'PAILA suggests ' },
  p2: { es: 'un solo género', en: 'just one genre' },
  p3: { es: ' por tema, juntando los estilos de ', en: ' per track, combining the styles from ' },
  p4: { es: ' (los discos donde está el tema) y las etiquetas de ', en: ' (the albums the track is on) and the tags from ' },
  p5: { es: '(solo las que son géneros: nada de "seen live" ni "favorites"). Solo para los temas ', en: '(only the ones that are genres: no "seen live" or "favorites"). Only for tracks ' },
  p6: { es: 'sin género', en: 'with no genre' },
  p7: { es: ' o con uno que no dice nada ("Other", "Unknown"):', en: ' or with one that says nothing ("Other", "Unknown"):' },
  p8: { es: 'lo que ya tiene género no se toca', en: 'whatever already has a genre is left alone' },
  p9: { es: ', y tampoco lo que cambiaste a mano. Solo se envía el artista y el título. Todo pasa por Cambios pendientes.', en: ', and so is whatever you changed by hand. Only the artist and the title are sent. Everything goes through Pending changes.' },
  hacenFaltaClaves: { es: 'Falta la clave de Discogs.', en: 'The Discogs key is missing.' },
  irConfig: { es: 'Ir a Configuración', en: 'Go to Settings' },
  sinGeneroBuscar: { es: ' temas sin género', en: ' tracks with no genre' },
  falta: { es: ' · faltan: ', en: ' · left: ' },
  busquedasTxt: { es: ' búsquedas', en: ' searches' },
  unos: { es: (m: number) => ` (unos ${m} min; podés cambiar de pantalla, cancelar y retomar)`, en: (m: number) => ` (about ${m} min; you can switch screens, cancel and pick it up again)` },
  tipDiscogs: { es: 'Los estilos de los discos donde está el tema. Necesita clave.', en: 'The styles of the albums the track is on. Needs a key.' },
  tipLastfm: { es: 'Las etiquetas que la gente le pone al tema y al artista. Opcional: sin la clave anda solo con Discogs.', en: 'The tags people give the track and the artist. Optional: without the key it works with Discogs alone.' },
  sinClave: { es: 'sin clave', en: 'no key' },
  sinClaveOpc: { es: 'sin clave (opcional)', en: 'no key (optional)' },
  faltan: { es: (k: string) => `faltan ${k}`, en: (k: string) => `${k} left` },
  listo: { es: 'listo', en: 'done' },
  busquedas: { es: 'búsquedas de géneros', en: 'genre searches' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  buscando: { es: 'Buscando…', en: 'Searching…' },
  buscar: { es: (k: string) => `Buscar géneros${k ? ` (${k} búsquedas)` : ''}`, en: (k: string) => `Look up genres${k ? ` (${k} searches)` : ''}` },
  claves: { es: 'Claves de internet', en: 'Internet keys' },
  detalle: { es: 'Detalle', en: 'Detail' },
  nivBib: { es: 'Como tu biblioteca', en: 'Like your library' },
  nivEstilo: { es: 'Estilo', en: 'Style' },
  nivGen: { es: 'Género general', en: 'General genre' },
  resumen: {
    es: (p: number, e: number, g: number) => `${n(p)} propuestas · ${n(g)} ya tienen género (no se tocan)`,
    en: (p: number, e: number, g: number) => `${cant(p, 'suggestion', 'suggestions')} · ${n(g)} already have a genre (left alone)`,
  },
  aMano: { es: (k: number) => ` · ${n(k)} los cambiaste a mano (no se tocan)`, en: (k: number) => ` · ${n(k)} you changed by hand (left alone)` },
  todos: { es: 'Todos', en: 'All' },
  proponer: { es: (k: number) => `Sumar ${n(k)} géneros a lo que vas a aplicar`, en: (k: number) => `Add ${k === 1 ? '1 genre' : `${n(k)} genres`} to what you are going to apply` },
  seguroTip: { es: 'Solo los de confianza alta', en: 'Only the high-confidence ones' },
  tildarSeguro: { es: 'Tildar lo seguro', en: 'Tick the sure ones' },
  tildarTodo: { es: 'Tildar todo', en: 'Tick all' },
  destildarTodo: { es: 'Destildar todo', en: 'Untick all' },
  colTema: { es: 'Tema', en: 'Track' },
  colAhora: { es: 'Ahora', en: 'Now' },
  colPropone: { es: 'Se propone', en: 'Suggested' },
  colDeDonde: { es: 'De dónde sale', en: 'Where it comes from' },
  colConf: { es: 'Confianza', en: 'Confidence' },
  tildadoTip: { es: 'Tildado = se propone este género', en: 'Ticked = this genre is suggested' },
  tambienMay: { es: 'También', en: 'Also' },
  tambien: { es: 'también', en: 'also' },
  alta: { es: 'alta', en: 'high' },
  media: { es: 'media', en: 'medium' },
  masProponer: { es: (k: string) => `… y ${k} más. Proponé estos y volvé a entrar, o elegí un género de arriba para ver solo esos.`, en: (k: string) => `… and ${k} more. Suggest these and come back, or pick a genre above to see only those.` },
  mismaCosa: { es: 'Misma cosa, escrita distinto', en: 'Same thing, written differently' },
  tema: { es: 'tema', en: 'track' },
  temas: { es: 'temas', en: 'tracks' },
  proponerEscritura: { es: (k: string) => `Sumar ${k} cambios de escritura a lo que vas a aplicar`, en: (k: string) => `Add ${k} spelling changes to what you are going to apply` },
  revisarProp: { es: (k: string) => `Revisar ${k} propuestas`, en: (k: string) => `Review ${k} suggestions` },
  ocultarProp: { es: 'Ocultar las propuestas', en: 'Hide the suggestions' },
  sinClaves: { es: 'sin claves de internet', en: 'no internet keys' },
  faltanN: { es: (k: string) => `faltan ${k} búsquedas`, en: (k: string) => `${k} searches left` },
  paraRevisarN: { es: (k: string) => `${k} para revisar`, en: (k: string) => `${k} to review` },
  listoE: { es: 'listo', en: 'done' },
  nadaRevisar: { es: 'Todavía no hay géneros para revisar. Corré la búsqueda de arriba.', en: 'There are no genres to review yet. Run the search above.' },
})
const SOURCE: Record<GenreProposal['sources'][number], string> = { discogs: 'Discogs', lastfm: 'Last.fm', musicbrainz: 'MusicBrainz', disco: T.disco }
const CONF: Record<string, string> = { get alta() { return T.alta }, get media() { return T.media } }

export default function Genres({ onStaged, onGo, onEstado }: { onStaged: () => void; onGo: (p: PageKey) => void; onEstado?: (e: EstadoSeccion) => void }) {
  const job = useJob('genres')
  const [st, setSt] = useState<GenresStatus | null>(null)
  const [level, setLevel] = useState<GenreLevel>('biblioteca')
  const [rep, setRep] = useState<GenreReport | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [spell, setSpell] = useState<Set<string>>(new Set())
  const [only, setOnly] = useState<string>('')
  const [msg, setMsg] = useState<string | null>(null)
  const seen = useRef(new Set<number>())
  const [abierto, setAbierto] = useState(false)

  const refresh = useCallback(async (lv: GenreLevel) => {
    setSt(await window.paila.genresStatus())
    const r = await window.paila.genresReport(lv)
    setRep(r)
    // los temas nuevos entran con lo seguro tildado (confianza alta); lo que ya estaba conserva lo que elegiste
    setPicked((prev) => {
      const s = new Set(prev)
      for (const p of r.proposals) { if (seen.current.has(p.fileId)) continue; seen.current.add(p.fileId); if (p.conf === 'alta') s.add(p.fileId) }
      return s
    })
  }, [])
  useEffect(() => { refresh(level).catch((e) => setMsg(clean(e))) }, [refresh, level])
  useEffect(() => { if (!job?.running) return; const t = setInterval(() => { refresh(level).catch(() => {}) }, 10000); return () => clearInterval(t) }, [job?.running, refresh, level])
  const was = useRef(false)
  useEffect(() => { if (was.current && !job?.running) refresh(level).catch(() => {}); was.current = !!job?.running }, [job?.running, refresh, level])

  useAlCambiarCambios(() => { refresh(level).catch(() => {}) })
  const run = () => { setMsg(null); window.paila.genresRun(false).catch((e) => setMsg(clean(e))) }
  const list = useMemo(() => (rep?.proposals ?? []).filter((p) => !only || p.genre === only), [rep, only])
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const p of rep?.proposals ?? []) m.set(p.genre, (m.get(p.genre) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]) }, [rep])
  // con un género elegido arriba, se propone solo lo que está a la vista
  const chosenIds = useMemo(() => list.filter((p) => picked.has(p.fileId)).map((p) => p.fileId), [list, picked])
  const chosen = chosenIds.length
  const spellCount = (rep?.spelling ?? []).filter((s) => spell.has(s.from)).reduce((a, s) => a + s.ids.length, 0)
  const setAll = (mode: 'safe' | 'all' | 'none') => setPicked(new Set(mode === 'none' ? [] : list.filter((p) => mode === 'all' || p.conf === 'alta').map((p) => p.fileId)))
  const toggle = (id: number, on: boolean) => setPicked((s) => { const t = new Set(s); on ? t.add(id) : t.delete(id); return t })

  const stage = async (what: 'genres' | 'spelling') => {
    try {
      const k = await window.paila.genresStage(what === 'genres' ? chosenIds : [], level, what === 'spelling' ? [...spell] : [])
      toast(T.propusieron(n(k.staged)) + (k.held ? T.retenidos(n(k.held)) : ''))
      if (what === 'spelling') setSpell(new Set()); else setPicked((s) => new Set([...s].filter((id) => !chosenIds.includes(id))))
      onStaged()
      await refresh(level)
    } catch (e) { setMsg(clean(e)) }
  }
  const left = st ? st.left.discogs + st.left.lastfm : 0
  const noKeys = st && !st.keys.discogs && !st.keys.lastfm
  // en qué está, en un renglón (lo muestra la sección plegada de Completar desde internet); sin claves no se abre sola
  const porRevisar = rep ? rep.proposals.length + rep.spelling.length : 0
  useEffect(() => {
    if (!st) return
    onEstado?.(noKeys ? { listo: true, texto: T.sinClaves } : left > 0 ? { listo: false, texto: T.faltanN(n(left)) } : porRevisar > 0 ? { listo: false, texto: T.paraRevisarN(n(porRevisar)) } : { listo: true, texto: T.listoE })
  }, [st, noKeys, left, porRevisar, onEstado])

  return (<>
    <Cabecera nivel={3} titulo={null} info={T.tipQue} ayuda={<>
      <p className="muted small">
        {T.p1}<b>{T.p2}</b>{T.p3}<b>Discogs</b>{T.p4}<b>Last.fm</b>
        {' '}{T.p5}<b>{T.p6}</b>{T.p7}
        {' '}<b>{T.p8}</b>{T.p9}
      </p>
      {st && (
        <div className="names-src">
          <span className={`pill ${!st.keys.discogs ? '' : st.left.discogs ? 'pill-blue' : 'pill-green'}`} style={{ marginLeft: 0 }} title={T.tipDiscogs}>Discogs: {!st.keys.discogs ? T.sinClave : st.left.discogs ? T.faltan(n(st.left.discogs)) : T.listo}</span>
          <span className={`pill ${!st.keys.lastfm ? '' : st.left.lastfm ? 'pill-blue' : 'pill-green'}`} style={{ marginLeft: 0 }} title={T.tipLastfm}>Last.fm: {!st.keys.lastfm ? T.sinClaveOpc : st.left.lastfm ? T.faltan(n(st.left.lastfm)) : T.listo}</span>
        </div>
      )}
      {st && left > 0 && <p className="muted small">{T.unos(st.minutes).trim()}</p>}
      <p className="small"><button className="link" onClick={() => onGo('settings')}>{T.claves}</button></p>
    </>} />
    {msg && <Aviso>{msg}</Aviso>}
    {noKeys && <Aviso tone="atencion">{T.hacenFaltaClaves} <button className="link" onClick={() => onGo('settings')}>{T.irConfig}</button></Aviso>}
    {st && !job?.running && !rep?.proposals.length && (
      <div className="callout">
        <b>{n(st.tracks)}</b>{T.sinGeneroBuscar}{!noKeys && <>{T.falta}<b>{n(left)}</b></>}
      </div>
    )}
    {job && <JobPanel job={job} unit={T.busquedas} onDismiss={() => window.paila.dismissJob('genres')}>{job.running && <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.cancelJob('genres')}>{T.cancelar}</Boton>}</JobPanel>}
    <div className="row">
      <Boton disabled={!!job?.running || !st || !!noKeys || left === 0} onClick={run}>{job?.running ? T.buscando : T.buscar(left ? n(left) : '')}</Boton>
    </div>

    {rep && (rep.proposals.length > 0 || rep.spelling.length > 0) && (<>
      <div className="row"><Boton variant={abierto ? 'ghost' : 'primary'} onClick={() => setAbierto(!abierto)}>{abierto ? T.ocultarProp : T.revisarProp(n(rep.proposals.length + rep.spelling.length))}</Boton></div>
      {abierto && (<>
      <div className="row" style={{ marginTop: 10 }}>
        <span className="small">{T.detalle} <Info tip={T.tipNivel} /></span>
        <Casilla tipo="radio" checked={level === 'biblioteca'} onChange={() => { setLevel('biblioteca'); setOnly('') }} label={T.nivBib} />
        <Casilla tipo="radio" checked={level === 'estilo'} onChange={() => { setLevel('estilo'); setOnly('') }} label={T.nivEstilo} />
        <Casilla tipo="radio" checked={level === 'general'} onChange={() => { setLevel('general'); setOnly('') }} label={T.nivGen} />
      </div>
      <div className="muted small">{T.resumen(rep.proposals.length, rep.empty, rep.withGenre)}{rep.handTouched ? T.aMano(rep.handTouched) : ''}</div>
      {counts.length > 1 && (
        <div className="names-src">
          <button className={`pill ${!only ? 'pill-accent' : ''}`} style={{ marginLeft: 0 }} onClick={() => setOnly('')}>{T.todos}</button>
          {counts.slice(0, 8).map(([g, k]) => <button key={g} className={`pill ${only === g ? 'pill-accent' : ''}`} style={{ marginLeft: 0 }} onClick={() => setOnly(only === g ? '' : g)}>{g} · {n(k)}</button>)}
        </div>
      )}
      {rep.proposals.length > 0 && (<>
        <div className="actionbar">
          <Boton disabled={!chosen} onClick={() => stage('genres')}>{T.proponer(chosen)}</Boton>
          <Boton variant="ghost" size="sm" onClick={() => setAll('safe')} title={T.seguroTip}>{T.tildarSeguro}</Boton>
          <Boton variant="ghost" size="sm" onClick={() => setAll('all')}>{T.tildarTodo}</Boton>
          <Boton variant="ghost" size="sm" onClick={() => setAll('none')}>{T.destildarTodo}</Boton>
        </div>
        <div className="mb-table">
          <div className="mb-row gen-row mb-head"><span /><span>{T.colTema}</span><span>{T.colAhora}</span><span>{T.colPropone}</span><span>{T.colDeDonde}</span><span>{T.colConf} <Info tip={T.tipConf} /></span></div>
          {list.slice(0, 400).map((p) => (
            <div key={p.fileId} className="mb-row gen-row">
              <input type="checkbox" checked={picked.has(p.fileId)} onChange={(e) => toggle(p.fileId, e.target.checked)} title={T.tildadoTip} />
              <span className="mb-song" title={p.rel}><b>{p.title}</b><br /><span className="muted small">{p.artist}</span></span>
              <span className="muted">{p.current ?? '—'}</span>
              <label className={`mb-new ${picked.has(p.fileId) ? 'on' : ''}`}><input type="checkbox" hidden checked={picked.has(p.fileId)} onChange={(e) => toggle(p.fileId, e.target.checked)} /><span>{p.genre}</span></label>
              <span className="small mb-song" title={[p.why, p.others.length ? `${T.tambienMay}: ${p.others.join(', ')}` : ''].filter(Boolean).join('\n')}>{p.sources.map((s) => SOURCE[s]).join(' + ')}{p.others.length ? <span className="muted"> · {T.tambien} {p.others.join(', ')}</span> : null}</span>
              <span><Pildora tone={p.conf === 'alta' ? 'ok' : 'atencion'}>{CONF[p.conf]}</Pildora></span>
            </div>
          ))}
        </div>
        {list.length > 400 && <p className="muted">{T.masProponer(n(list.length - 400))}</p>}
      </>)}

      {rep.spelling.length > 0 && (<>
        <h4>{T.mismaCosa} <Info tip={T.tipEscritura} /></h4>
        <div className="listbox">
          {rep.spelling.map((s) => (
            <label key={s.from} className="listbox-row choice small">
              <input type="checkbox" checked={spell.has(s.from)} onChange={(e) => setSpell((x) => { const t = new Set(x); e.target.checked ? t.add(s.from) : t.delete(s.from); return t })} />
              <span className="choice-body">"{s.from}" → <b>"{s.to}"</b> <span className="muted">({cant(s.ids.length, T.tema, T.temas)})</span></span>
            </label>
          ))}
        </div>
        <div className="row"><Boton variant="ghost" disabled={!spellCount} onClick={() => stage('spelling')}>{T.proponerEscritura(n(spellCount))}</Boton></div>
      </>)}
      </>)}
    </>)}
    {rep && rep.proposals.length === 0 && rep.spelling.length === 0 && st && st.tracks > 0 && <p className="muted">{T.nadaRevisar}</p>}
  </>)
}
