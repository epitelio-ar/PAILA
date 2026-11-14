// Los nombres limpios de la lista «Faltan o suenan mal»: lo que propondría "Arreglar nombres" para artista y título (sin escribir
// nada). Es una pasada entera por la Música (4 s con la base del autor, ~7 s con 100.000 temas): se guarda mientras la
// biblioteca no cambie y, en la app, se calcula en un hilo aparte (core/tidyworker.ts). La lista se muestra primero con los
// nombres de los tags y se limpia cuando llega (usabilidad, 2.ª tanda, P1: antes la ventana no respondía mientras tanto).
import type { Db } from './db'
import { tidy, type TidyChange } from './tidy'
import type { TidyRule } from '@paila/shared/types'

/** Lo que "Arreglar nombres" propone para artista y título, con esas reglas (sin `rules`: las de fábrica). */
export function namesTidy(db: Db, rules?: TidyRule[]): TidyChange[] {
  return tidy(db, ['mojibake', 'filename', 'junk', 'style'], undefined, rules).changes.filter((c) => c.field === 'artist' || c.field === 'title')
}

/** Calcula `namesTidy` en otro hilo; null = lo cortó un pedido más nuevo. */
export type Limpiador = (rules: TidyRule[] | undefined) => Promise<TidyChange[] | null>
/** Avisa cuando empieza (true) y cuando termina (false) de limpiar en el hilo. */
export type AvisoLimpios = (limpiando: boolean) => void

export class NombresLimpios {
  private cache: { stamp: string; reglas: string; changes: TidyChange[] } | null = null
  private enCurso: { stamp: string; p: Promise<void> } | null = null
  private hilo: { limpiador: Limpiador; aviso: AvisoLimpios } | null = null
  /** El hilo falló con esta biblioteca: se calcula acá, como antes (si no, la pantalla lo pediría una y otra vez). */
  private fallo: string | null = null

  constructor(private db: Db) {}

  /** De acá en más, lo que no hace falta esperar se calcula en un hilo aparte. */
  enHilo(limpiador: Limpiador, aviso: AvisoLimpios) { this.hilo = { limpiador, aviso } }

  /** ¿Se está limpiando en el hilo? (la lista que se mostró tiene los nombres de los tags, o los de antes) */
  get limpiando() { return this.enCurso != null }

  private clave(rules?: Iterable<TidyRule>) {
    const s = this.db.prepare('SELECT COUNT(*) AS n, MAX(probed_at) AS p, (SELECT MAX(id) FROM journal) AS j FROM files').get() as { n: number; p: string | null; j: number | null }
    const list = rules ? [...rules] : undefined
    const reglas = list ? [...list].sort().join(',') : ''
    return { stamp: `${s.n}|${s.p}|${s.j}|${reglas}`, reglas, list }
  }

  /**
   * Los cambios de nombre. `rapido`: sin esperar al hilo; mientras trabaja, lo último calculado con estas mismas reglas
   * (puede faltarle lo recién llegado) o nada (quedan los nombres de los tags). Sin hilo, se calcula acá.
   */
  cambios(rules?: Iterable<TidyRule>, rapido = false): TidyChange[] {
    const k = this.clave(rules)
    if (this.cache?.stamp === k.stamp) return this.cache.changes
    if (rapido && this.hilo && this.fallo !== k.stamp) {
      void this.limpiar(rules)
      return this.cache?.reglas === k.reglas ? this.cache.changes : []
    }
    const changes = namesTidy(this.db, k.list)
    this.cache = { stamp: k.stamp, reglas: k.reglas, changes }
    return changes
  }

  /** Calcula en el hilo, si hace falta, y espera (para exportar o guardar un nombre: ahí tiene que estar limpio). */
  limpiar(rules?: Iterable<TidyRule>): Promise<void> {
    const k = this.clave(rules)
    if (!this.hilo || this.cache?.stamp === k.stamp || this.fallo === k.stamp) return Promise.resolve()
    if (this.enCurso?.stamp === k.stamp) return this.enCurso.p
    const { limpiador, aviso } = this.hilo
    aviso(true)
    const p = limpiador(k.list)
      .then((changes) => { if (changes) this.cache = { stamp: k.stamp, reglas: k.reglas, changes: changes.filter((c) => c.field === 'artist' || c.field === 'title') } })
      .catch(() => { this.fallo = k.stamp })
      .finally(() => {
        if (this.enCurso?.p !== p) return // ya hay un pedido más nuevo: avisa ese
        this.enCurso = null
        aviso(false)
      })
    this.enCurso = { stamp: k.stamp, p }
    return p
  }
}
