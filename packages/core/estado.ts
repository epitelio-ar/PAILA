// "El estado de la colección" (MASTERPLAN-5, 3.1 y etapa 1): cuántos repetidos sin resolver, temas sin buscar en internet, nombres
// rotos, discos con tapa para poner, temas fuera de su carpeta y lo que suena mal. Sale de la base tal como está (no de marcas): si
// deshacés Organizar, vuelve a decir "N temas fuera de su carpeta". Hecho quiere decir 0. Las cuentas están en core/estado-grupos.ts
// y "Dejar como está", en core/estado-dejar.ts. Los repetidos necesitan leer archivos: se calculan aparte, con el análisis terminado.
import { visible, type Db } from './db'
import { findDuplicates } from './duplicates'
import { guardarRepetidos } from './repetidos-guardados'
import { pendingAnalysis, pendingPrints } from './queue'
import type { Organizer } from './organizer'
import { carpetas, internet, nombres, repetidos, sonido, tapas } from './estado-grupos'
import { dejadosDe, dejarComoEsta, guardarRegla, hayRegla, reglaElegida } from './estado-dejar'
import { GRUPOS_ESTADO, type DupGroup, type EstadoColeccion, type GrupoCuenta, type GrupoEstado, type OrganizeOptions } from '@paila/shared/types'

/** Sin veredicto con pocos datos: hasta tener 50 temas escuchados o el 10 %, lo que suena mal no se cuenta. */
export const hayVeredicto = (escuchados: number, total: number) => total > 0 && (escuchados >= 50 || escuchados >= total * 0.1)
/** La música está escuchada (para buscar repetidos por el sonido): falta como mucho el 2 % (lo que no se puede leer no traba). */
export const escuchada = (faltan: number, total: number) => faltan <= Math.floor(total * 0.02)

export interface EstadoDeps {
  /** Dónde está cada tema (los repetidos comparan archivos). */
  pathOf: (id: number) => string | null
  organizer: Organizer
  /** Avisa que hay un estado nuevo que no se pidió (terminaron de calcularse los repetidos). */
  onCambio?: () => void
}

const esperando = (espera: GrupoCuenta['espera']): GrupoCuenta => ({ n: null, filas: [], dejados: 0, espera })
/** Una parte que no se pudo contar (una regla de carpetas rota, la base a medio migrar) no deja al Inicio sin las demás. */
const seguro = (f: () => GrupoCuenta): GrupoCuenta => { try { return f() } catch (e) { return { ...esperando('error'), error: (e as Error).message } } }

export class Estado {
  /** Lo último calculado, con la "firma" de la base de entonces: si la base no cambió, no se vuelve a calcular. */
  private ultimo: { firma: string; estado: EstadoColeccion } | null = null
  private dups: { firma: string; grupos: DupGroup[] } | null = null
  private calculando: string | null = null

  constructor(private db: Db, private deps: EstadoDeps) {}

  /** Cómo está la colección ahora. */
  leer(): EstadoColeccion {
    const firma = this.firma()
    if (this.ultimo?.firma === firma) return this.ultimo.estado
    const db = this.db
    const { total, escuchados } = db.prepare(
      `SELECT COUNT(*) AS total, COUNT(a.grade) AS escuchados FROM files f LEFT JOIN analysis a ON a.file_id = f.id
       WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica'`).get() as { total: number; escuchados: number }
    const veredicto = hayVeredicto(escuchados, total)
    const regla = reglaElegida(db)
    const d = (g: GrupoEstado) => dejadosDe(db, g)
    const grupos: Record<GrupoEstado, GrupoCuenta> = {
      repetidos: seguro(() => this.repetidos()),
      internet: seguro(() => internet(db, d('internet'))),
      nombres: seguro(() => nombres(db, d('nombres'))),
      tapas: seguro(() => tapas(db, d('tapas'))),
      carpetas: seguro(() => carpetas(db, this.deps.organizer, regla)),
      sonido: veredicto ? seguro(() => sonido(db, d('sonido'))) : esperando('escuchando'),
    }
    const estado: EstadoColeccion = { total, escuchados, hayVeredicto: veredicto, grupos, regla, reglaGuardada: hayRegla(db) }
    // mientras se calculan los repetidos no se guarda: el próximo pedido los trae
    if (grupos.repetidos.espera !== 'calculando') this.ultimo = { firma, estado }
    return estado
  }

  /** "Dejar como está" (o volver a contar, con `si` = false) y el estado nuevo. */
  dejar(grupo: GrupoEstado, ids: number[] | 'todos', si = true): EstadoColeccion {
    dejarComoEsta(this.db, grupo, ids, si)
    return this.leer()
  }

  /** Guarda la regla de carpetas con que se cuenta (la ventana la recordaba antes del 02/11) y el estado nuevo. */
  regla(o: OrganizeOptions): EstadoColeccion {
    guardarRegla(this.db, o)
    return this.leer()
  }

  /** Los grupos que acaba de armar la pantalla Duplicados: así el estado no vuelve a leer los archivos. */
  recordarRepetidos(grupos: DupGroup[]) { this.dups = { firma: this.firmaDups(), grupos } }

  /** Espera a que terminen de calcularse los repetidos (para los tests y el recorrido automático). */
  async listo(): Promise<EstadoColeccion> {
    for (let i = 0; i < 600 && this.leer().grupos.repetidos.espera === 'calculando'; i++) await new Promise((r) => setTimeout(r, 50))
    return this.leer()
  }

  private repetidos(): GrupoCuenta {
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM files WHERE ${visible()} AND kind = 'musica'`).get() as { n: number }).n
    if (!escuchada(pendingAnalysis(this.db) + pendingPrints(this.db), total)) return esperando('escuchando')
    const firma = this.firmaDups()
    if (this.dups?.firma === firma) return repetidos(this.dups.grupos, dejadosDe(this.db, 'repetidos'))
    if (this.calculando !== firma) {
      this.calculando = firma
      void findDuplicates(this.db, this.deps.pathOf).then((grupos) => {
        // si la base cambió mientras tanto, se vuelve a calcular en el próximo pedido
        this.dups = { firma, grupos }
        guardarRepetidos(this.db, grupos) // Duplicados los muestra sin buscar de nuevo (core/repetidos-guardados.ts)
      }, () => { this.dups = { firma, grupos: [] } }).finally(() => { this.calculando = null; this.deps.onCambio?.() })
    }
    return esperando('calculando')
  }

  /** Lo que cambia la cuenta de repetidos: qué temas hay a la vista y qué huellas tienen. */
  private firmaDups(): string {
    return JSON.stringify(this.db.prepare(
      `SELECT (SELECT COUNT(*) FROM files WHERE ${visible()}) AS n, (SELECT MAX(id) FROM files) AS m, (SELECT TOTAL(size) + TOTAL(mtime) FROM files WHERE ${visible()}) AS s,
              (SELECT COUNT(chromaprint) FROM analysis) AS p, (SELECT COUNT(audio_md5) FROM analysis) AS a, (SELECT COUNT(*) FROM trash_log WHERE restored_at IS NULL) AS t`).get())
  }

  /** Lo que cambia alguna cuenta: temas, tags, análisis, cambios, movimientos, papelera, internet, lo dejado y la regla. */
  private firma(): string {
    return JSON.stringify([this.firmaDups(), this.db.prepare(
      `SELECT (SELECT MAX(probed_at) FROM files) AS p, (SELECT COUNT(grade) FROM analysis) AS g, (SELECT MAX(id) FROM journal) AS j,
              (SELECT COUNT(undone_at) FROM journal) AS ju, (SELECT MAX(id) FROM moves_log) AS mv, (SELECT COUNT(undone_at) FROM moves_log) AS mu,
              (SELECT COUNT(*) FROM online_cache) AS c, (SELECT MAX(looked_at) FROM online_cache) AS l, (SELECT COUNT(*) FROM pending_changes) AS pc,
              (SELECT COUNT(*) || '|' || MAX(at) FROM dejar_como_esta) AS d, (SELECT value FROM settings WHERE key = 'organizar.regla') AS r`).get(),
      this.dups?.firma ?? null])
  }
}

/** El que sigue: la primera parte con algo para hacer, en el orden de GRUPOS_ESTADO. Null si está todo al día (o esperando). */
export const siguienteGrupo = (e: EstadoColeccion): GrupoEstado | null => GRUPOS_ESTADO.find((g) => (e.grupos[g].n ?? 0) > 0) ?? null
