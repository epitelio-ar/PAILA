// Ventana "Buscar de otra forma": lo que no se encontró (o no se pudo bajar) de una lista, con otra búsqueda para cada tema
// (core/sockseek/reintento.ts: sin el feat., sin "(Remastered…)", solo título y artista principal, o la versión original si
// era un remix). Cada fila dice qué cambia en la búsqueda y se elige; "Para todos" elige lo mismo en todas las que lo tienen.
// Lo elegido entra a la tanda como un reintento de esa lista: va a la misma carpeta y, si NAPIA no estaba bajando, arranca.
import { useEffect, useMemo, useState } from 'react'
import { Boton, Info, Pildora, Ventana } from '@paila/diseno'
import type { EntradaHistorial, TandaEstado, TipoVariante, Variante } from '@paila/shared/napia'
import { textos } from '@paila/shared/idioma'
import { TIP, n } from './textos'
import { TC } from './Calidad'

const T = textos({
  titulo: { es: 'Buscar de otra forma', en: 'Search another way' },
  intro1: { es: 'En Soulseek los archivos casi nunca se llaman como en Spotify. Para cada tema de «', en: 'On Soulseek files are almost never named like they are on Spotify. For each track of “' },
  intro2: { es: '» que no llegó te proponemos otra búsqueda: elegí la que quieras.', en: '” that didn\'t arrive we suggest another search: pick the one you like.' },
  intro3: { es: ' Lo que se baje va a la misma carpeta de la lista.', en: ' What gets downloaded goes to the same folder as the list.' },
  armando: { es: 'Armando las búsquedas…', en: 'Putting the searches together…' },
  paraTodos: { es: 'Para todos:', en: 'For all:' },
  sugerido: { es: 'Lo sugerido', en: 'The suggested one' },
  principal: { es: 'Solo título y artista principal', en: 'Only title and main artist' },
  original: { es: 'La versión original', en: 'The original version' },
  igualAntes: { es: 'Igual que antes', en: 'Same as before' },
  noSePudo: { es: 'No se pudo', en: "Couldn't get it" },
  noSeEncontro: { es: 'No se encontró', en: 'Not found' },
  comoBuscar: { es: (t: string) => `Cómo buscar ${t}`, en: (t: string) => `How to search for ${t}` },
  noBuscarlo: { es: 'No buscarlo', en: "Don't search for it" },
  busca: { es: 'Busca ', en: 'Searches for ' },
  noSeBusca: { es: 'No se busca.', en: "It isn't searched for." },
  buscaIgual: { es: 'Busca igual que antes (quizás ahora alguien lo tiene).', en: 'Searches the same as before (maybe someone has it now).' },
  nadaParaSacar: {
    es: 'No hay nada para sacarle al nombre: se busca igual que antes (quizás ahora alguien lo tiene).',
    en: "There's nothing to remove from the name: it's searched the same as before (maybe someone has it now).",
  },
  sumarTanda: { es: (c: string) => `Sumar a la tanda (${c})`, en: (c: string) => `Add to the batch (${c})` },
  buscarNuevo: { es: (c: string) => `Buscar de nuevo (${c})`, en: (c: string) => `Search again (${c})` },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  bajandoAhora: { es: 'NAPIA está bajando: se busca cuando termine lo que está en la tanda.', en: "NAPIA is downloading: it's searched for when what's in the batch finishes." },
})

/** Una lista y lo que le faltó (del final de una bajada o del historial). */
export interface ParaReintentar { nombre: string; faltan: EntradaHistorial['faltan'] }

/** Qué se elige para cada tema: una de sus búsquedas nuevas (por su número), la misma de antes, o no buscarlo. */
type Eleccion = number | 'igual' | 'no'

interface Props {
  para: ParaReintentar
  running: boolean
  onClose: () => void
  onListo: (t: TandaEstado) => void
}

const nombreDe = (t: { artist: string; title: string }) => (t.artist ? `${t.artist} - ${t.title}` : t.title)

export default function Reintentar({ para, running, onClose, onListo }: Props) {
  const [vs, setVs] = useState<Variante[][] | null>(null)
  const [elegido, setElegido] = useState<Eleccion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => {
    void window.napia.variantes(para.faltan.map((t) => ({ artist: t.artist, title: t.title }))).then((v) => {
      setVs(v)
      // de entrada: la búsqueda nueva que no cambia de versión; si no hay, la misma de antes (quizás ahora alguien lo tiene)
      setElegido(v.map((opts) => { const i = opts.findIndex((o) => o.tipo !== 'original'); return i >= 0 ? i : 'igual' }))
    })
  }, [para])

  const paraTodos = (tipo: TipoVariante | 'sugerida') => setElegido((cur) => cur.map((e, i) => {
    const opts = vs?.[i] ?? []
    const j = tipo === 'sugerida' ? opts.findIndex((o) => o.tipo !== 'original') : opts.findIndex((o) => o.tipo === tipo)
    return j >= 0 ? j : tipo === 'sugerida' ? 'igual' : e
  }))
  const hay = useMemo(() => new Set((vs ?? []).flat().map((v) => v.tipo)), [vs])
  const busquedas = para.faltan.map((t, i) => {
    const e = elegido[i]
    return e === 'no' || e == null ? null : e === 'igual' ? { artist: t.artist, title: t.title } : vs?.[i]?.[e] ?? null
  })
  const cuantos = busquedas.filter(Boolean).length

  const buscar = async () => {
    setOcupado(true); setError(null)
    try {
      const tracks = busquedas.filter((b): b is { artist: string; title: string } => !!b).map((b) => ({ artist: b.artist, title: b.title, album: null, duration: null }))
      // idioma-ok (dato que va al proceso principal, no se muestra así)
      let t = await window.napia.sumarATanda({ name: para.nombre, source: 'Otra búsqueda', tracks, skipped: [] }, true)
      if (!running) { await window.napia.start(); t = await window.napia.tanda() }
      onListo(t)
    } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); setOcupado(false) }
  }

  return (
    <Ventana onClose={onClose} busy={ocupado} className="reintentar">
      <h2>{T.titulo}</h2>
      <p className="muted">
        {T.intro1}{para.nombre}{T.intro2}
        {T.intro3}<Info tip={TIP.reintento} />
      </p>
      {!vs ? <p className="muted">{T.armando}</p> : (
        <>
          <div className="row reintentar-todos">
            <span className="small">{T.paraTodos}</span>
            <Boton size="sm" variant="ghost" onClick={() => paraTodos('sugerida')}>{T.sugerido}</Boton>
            {hay.has('principal') && <Boton size="sm" variant="ghost" onClick={() => paraTodos('principal')}>{T.principal}</Boton>}
            {hay.has('original') && <Boton size="sm" variant="ghost" onClick={() => paraTodos('original')}>{T.original}</Boton>}
            <Boton size="sm" variant="ghost" onClick={() => setElegido(para.faltan.map(() => 'igual'))}>{T.igualAntes}</Boton>
          </div>
          <div className="reintentar-filas">
            {para.faltan.map((t, i) => {
              const opts = vs[i] ?? []
              const e = elegido[i]
              const v = typeof e === 'number' ? opts[e] : null
              return (
                <div key={i} className="reintentar-fila">
                  <div className="row">
                    <span className="ellipsis"><b>{nombreDe(t)}</b></span>
                    <Pildora tone={t.estado === 'fallo' || t.estado === 'soloFalsa' ? 'error' : 'atencion'}>{t.estado === 'sinMejor' ? TC.sinMejor : t.estado === 'soloFalsa' ? TC.soloFalsa : t.estado === 'fallo' ? T.noSePudo : T.noSeEncontro}</Pildora>
                    <select className="push-right" aria-label={T.comoBuscar(nombreDe(t))} value={String(e ?? 'igual')} onChange={(ev) => { const x = ev.target.value; setElegido((cur) => cur.map((c, j) => (j === i ? (x === 'igual' || x === 'no' ? x : Number(x)) : c))) }}>
                      {opts.map((o, j) => <option key={j} value={j}>{o.etiqueta}</option>)}
                      <option value="igual">{T.igualAntes}</option>
                      <option value="no">{T.noBuscarlo}</option>{/* idioma-ok */}
                    </select>
                  </div>
                  <div className="small muted">
                    {v ? <>{T.busca}<b>«{nombreDe(v)}»</b>: {v.cambios.join(' · ')}.</>
                      : e === 'no' ? T.noSeBusca
                        : opts.length ? T.buscaIgual : T.nadaParaSacar}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
      {error && <p className="warn-inline">{error}</p>}
      <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
        <Boton disabled={!vs || !cuantos || ocupado} onClick={buscar}>{running ? T.sumarTanda(n(cuantos)) : T.buscarNuevo(n(cuantos))}</Boton>
        <Boton variant="ghost" onClick={onClose} disabled={ocupado}>{T.cancelar}</Boton>
        {running && <span className="muted small">{T.bajandoAhora}</span>}
      </div>
    </Ventana>
  )
}
