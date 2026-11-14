// Cuánto ocupa la papelera de PAILA (pedido del autor, 24/10: que nadie junte GB sin darse cuenta). `usePapelera` lo pide al
// núcleo (core/purge.ts `trashSummary`, por `window.paila.trashSummary()`) al abrir, cada minuto, al volver a la ventana y
// cuando algo avisa que cambió (`papeleraCambio`). Trae el total, cuánto es de respaldos, de temas y de otros archivos, y `warn`
// si pasa del tope (5 GB, o el 5 % del disco si es chico). Lo usan la barra lateral ("Papelera · 3,2 GB") y la tarjeta de
// mantenimiento del Inicio; "Vaciar…" desde afuera: `pedirVaciar()` y abrir la pantalla Papelera (pide confirmar, como siempre).
import { useEffect, useState } from 'react'
import type { TrashSummary } from '@paila/shared/types'
import { bytes } from './format'
import { textos } from '@paila/shared/idioma'

const T = textos({
  partes: {
    es: (r: string | null, t: string | null) => ` (${[r && `${r} de respaldos`, t && `${t} de temas`].filter(Boolean).join(', ')})`,
    en: (r: string | null, t: string | null) => ` (${[r && `${r} of backups`, t && `${t} of tracks`].filter(Boolean).join(', ')})`,
  },
  barraTip: {
    es: (b: string, partes: string) => `La papelera ocupa ${b}${partes}. El lugar se libera al vaciarla.`,
    en: (b: string, partes: string) => `The trash takes up ${b}${partes}. The space is freed when you empty it.`,
  },
})

const EVENTO = 'paila:papelera'
/** Algo cambió la papelera (se mandó, restauró o vació algo): que la barra lateral y el Inicio se pongan al día. */
export const papeleraCambio = () => window.dispatchEvent(new Event(EVENTO))

let vaciarAlAbrir = false
/** "Vaciar…" desde afuera de la pantalla Papelera: al abrirla, aparece el panel de vaciar (que pide confirmar, como siempre). */
export const pedirVaciar = () => { vaciarAlAbrir = true }
/** Lo usa la pantalla Papelera al abrir: ¿la pidieron para vaciar? (una sola vez). */
export const tomarPedidoVaciar = () => { const v = vaciarAlAbrir; vaciarAlAbrir = false; return v }

/** El resumen de la papelera, al día. `dep`: algo que, al cambiar, lo vuelve a pedir (la pantalla abierta). */
export function usePapelera(dep?: unknown): TrashSummary | null {
  const [s, setS] = useState<TrashSummary | null>(null)
  useEffect(() => {
    let vivo = true
    const pedir = () => { void window.paila.trashSummary().then((x) => { if (vivo) setS(x) }, () => { /* sin dato: no se muestra */ }) }
    pedir()
    const t = setInterval(pedir, 60_000)
    window.addEventListener(EVENTO, pedir); window.addEventListener('focus', pedir)
    return () => { vivo = false; clearInterval(t); window.removeEventListener(EVENTO, pedir); window.removeEventListener('focus', pedir) }
  }, [dep])
  return s
}

/** "(8 GB de respaldos, 4 GB de temas)", o nada si no hay de ninguno. */
export const partes = (s: TrashSummary) => (s.backups || s.tracks ? T.partes(s.backups ? bytes(s.backups) : null, s.tracks ? bytes(s.tracks) : null) : '')
/** El texto al pasar el mouse por el tamaño de "Papelera" en la barra lateral. */
export const barraTip = (s: TrashSummary) => T.barraTip(bytes(s.bytes), partes(s))
