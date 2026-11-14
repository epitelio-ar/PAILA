// "Qué hay de nuevo": lee docs/NOVEDADES.md (una sección "## 0.2.0 · 22/10/2026" por versión) y devuelve la de una versión.
// La usa Configuración → Actualizaciones para mostrar lo de la versión instalada; el test revisa que la versión actual tenga su entrada.

/** Un renglón: texto suelto o un punto de lista (nivel 1 o 2). `**así**` va en negrita. */
export interface Renglon { nivel: 0 | 1 | 2; texto: string }
export interface Novedad { version: string; fecha: string; titulo: string; renglones: Renglon[] }

const CABEZA = /^##\s+(\d+\.\d+\.\d+)\s*(?:[·—–-]\s*(.*))?$/

/** Todas las versiones del archivo, de la más nueva a la más vieja (como están escritas). */
export function novedades(md: string): Novedad[] {
  const out: Novedad[] = []
  let actual: Novedad | null = null
  for (const crudo of md.replace(/\r/g, '').split('\n')) {
    const cab = CABEZA.exec(crudo.trim())
    if (cab) {
      const [fecha, ...resto] = (cab[2] ?? '').split(':')
      actual = { version: cab[1], fecha: fecha.trim(), titulo: resto.join(':').trim(), renglones: [] }
      out.push(actual)
      continue
    }
    if (/^#/.test(crudo.trim())) { actual = null; continue } // otra sección (el título del archivo)
    if (!actual || !crudo.trim() || /^<!--/.test(crudo.trim())) continue
    const punto = /^(\s*)[-*]\s+(.*)$/.exec(crudo)
    if (punto) actual.renglones.push({ nivel: punto[1].length >= 2 ? 2 : 1, texto: punto[2].trim() })
    else actual.renglones.push({ nivel: 0, texto: crudo.trim() })
  }
  return out
}

/** La entrada de una versión, o null si no tiene. */
export const novedadDe = (md: string, version: string): Novedad | null => novedades(md).find((n) => n.version === version) ?? null

/** Parte un texto en pedazos normales y en negrita (`**así**`). */
export function negritas(texto: string): { texto: string; negrita: boolean }[] {
  return texto.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? { texto: p.slice(2, -2), negrita: true } : { texto: p, negrita: false }))
}
