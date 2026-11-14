// La lista de la bajada sigue sola el avance: se desplaza para que se vea lo que está pasando (bajando, revisando, esperando) con
// lo ya bajado arriba. Si la persona sube a mirar algo, no se la arrastra; vuelve a seguir cuando baja hasta el final o con "Seguir".
import { useCallback, useEffect, useRef, useState } from 'react'

/** Cuánto de la caja queda arriba de la primera fila activa (lo ya bajado). */
export const ARRIBA = 0.55

/** A dónde hay que llevar el scroll para que la fila activa quede a `ARRIBA` de la altura; null si no hay fila activa. */
export function scrollParaSeguir(filaTop: number, cajaAlto: number, cajaScroll: number, scrollMax: number): number | null {
  if (filaTop < 0) return null
  const destino = Math.max(0, Math.min(scrollMax, Math.round(filaTop - cajaAlto * ARRIBA)))
  return destino === cajaScroll ? null : destino
}
/** ¿Está al final de la lista (con un poquito de margen)? */
export const alFinal = (scrollTop: number, alto: number, total: number) => scrollTop + alto >= total - 12

/**
 * `raiz`: un elemento que contiene la caja `.filas`; `primeraActiva`: el número de la primera fila en curso (-1: ninguna);
 * `siguiendo`: solo mientras corre. Devuelve si se está siguiendo y cómo volver a seguir.
 */
export function useSeguirAvance(raiz: React.RefObject<HTMLElement | null>, primeraActiva: number, filas: number, siguiendo: boolean) {
  const [sigue, setSigue] = useState(true)
  const propio = useRef(0) // el último scroll que hizo la lista sola: ese evento no cuenta como "la persona subió"
  const caja = () => raiz.current?.querySelector<HTMLElement>('.filas') ?? null

  const llevar = useCallback(() => {
    const c = caja(); if (!c || primeraActiva < 0) return
    const fila = c.children[primeraActiva] as HTMLElement | undefined; if (!fila) return
    const top = fila.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop
    const a = scrollParaSeguir(top, c.clientHeight, c.scrollTop, c.scrollHeight - c.clientHeight)
    if (a == null) return
    propio.current = Date.now(); c.scrollTo({ top: a })
  }, [primeraActiva]) // eslint-disable-line react-hooks/exhaustive-deps

  // sigue el avance cada vez que cambia lo que está en curso o llega una fila
  useEffect(() => { if (siguiendo && sigue) llevar() }, [siguiendo, sigue, llevar, filas])

  // la persona mueve la lista: si sube, deja de seguirla; si baja hasta el final, vuelve a seguir
  useEffect(() => {
    const c = caja(); if (!c) return
    const onScroll = () => { if (Date.now() - propio.current < 150) return; setSigue(alFinal(c.scrollTop, c.clientHeight, c.scrollHeight)) }
    c.addEventListener('scroll', onScroll)
    return () => c.removeEventListener('scroll', onScroll)
  }, [filas > 0]) // eslint-disable-line react-hooks/exhaustive-deps
  return { sigue, seguir: () => setSigue(true) }
}
