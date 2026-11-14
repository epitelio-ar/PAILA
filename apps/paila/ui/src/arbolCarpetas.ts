// Un árbol de carpetas a partir de rutas ("Biblioteca/Artista/Disco/01 - Tema.mp3"), con cuántos temas hay adentro de cada una.
// Lo usa "Cómo va a quedar" en Ordenar (OrdenarArbol.tsx), para ver hoy y después lado a lado. Sin interfaz: se prueba solo.

export interface Nodo { nombre: string; temas: number; hijos: Nodo[]; hojas: string[] }

export function arbolDe(rutas: string[]): Nodo {
  const raiz: Nodo = { nombre: '', temas: 0, hijos: [], hojas: [] }
  const por = new Map<Nodo, Map<string, Nodo>>()
  for (const r of rutas) {
    const partes = r.split('/'), hoja = partes.pop()!
    let n = raiz; n.temas++
    for (const p of partes) {
      const m = por.get(n) ?? por.set(n, new Map()).get(n)!
      let h = m.get(p)
      if (!h) { h = { nombre: p, temas: 0, hijos: [], hojas: [] }; m.set(p, h); n.hijos.push(h) }
      n = h; n.temas++
    }
    n.hojas.push(hoja)
  }
  const ordenar = (n: Nodo) => { n.hijos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')); n.hojas.sort((a, b) => a.localeCompare(b, 'es')); n.hijos.forEach(ordenar) }
  ordenar(raiz)
  return raiz
}

/** Cuántas carpetas distintas tienen temas (las que quedan con algo adentro). */
export const carpetasDe = (rutas: string[]) => new Set(rutas.map((r) => r.slice(0, Math.max(0, r.lastIndexOf('/'))))).size
