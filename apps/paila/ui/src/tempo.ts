// El BPM que se muestra de un tema (tabla y ficha): un número, o un rango honesto si el tempo se mueve (tocado sin
// metrónomo: rock en vivo, discos viejos). El rango sale de la grilla variable, llevado a la misma octava que el BPM.
import { num, textos } from '@paila/shared/idioma'
import type { Track } from '@paila/shared/types'

/** Desde cuántos BPM de diferencia se muestra el rango; si se mueve menos, el promedio con "≈". */
const WIDE = 1.5

const T = textos({
  seMueve: {
    es: (lo: number, hi: number, avg: number) => `El tempo se mueve (tocado sin metrónomo): va de ${lo} a ${hi} BPM, ${avg} en promedio. Por eso la grilla va compás por compás.`,
    en: (lo: number, hi: number, avg: number) => `The tempo drifts (played without a click track): it goes from ${lo} to ${hi} BPM, ${avg} on average. That's why the beat grid follows it bar by bar.`,
  },
})

export function bpmShown(t: Pick<Track, 'bpm' | 'tempo'>): { text: string; title: string | null } | null {
  if (!t.tempo) return t.bpm == null ? null : { text: num(t.bpm, { maximumFractionDigits: 1 }), title: null }
  const [lo, hi, avg] = t.tempo.split(',').map(Number)
  // la grilla puede estar a la mitad o al doble del BPM elegido para el género (core/analysis/bpmrange.ts)
  const k = t.bpm && avg ? 2 ** Math.round(Math.log2(t.bpm / avg)) : 1
  const r = (x: number) => Math.round(x * k)
  const title = T.seMueve(r(lo), r(hi), r(avg))
  return { text: hi - lo >= WIDE ? `${r(lo)}–${r(hi)}` : `≈${r(avg)}`, title }
}
