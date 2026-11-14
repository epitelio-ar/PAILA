// Una línea para las pantallas que todavía no hicieron nada (repaso del 27/10): qué va a pasar al apretar el botón, cuánto tarda
// y que no cambia nada hasta aplicar. Se va cuando ya hay resultado.
import { cant, textos } from '@paila/shared/idioma'
import { n } from './format'

const T = textos({
  va: {
    es: (k: string, min: number) => `Va a revisar ${k} · tarda ~${min} min · no cambia nada hasta que apliques.`,
    en: (k: string, min: number) => `It will check ${k} · takes ~${min} min · nothing changes until you apply.`,
  },
  temas: { es: (k: number) => cant(k, 'tema', 'temas'), en: (k: number) => cant(k, 'track', 'tracks') },
})

/** Minutos a ojo: una pasada por tema, unos 3.000 por minuto en una PC de escritorio (mínimo 1). */
export const minutosDeRevisar = (total: number) => Math.max(1, Math.round(total / 3000))

export default function QueVaAPasar({ total }: { total: number }) {
  if (total <= 0) return null
  return <p className="muted small que-va">{T.va(`${n(total)} ${T.temas(total).replace(/^[\d.,]+\s*/, '')}`, minutosDeRevisar(total))}</p>
}
