// Cómo busca y ordena Ctrl+K. Antes no ordenaba: las acciones iban primero y escribir el nombre exacto «Programas de DJ» dejaba
// arriba (lo que hace Enter) «Apagar las herramientas para DJ»; con «Análisis», «Prender el modo avanzado» (prueba de usabilidad
// con teclado, 27/10/2026). Ahora: nombre exacto, después el que empieza así, después todas las palabras en el nombre, y al final
// lo que solo coincide por la ayuda. Un plural encuentra el singular («repetidos» → «repetido»).
import { textos } from '@paila/shared/idioma'

export interface Buscable { id: string; label: string; hint: string }

/** Palabras con que la gente busca una pantalla y que no están en su nombre ni en su ayuda. */
const T = textos({
  dups: { es: 'repetidos repetidas iguales dobles', en: 'repeated twice same doubles' },
  requests: { es: 'spotify youtube apple deezer tidal csv m3u importar pegar lista de un amigo', en: 'spotify youtube apple deezer tidal csv m3u import paste a friend list' },
  carry: { es: 'pendrive usb celular telefono auto exportar copiar', en: 'usb stick phone car export copy' },
  tidy: { es: 'nombres raros feos mayusculas track 01', en: 'weird ugly names uppercase track 01' },
  wishlist: { es: 'bajar descargar comprar mejor calidad', en: 'download buy better quality' },
})
const EXTRA: Record<string, string> = T

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') // idioma-ok
/** Una palabra buscada, sin la s del plural (si es larga): «repetidos» también encuentra «repetido». */
const raiz = (w: string) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)

export function buscarComandos<C extends Buscable>(todos: C[], q: string, max = 12): C[] {
  const qp = plano(q).trim()
  const words = qp.split(/\s+/).filter(Boolean).map(raiz)
  if (!words.length) return todos.slice(0, max)
  const nota = (c: C) => {
    const label = plano(c.label)
    if (label === qp) return 0
    if (label.startsWith(qp)) return 1
    if (words.every((w) => label.includes(w))) return 2
    const todo = `${label} ${plano(c.hint)} ${EXTRA[c.id] ?? ''}`
    return words.every((w) => todo.includes(w)) ? 3 : -1
  }
  return todos.map((c, i) => ({ c, i, n: nota(c) })).filter((x) => x.n >= 0).sort((a, b) => a.n - b.n || a.i - b.i).slice(0, max).map((x) => x.c)
}
