// Pantalla "Escuchando": el reproductor en grande, encima de la zona central (tapa como figurita, forma de onda grande,
// controles grandes y la cola al costado). Las piezas (onda, botones, volumen, cola) las arma Player.tsx y llegan ya hechas.
// Lo que se ve tocable hace algo (prueba con la persona 2, 01/11): la tapa y el título abren la ficha; el artista y el disco, la
// biblioteca con esa búsqueda.
import type { ReactNode } from 'react'
import type { Track } from '@paila/shared/types'
import { Boton } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { display, duration } from './format'
import { colorDe, iniciales } from './thumbs'
import { buscarEnBiblioteca } from './buscarEn'

const T = textos({
  escuchando: { es: 'Escuchando', en: 'Now playing' },
  numero: { es: 'N.º', en: 'No.' },
  verFicha: { es: 'Ver la ficha', en: 'See track details' },
  verFichaTip: { es: 'Ver la ficha de este tema', en: 'See this track’s details' },
  delArtista: { es: (a: string) => `Ver en la biblioteca los temas de ${a}`, en: (a: string) => `See ${a}’s tracks in the library` },
  delDisco: { es: (a: string) => `Ver en la biblioteca los temas de «${a}»`, en: (a: string) => `See the tracks of “${a}” in the library` },
  nada: { es: 'No suena nada', en: 'Nothing is playing' },
  elegi: { es: 'Elegí un tema en la biblioteca y dale play (doble clic o barra espaciadora).', en: 'Pick a track in the library and hit play (double-click or Space).' },
})

interface Props {
  track: Track | null; cover: string | null; desde: string; time: number; total: number
  calidad: ReactNode; pulso: ReactNode; onda: ReactNode; botones: ReactNode; volumen: ReactNode; cola: ReactNode
  onOpenTrack?: (id: number) => void
}

export default function Escuchando({ track, cover, desde, time, total, calidad, pulso, onda, botones, volumen, cola, onOpenTrack }: Props) {
  const d = track && display(track)
  const ficha = () => track && onOpenTrack?.(track.id)
  return (
    <section className="escuchando" aria-label={T.escuchando}>
      <div className="esc-fondo" style={cover ? { backgroundImage: `url(${cover})` } : undefined} />
      <div className="esc-principal">
        {d && track ? (<>
          <div className="esc-arriba">
            <button type="button" className="figu esc-figu tocable" onClick={ficha} title={T.verFichaTip}>
              <div className="figu-img" style={{ background: cover ? `center / cover url(${cover})` : colorDe(d.artist || d.title) }}>{cover ? null : iniciales(d.artist || d.title)}</div>
              <div className="figu-plaq"><small>{T.numero}{track.id}</small><b title={d.title}>{d.title}</b></div>
            </button>
            <div className="esc-datos">
              <div className="rotulo">{T.escuchando}{desde}</div>
              {/* los títulos largos van más chicos: en letra gigante tapaban media pantalla */}
              <button type="button" className={`tocable titulo esc-titulo${d.title.length > 60 ? ' muy-largo' : d.title.length > 28 ? ' largo' : ''}`} title={`${d.title}\n${T.verFichaTip}`} onClick={ficha}>{d.title}</button>
              <div className="esc-artista">
                {d.artist && <button type="button" className="tocable" title={T.delArtista(d.artist)} onClick={() => buscarEnBiblioteca(d.artist)}>{d.artist}</button>}
                {track.album && <span className="muted"> · <button type="button" className="tocable" title={T.delDisco(track.album)} onClick={() => buscarEnBiblioteca(track.album!)}>{track.album}</button></span>}
              </div>
              <div className="esc-pils">{calidad}{pulso}</div>
            </div>
          </div>
          <div className="esc-onda">
            {onda}
            <div className="esc-tiempos num"><span>{duration(time) || '0:00'}</span><span>−{duration(Math.max(0, total - time)) || '0:00'}</span></div>
          </div>
          {botones}
          <div className="esc-acciones">
            <Boton variant="ghost" size="sm" onClick={ficha}>{T.verFicha}</Boton>
            {volumen}
          </div>
        </>) : (
          <div className="esc-vacio">
            <div className="titulo">{T.nada}</div>
            <p className="muted">{T.elegi}</p>
          </div>
        )}
      </div>
      <div className="esc-cola">{cola}</div>
    </section>
  )
}
