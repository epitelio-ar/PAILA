// Tapas para mostrar música: la de un tema (chica, guardada), la que falta (iniciales con el color del nombre) y el mosaico
// de cuatro tapas de una playlist. Las usan el Inicio y la barra de la playlist.
import { useEffect, useState } from 'react'
import type { PlaylistNode } from '@paila/shared/types'
import { colorDe, iniciales, thumb, useThumb } from './thumbs'

/** Sin tapa: las iniciales sobre un color propio de cada nombre (siempre el mismo), nunca un cuadro gris vacío. */
export function SinTapa({ name }: { name: string }) {
  return <div className="sin-tapa" style={{ background: colorDe(name) }}>{iniciales(name)}</div>
}

export function Tapa({ id, name, className }: { id: number | null; name: string; className?: string }) {
  const src = useThumb(id)
  return <div className={`tapa ${className ?? ''}`}>{src ? <img src={src} alt="" /> : <SinTapa name={name} />}</div>
}

/** Las primeras cuatro tapas que aparezcan en la playlist (buscando entre sus primeros temas). */
export function Mosaico({ node }: { node: PlaylistNode }) {
  const [tapas, setTapas] = useState<string[] | null>(null)
  useEffect(() => {
    let ok = true
    void (async () => {
      const ids = (await window.paila.playlistTracks(node.id)).slice(0, 16)
      const out: string[] = []
      for (const id of ids) { if (out.length >= 4) break; const s = await thumb(id); if (s && !out.includes(s)) out.push(s) }
      if (ok) setTapas(out)
    })()
    return () => { ok = false }
  }, [node.id, node.count])
  if (!tapas || !tapas.length) return <div className="mosaico"><SinTapa name={node.name} /></div>
  // con menos de cuatro tapas distintas va una sola grande (repetidas en mosaico parecen un error)
  if (tapas.length < 4) return <div className="mosaico uno"><img src={tapas[0]} alt="" /></div>
  return <div className="mosaico">{tapas.map((s, i) => <img key={i} src={s} alt="" />)}</div>
}

