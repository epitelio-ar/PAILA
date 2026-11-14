// Ordenar, la pregunta de las carpetas (se hace una vez): tres formas armadas con dos temas tuyos de ejemplo, "Armar la mía" con
// bloques (sin códigos con %) y "No tocar mis carpetas". Los ejemplos salen de la vista previa de Organizar con cada forma.
import { useEffect, useState } from 'react'
import type { OrganizeOptions } from '@paila/shared/types'
import { Boton, Casilla, Icon, Info } from '@paila/diseno'
import { T } from './Ordenar.textos'
import { aRegla, deRegla, DEST_DE_FABRICA, elegirEjemplos, esForma, FORMA_DE_FABRICA, FORMAS, NIVELES, type Forma, type FormaArmada, type Nivel } from './ordenarRegla'

const NOMBRE: Record<Nivel, () => string> = { artista: () => T.nArtista, disco: () => T.nDisco, anio: () => T.nAnio, genero: () => T.nGenero }
const ARMADAS: { k: FormaArmada; nombre: () => string; dice: () => string }[] = [
  { k: 'discos', nombre: () => T.porDisco, dice: () => T.porDiscoDice },
  { k: 'artistas', nombre: () => T.porArtista, dice: () => T.porArtistaDice },
  { k: 'generos', nombre: () => T.porGenero, dice: () => T.porGeneroDice },
]

/** Una ruta en escalera: cada carpeta un renglón más adentro, el archivo en negrita. */
function Escalera({ ruta }: { ruta: string }) {
  const p = ruta.split('/')
  return <div className="ord-muestra">{p.map((x, i) => <div key={i} style={{ paddingLeft: i * 12 }}>{i ? '└ ' : ''}{i === p.length - 1 ? <b>{x}</b> : x}</div>)}</div>
}

/** Unos temas tuyos que se moverían con esta regla, sin los que chocan ni los repetidos sin decidir (ipc/ordenar.ts), elegidos para que muestren la forma. */
function useEjemplos(o: OrganizeOptions, cuantos: number) {
  const [rutas, setRutas] = useState<{ de: string; a: string }[] | null>(null)
  const clave = JSON.stringify(o)
  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => {
      window.paila.ejemplosCarpetas(o).then((ms) => { if (vivo) setRutas(elegirEjemplos(ms, cuantos, o.dest).map((m) => ({ de: m.from, a: m.to }))) }, () => { if (vivo) setRutas([]) })
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps
  return rutas
}

function Opcion({ k, nombre, dice, tildes, hoy, onElegir }: { k: FormaArmada; nombre: string; dice: string; tildes: Pick<Forma, 'numero' | 'anio'>; hoy: boolean; onElegir: (o: OrganizeOptions) => void }) {
  const o = aRegla({ ...FORMA_DE_FABRICA, ...FORMAS[k], ...tildes })
  const rutas = useEjemplos(o, 2)
  return (
    <button className={`ord-opcion${hoy ? ' ord-hoy' : ''}`} onClick={() => onElegir(o)}>
      <b>{nombre}</b>{hoy && <span className="ord-mejor" title={T.asiHoyTip}>{T.asiHoy}</span>}<span className="muted small">{dice}</span>
      {rutas?.length ? rutas.map((r) => <Escalera key={r.de} ruta={r.a} />) : <span className="muted small">{rutas ? T.sinEjemplos : T.armandoEjemplo}</span>}
    </button>
  )
}

/** `hoy`: la forma que ya tienen tus carpetas (se propone como elegida, con sus tildes; corrida supervisada, 13/11). */
export function PreguntaCarpetas({ regla, hoy, onElegir, onEditor }: { regla: OrganizeOptions; hoy: OrganizeOptions | null; onElegir: (o: OrganizeOptions | null) => void; onEditor: () => void }) {
  const actual = deRegla(regla)
  const [tildes, setTildes] = useState({ numero: actual?.numero ?? true, anio: actual?.anio ?? true })
  return (
    <div className="ord-ancho">
      <h2 className="ord-titulo">{T.comoCarpetas}</h2>
      <p className="muted">{T.comoCarpetasSub}</p>
      <div className="ord-opciones">{ARMADAS.map((a) => <Opcion key={a.k} k={a.k} nombre={a.nombre()} dice={a.dice()} tildes={tildes} hoy={!!hoy && esForma(hoy, a.k)} onElegir={onElegir} />)}</div>
      <div className="ord-panel">
        <h4>{T.enLosNombres}</h4>
        <Casilla checked={tildes.numero} onChange={(v) => setTildes({ ...tildes, numero: v })} label={T.conNumero} detail={tildes.numero ? '01 - Final' : 'Final'} /> {/* idioma-ok: un nombre de archivo de ejemplo */}
        <Casilla checked={tildes.anio} onChange={(v) => setTildes({ ...tildes, anio: v })} label={T.conAnio} detail={tildes.anio ? '2000 - La Esquina del Infinito' : 'La Esquina del Infinito'} /> {/* idioma-ok: un disco de ejemplo */}
      </div>
      <div className="actionrow">
        <Boton variant="ghost" onClick={onEditor}>{T.armarLaMia}</Boton>
        <Boton variant="ghost" onClick={() => onElegir(null)} title={T.noTocarTip}>{T.noTocar}</Boton>
      </div>
    </div>
  )
}

export function EditorCarpetas({ regla, onUsar, onVolver }: { regla: OrganizeOptions; onUsar: (o: OrganizeOptions) => void; onVolver: () => void }) {
  const [f, setF] = useState<Forma>(() => deRegla(regla) ?? FORMA_DE_FABRICA)
  const o = aRegla(f)
  const rutas = useEjemplos(o, 3)
  const libres = NIVELES.filter((n) => !f.niveles.includes(n))
  const mover = (i: number, d: -1 | 1) => { const n = [...f.niveles]; [n[i], n[i + d]] = [n[i + d], n[i]]; setF({ ...f, niveles: n }) }
  return (
    <div className="ord-ancho">
      <h2 className="ord-titulo">{T.armaTitulo}</h2>
      <p className="muted">{T.armaSub}</p>
      <div className="ord-editor">
        <div className="ord-panel">
          <h4>{T.carpetaPrincipal} <Info tip={T.carpetaPrincipalTip} /></h4>
          <input value={f.dest} onChange={(e) => setF({ ...f, dest: e.target.value })} placeholder={DEST_DE_FABRICA} />
          <h4>{T.niveles}</h4>
          {f.niveles.length ? f.niveles.map((n, i) => (
            <div key={n}>
              <div className="ord-nivel"><b>{NOMBRE[n]()}</b>
                <button className="link" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={T.subir}><Icon name="up" size={14} /></button>
                <button className="link" disabled={i === f.niveles.length - 1} onClick={() => mover(i, 1)} aria-label={T.bajar}><Icon name="down" size={14} /></button>
                <button className="link" onClick={() => setF({ ...f, niveles: f.niveles.filter((x) => x !== n) })} aria-label={T.sacar}><Icon name="close" size={14} /></button>
              </div>
              {n === 'disco' && <Casilla checked={f.anio} onChange={(v) => setF({ ...f, anio: v })} label={T.conAnio} />}
            </div>
          )) : <p className="muted small">{T.sinNiveles}</p>}
          {libres.length > 0 && <div className="row">{libres.map((n) => <Boton key={n} size="sm" variant="ghost" onClick={() => setF({ ...f, niveles: [...f.niveles, n] })}>+ {NOMBRE[n]()}</Boton>)}</div>}
          <h4>{T.nombreArchivo}</h4>
          <Casilla tipo="radio" checked={f.archivo === 'titulo'} onChange={() => setF({ ...f, archivo: 'titulo' })} label={T.soloTitulo} />
          <Casilla tipo="radio" checked={f.archivo === 'artistaTitulo'} onChange={() => setF({ ...f, archivo: 'artistaTitulo' })} label={T.artistaTitulo} />
          <Casilla checked={f.numero} onChange={(v) => setF({ ...f, numero: v })} label={T.conNumero} />
          <Casilla checked={f.soloCarpetas} onChange={(v) => setF({ ...f, soloCarpetas: v })} label={T.nombresComoEstan} />
        </div>
        <div className="ord-panel">
          <h4>{T.asiQuedan}</h4>
          {rutas?.length ? rutas.map((r) => <div key={r.de} className="ord-ejemplo"><span className="muted small">{r.de}</span><Escalera ruta={r.a} /></div>) : rutas && <p className="muted small">{T.sinEjemplos}</p>}
          <p className="muted small">{T.faltaDato}</p>
          <details className="small"><summary>{T.avanzado}</summary><code>{o.rule}</code></details>
        </div>
      </div>
      <div className="actionrow"><Boton size="lg" onClick={() => onUsar(o)}>{T.usarForma}</Boton><Boton variant="ghost" onClick={onVolver}>{T.volver}</Boton></div>
    </div>
  )
}
