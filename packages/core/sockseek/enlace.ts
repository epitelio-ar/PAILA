// El enlace entre NAPIA y PAILA (el autor, 1/11: "tienen que estar bien interconectadas en varios sentidos"). Cada una
// sigue en su ventana; NAPIA deja en sus datos un archivo chico (para-paila.json) con en qué anda y cómo terminó la última
// lista, y PAILA lo mira cada pocos segundos: muestra la bajada en su barra de trabajos, avisa cuando termina y anota en
// «Faltan o suenan mal» lo que no se consiguió. Sin sockets ni puertos: un archivo que se reemplaza entero (nunca a medias).
import fs from 'node:fs'
import path from 'node:path'

export interface FinLista {
  lista: string
  /** Cuándo terminó (ms): PAILA avisa una sola vez por cada fin. */
  hora: number
  bajados: number
  /** Lo que no se consiguió (no estaba en Soulseek, no se pudo bajar o solo llegó trucho). */
  noConseguidos: { artist: string; title: string }[]
  cortada: boolean
}

export interface EnlaceNapia {
  /** Cuándo lo escribió NAPIA (ms). Si NAPIA se cerró de golpe, el archivo queda viejo: ver `vigente`. */
  hora: number
  corriendo: boolean
  lista: string | null
  hechos: number
  total: number
  bajados: number
  /** Dónde guarda NAPIA lo bajado. */
  carpeta: string | null
  fin: FinLista | null
  // Desde la Etapa 5 (MASTERPLAN-5, 2.4: el estado de NAPIA se ve en Sonido de PAILA, sin cambiar de ventana). Opcionales: una
  // NAPIA vieja no los escribe y PAILA muestra lo de antes. Los arma enlace-armar.ts.
  /** Temas que llegaron truchos en la lista que baja (al menos una copia descartada). */
  truchos?: number
  /** Temas que no se encontraron o no se pudieron bajar. */
  noEncontrados?: number
  /** Listas que esperan en la tanda, después de la que baja. */
  enEspera?: number
  /** Qué le falta a NAPIA para poder bajar (null: está lista): sockseek, la cuenta de Soulseek o confirmar la carpeta. */
  falta?: FaltaNapia | null
  /** Lo último que pasó, del más nuevo al más viejo (hasta 8): lo que llegó, lo trucho y lo que no estaba. */
  ultimos?: UltimoNapia[]
}

export type FaltaNapia = 'sockseek' | 'cuenta' | 'carpeta'
/** Un tema que terminó: llegó bien, llegó trucho (con lo que es en realidad, en palabras) o no estaba en Soulseek. */
/** `otraCopia`: llegó bien, pero la primera copia era trucha y NAPIA consiguió otra. */
export interface UltimoNapia { artist: string; title: string; estado: 'llego' | 'trucho' | 'noEsta'; es?: string | null; otraCopia?: boolean }

export const ARCHIVO_ENLACE = 'para-paila.json'
/** NAPIA lo reescribe cada 2 s mientras está abierta: más viejo que esto, NAPIA ya no está bajando. */
export const ENLACE_VENCE_MS = 15_000

export function escribirEnlace(carpetaDatos: string, e: EnlaceNapia) {
  const f = path.join(carpetaDatos, ARCHIVO_ENLACE)
  const tmp = f + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(e), 'utf8')
  fs.renameSync(tmp, f)
}

/** El enlace de la primera carpeta de datos de NAPIA que lo tenga (la portable primero), o null. */
export function leerEnlace(carpetas: string[]): EnlaceNapia | null {
  for (const d of carpetas) {
    try { return JSON.parse(fs.readFileSync(path.join(d, ARCHIVO_ENLACE), 'utf8')) as EnlaceNapia } catch { /* sin NAPIA o a medio escribir */ }
  }
  return null
}

/** ¿Está bajando de verdad? Un archivo viejo que dice "corriendo" es de una NAPIA que se cerró antes de avisar. */
export const vigente = (e: EnlaceNapia | null, ahora = Date.now()) => !!e && e.corriendo && ahora - e.hora < ENLACE_VENCE_MS
