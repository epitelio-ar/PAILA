// La confirmación y el resultado, iguales en todas las pantallas que tocan archivos (motor único, masterplan 4, 4B.4).
// Antes de tocar nada, el botón se vuelve una pregunta en el mismo lugar: qué se va a hacer, cómo se deshace, «Sí» y
// «Cancelar». Después, el resultado: lo que se hizo, lo que no se pudo (cada uno con su motivo, todos a la vista con
// «Ver los N») y cómo se deshace. Así en todas las pantallas se lee y se aprieta lo mismo.
import { useState, type ReactNode } from 'react'
import { Aviso, Boton } from '@paila/diseno'
import { Icon } from './icons'
import { n } from './format'
import { textos } from '@paila/shared/idioma'

const T = textos({
  si: { es: 'Sí, hacerlo', en: 'Yes, do it' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  historial: { es: 'Se puede deshacer desde el Historial.', en: 'It can be undone from the History.' },
  papelera: { es: 'Van a la papelera de PAILA: se pueden restaurar desde Papelera o el Historial.', en: "They go to PAILA's trash: they can be restored from Trash or the History." },
  copias: { es: 'Son copias: tu Música no se toca.', en: "They're copies: your Music isn't touched." },
  nunca: { es: 'Esto no se puede deshacer.', en: 'This cannot be undone.' },
  respaldos: { es: 'Van a la papelera de PAILA: se recuperan desde Configuración → Respaldos hasta que la vacíes. El lugar se libera al vaciarla.', en: "They go to PAILA's trash: they can be recovered from Settings → Backups until you empty it. The space is freed when you empty it." },
  atras: { es: 'Cada archivo vuelve a como estaba antes de esa tanda.', en: 'Each file goes back to how it was before that batch.' },
  escribi: { es: (w: string) => `Para seguir, escribí ${w}`, en: (w: string) => `To go on, type ${w}` },
  noSePudo: { es: (k: string) => `${k} no se pudieron:`, en: (k: string) => `${k} couldn't be done:` },
  noSePudoUno: { es: 'Uno no se pudo:', en: "One couldn't be done:" },
  verTodos: { es: (k: string) => `Ver los ${k}`, en: (k: string) => `See all ${k}` },
  ocultar: { es: 'Ocultar', en: 'Hide' },
  yMas: { es: (k: string) => `y ${k} más`, en: (k: string) => `and ${k} more` },
  cerrar: { es: 'Cerrar', en: 'Close' },
  cancelado: { es: 'Se canceló en el medio: lo hecho hasta ahí quedó bien.', en: 'It was cancelled midway: what was done up to then is fine.' },
})

/**
 * Cómo se vuelve atrás lo que se va a hacer (lo dice la pregunta y el resultado). 'atras': es deshacer o restaurar (desde el
 * Historial mismo no tiene sentido decir «se deshace desde el Historial»).
 */
export type ComoDeshacer = 'historial' | 'papelera' | 'copias' | 'nunca' | 'atras' | 'respaldos'

/** Lo que no se pudo, venga de donde venga (cada pantalla trae su forma: rel, name o nombre). */
export interface Falla { rel?: string; name?: string; error: string }
const nombre = (f: Falla) => (f.rel ?? f.name ?? '').split(/[\\/]/).pop() || '…'

/**
 * El botón que toca archivos. Al apretarlo no hace nada todavía: se vuelve la pregunta «¿<pregunta>?» con cómo se deshace,
 * «Sí, hacerlo» y «Cancelar». `palabra`: hay que escribirla para seguir (Vaciar papelera). `aviso`: algo más para leer antes
 * (temas que están en Rekordbox, nombres que van a chocar…).
 */
export function ConfirmarBoton({ children, pregunta, deshacer, onSi, disabled, aviso, palabra, si, size, variant }: {
  children: ReactNode
  pregunta: ReactNode
  deshacer: ComoDeshacer
  onSi: () => void
  disabled?: boolean
  aviso?: ReactNode
  palabra?: string
  /** El texto del «Sí» (si no, «Sí, hacerlo»). */
  si?: string
  size?: 'sm' | 'md'
  /** Cómo se ve el botón antes de apretarlo (deshacer y restaurar, más discretos). */
  variant?: 'primary' | 'ghost' | 'aplicar'
}) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const peligro = deshacer === 'nunca'
  if (!abierto) {
    return <Boton variant={peligro ? 'danger' : variant ?? 'primary'} size={size} disabled={disabled} onClick={() => { setTexto(''); setAbierto(true) }}>{children}</Boton>
  }
  const listo = !palabra || texto.trim().toUpperCase() === palabra.toUpperCase()
  return (
    <div className="confirmar" role="group">
      <span className="confirmar-pregunta">{pregunta}</span>
      <span className={peligro ? 'confirmar-deshacer peligro' : 'confirmar-deshacer'}>{T[deshacer]}</span>
      {aviso && <div className="confirmar-aviso">{aviso}</div>}
      {palabra && <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={palabra} aria-label={T.escribi(palabra)} title={T.escribi(palabra)} />}
      <Boton variant={peligro ? 'danger' : variant === 'aplicar' ? 'aplicar' : 'primary'} size={size} disabled={disabled || !listo} onClick={() => { setAbierto(false); onSi() }}>{si ?? T.si}</Boton>
      <Boton variant="ghost" size={size} onClick={() => setAbierto(false)}>{T.cancelar}</Boton>
    </div>
  )
}

/** Lo que pasó al aplicar: lo hecho, lo que no se pudo con su motivo y cómo se deshace. */
export interface ResultadoTanda {
  /** Qué se hizo, ya escrito ("Se movieron 120 temas"); puede llevar negritas. */
  hechos: ReactNode
  fallados?: Falla[]
  cancelado?: boolean
  deshacer?: ComoDeshacer
  /** Algo más al final (un botón «Abrir carpeta», una nota). */
  extra?: ReactNode
}

/** `onCerrar`: con una ✕ para sacarlo (donde hay poco lugar, como la barra de Cambios pendientes). */
export function Resultado({ r, onCerrar }: { r: ResultadoTanda; onCerrar?: () => void }) {
  const [todos, setTodos] = useState(false)
  const f = r.fallados ?? []
  const vista = todos ? f.slice(0, 500) : f.slice(0, 3)
  return (
    <Aviso tone={f.length || r.cancelado ? 'atencion' : 'ok'} className="resultado">
      <div>
        {r.hechos}{r.deshacer ? ` ${T[r.deshacer]}` : ''}
        {onCerrar && <button className="link push-right" onClick={onCerrar} aria-label={T.cerrar} title={T.cerrar}><Icon name="close" size={14} /></button>}
      </div>
      {r.cancelado && <div>{T.cancelado}</div>}
      {f.length > 0 && (
        <div className="resultado-fallas">
          <div>{f.length === 1 ? T.noSePudoUno : T.noSePudo(n(f.length))}</div>
          <ul>{vista.map((x, i) => <li key={i}><b>{nombre(x)}</b>: {x.error}</li>)}</ul>
          {todos && f.length > 500 && <div className="muted small">{T.yMas(n(f.length - 500))}</div>}
          {f.length > 3 && <button className="link" onClick={() => setTodos(!todos)}>{todos ? T.ocultar : T.verTodos(n(f.length))}</button>}
        </div>
      )}
      {r.extra}
    </Aviso>
  )
}
