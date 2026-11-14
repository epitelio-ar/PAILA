// NAPIA: bajar en tanda (varias listas, una detrás de otra) y el historial de lo bajado. Sin procesos ni ventanas: el
// proceso principal de NAPIA (apps/napia/electron/ipc.ts) corre sockseek y le avisa a la tanda cuándo empieza y cómo
// termina cada lista. Tests: tests/napia-tanda.test.ts.
// - La tanda: listas en espera, la que está bajando y las terminadas (con su resumen). Se pueden sumar listas mientras baja.
//   Si una lista termina con un problema que va a pasar igual con las siguientes (la cuenta, el router trabado, no se
//   conecta con nadie), la tanda se frena y las que faltan quedan en espera. "Saltear esta" corta la actual y sigue.
// - El historial (historial.json en los datos de NAPIA): qué lista, cuándo, cuántos llegaron, cuántos no se encontraron,
//   adónde fueron y cuáles faltan (para reintentarlos con otra búsqueda: reintento.ts). Lo que solo llegó en calidad falsa
//   (control.ts) va con lo que falta, y se cuenta cuántos llegaron truchos y cuántos se reemplazaron por otra fuente.
import fs from 'node:fs'
import path from 'node:path'
import type { EntradaHistorial, EstadoTanda, NapiaList, ProblemKind, ResumenLista, TandaItem, TrackProgress } from '@paila/shared/napia'
import { textos } from '@paila/shared/idioma'

const T = textos({
  cortaste: { es: 'Cortaste la bajada.', en: 'You stopped the download.' },
  soloFalsa: { es: 'Solo se encontró en calidad falsa.', en: 'Only found in fake quality.' },
  sinMejor: { es: 'No se encontró una copia mejor que la tuya.', en: "Couldn't find a copy better than yours." },
})

/** Problemas que no dependen de la lista: si pasan con una, van a pasar con la siguiente. La pausa de búsquedas no frena. */
const FRENAN: ProblemKind[] = ['sinCuenta', 'claveMal', 'login', 'echado', 'noArranco', 'noConecta', 'routerTrabado']
export const frenaLaTanda = (p: ProblemKind | null | undefined) => !!p && FRENAN.includes(p)

/**
 * Llegó, pero solo en calidad falsa, o no apareció una copia mejor que la tuya (core/sockseek/control.ts): no cuenta como
 * bajado, va con lo que falta.
 */
const noSirvio = (t: Pick<TrackProgress, 'calidad'>) => t.calidad?.estado === 'soloFalsa' || t.calidad?.estado === 'sinMejor'

/** Cuántos de cada cosa, del avance de sockseek (y de la revisión de calidad). */
export function resumir(tracks: Pick<TrackProgress, 'state' | 'calidad'>[], yaEnPaila = 0): ResumenLista {
  const c = (s: TrackProgress['state'][]) => tracks.filter((t) => s.includes(t.state) && !noSirvio(t)).length
  const q = (fn: (t: Pick<TrackProgress, 'calidad'>) => boolean) => tracks.filter(fn).length
  return {
    total: tracks.length, bajados: c(['bajado']), yaEstaban: c(['yaEstaba']), noEncontrados: c(['noEncontrado']), noSePudieron: c(['fallo']), sinTerminar: c(['espera', 'buscando', 'bajando', 'cancelado']), yaEnPaila,
    descartados: q((t) => (t.calidad?.descartadas ?? 0) > 0), reemplazados: q((t) => t.calidad?.estado === 'reemplazado'), soloFalsa: q((t) => t.calidad?.estado === 'soloFalsa'), sinMejor: q((t) => t.calidad?.estado === 'sinMejor'),
  }
}

let seq = 0
const nuevoId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`

export class Tanda {
  items: TandaItem[] = []
  /** Se frenó por un problema (o la cortaste): no arranca la siguiente sola. */
  frenada: { motivo: string } | null = null

  /** Suma una lista al final. `aBajar`: cuántos temas se van a buscar (sin lo que ya tenés en PAILA), si se sabe. */
  sumar(list: NapiaList, extra: { aBajar?: number | null; reintento?: boolean } = {}): TandaItem {
    const it: TandaItem = { id: nuevoId(), list, estado: 'espera', aBajar: extra.aBajar ?? null, reintento: !!extra.reintento, resumen: null, folder: null, problema: null }
    this.items.push(it)
    return it
  }

  get(id: string) { return this.items.find((i) => i.id === id) ?? null }
  get actual() { return this.items.find((i) => i.estado === 'bajando') ?? null }
  get enEspera() { return this.items.filter((i) => i.estado === 'espera') }

  /** Saca una lista que no está bajando. */
  sacar(id: string): boolean {
    const i = this.items.findIndex((x) => x.id === id && x.estado !== 'bajando')
    if (i < 0) return false
    this.items.splice(i, 1)
    return true
  }

  /** Cambia el nombre (y con él la carpeta) de una lista que todavía no empezó. */
  renombrar(id: string, name: string) {
    const it = this.get(id)
    if (it && it.estado === 'espera') it.list = { ...it.list, name }
  }

  /** Sube o baja una lista en espera (delta -1 / +1), sin pasar adelante de lo que ya empezó. */
  mover(id: string, delta: number) {
    const i = this.items.findIndex((x) => x.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= this.items.length || this.items[i].estado !== 'espera' || this.items[j].estado !== 'espera') return
    ;[this.items[i], this.items[j]] = [this.items[j], this.items[i]]
  }

  /** La próxima para bajar (null: no queda ninguna, o la tanda está frenada). */
  siguiente(): TandaItem | null {
    if (this.frenada || this.actual) return null
    return this.enEspera[0] ?? null
  }

  /** Arranca a bajar esa lista. */
  empezar(id: string, folder: string) {
    const it = this.get(id)
    if (!it) return
    it.estado = 'bajando'; it.folder = folder; it.resumen = null; it.problema = null
  }

  /**
   * Terminó la que estaba bajando. `saltear`: la cortaste para seguir con la próxima. Cortada sin saltear, o con un problema
   * que frena, la tanda se para (las que faltan quedan en espera).
   */
  terminar(id: string, r: { resumen: ResumenLista; cortada: boolean; saltear?: boolean; problema?: { kind: ProblemKind; text: string } | null }): EstadoTanda {
    const it = this.get(id)
    if (!it) return 'terminada'
    it.resumen = r.resumen
    it.problema = r.problema?.text ?? null
    it.estado = r.cortada ? 'cortada' : frenaLaTanda(r.problema?.kind) ? 'frenada' : 'terminada'
    if (r.cortada && !r.saltear) this.frenada = { motivo: T.cortaste }
    else if (it.estado === 'frenada') this.frenada = { motivo: r.problema!.text }
    return it.estado
  }

  /** Volver a arrancar después de un freno (las listas en espera siguen). */
  seguir() { this.frenada = null }

  /** Vuelve a poner en espera una lista que ya terminó (por ejemplo para bajar lo nuevo de la misma lista). */
  deNuevo(id: string) {
    const it = this.get(id)
    if (it && it.estado !== 'bajando' && it.estado !== 'espera') { it.estado = 'espera'; it.resumen = null; it.problema = null }
  }

  /** Saca de la vista las que ya terminaron. */
  limpiar() { this.items = this.items.filter((i) => i.estado === 'espera' || i.estado === 'bajando') }
}

// ---------- historial ----------

const MAX_HISTORIAL = 300

export function leerHistorial(file: string): EntradaHistorial[] {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; return Array.isArray(v) ? v as EntradaHistorial[] : [] } catch { return [] }
}

/** Suma una entrada (la más nueva primero) y guarda. Se queda con las últimas 300. */
export function sumarAlHistorial(file: string, e: EntradaHistorial): EntradaHistorial[] {
  const todo = [e, ...leerHistorial(file).filter((x) => x.id !== e.id)].slice(0, MAX_HISTORIAL)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(todo, null, 1))
  fs.renameSync(tmp, file)
  return todo
}

/** Saca una entrada del historial (no toca lo bajado). */
export function sacarDelHistorial(file: string, id: string): EntradaHistorial[] {
  const todo = leerHistorial(file).filter((x) => x.id !== id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(todo, null, 1))
  return todo
}

/** La entrada del historial de una lista que terminó. null si no llegó a pasar nada (se cortó antes de empezar). */
export function entradaDe(it: TandaItem, tracks: TrackProgress[], inicio: string, fin: string): EntradaHistorial | null {
  const r = it.resumen ?? resumir(tracks)
  if (r.total - r.sinTerminar === 0 && r.yaEnPaila === 0) return null
  return {
    id: `${it.id}-${Date.parse(inicio).toString(36)}`, tandaId: it.id, lista: it.list.name, reintento: !!it.reintento, inicio, fin, carpeta: it.folder,
    total: r.total, bajados: r.bajados, yaEstaban: r.yaEstaban, yaEnPaila: r.yaEnPaila, noEncontrados: r.noEncontrados, noSePudieron: r.noSePudieron, sinTerminar: r.sinTerminar,
    descartados: r.descartados ?? 0, reemplazados: r.reemplazados ?? 0, soloFalsa: r.soloFalsa ?? 0, sinMejor: r.sinMejor ?? 0,
    cortada: it.estado === 'cortada', problema: it.problema,
    faltan: [
      ...tracks.filter((t) => (t.state === 'noEncontrado' || t.state === 'fallo') && !noSirvio(t)).map((t) => ({ artist: t.artist, title: t.title, estado: t.state as 'noEncontrado' | 'fallo', detalle: t.detail })),
      ...tracks.filter(noSirvio).map((t) => (t.calidad?.estado === 'sinMejor'
        ? { artist: t.artist, title: t.title, estado: 'sinMejor' as const, detalle: T.sinMejor }
        : { artist: t.artist, title: t.title, estado: 'soloFalsa' as const, detalle: T.soloFalsa })),
    ],
    llegaron: tracks.filter((t) => t.state === 'bajado' && !noSirvio(t)).map((t) => ({ artist: t.artist, title: t.title, path: t.path })),
  }
}
