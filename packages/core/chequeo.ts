// El Chequeo (Configuración → Chequeo): lo que le puede impedir andar a PAILA, en simple y con su arreglo. Cada control es una
// prueba chica: ffmpeg y ffprobe responden, se puede escribir en tu Música y en la carpeta de datos, hay lugar, las claves
// andan, MusicBrainz contesta, la base está sana (PRAGMA quick_check, en un hilo aparte), y el firewall y el puerto de NAPIA.
// Lo que toca el sistema entra por `Sondas` (los tests no usan internet ni discos de verdad). Nunca muestra ni anota el valor
// de una clave: las sondas devuelven solo si anduvo. `controlDelError` dice qué control mirar cuando algo falla al usarse.
import type { ArregloControl, Control, ControlId } from '@paila/shared/types'
import type { FirewallDiag } from '@paila/shared/napia'
import { TIP_FIREWALL, textoFirewall } from '@paila/shared/firewall'
import { lista, num } from '@paila/shared/idioma'
import { T } from './chequeo.textos'

export type ClaveServicio = 'discogs' | 'acoustid' | 'lastfm'
export const SERVICIO: Record<ClaveServicio, string> = { discogs: 'Discogs', acoustid: 'AcoustID', lastfm: 'Last.fm' }

export interface Sondas {
  /** ¿El programa contesta (`-version`)? */
  responde: (exe: string) => Promise<boolean>
  /** Escribe y borra un archivito en esa carpeta: null si anduvo, si no el código del error (EACCES, EROFS…). */
  escribir: (dir: string) => Promise<string | null>
  /** Bytes libres en el disco de esa carpeta (null si no se sabe). */
  libre: (dir: string) => Promise<number | null>
  /** La prueba de una clave: si hay clave y cómo salió (sin el valor). */
  clave: (s: ClaveServicio) => Promise<{ hay: boolean; ok?: boolean; sinInternet?: boolean; msg?: string }>
  /** null si MusicBrainz contestó; 'enUso' si lo está usando una búsqueda; 'ocupado' si pide ir más despacio; si no, por qué no. */
  musicbrainz: () => Promise<string | null>
  /** PRAGMA quick_check: los problemas (vacío = sana). null si no se pudo correr, con el motivo. */
  base: () => Promise<{ problemas: string[] } | { error: string }>
  /** NAPIA, si está (null: no hay sockseek de NAPIA en esta compu). */
  napia: () => Promise<null | { firewall: FirewallDiag | null; router: 'ok' | 'dobleNat' | 'no' | 'bajando' | null }>
}

export interface EntradaChequeo {
  ffmpeg: string | null
  ffprobe: string | null
  /** Las carpetas de la biblioteca (con su nombre para mostrar). */
  raices: { path: string; nombre: string; available: boolean }[]
  /** La carpeta de datos de PAILA. */
  datos: string
  /** PAILA abierta solo para mirar: no se escribe en la Música. */
  soloMirar: boolean
}

const control = (id: ControlId, estado: Control['estado'], titulo: string, tip: string, resumen: string, detalle: string[] = [], arreglos: ArregloControl[] = [], nota: string | null = null): Control =>
  ({ id, estado, titulo, tip, resumen, detalle, arreglos, nota })
const repetir = (): ArregloControl => ({ tipo: 'repetir', etiqueta: T.repetir })

export function controlProgramas(ffmpeg: boolean | null, ffprobe: boolean | null): Control {
  // null: no está; false: está pero no contesta
  const faltan = [ffmpeg == null && 'ffmpeg', ffprobe == null && 'ffprobe'].filter(Boolean) as string[]
  const mudos = [ffmpeg === false && 'ffmpeg', ffprobe === false && 'ffprobe'].filter(Boolean) as string[]
  if (!faltan.length && !mudos.length) return control('programas', 'ok', T.programas, T.programasTip, T.programasOk)
  const resumen = [faltan.length ? T.falta(lista(faltan)) : '', mudos.length ? T.noResponde(lista(mudos)) : ''].filter(Boolean).join(' ')
  return control('programas', 'mal', T.programas, T.programasTip, resumen, [T.programasPorQue, T.reinstalar], [repetir()])
}

const motivo = (code: string) => (/EACCES|EPERM/.test(code) ? T.sinPermiso : /EROFS/.test(code) ? T.soloLectura : /ENOSPC/.test(code) ? T.lleno : code)

export function controlCarpetas(raices: { nombre: string; available: boolean; error: string | null }[], soloMirar: boolean): Control {
  const c = (estado: Control['estado'], resumen: string, detalle: string[] = [], arreglos: ArregloControl[] = []) => control('carpetas', estado, T.carpetas, T.carpetasTip, resumen, detalle, arreglos)
  if (!raices.length) return c('nose', T.sinCarpetas)
  const mal = raices.filter((r) => r.available && r.error)
  if (mal.length) return c('mal', mal.map((r) => T.noSeEscribe(r.nombre, motivo(r.error!))).join(' '), [T.noSeEscribePorQue], [repetir()])
  const fuera = raices.filter((r) => !r.available)
  if (fuera.length) return c('atencion', T.noConectado(lista(fuera.map((r) => r.nombre))), [T.noConectadoPorQue], [repetir()])
  return soloMirar ? c('nose', T.soloMirar) : c('ok', T.carpetasOk(raices.length))
}

export function controlDatos(error: string | null): Control {
  return error ? control('datos', 'mal', T.datos, T.datosTip, T.datosMal(motivo(error)), [T.datosPorQue], [repetir()]) : control('datos', 'ok', T.datos, T.datosTip, T.datosOk)
}

/** Menos de 1 GB libre: mal; menos de 5 GB: atención. */
export const POCO = 5e9, NADA = 1e9
export const gb = (b: number) => (b >= 1e9 ? `${num(Math.floor(b / 1e8) / 10)} GB` : `${num(Math.round(b / 1e6))} MB`)

export function controlEspacio(discos: { disco: string; libre: number | null }[]): Control {
  const sabidos = discos.filter((d): d is { disco: string; libre: number } => d.libre != null)
  if (!sabidos.length) return control('espacio', 'nose', T.espacio, T.espacioTip, T.espacioOk('?'))
  const poco = sabidos.filter((d) => d.libre < POCO).sort((a, b) => a.libre - b.libre)
  const texto = (ds: typeof sabidos) => lista(ds.map((d) => T.libres(d.disco, gb(d.libre))))
  if (!poco.length) return control('espacio', 'ok', T.espacio, T.espacioTip, T.espacioOk(texto(sabidos)))
  return control('espacio', poco[0].libre < NADA ? 'mal' : 'atencion', T.espacio, T.espacioTip, T.pocoLugar(texto(poco)), [T.espacioPorQue],
    [{ tipo: 'ir', etiqueta: T.irEspacio, pagina: 'space' }, { tipo: 'ir', etiqueta: T.irPapelera, pagina: 'trash' }])
}

const TIP_CLAVE: Record<ClaveServicio, () => string> = { discogs: () => T.discogsTip, acoustid: () => T.acoustidTip, lastfm: () => T.lastfmTip }
export function controlClave(s: ClaveServicio, r: Awaited<ReturnType<Sondas['clave']>>): Control {
  const n = SERVICIO[s]
  const c = (estado: Control['estado'], resumen: string, detalle: string[] = [], arreglos: ArregloControl[] = []) => control(`clave-${s}`, estado, T.clave(n), TIP_CLAVE[s](), resumen, detalle, arreglos)
  const ir = (etiqueta: string): ArregloControl => ({ tipo: 'ir', etiqueta, pagina: 'settings', seccion: 'cfg-internet' })
  if (!r.hay) return c('info', T.sinClave(n), [], [ir(T.ponerClave)])
  if (r.ok) return c('ok', T.claveOk)
  if (r.sinInternet) return c('atencion', T.sinInternet(n), [T.sinInternetPorQue], [repetir()])
  return c('mal', T.claveMal(n), [T.claveMalPorQue(n)], [ir(T.revisarClave)])
}

export function controlMusicBrainz(r: string | null): Control {
  if (r == null || r === 'enUso') return control('musicbrainz', 'ok', 'MusicBrainz', T.mbTip, r ? T.mbEnUso : T.mbOk)
  if (r === 'ocupado') return control('musicbrainz', 'info', 'MusicBrainz', T.mbTip, T.mbOcupado, [T.mbOcupadoPorQue], [repetir()])
  return control('musicbrainz', 'atencion', 'MusicBrainz', T.mbTip, T.mbMal(r), [T.mbPorQue, T.sinInternetPorQue], [repetir()])
}

export function controlBase(r: Awaited<ReturnType<Sondas['base']>>): Control {
  if ('error' in r) return control('base', 'nose', T.base, T.baseTip, T.baseNose(r.error), [], [repetir()])
  if (!r.problemas.length) return control('base', 'ok', T.base, T.baseTip, T.baseOk)
  return control('base', 'mal', T.base, T.baseTip, T.baseMal, [T.basePorQue], [{ tipo: 'ir', etiqueta: T.irDiagnostico, pagina: 'settings', seccion: 'cfg-diagnostico' }])
}

/** El firewall de NAPIA con el mismo texto que muestra NAPIA (@paila/shared/firewall). */
export function controlFirewall(d: FirewallDiag | null): Control {
  if (!d) return control('napia-firewall', 'nose', T.napiaFirewall, TIP_FIREWALL.info, T.napiaFirewallNose, [], [repetir()])
  const t = textoFirewall(d)
  const arreglos: ArregloControl[] = []
  if (t.arreglar) arreglos.push({ tipo: 'firewall', etiqueta: t.arreglar })
  if (t.abrir) arreglos[t.primeroAbrir ? 'unshift' : 'push']({ tipo: 'windows', etiqueta: t.abrir.etiqueta, que: t.abrir.que })
  const detalle = [t.texto, t.consecuencia, t.redPublica].filter((x): x is string => !!x)
  const nota = (t.primeroAbrir ? [t.abrir?.nota, t.queHace] : [t.queHace, t.abrir?.nota]).filter(Boolean).join(' ') || null
  return { ...control('napia-firewall', t.tono === 'ok' ? 'ok' : 'atencion', T.napiaFirewall, TIP_FIREWALL.info, t.titulo, detalle, arreglos, nota), aMano: d.aMano }
}

export function controlPuerto(r: 'ok' | 'dobleNat' | 'no' | 'bajando' | null): Control | null {
  if (r == null) return null
  if (r === 'ok' || r === 'bajando') return control('napia-puerto', 'ok', T.napiaPuerto, T.napiaPuertoTip, r === 'ok' ? T.puertoOk : T.puertoBajando)
  return control('napia-puerto', 'info', T.napiaPuerto, T.napiaPuertoTip, r === 'dobleNat' ? T.puertoDobleNat : T.puertoNo, [T.puertoPorQue], [repetir()])
}

/** El disco de una carpeta, para mostrar ("C:", "F:" o la carpeta en Mac). */
export const discoDe = (p: string) => { const m = p.match(/^([A-Za-z]:)[\\/]/); return m ? m[1].toUpperCase() : p.startsWith('\\\\') ? p.split('\\').slice(0, 4).join('\\') : '/' + (p.split('/')[1] ?? '') }

/** Uno solo (para "Probar de nuevo" y los avisos). null si no corresponde (NAPIA no está). */
export async function chequearUno(id: ControlId, e: EntradaChequeo, s: Sondas): Promise<Control | null> {
  switch (id) {
    case 'programas': {
      const [a, b] = await Promise.all([e.ffmpeg ? s.responde(e.ffmpeg) : null, e.ffprobe ? s.responde(e.ffprobe) : null])
      return controlProgramas(a, b)
    }
    case 'carpetas': return controlCarpetas(await Promise.all(e.raices.map(async (r) => ({ nombre: r.nombre, available: r.available, error: r.available && !e.soloMirar ? await s.escribir(r.path) : null }))), e.soloMirar)
    case 'datos': return controlDatos(await s.escribir(e.datos))
    case 'espacio': {
      // un renglón por disco (la carpeta de datos y cada carpeta de música conectada)
      const dirs = new Map<string, string>()
      for (const d of [e.datos, ...e.raices.filter((r) => r.available).map((r) => r.path)]) if (!dirs.has(discoDe(d))) dirs.set(discoDe(d), d)
      return controlEspacio(await Promise.all([...dirs].map(async ([disco, dir]) => ({ disco, libre: await s.libre(dir) }))))
    }
    case 'clave-discogs': case 'clave-acoustid': case 'clave-lastfm': {
      const sv = id.slice(6) as ClaveServicio
      return controlClave(sv, await s.clave(sv))
    }
    case 'musicbrainz': return controlMusicBrainz(await s.musicbrainz())
    case 'base': return controlBase(await s.base())
    case 'napia-firewall': { const n = await s.napia(); return n ? controlFirewall(n.firewall) : null }
    case 'napia-puerto': { const n = await s.napia(); return n ? controlPuerto(n.router) : null }
  }
}

export const CONTROLES: ControlId[] = ['programas', 'datos', 'carpetas', 'espacio', 'base', 'musicbrainz', 'clave-discogs', 'clave-acoustid', 'clave-lastfm', 'napia-firewall', 'napia-puerto']

/** Todos los controles a la vez, en su orden; `alTerminar` recibe cada uno apenas está (para ir mostrándolos). */
export async function chequear(e: EntradaChequeo, s: Sondas, alTerminar?: (c: Control) => void): Promise<Control[]> {
  // NAPIA se mira una sola vez para sus dos controles
  let napia: ReturnType<Sondas['napia']> | null = null
  const una: Sondas = { ...s, napia: () => (napia ??= s.napia()) }
  const out = await Promise.all(CONTROLES.map(async (id) => {
    const c = await chequearUno(id, e, una).catch((err: Error): Control => control(id, 'nose', id, '', err.message))
    if (c) alTerminar?.(c)
    return c
  }))
  return out.filter((c): c is Control => !!c)
}

/**
 * Qué control mirar cuando algo falló al usarse (el mensaje de un error): un disco lleno, la base dañada, un disco de solo
 * lectura. null si no es de esos (un archivo abierto en otro programa, por ejemplo, no es para el Chequeo).
 */
export function controlDelError(msg: string): ControlId | null {
  if (/ENOSPC|no space left|not enough space|disk is full|database or disk is full|SQLITE_FULL|espacio insuficiente|no hay (suficiente )?espacio|no hay lugar/i.test(msg)) return 'espacio'
  if (/SQLITE_CORRUPT|SQLITE_NOTADB|database disk image is malformed|file is not a database/i.test(msg)) return 'base'
  if (/EROFS|read-only file system/i.test(msg)) return 'carpetas'
  return null
}
