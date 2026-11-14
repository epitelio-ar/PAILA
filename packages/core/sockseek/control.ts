// NAPIA: el control de calidad de lo que baja una lista. Cada tema que sockseek termina queda en la carpeta de trabajo hasta
// que se revisa su calidad real (calidad.ts), de a uno y sin frenar la bajada (en la app, el análisis es un proceso aparte con
// prioridad baja). Si sirve, pasa a la carpeta de la lista; si es trucho, va a <lista>/descartados (no se borra nada), se anota
// quién lo compartía y, cuando sockseek termina su tramo de la lista (tramos.ts), se le pide otra fuente: el mismo tema, sin esos usuarios
// (--banned-users), hasta 3 veces. Si ninguna sirve, queda "Solo se encontró en calidad falsa". Así a la Bandeja de PAILA
// solo llega lo que pasó la revisión. Sin ffmpeg (`revisar` null) todo pasa directo, como antes.
// Lo que viene a reemplazar una copia que ya tenés (`tuya`: la lista «Faltan o suenan mal» manda su nota) además tiene que ser
// claramente mejor que esa (calidad.ts, esMejor); si ninguna fuente lo es: "No se encontró una copia mejor que la tuya".
// Lo que va a otra fuente se baja con otro sockseek después del principal (una sola sesión por cuenta: dos se echan entre sí),
// todos los temas de la vuelta juntos, en paralelo (como la lista). Una fuente muy lenta no frena la vuelta ni la lista
// (lentitud.ts): cuando es lo único que queda, se corta, cuenta como un intento y el tema pasa a la vuelta siguiente sin ese
// usuario (`lenta`). Si solo hubo fuentes lentas, termina como "no se pudo".
// Otra versión que no pediste (una acapella, un remix, en vivo: otraversion.ts) tampoco sirve, aunque suene bien: se aparta igual
// y se busca en otro usuario; si solo aparece así, termina como "no se encontró" (para buscarlo de otra forma).
// Antes de pasar a la carpeta de la lista, con `arreglar` (nombres.ts) el archivo toma el nombre y los tags de la lista.
// La lista baja en tramos (tramos.ts): la otra fuente se busca al terminar cada tramo, no al final de la lista. Y un tema que,
// mientras baja, ya suena trucho en un pedazo (muestra.ts) se corta igual que una fuente lenta (`porMuestra`).
// Tests: tests/napia-calidad.test.ts, napia-lentitud.test.ts y napia-tramos.test.ts.
import type { Calidad, CopiaTuya, CuentaCalidad, MotivoTrucho, RevisionCalidad, TrackProgress } from '@paila/shared/napia'
import { Reparto } from './carpetas'
import { esMejor, type Revision } from './calidad'
import { otraVersion } from './otraversion'
import { compararHuellas } from './huella'
import { textos } from '@paila/shared/idioma'

const T = textos({
  soloLentas: { es: 'Solo se encontró en fuentes muy lentas. Probá más tarde.', en: 'Only found from very slow sources. Try again later.' },
  soloMuestra: {
    es: 'Solo se encontró trucho: mientras bajaba, ya sonaba mal, y se cortó. Probá buscarlo de otra forma.',
    en: 'Only found bogus: it already sounded bad while downloading, so it was cut. Try searching for it another way.',
  },
  suenaOtra: { es: 'suena distinto a la tuya: en vivo, remix u otro master', en: 'sounds different from yours: live, remix or another master' },
  esOtroTema: { es: 'por el sonido, es otro tema', en: 'by its sound, it is another track' },
  esOtra: { es: (v: string) => `Es otra versión (${v}), no la que pediste`, en: (v: string) => `It's another version (${v}), not the one you asked for` },
  soloOtra: {
    es: (v: string) => `Solo se encontró otra versión (${v}): quedó en «descartados». Probá buscarlo de otra forma.`,
    en: (v: string) => `Only another version was found (${v}): it was left in “descartados”. Try searching for it another way.`,
  },
})

/** Cuántas veces se busca otra fuente para un tema trucho. */
export const MAX_FUENTES = 3

const clave = (t: { artist: string; title: string }) => `${t.artist}\u0000${t.title}`.toLowerCase().replace(/\s+/g, ' ').trim()
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const nueva = (tuya: CopiaTuya | null): RevisionCalidad => ({ estado: 'revisando', nota: null, es: null, motivo: null, descartadas: 0, intentos: 0, tuya })

/** Un archivo para revisar: `fila` es el tema de la lista; `archivo`, la fila de sockseek con el archivo (la misma, u otra fuente). */
interface Pedido { fila: TrackProgress; archivo: TrackProgress }

export interface ControlOpciones {
  /** La carpeta de trabajo de sockseek y la de la lista. */
  trabajo: string
  carpeta: string
  calidad: Calidad
  /** Revisa un archivo. null: no se puede (sin ffmpeg): todo pasa sin revisar. */
  revisar: ((file: string, calidad: Calidad) => Promise<Revision>) | null
  onCambio?: () => void
  maxFuentes?: number
  /** La copia que ya tenés de cada tema que viene a reemplazarla (null: no la tenés, o no se reemplaza nada). */
  tuya?: (fila: { artist: string; title: string }) => CopiaTuya | null
  /**
   * Antes de pasarlo a la carpeta: le pone al archivo los tags de la lista y devuelve el nombre con el que va (nombres.ts). null:
   * se deja como llegó. Si falla, se entrega igual.
   */
  arreglar?: (fila: { artist: string; title: string }, archivo: string) => Promise<string | null>
  /** La huella de tu copia, por su número en PAILA (huella.ts): lo bajado tiene que ser el mismo audio. */
  huellaTuya?: (id: number) => string | Uint32Array | null
  /** Para un tema que no tenés: ¿AcoustID dice que es ese tema? (null: no sabe; se deja pasar). */
  reconocer?: (huella: string, duracion: number, fila: { artist: string; title: string }) => Promise<boolean | null>
}

export class ControlCalidad {
  readonly reparto: Reparto
  /** Las filas de la lista (las de la corrida principal de sockseek). */
  private filas: TrackProgress[] = []
  private cola: Pedido[] = []
  private vistos = new WeakSet<TrackProgress>()
  /** Archivos revisados que sirven (o que no se pudieron revisar): el reparto los puede pasar a la carpeta. */
  private buenos = new WeakSet<TrackProgress>()
  /** Dónde estaba la primera copia (trucha) de cada tema: si llega una buena, el índice de sockseek apunta a ella. */
  private origen = new Map<TrackProgress, string>()
  private vetados = new Map<TrackProgress, Set<string>>()
  private ronda = new Map<string, TrackProgress>()
  /** Los que no llegaron en la corrida principal (su fuente iba lenta) y después llegaron de otra: el índice no los tiene. */
  readonly rescatados: TrackProgress[] = []
  private trabajando: Promise<void> | null = null
  private readonly max: number
  /** Está buscando otras fuentes (lo pone quien corre sockseek, ver buscarOtrasFuentes). */
  buscandoOtra = false

  constructor(private readonly o: ControlOpciones) {
    this.max = o.maxFuentes ?? MAX_FUENTES
    this.reparto = new Reparto(o.trabajo, o.carpeta, (t) => !o.revisar || this.buenos.has(t as TrackProgress))
  }

  get activa() { return !!this.o.revisar }

  /** Cada aviso de la corrida principal: lo terminado en la carpeta de trabajo se revisa (o pasa, si no se puede revisar). */
  ver(tracks: TrackProgress[]) {
    this.filas = tracks
    if (this.o.revisar) {
      for (const t of tracks) {
        if (this.vistos.has(t) || !this.reparto.enTrabajo(t)) continue
        this.vistos.add(t)
        t.calidad = nueva(this.o.tuya?.(t) ?? null)
        this.encolar({ fila: t, archivo: t })
      }
    }
    this.reparto.repartir(tracks)
  }

  /** Espera a que se revise todo lo que está en la cola. */
  async vacio() { while (this.trabajando) await this.trabajando }

  private encolar(p: Pedido) {
    this.cola.push(p)
    if (this.trabajando) return
    this.trabajando = (async () => { while (this.cola.length) await this.revisarUno(this.cola.shift()!) })().finally(() => { this.trabajando = null })
  }

  private async revisarUno({ fila, archivo }: Pedido) {
    const c = fila.calidad ??= nueva(this.o.tuya?.(fila) ?? null)
    const file = archivo.path!
    let r: Revision | null = null
    try { r = await this.o.revisar!(file, this.o.calidad) } catch { r = null }
    // viene a reemplazar tu copia: si no es claramente mejor, no sirve (aunque sea buena)
    if (r && !r.motivo && c.tuya && !esMejor(r, c.tuya)) r = { ...r, motivo: 'noEsMejor' }
    // otra versión que no pediste (la acapella en vez del tema): no sirve, aunque la calidad esté bien
    const otra = otraVersion(fila, file) ?? (r && !r.motivo ? await this.porSonido(fila, r, c) : null)
    const motivo = otra ? 'otraVersion' as const : r?.motivo ?? null
    const deOtraFuente = archivo !== fila
    if (!motivo) {
      // sirve (o no se pudo analizar: se entrega igual, como antes de que existiera la revisión)
      // primero el nombre y los tags (mientras tanto el reparto no lo mueve: todavía no está entre los buenos)
      let nombre: string | null = null
      try { nombre = (await this.o.arreglar?.(fila, file)) ?? null } catch { nombre = null }
      this.buenos.add(archivo)
      await paciencia(() => this.reparto.pasar(archivo, nombre))
      if (deOtraFuente) {
        Object.assign(fila, { state: 'bajado', percent: 100, detail: null, path: archivo.path, format: archivo.format, fuente: archivo.fuente })
        const o = this.origen.get(fila)
        if (o && archivo.path) this.reparto.movidos.set(o, archivo.path)
        else this.rescatados.push(fila)
      }
      c.avance = null
      // de otra fuente: "reemplazado" si antes llegó una trucha; si solo se cortaron fuentes lentas, llegó y listo
      c.estado = deOtraFuente && (c.descartadas || c.enMuestra) ? 'reemplazado' : r ? 'buena' : 'sinRevisar'
      // sin revisar: lo que decía de la copia anterior (trucha u otra versión) ya no vale
      if (r) { c.nota = r.nota; c.es = r.es } else { c.nota = null; c.es = null }
      c.muestra = false
    } else {
      if (!deOtraFuente) this.origen.set(fila, file)
      await paciencia(() => this.reparto.apartar(archivo))
      if (deOtraFuente) fila.path = archivo.path
      this.vetar(fila, archivo.fuente)
      Object.assign(c, { nota: r?.nota ?? null, es: otra ? T.esOtra(otra) : r?.es ?? null, motivo, otra: otra ?? undefined, descartadas: c.descartadas + 1, avance: null, estado: 'trucho', muestra: false })
      if (c.intentos >= this.max) this.rendirse(fila)
    }
    this.o.onCambio?.()
  }

  /**
   * ¿Es otra versión u otro tema, por cómo suena? (huella.ts) Con copia tuya, su huella contra la tuya; sin copia, AcoustID.
   * Devuelve el porqué (va como "otra versión": a descartados y otra fuente) o null si sirve o no se puede saber.
   */
  private async porSonido(fila: TrackProgress, r: Revision, c: { tuya?: CopiaTuya | null }): Promise<string | null> {
    if (!r.huella) return null
    const tuya = c.tuya?.id != null ? this.o.huellaTuya?.(c.tuya.id) ?? null : null
    if (tuya) {
      const p = compararHuellas(r.huella, r.duracion, tuya, c.tuya!.duracion ?? null)
      return p === 'version' ? T.suenaOtra : p === 'otro' ? T.esOtroTema : null
    }
    if (c.tuya || !this.o.reconocer || !r.duracion) return null
    let ok: boolean | null = null
    try { ok = await this.o.reconocer(r.huella, r.duracion, fila) } catch { ok = null }
    return ok === false ? T.esOtroTema : null
  }

  private vetar(fila: TrackProgress, usuario: string | null | undefined) {
    if (!usuario) return
    const v = this.vetados.get(fila) ?? new Set(); v.add(usuario); this.vetados.set(fila, v)
  }

  /**
   * Una fuente iba tan lenta que se cortó su sockseek (lentitud.ts): cuenta como un intento, ese usuario no se vuelve a usar y
   * el tema espera otra fuente. `deOtraFuente`: la fila es de la corrida de otra fuente (si no, de la lista).
   */
  lenta(t: TrackProgress, deOtraFuente = false) {
    this.cortada(t, deOtraFuente, (c) => ({ lentas: (c.lentas ?? 0) + 1, motivo: 'lenta' }))
  }

  /**
   * Mientras bajaba, un pedazo ya sonaba trucho (muestra.ts) y se cortó su sockseek: como una fuente lenta (un intento, ese
   * usuario vetado), pero con lo que se vio en el pedazo. No va a descartados: no llegó ningún archivo entero.
   */
  porMuestra(t: TrackProgress, m: Pick<RevisionCalidad, 'nota' | 'es'> & { motivo: MotivoTrucho }, deOtraFuente = false) {
    this.cortada(t, deOtraFuente, (c) => ({ enMuestra: (c.enMuestra ?? 0) + 1, motivo: m.motivo, nota: m.nota, es: m.es, muestra: true }))
  }

  private cortada(t: TrackProgress, deOtraFuente: boolean, cambios: (c: RevisionCalidad) => Partial<RevisionCalidad>) {
    const fila = deOtraFuente ? this.ronda.get(clave(t)) : t
    if (!fila || (deOtraFuente && fila.calidad?.estado !== 'otraFuente')) return
    const c = fila.calidad ??= nueva(this.o.tuya?.(fila) ?? null)
    this.vetar(fila, t.fuente)
    // de la lista: todavía no llegó, se sigue buscando (con otra fuente)
    if (!deOtraFuente) Object.assign(fila, { state: 'buscando', percent: null, detail: null })
    Object.assign(c, cambios(c), { avance: null, estado: 'trucho' })
    if (c.intentos >= this.max) this.rendirse(fila)
    this.o.onCambio?.()
  }

  /**
   * Cómo termina un tema sin una copia que sirva: sin una mejor que la tuya, o solo trucho. Si nunca llegó ninguna (solo
   * fuentes lentas), no se pudo bajar, como cualquier otro que falló.
   */
  private rendirse(fila: TrackProgress) {
    const c = fila.calidad
    if (!c) return
    if (!c.descartadas && (c.lentas || c.enMuestra) && fila.state !== 'bajado') { Object.assign(fila, { state: 'fallo', percent: null, detail: c.enMuestra ? T.soloMuestra : T.soloLentas, calidad: null }); return }
    // solo llegó otra versión (la acapella, un remix): no se encontró el tema, se puede buscar de otra forma
    if (c.motivo === 'otraVersion') { Object.assign(fila, { state: 'noEncontrado', percent: null, detail: T.soloOtra(c.otra ?? ''), calidad: null }); return }
    c.avance = null
    c.estado = c.tuya ? 'sinMejor' : 'soloFalsa'
  }

  /** Los temas truchos que todavía pueden probar otra fuente, y los usuarios que no hay que volver a usar. */
  paraOtraFuente(): { filas: TrackProgress[]; vetados: string[] } {
    const filas = this.filas.filter((f) => f.calidad?.estado === 'trucho' && f.calidad.intentos < this.max)
    // sockseek separa la lista con comas: un nombre con coma no se puede vetar
    const vetados = [...new Set(filas.flatMap((f) => [...(this.vetados.get(f) ?? [])]))].filter((u) => !u.includes(','))
    return { filas, vetados }
  }

  /** Arranca una ronda de otra fuente con esos temas. */
  empezarRonda(filas: TrackProgress[]) {
    this.ronda = new Map(filas.map((f) => [clave(f), f]))
    for (const f of filas) { f.calidad!.intentos++; f.calidad!.estado = 'otraFuente' }
    this.o.onCambio?.()
  }

  /** Cada aviso de la corrida de otra fuente: lo que llegó se revisa por el tema de la lista; lo que no, se termina ahí. */
  verOtraFuente(tracks: TrackProgress[], terminada = false) {
    for (const t of tracks) {
      const f = this.ronda.get(clave(t))
      if (!f?.calidad || f.calidad.estado !== 'otraFuente') continue
      if (this.reparto.enTrabajo(t)) {
        if (!this.vistos.has(t)) { this.vistos.add(t); f.calidad.estado = 'revisando'; this.encolar({ fila: f, archivo: t }) }
      } else if (t.state === 'noEncontrado' || t.state === 'fallo' || (terminada && t.state !== 'bajado' && t.state !== 'yaEstaba')) {
        // nadie más lo tiene (o se cortó): no hay otra fuente para probar
        if (t.state === 'cancelado') f.calidad.estado = 'trucho'
        else this.rendirse(f)
      } else f.calidad.avance = t.state === 'bajando' ? t.percent : null
    }
    this.o.onCambio?.()
  }

  /** Al terminar las rondas: lo que siguió trucho queda como "solo se encontró en calidad falsa". */
  terminar() {
    for (const f of this.filas) if (f.calidad && (f.calidad.estado === 'trucho' || f.calidad.estado === 'otraFuente')) this.rendirse(f)
    this.buscandoOtra = false
    this.o.onCambio?.()
  }

  cuenta(): CuentaCalidad {
    const n = (fn: (c: RevisionCalidad) => boolean) => this.filas.filter((f) => f.calidad && fn(f.calidad)).length
    return {
      activa: this.activa, revisando: n((c) => c.estado === 'revisando'), descartados: n((c) => c.descartadas > 0 || !!c.enMuestra),
      reemplazados: n((c) => c.estado === 'reemplazado'), soloFalsa: n((c) => c.estado === 'soloFalsa'), sinMejor: n((c) => c.estado === 'sinMejor'), buscandoOtra: this.buscandoOtra,
    }
  }
}

/** Mover un archivo que el antivirus o sockseek todavía tienen tomado: unos intentos cortos. */
async function paciencia(fn: () => boolean) {
  for (let i = 0; i < 5 && !fn(); i++) await espera(400)
}

/** Una corrida de sockseek para otra fuente (la arma quien sabe correrlo: apps/napia/electron/ipc.ts, o un test). */
export interface CorridaOtraFuente { tracks: () => TrackProgress[]; done: Promise<{ cancelled: boolean }> }

/**
 * Cuando terminó la corrida principal: espera la revisión de todo y, mientras quede algo trucho con intentos, corre sockseek
 * de nuevo con esos temas y sin los usuarios que dieron copias truchas. `lanzar` arma la corrida (null: no se puede).
 */
export async function buscarOtrasFuentes(control: ControlCalidad, lanzar: (filas: TrackProgress[], vetados: string[], ronda: number) => CorridaOtraFuente | null, cortado: () => boolean) {
  await control.vacio()
  for (let ronda = 1; control.activa && !cortado(); ronda++) {
    const plan = control.paraOtraFuente()
    if (!plan.filas.length) break
    control.buscandoOtra = true
    control.empezarRonda(plan.filas)
    const corrida = lanzar(plan.filas, plan.vetados, ronda)
    if (!corrida) break
    const fin = await corrida.done
    control.verOtraFuente(corrida.tracks(), true)
    await control.vacio()
    if (fin.cancelled) break
  }
  control.terminar()
}
