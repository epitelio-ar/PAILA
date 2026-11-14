// Lo que el Inicio y las pestañas dicen del estado de la colección (core/estado.ts; MASTERPLAN-5, 2.3 y etapa 1): un renglón por
// parte con su número de verdad, cuál sigue y qué conviene antes de Organizar. Solo decide qué decir (se prueba sin pantalla:
// tests/estado-inicio.test.ts); lo dibuja Estado.tsx. Reemplaza a los "Primeros pasos" con marcas (02/11).
import { cant, num, textos } from '@paila/shared/idioma'
import { GRUPOS_ESTADO, type EstadoColeccion, type GrupoEstado } from '@paila/shared/types'
import type { PageKey } from './nav'

const T = textos({
  escuchar: { es: 'Escuchando', en: 'Listening' },
  repetidos: { es: 'Repetidos', en: 'Repeats' },
  internet: { es: 'Completar desde internet', en: 'Fill in from the internet' },
  nombres: { es: 'Nombres', en: 'Names' },
  tapas: { es: 'Tapas', en: 'Covers' },
  carpetas: { es: 'Carpetas', en: 'Folders' },
  sonido: { es: 'Sonido', en: 'Sound' },
  escuchados: { es: (h: number, t: number) => `${num(h)} de ${num(t)} temas`, en: (h: number, t: number) => `${num(h)} of ${num(t)} tracks` },
  listo: { es: 'listo', en: 'done' },
  esperaEscuchar: { es: 'cuando PAILA termine de escuchar', en: 'once PAILA is done listening' },
  calculando: { es: 'contando…', en: 'counting…' },
  noSePudo: { es: (x: string) => `no se pudo contar: ${x}`, en: (x: string) => `couldn't count it: ${x}` },
  repN: { es: (k: number) => `${cant(k, 'copia repetida', 'copias repetidas')} para la papelera`, en: (k: number) => `${cant(k, 'repeated copy', 'repeated copies')} for the trash` },
  repDecidir: { es: (k: number) => `${cant(k, 'grupo', 'grupos')} para decidir vos`, en: (k: number) => `${cant(k, 'group', 'groups')} for you to decide` },
  repOk: { es: 'sin repetidos', en: 'no repeats' },
  intN: { es: (k: number) => cant(k, 'tema sin buscar', 'temas sin buscar'), en: (k: number) => cant(k, 'track not looked up', 'tracks not looked up') },
  intOk: { es: 'todo buscado', en: 'all looked up' },
  nomN: { es: (k: number) => cant(k, 'tema sin artista o con el nombre roto', 'temas sin artista o con el nombre roto'), en: (k: number) => cant(k, 'track missing the artist or with a broken name', 'tracks missing the artist or with a broken name') },
  nomOk: { es: 'sin faltantes', en: 'nothing missing' },
  tapN: { es: (k: number) => cant(k, 'disco con tapa para poner', 'discos con tapa para poner'), en: (k: number) => cant(k, 'album with a cover to add', 'albums with a cover to add') },
  tapRevisar: { es: (k: number) => cant(k, 'disco sin revisar', 'discos sin revisar'), en: (k: number) => cant(k, 'album not checked', 'albums not checked') },
  tapOk: { es: 'todas puestas', en: 'all in place' },
  carN: { es: (k: number) => cant(k, 'tema fuera de su carpeta', 'temas fuera de su carpeta'), en: (k: number) => cant(k, 'track out of its folder', 'tracks out of their folder') },
  carNombre: { es: (k: number) => `${cant(k, 'tema cambiaría', 'temas cambiarían')} de nombre`, en: (k: number) => `${cant(k, 'track would', 'tracks would')} get a new name` },
  carOk: { es: 'todo en su lugar', en: 'everything in place' },
  sonN: { es: (k: number) => `${cant(k, 'tema suena', 'temas suenan')} peor de lo que podría`, en: (k: number) => `${cant(k, 'track sounds', 'tracks sound')} worse than it could` },
  sonOk: { es: 'nada suena mal', en: 'nothing sounds bad' },
  dejados: { es: (k: number) => `${num(k)} dejados como están`, en: (k: number) => `${num(k)} left as they are` },
  antes: { es: (x: string) => `Conviene antes: ${x}`, en: (x: string) => `Better first: ${x}` },
  y: { es: ' · ', en: ' · ' },
})

export type ClaveEstado = GrupoEstado | 'escuchar'
export interface Renglon {
  clave: ClaveEstado; titulo: string; texto: string; page: PageKey
  /** hecho = 0 · falta = hay algo para hacer · espera = todavía no se puede saber */
  como: 'hecho' | 'falta' | 'espera'
  /** se puede abrir "Ver cuáles" (hay temas para mirar o dejar como están) */
  lista: boolean
}

export const PAGINA: Record<ClaveEstado, PageKey> = { escuchar: 'progress', repetidos: 'dups', internet: 'online', nombres: 'tidy', tapas: 'albums', carpetas: 'organize', sonido: 'wishlist' }
export const TITULO: Record<ClaveEstado, string> = { escuchar: T.escuchar, repetidos: T.repetidos, internet: T.internet, nombres: T.nombres, tapas: T.tapas, carpetas: T.carpetas, sonido: T.sonido }

/** La música está escuchada: falta como mucho el 2 % (como core/estado.ts). */
const escuchada = (e: EstadoColeccion) => e.total > 0 && e.escuchados >= Math.floor(e.total * 0.98)

/** Lo que dice cada parte cuando hay algo para hacer. */
function cuanto(g: GrupoEstado, n: number, aparte: number): string {
  const partes = {
    repetidos: [n ? T.repN(n) : '', aparte ? T.repDecidir(aparte) : ''],
    internet: [T.intN(n)],
    nombres: [T.nomN(n)],
    tapas: [n - aparte ? T.tapN(n - aparte) : '', aparte ? T.tapRevisar(aparte) : ''],
    carpetas: [n - aparte ? T.carN(n - aparte) : '', aparte ? T.carNombre(aparte) : ''],
    sonido: [T.sonN(n)],
  }[g]
  return partes.filter(Boolean).join(T.y)
}
const OK: Record<GrupoEstado, string> = { repetidos: T.repOk, internet: T.intOk, nombres: T.nomOk, tapas: T.tapOk, carpetas: T.carOk, sonido: T.sonOk }

export function renglones(e: EstadoColeccion): Renglon[] {
  const oido = escuchada(e)
  const out: Renglon[] = [{ clave: 'escuchar', titulo: T.escuchar, texto: oido ? T.listo : T.escuchados(e.escuchados, e.total), page: PAGINA.escuchar, como: oido ? 'hecho' : 'falta', lista: false }]
  for (const g of GRUPOS_ESTADO) {
    const c = e.grupos[g]
    const n = c.n
    const extra = c.dejados ? `${T.y}${T.dejados(c.dejados)}` : ''
    if (n == null) { out.push({ clave: g, titulo: TITULO[g], texto: c.espera === 'calculando' ? T.calculando : c.espera === 'error' ? T.noSePudo(c.error ?? '') : T.esperaEscuchar, page: PAGINA[g], como: 'espera', lista: false }); continue }
    // los repetidos "para decidir vos" se muestran, pero no son pendiente de PAILA: los decide la persona escuchándolos
    const aparte = g === 'repetidos' ? c.aparte ?? 0 : Math.min(c.aparte ?? 0, n)
    const hay = n > 0 || (g === 'repetidos' && aparte > 0)
    out.push({ clave: g, titulo: TITULO[g], texto: (hay ? cuanto(g, n, aparte) : OK[g]) + extra, page: PAGINA[g], como: n > 0 ? 'falta' : 'hecho', lista: c.filas.length > 0 })
  }
  return out
}

/** Lo que sigue: la primera parte con algo para hacer (escuchar no: PAILA lo hace sola). Null = todo al día. */
export const siguiente = (r: Renglon[]) => r.find((x) => x.clave !== 'escuchar' && x.como === 'falta') ?? null

/** Las partes hechas (para las pestañas): 0 de verdad, no "esperando". */
export const hechos = (r: Renglon[]) => new Set(r.filter((x) => x.como === 'hecho').map((x) => x.clave))

/** Para Organizar: lo que conviene hacer antes (las partes anteriores con algo para hacer), en un renglón. Vacío si no falta nada. */
export function convieneAntes(r: Renglon[]): string {
  const org = r.findIndex((x) => x.clave === 'carpetas')
  const faltan = r.filter((x, i) => i < org && x.clave !== 'escuchar' && x.como === 'falta')
  return faltan.length ? T.antes(faltan.map((x) => `${x.titulo} (${x.texto})`).join(', ')) : ''
}
