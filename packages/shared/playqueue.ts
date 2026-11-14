// Cola del reproductor, sin interfaz: qué suena, qué sigue, aleatorio y repetir. Son funciones puras (cada una devuelve el
// estado nuevo) para poder probarlas sin audio. "La cola" es lo que pediste que suene enseguida; después sigue la lista de la
// que arrancó el tema (lo que estabas viendo, una playlist o el álbum).

export type Repeat = 'off' | 'all' | 'one'

export interface PlayQ {
  /** La lista de la que sigue el tema (en su orden). */
  items: number[]
  /** El tema que suena (puede no estar en `items` si vino de la cola). */
  current: number | null
  /** Lo que pediste que suene enseguida, en orden. */
  upNext: number[]
  /** Los temas que ya sonaron, del más viejo al más nuevo (para volver atrás). */
  history: number[]
  /** El último tema de `items` que sonó: de ahí sigue la lista cuando termina la cola. */
  anchor: number | null
  /** Los de `items` que ya sonaron en esta vuelta del aleatorio. */
  played: number[]
  shuffle: boolean
  repeat: Repeat
}

export const emptyQ: PlayQ = { items: [], current: null, upNext: [], history: [], anchor: null, played: [], shuffle: false, repeat: 'off' }

const HISTORY_MAX = 200

/** Empieza a sonar `id` dentro de `items`. La cola y las opciones de aleatorio y repetir se conservan. */
export function start(q: PlayQ, items: number[], id: number): PlayQ {
  const inList = items.includes(id)
  return { ...q, items: [...items], current: id, history: [], anchor: inList ? id : null, played: inList ? [id] : [] }
}

/** Cambia la lista de la que sigue (por ejemplo, de "lo que veo" a "el álbum") sin cortar el tema que suena. */
export function setItems(q: PlayQ, items: number[]): PlayQ {
  const inList = q.current != null && items.includes(q.current)
  return { ...q, items: [...items], anchor: inList ? q.current : q.anchor != null && items.includes(q.anchor) ? q.anchor : null, played: inList ? [q.current!] : [] }
}

/**
 * El que sigue, o null si se terminó. `manual`: lo pidió la persona con "siguiente" (con "repetir un tema" igual pasa al
 * siguiente; cuando el tema termina solo, se repite). `rnd`: número de 0 a 1 (se inyecta para probar).
 */
export function advance(q: PlayQ, manual: boolean, rnd: () => number = Math.random): { q: PlayQ; id: number | null } {
  if (q.current == null) return { q, id: null }
  if (q.repeat === 'one' && !manual) return { q, id: q.current }
  const leave = (n: number, from: 'queue' | 'list', extra: Partial<PlayQ> = {}): { q: PlayQ; id: number } => ({
    id: n,
    q: {
      ...q, ...extra, current: n, history: [...q.history, q.current!].slice(-HISTORY_MAX),
      anchor: from === 'list' ? n : q.anchor,
      played: from === 'list' ? [...(extra.played ?? q.played), n] : (extra.played ?? q.played),
    },
  })
  if (q.upNext.length) return leave(q.upNext[0], 'queue', { upNext: q.upNext.slice(1) })
  if (!q.items.length) return { q, id: null }
  if (q.shuffle) {
    let played = q.played
    let left = q.items.filter((x) => !played.includes(x) && x !== q.current)
    if (!left.length) {
      if (q.repeat !== 'all') return { q, id: null }
      played = q.current != null && q.items.includes(q.current) ? [q.current] : []
      left = q.items.filter((x) => x !== q.current)
      if (!left.length) left = [...q.items] // una lista de un solo tema
    }
    return leave(left[Math.min(left.length - 1, Math.floor(rnd() * left.length))], 'list', { played })
  }
  const from = q.items.includes(q.current) ? q.current : q.anchor
  const i = from == null ? -1 : q.items.indexOf(from)
  const next = q.items[i + 1]
  if (next != null) return leave(next, 'list')
  if (q.repeat === 'all') return leave(q.items[0], 'list', { played: [] })
  return { q, id: null }
}

/** El anterior (el último que sonó), o null si no hay. El tema que sonaba no vuelve a la cola. */
export function back(q: PlayQ): { q: PlayQ; id: number | null } {
  const id = q.history[q.history.length - 1]
  if (id == null) return { q, id: null }
  return { id, q: { ...q, current: id, history: q.history.slice(0, -1), anchor: q.items.includes(id) ? id : q.anchor } }
}

/** Agrega a la cola: `where` 'next' = el primero de la cola (suena enseguida), 'end' = al final. */
export function enqueue(q: PlayQ, ids: number[], where: 'next' | 'end'): PlayQ {
  return { ...q, upNext: where === 'next' ? [...ids, ...q.upNext] : [...q.upNext, ...ids] }
}

export function removeFromQueue(q: PlayQ, index: number): PlayQ {
  return { ...q, upNext: q.upNext.filter((_, i) => i !== index) }
}

export function clearQueue(q: PlayQ): PlayQ { return { ...q, upNext: [] } }

export function setShuffle(q: PlayQ, on: boolean): PlayQ {
  // al prender el aleatorio, lo que ya sonó no vuelve a salir hasta que se agote la lista
  return { ...q, shuffle: on, played: on && q.current != null && q.items.includes(q.current) ? [q.current] : q.played }
}

export function setRepeat(q: PlayQ, repeat: Repeat): PlayQ { return { ...q, repeat } }
export const nextRepeat = (r: Repeat): Repeat => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')

/** Lo que sigue en la lista, en orden, para mostrar en la cola (con el aleatorio prendido no se sabe: vacío). */
export function upcoming(q: PlayQ, max = 30): number[] {
  if (q.shuffle || q.current == null) return []
  const from = q.items.includes(q.current) ? q.current : q.anchor
  const i = from == null ? -1 : q.items.indexOf(from)
  return q.items.slice(i + 1, i + 1 + max)
}

/** Salta a un tema de la cola o de la lista (un clic en la cola): suena ya, y lo que sonaba queda en el historial. */
export function jump(q: PlayQ, id: number): PlayQ {
  const qi = q.upNext.indexOf(id)
  const inList = q.items.includes(id)
  return {
    ...q, current: id, upNext: qi >= 0 ? q.upNext.filter((_, i) => i !== qi) : q.upNext,
    history: q.current != null ? [...q.history, q.current].slice(-HISTORY_MAX) : q.history,
    anchor: inList ? id : q.anchor, played: inList ? [...q.played, id] : q.played,
  }
}
