// El idioma de lo que se ve (castellano o inglés): los textos de cada pantalla van en pares con `textos()`, y los números,
// fechas y plurales salen con `num`, `fecha`, `cant`. Sirve en la interfaz, en el proceso principal y en el núcleo.
// Lo que PAILA escribe en los archivos (tags, carpetas como "Instrumentales y Acapellas") NO pasa por acá: no cambia.
// En Mac, los atajos de los textos se leen con Cmd en vez de Ctrl (teclas.ts).
import { esMac, teclas } from './teclas'

export type Idioma = 'es' | 'en'
/** Cómo se llama cada idioma, en su propio idioma (así lo encuentra quien no entiende el otro). */
export const IDIOMAS: { key: Idioma; nombre: string }[] = [{ key: 'es', nombre: 'Castellano' }, { key: 'en', nombre: 'English' }]
export const IDIOMA_DE_FABRICA: Idioma = 'es'

export const esIdioma = (v: unknown): v is Idioma => v === 'es' || v === 'en'

/** La primera vez: el primer idioma de Windows que PAILA sepa (es-AR, es-ES, en-US, en-GB…); si ninguno, castellano. */
export function idiomaDelSistema(preferidos: readonly string[]): Idioma {
  for (const p of preferidos) {
    const base = p.toLowerCase().split(/[-_]/)[0]
    if (esIdioma(base)) return base
  }
  return IDIOMA_DE_FABRICA
}

let actual: Idioma | null = null

/** El idioma de ahora. En las ventanas lo deja el preload (`pailaIdioma`) antes de que corra la pantalla; si no hay, castellano. */
export function idioma(): Idioma {
  if (actual) return actual
  const deLaVentana = (globalThis as { pailaIdioma?: unknown }).pailaIdioma
  actual = esIdioma(deLaVentana) ? deLaVentana : IDIOMA_DE_FABRICA
  return actual
}

/** Lo cambia en este proceso (el principal al arrancar, los tests). En una ventana, cambiarlo es guardar y recargar. */
export function ponerIdioma(i: Idioma) { actual = i }

/** Con qué formato salen números y fechas: 1.234,5 y 23/10/2026, o 1,234.5 y 10/23/2026. */
export const formato = (i: Idioma = idioma()) => (i === 'en' ? 'en-US' : 'es-AR')

/** Un texto en los dos idiomas: una cadena, o una función si lleva datos (los dos con los mismos datos). */
type Par = { es: string; en: string } | { es: (...a: never[]) => string; en: (...a: never[]) => string }
type Elegido<P> = P extends { es: infer T } ? T : never

/**
 * Los textos de una pantalla, en pares: `const T = textos({ titulo: { es: 'Duplicados', en: 'Duplicates' } })` y después
 * `T.titulo`. Cada uno se lee en el idioma de ahora al usarlo. Si lleva datos: `{ es: (n: number) => …, en: (n: number) => … }`.
 */
export function textos<D extends Record<string, Par>>(pares: D & { [K in keyof D]: { en: Elegido<D[K]> } }): { readonly [K in keyof D]: Elegido<D[K]> } {
  const out = {} as Record<string, unknown>
  for (const p of Object.values(pares) as Par[]) anotar(p)
  for (const k of Object.keys(pares)) Object.defineProperty(out, k, { enumerable: true, get: () => conTeclas((pares as Record<string, Par>)[k][idioma()]) })
  return out as { readonly [K in keyof D]: Elegido<D[K]> }
}

/**
 * Lo que quedó guardado en un idioma (en la base: la nota de calidad, un error), en el de ahora. Si es uno de los textos de
 * `textos()`, su par: los fijos tal cual; los que llevan datos, por su molde (se arma llamando al texto con marcas en vez de
 * datos), reconociendo los datos en lo guardado y pasando sus números al otro formato (19,5 → 19.5). Si hay dudas, queda igual.
 * Sirve para lo que se guardó antes de guardar los dos idiomas (core/textosidioma.ts).
 */
type ParDatos = { es: (...a: unknown[]) => string; en: (...a: unknown[]) => string }
const MARCA = '\u0001'
const fijos = new Map<string, { es: string; en: string }>()
const conDatos: ParDatos[] = []
// `fijo`: los datos que no aparecen escritos (un sí o no que agrega una frase): cada molde los tiene ya puestos
let moldes: { re: RegExp; desde: Idioma; par: ParDatos; orden: number[]; fijo: unknown[]; pista: string; largo: number }[] | null = null
const yaVistos = new Map<string, string>()
function anotar(p: Par) {
  if (typeof p.es === 'string' && typeof p.en === 'string') {
    const q = p as { es: string; en: string }
    if (!fijos.has(q.es)) fijos.set(q.es, q)
    if (!fijos.has(q.en)) fijos.set(q.en, q)
  } else if (typeof p.es === 'function' && typeof p.en === 'function') { conDatos.push(p as unknown as ParDatos); moldes = null; yaVistos.clear() }
}
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c)
function armarMoldes() {
  moldes = []
  for (const par of conDatos) for (const desde of ['es', 'en'] as Idioma[]) {
    const f = par[desde], n = f.length
    if (n < 1 || n > 6) continue
    const marcas = Array.from({ length: n }, (_, k) => MARCA + k + MARCA)
    let prueba: string
    try { prueba = String(f(...marcas)) } catch { continue }
    // los que no aparecen escritos: se prueban con sí y con no (hasta 3: 8 moldes)
    const ocultos = marcas.map((m, k) => (prueba.includes(m) ? -1 : k)).filter((k) => k >= 0)
    if (ocultos.length > 3) continue
    for (let combo = 0; combo < 1 << ocultos.length; combo++) {
      const datos: unknown[] = [...marcas]
      ocultos.forEach((k, b) => { datos[k] = (combo >> b) % 2 === 1 })
      let s: string
      try { s = String(f(...datos)) } catch { continue }
      const vistas = marcas.filter((_, k) => !ocultos.includes(k))
      if (!vistas.every((m) => s.split(m).length === 2)) continue // un dato que se repite o se usa en una cuenta: sin molde
      const orden = vistas.map((m) => ({ k: marcas.indexOf(m), at: s.indexOf(m) })).sort((a, b) => a.at - b.at).map((x) => x.k)
      const trozos = s.split(new RegExp(MARCA + '\\d' + MARCA)), pista = trozos.reduce((a, b) => (b.length > a.length ? b : a), '')
      if (pista.trim().length < 4) continue // casi todo datos ("dato · dato"): demasiado ambiguo
      moldes.push({ re: new RegExp('^' + trozos.map(escapar).join('(.+?)') + '$', 's'), desde, par, orden, fijo: datos.map((d, k) => (ocultos.includes(k) ? d : undefined)), pista, largo: trozos.join('').length })
    }
  }
  moldes.sort((a, b) => b.largo - a.largo) // el más específico primero
}
/** Los números escritos en un idioma, en el formato del otro (solo los que tienen separador: los años y los enteros quedan igual). */
function numerosA(v: string, desde: Idioma, a: Idioma): string {
  if (desde === a) return v
  const mil = desde === 'es' ? '.' : ',', dec = desde === 'es' ? ',' : '.'
  return v.replace(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+[.,]\d+/g, (m) => {
    const limpio = m.split(mil).join('').replace(dec, '.'), x = Number(limpio)
    if (!Number.isFinite(x)) return m
    const d = limpio.includes('.') ? limpio.split('.')[1].length : 0
    return x.toLocaleString(formato(a), { minimumFractionDigits: d, maximumFractionDigits: d })
  })
}
export function enEsteIdioma(texto: string, i: Idioma = idioma()): string {
  const fijo = fijos.get(texto)
  if (fijo) return fijo[i]
  const clave = i + MARCA + texto, visto = yaVistos.get(clave)
  if (visto !== undefined) return visto
  if (!moldes) armarMoldes()
  let out = texto
  for (const m of moldes!) {
    if (m.desde === i || !texto.includes(m.pista)) continue
    const r = m.re.exec(texto)
    if (!r) continue
    const datos: unknown[] = [...m.fijo]
    m.orden.forEach((k, g) => { const d = r[g + 1], t = enEsteIdioma(d, i); datos[k] = t !== d ? t : numerosA(d, m.desde, i) })
    const antes = actual
    try { actual = i; out = String(m.par[i](...datos)) } catch { continue } finally { actual = antes }
    break
  }
  yaVistos.set(clave, out)
  return out
}

/**
 * Lo mismo armado en los dos idiomas (la nota de calidad, que se guarda en la base): corre `f` en castellano y en inglés, con
 * sus números y plurales. Solo para funciones que no esperan nada (`f` es sincrónica: el idioma vuelve a ser el de antes).
 */
export function enCadaIdioma<T>(f: () => T): Record<Idioma, T> {
  const antes = actual
  try { actual = 'es'; const es = f(); actual = 'en'; const en = f(); return { es, en } } finally { actual = antes }
}

/** Uno suelto, sin armar la lista: `tr({ es: 'Guardar', en: 'Save' })`. */
export const tr = <T>(par: { es: T; en: T }): T => conTeclas(par[idioma()])

/**
 * Los atajos en Mac: "Ctrl+K" se lee "Cmd+K" (teclas.ts). Pasa acá, en un solo lugar, para todo texto en pares
 * (también los que llevan datos y las listas de renglones); en Windows queda igual.
 */
function conTeclas<T>(v: T): T {
  if (!esMac) return v
  if (typeof v === 'string') return teclas(v) as T
  if (typeof v === 'function') return ((...a: never[]) => conTeclas((v as (...a: never[]) => unknown)(...a))) as T
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? teclas(x) : x)) as T
  return v
}

/** Un número con los separadores del idioma: 1.234,5 / 1,234.5. */
export const num = (n: number, opciones?: Intl.NumberFormatOptions) => n.toLocaleString(formato(), opciones)

/** Una fecha (o fecha y hora, con las opciones) en el formato del idioma. */
export const fecha = (d: Date | number | string, opciones?: Intl.DateTimeFormatOptions) =>
  new Date(d).toLocaleDateString(formato(), opciones)
/**
 * Fecha y hora. En castellano, de 24 horas: el formato de fábrica de "es-AR" la da de 12 y sin "p. m." (las 18:30 salían
 * "06:30:00" en Configuración → Respaldos; capturas del respaldo liviano, 24/10/2026).
 */
export const fechaHora = (d: Date | number | string, opciones?: Intl.DateTimeFormatOptions) =>
  new Date(d).toLocaleString(formato(), { ...(idioma() === 'es' ? { hourCycle: 'h23' as const } : {}), ...opciones })

/** La palabra según la cantidad, sin el número: plural(3, 'tema', 'temas') → "temas". */
export const plural = (n: number, uno: string, varios: string) => (new Intl.PluralRules(formato()).select(n) === 'one' ? uno : varios)

/** La cantidad con su palabra: cant(1, 'tema', 'temas') → "1 tema"; cant(1234, …) → "1.234 temas" (o "1,234" en inglés). */
export const cant = (n: number, uno: string, varios: string) => `${num(n)} ${plural(n, uno, varios)}`

/** Una lista con la "y" del idioma: lista(['A', 'B', 'C']) → "A, B y C" / "A, B and C". */
export const lista = (cosas: string[]) => new Intl.ListFormat(formato(), { type: 'conjunction' }).format(cosas)
