// NAPIA: una fuente muy lenta no frena la lista. Lo que no avanza nada lo corta sockseek solo (--max-stale-time, 30 s sin
// recibir nada: prueba otro usuario), pero una fuente que avanza a paso de tortuga (10 KB/s: un FLAC tarda una hora) la deja
// seguir. Pedido del autor (24/10): "como el primero está descargando lento, se para todo". sockseek no deja que otro
// programa le pida "probá otro usuario" para un tema (sus atajos de teclado no andan si no hay teclado), así que NAPIA hace esto:
// - mira cuánto avanza cada tema que baja (los bytes que dice sockseek, cada 2 segundos);
// - es lenta si hace por lo menos un minuto que baja de ese usuario y, al ritmo del último minuto, le faltan más de 5 minutos;
// - mientras haya algo más en marcha (buscando, esperando o bajando bien), la lenta sigue: no frena a nadie;
// - cuando lo único que queda son fuentes lentas, corta ese sockseek. Cada tema lento cuenta como un intento y se busca en otro
//   usuario (control.ts: lenta), sin el que iba lento.
// Lo mismo con lo que ya suena trucho en un pedazo mientras baja (muestra.ts): cuenta como "no vale la pena esperarlo".
// Puro (recibe la hora); el reloj lo pone `vigilar`. Tests: tests/napia-lentitud.test.ts y napia-muestra.test.ts.
import type { TrackProgress } from '@paila/shared/napia'

export interface Lentitud {
  /** Cuánto tiene que bajar de un usuario antes de juzgarlo (ms). */
  observar: number
  /** Con cuánto de atrás se mide el ritmo (ms). */
  ventana: number
  /** Si al ritmo de ahora le falta más que esto, es lenta (ms). */
  maxRestante: number
  /** Cada cuánto se mira (ms). */
  cada: number
}

export const LENTITUD: Lentitud = { observar: 60_000, ventana: 60_000, maxRestante: 5 * 60_000, cada: 2_000 }

/** Los mismos tiempos más cortos (para los tests y la prueba con el sockseek de mentira). */
export const escalar = (l: Lentitud, f: number): Lentitud => ({ observar: l.observar * f, ventana: l.ventana * f, maxRestante: l.maxRestante * f, cada: Math.max(50, l.cada * f) })

const terminado = (t: TrackProgress) => !['espera', 'buscando', 'bajando'].includes(t.state)

interface Seguimiento { de: string; desde: number; muestras: [number, number][] }

export class VigiaLentitud {
  private seg = new Map<TrackProgress, Seguimiento>()
  constructor(private readonly l: Lentitud = LENTITUD) {}

  /** Anota cuánto lleva cada tema que baja. Si sockseek pasó a otro usuario (u otro archivo), empieza de cero. */
  anotar(tracks: TrackProgress[], ahora: number) {
    for (const t of tracks) {
      if (t.state !== 'bajando' || typeof t.bytes !== 'number') { this.seg.delete(t); continue }
      const de = `${t.fuente ?? ''}|${t.total ?? ''}`
      let s = this.seg.get(t)
      if (!s || s.de !== de) { s = { de, desde: ahora, muestras: [] }; this.seg.set(t, s) }
      s.muestras.push([ahora, t.bytes])
      // alcanza con la última muestra de antes de la ventana
      while (s.muestras.length > 2 && s.muestras[1][0] <= ahora - this.l.ventana) s.muestras.shift()
    }
  }

  /** ¿Va lenta? Al ritmo de la última ventana, le falta más de `maxRestante` (o no avanzó nada). */
  lenta(t: TrackProgress, ahora: number): boolean {
    const s = this.seg.get(t)
    if (!s || t.state !== 'bajando' || ahora - s.desde < this.l.observar || !t.total) return false
    // la primera muestra es la última de antes de la ventana (anotar descarta las anteriores)
    const [t0, b0] = s.muestras[0]
    const [t1, b1] = s.muestras[s.muestras.length - 1]
    const ritmo = t1 > t0 ? (b1 - b0) / (t1 - t0) : 0
    const falta = t.total - b1
    return falta > 0 && (ritmo <= 0 || falta / ritmo > this.l.maxRestante)
  }

  /**
   * Las que hay que cortar: todas las que van lentas (o, con `trucho`, ya suenan truchas en la muestra), pero solo cuando no
   * queda nada más en marcha en esa corrida (nada buscando, esperando ni bajando bien). Si no, ninguna: siguen y no frenan a nadie.
   */
  aCortar(tracks: TrackProgress[], ahora: number, trucho: (t: TrackProgress) => boolean = () => false): TrackProgress[] {
    const enMarcha = tracks.filter((t) => !terminado(t))
    if (!enMarcha.length || !enMarcha.every((t) => this.lenta(t, ahora) || (t.state === 'bajando' && trucho(t)))) return []
    return enMarcha
  }
}

/** Lo que suena trucho mientras baja (muestra.ts, VigiaMuestras): se le muestra cada vuelta y dice qué tema ya suena mal. */
export interface Muestreo { mirar: (tracks: TrackProgress[]) => void; trucho: (t: TrackProgress) => boolean }

/**
 * Vigila una corrida de sockseek: cada `cada` ms anota y, si lo único que queda son fuentes lentas (o truchas en la muestra),
 * avisa cuáles (`alCortar`, que las anota para buscar otra fuente) y corta la corrida. Devuelve cómo dejar de vigilar.
 */
export function vigilar(tracks: () => TrackProgress[], alCortar: (lentas: TrackProgress[]) => void, cortar: (lentas: TrackProgress[]) => void, l: Lentitud = LENTITUD, muestreo?: Muestreo): () => void {
  const v = new VigiaLentitud(l)
  const timer = setInterval(() => {
    const ahora = Date.now(), ts = tracks()
    v.anotar(ts, ahora)
    muestreo?.mirar(ts)
    const lentas = v.aCortar(ts, ahora, muestreo?.trucho)
    if (!lentas.length) return
    clearInterval(timer)
    alCortar(lentas)
    cortar(lentas)
  }, l.cada)
  return () => clearInterval(timer)
}
