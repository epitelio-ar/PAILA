// Tapas chicas (240 px) para mostrar muchas a la vez: Inicio, tabla de temas, cola. Se piden de a pocas (la primera vez
// ffmpeg las saca del archivo) y se recuerdan mientras la app está abierta. Ver electron/media.ts: coverThumb.
import { useEffect, useState } from 'react'

const cache = new Map<number, Promise<string | null>>()
const listo = new Map<number, string | null>()
const cola: { id: number; ok: (s: string | null) => void }[] = []
let andando = 0
const A_LA_VEZ = 3

function seguir() {
  while (andando < A_LA_VEZ && cola.length) {
    const { id, ok } = cola.shift()!
    andando++
    window.paila.coverThumb(id).catch(() => null).then((s) => { listo.set(id, s); ok(s) }).finally(() => { andando--; seguir() })
  }
}

/** La tapa chica de un tema (data URL) o null si el archivo no trae. `urgente` la pone primera en la fila. */
export function thumb(id: number, urgente = false): Promise<string | null> {
  let p = cache.get(id)
  if (!p) {
    p = new Promise((ok) => { if (urgente) cola.unshift({ id, ok }); else cola.push({ id, ok }) })
    cache.set(id, p)
    seguir()
  }
  return p
}

/** Lo que ya se sabe de un tema sin esperar (undefined = todavía no se pidió o no llegó). */
export const thumbYa = (id: number) => listo.get(id)

/** Hook: la tapa chica de un tema. Con `espera` (ms) la pide solo si sigue a la vista ese tiempo (al scrollear rápido no se piden todas). */
export function useThumb(id: number | null, espera = 0): string | null {
  const [src, setSrc] = useState<string | null>(() => (id != null ? thumbYa(id) ?? null : null))
  useEffect(() => {
    if (id == null) { setSrc(null); return }
    const ya = thumbYa(id)
    if (ya !== undefined) { setSrc(ya); return }
    setSrc(null)
    let ok = true
    const t = setTimeout(() => { void thumb(id).then((s) => { if (ok) setSrc(s) }) }, espera)
    return () => { ok = false; clearTimeout(t) }
  }, [id, espera])
  return src
}

/** Un color propio de cada nombre (siempre el mismo), para la tapa que falta. */
export function colorDe(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return `linear-gradient(135deg, hsl(${h} 38% 34%), hsl(${(h + 50) % 360} 30% 14%))`
}
export const iniciales = (name: string) => name.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w[0] ?? '')).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?'
