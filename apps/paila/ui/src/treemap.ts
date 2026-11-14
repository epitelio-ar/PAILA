// Mapa de rectángulos "squarified" (Bruls, Huizing, van Wijk): rectángulos lo más cuadrados posible.
export interface Rect<T> { item: T; x: number; y: number; w: number; h: number }

export function squarify<T>(items: { item: T; value: number }[], x: number, y: number, w: number, h: number): Rect<T>[] {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value)
  const total = list.reduce((s, i) => s + i.value, 0)
  const out: Rect<T>[] = []
  if (!list.length || w <= 0 || h <= 0) return out
  const scale = (w * h) / total
  const areas = list.map((i) => ({ item: i.item, a: i.value * scale }))
  let rx = x, ry = y, rw = w, rh = h
  let row: typeof areas = []
  const worst = (r: typeof areas, side: number) => {
    const s = r.reduce((t, i) => t + i.a, 0)
    const max = Math.max(...r.map((i) => i.a)), min = Math.min(...r.map((i) => i.a))
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min))
  }
  const layout = (r: typeof areas) => {
    const s = r.reduce((t, i) => t + i.a, 0)
    if (rw >= rh) { // columna a la izquierda
      const cw = s / rh; let cy = ry
      for (const i of r) { const ch = i.a / cw; out.push({ item: i.item, x: rx, y: cy, w: cw, h: ch }); cy += ch }
      rx += cw; rw -= cw
    } else { // fila arriba
      const rhh = s / rw; let cx = rx
      for (const i of r) { const cw2 = i.a / rhh; out.push({ item: i.item, x: cx, y: ry, w: cw2, h: rhh }); cx += cw2 }
      ry += rhh; rh -= rhh
    }
  }
  for (const a of areas) {
    const side = Math.min(rw, rh)
    if (!row.length || worst([...row, a], side) <= worst(row, side)) row.push(a)
    else { layout(row); row = [a] }
  }
  if (row.length) layout(row)
  return out
}
