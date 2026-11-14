// Cuánto falta para terminar un escaneo o análisis: velocidad por minuto y texto de tiempo restante. El cálculo
// (promedio suavizado, y no prometer nada si la velocidad no es creíble) está en @paila/shared/eta.
import { textos } from '@paila/shared/idioma'
import { useEffect, useRef, useState } from 'react'
import type { ScanStatus } from '@paila/shared/types'
import { EtaMeter, type Eta } from '@paila/shared/eta'

export type { Eta }

const T = textos({
  noSePuede: { es: 'no se puede calcular (muchos errores seguidos)', en: "can't tell (too many errors in a row)" },
  calculando: { es: 'calculando…', en: 'calculating…' },
  menosDe1: { es: 'menos de 1 min', en: 'less than 1 min' },
})

/** "unos 12 min", "1 h 20 min", "calculando…". */
export function etaText(m: number | null, doubtful = false): string {
  if (doubtful) return T.noSePuede
  if (m == null) return T.calculando
  if (m < 1) return T.menosDe1
  if (m < 60) return `${Math.round(m)} min`
  const h = Math.floor(m / 60), r = Math.round(m % 60)
  return r ? `${h} h ${r} min` : `${h} h`
}

/** Ritmo y tiempo restante a partir de lo que va informando el escaneo o el análisis (se reinicia en cada fase). */
export function useEta(s: ScanStatus): Eta {
  const meter = useRef(new EtaMeter())
  const key = useRef('')
  const [eta, setEta] = useState<Eta>({ perMinute: null, minutes: null, doubtful: false })

  useEffect(() => {
    const k = `${s.job}|${s.phase}|${s.toProbe}`
    if (k !== key.current) { key.current = k; meter.current.reset(); setEta({ perMinute: null, minutes: null, doubtful: false }) }
    if (!s.running || s.paused) { meter.current.gap(); return }
    meter.current.add(Date.now(), s.probed, s.errors)
    setEta(meter.current.estimate(s.toProbe - s.probed))
  }, [s.running, s.paused, s.job, s.phase, s.toProbe, s.probed, s.errors])

  return eta
}
