// Panel de la cola del reproductor: qué suena, lo que pediste que suene enseguida, lo que sigue de la lista, y "seguir con…".
import { Icon } from './icons'
import type { Track } from '@paila/shared/types'
import { upcoming, type PlayQ } from '@paila/shared/playqueue'
import { Boton, Info, Pestanas, Rico } from '@paila/diseno'
import { display, duration } from './format'
import { n } from './format'
import { conTeclado } from './conTeclado'
import type { Follow } from './Player'
import { textos } from '@paila/shared/idioma'

const T = textos({
  helpVista: { es: 'Cuando termina un tema sigue el que viene en la lista que estabas viendo al darle play: tu búsqueda, una colección o una playlist.', en: 'When a track ends, the next one in the list you were viewing when you hit play comes on: your search, a collection or a playlist.' },
  helpAlbum: { es: 'Sigue con los demás temas del mismo álbum (de la misma carpeta), en el orden del disco.', en: 'It continues with the other tracks of the same album (the same folder), in disc order.' },
  helpTema: { es: 'Suena este tema y se detiene; solo sigue lo que pongas en la cola.', en: 'This track plays and then stops; only what you add to the queue comes next.' },
  ahora: { es: (l: string) => ` Ahora: ${l}.`, en: (l: string) => ` Now: ${l}.` },
  cargando: { es: 'Cargando…', en: 'Loading…' },
  sacar: { es: 'Sacar de la cola', en: 'Remove from queue' },
  laCola: { es: 'La cola', en: 'The queue' },
  cerrar: { es: 'Cerrar', en: 'Close' },
  seguirCon: { es: 'Seguir con', en: 'Play next from' },
  seguirTip: { es: 'Qué suena cuando termina el tema. Lo que pongas en la cola suena primero.', en: 'What plays when the track ends. Whatever you put in the queue plays first.' },
  loQueVeo: { es: 'Lo que veo', en: 'What I see' },
  elAlbum: { es: 'El álbum', en: 'The album' },
  soloEste: { es: 'Solo este tema', en: 'Just this track' },
  suenaAhora: { es: 'Suena ahora', en: 'Playing now' },
  enLaCola: { es: 'En la cola', en: 'In the queue' },
  vaciar: { es: 'Vaciar', en: 'Clear' },
  vacia: { es: 'Vacía. Con el tema elegido en la tabla, apretá **E** para sumarlo al final o **Mayús + E** para que suene a continuación.', en: 'Empty. With a track selected in the table, press <b>E</b> to add it to the end or **Shift + E** to play it next.' },
  tocar: { es: 'Tocá para que suene ya', en: 'Click to play it now' },
  verFicha: { es: 'Ver la ficha de este tema', en: 'See this track’s details' },
  sigueLista: { es: 'Sigue de la lista', en: 'Next from the list' },
  aleatorio: { es: 'Aleatorio prendido: el que sigue se elige al azar entre los que todavía no sonaron.', en: "Shuffle is on: the next one is picked at random from those that haven't played yet." },
  vuelve: { es: 'Al terminar vuelve al principio de la lista.', en: 'When it ends, it goes back to the start of the list.' },
  noHay: { es: 'No hay más temas en la lista.', en: 'There are no more tracks in the list.' },
})
const FOLLOW_HELP = { get vista() { return T.helpVista }, get album() { return T.helpAlbum }, get tema() { return T.helpTema } }

function Row({ t, id, onClick, onRemove, hint }: { t?: Track; id: number; onClick?: () => void; onRemove?: () => void; hint?: string }) {
  const d = t && display(t)
  return (
    <div className={`pq-row ${onClick ? 'click' : ''}`} onClick={onClick} {...(onClick ? conTeclado(onClick) : {})} title={hint}>
      <span className="pq-name">{d ? <><b>{d.title}</b><span className="muted"> · {d.artist}</span></> : <span className="muted">{T.cargando}</span>}</span>
      <span className="muted small num">{t ? duration(t.duration) : ''}</span>
      {onRemove && <button className="link" onClick={(e) => { e.stopPropagation(); onRemove() }} title={T.sacar} aria-label={T.sacar}><Icon name="close" size={14} /></button>}
    </div>
  )
}

export default function PlayerQueue({ q, info, follow, label, onFollow, onJump, onRemove, onClear, onClose, onOpenTrack, inline }: {
  /** Tocar lo que suena abre su ficha (la persona 2, 01/11: lo tocó 10 veces y no pasaba nada). */
  onOpenTrack?: (id: number) => void
  /** Dentro de la pantalla Escuchando (sin ventanita ni botón de cerrar). */
  inline?: boolean
  q: PlayQ; info: Map<number, Track>; follow: Follow; label: string
  onFollow: (f: Follow) => void; onJump: (id: number) => void; onRemove: (index: number) => void; onClear: () => void; onClose: () => void
}) {
  const next = upcoming(q, 20)
  const left = q.shuffle ? 0 : Math.max(0, q.items.length - (q.items.indexOf(q.anchor ?? q.current ?? -1) + 1))
  return (
    <div className={inline ? 'pq pq-inline' : 'player-pop pq'} role={inline ? undefined : 'dialog'} aria-label={T.laCola}>
      {!inline && <button className="close" onClick={onClose} title={T.cerrar}><Icon name="close" size={14} /></button>}
      <h4>{T.seguirCon} <Info tip={T.seguirTip} /></h4>
      <Pestanas label={T.seguirCon} value={follow} onChange={onFollow} items={[{ key: 'vista', label: T.loQueVeo }, { key: 'album', label: T.elAlbum }, { key: 'tema', label: T.soloEste }]} />
      <p className="muted small">{FOLLOW_HELP[follow]}{follow === 'vista' && label ? T.ahora(label) : ''}</p>

      {q.current != null && (<>
        <h4>{T.suenaAhora}</h4>
        <Row id={q.current} t={info.get(q.current)} onClick={onOpenTrack && (() => onOpenTrack(q.current!))} hint={T.verFicha} />
      </>)}

      <h4>
        {T.enLaCola} {q.upNext.length > 0 && <span className="muted">({n(q.upNext.length)})</span>}
        {q.upNext.length > 0 && <Boton size="sm" variant="ghost" onClick={onClear}>{T.vaciar}</Boton>}
      </h4>
      {q.upNext.length === 0
        ? <p className="muted small"><Rico texto={T.vacia} /></p>
        : q.upNext.map((id, i) => <Row key={`${id}-${i}`} id={id} t={info.get(id)} onClick={() => onJump(id)} onRemove={() => onRemove(i)} hint={T.tocar} />)}

      <h4>{T.sigueLista} {left > 0 && <span className="muted">({n(left)})</span>}</h4>
      {q.shuffle
        ? <p className="muted small">{T.aleatorio}</p>
        : next.length === 0
          ? <p className="muted small">{q.repeat === 'all' ? T.vuelve : T.noHay}</p>
          : next.map((id) => <Row key={id} id={id} t={info.get(id)} onClick={() => onJump(id)} hint={T.tocar} />)}
    </div>
  )
}
