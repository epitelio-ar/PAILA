// PAILA mira en qué anda NAPIA (core/sockseek/enlace.ts), cada 3 s: la bajada se ve en la barra de trabajos (tocarla trae
// NAPIA adelante), la Bandeja sigue la carpeta de NAPIA aunque la cambies, y cuando termina una lista avisa y anota en
// «Faltan o suenan mal» lo que no se consiguió. Cada programa sigue en su ventana (el autor, 1/11).
import path from 'node:path'
import { BrowserWindow, Notification } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type { Jobs } from '@paila/core/jobs'
import { leerEnlace, vigente, type EnlaceNapia } from '@paila/core/sockseek/enlace'
import { bandejaCubre } from '@paila/core/sockseek/paila'
import { marcarNoConseguidos } from '@paila/core/wanted-napia'
import { textos } from '@paila/shared/idioma'

const T = textos({
  bajando: { es: (l: string) => `NAPIA bajando «${l}»`, en: (l: string) => `NAPIA downloading «${l}»` },
  bajados: { es: (n: number) => `${n} bajados`, en: (n: number) => `${n} downloaded` },
  termino: { es: (l: string) => `NAPIA terminó «${l}»`, en: (l: string) => `NAPIA finished «${l}»` },
  resumen: {
    es: (b: number, f: number) => `${b} bajados${f ? `, ${f} no se consiguieron (quedan marcados en «Faltan o suenan mal»)` : ''}. Lo bajado está en la Bandeja.`,
    en: (b: number, f: number) => `${b} downloaded${f ? `, ${f} couldn't be found (marked in «Missing or sounds bad»)` : ''}. What was downloaded is in the Inbox.`,
  },
})

export const SIGUE_NAPIA = 'inbox_sigue_napia'
const FIN_VISTO = 'napia_fin_visto'

export interface EnlaceOpts {
  jobs: Jobs
  db: DatabaseSync
  /** Las carpetas de datos de NAPIA (la portable primero). */
  carpetasNapia: () => string[]
  setting: (k: string) => string | null
  setSetting: (k: string, v: string) => void
  /** Las carpetas de música: si NAPIA guarda adentro de una, la Bandeja no la vigila (lo bajado ya está en tu Música). */
  raices: () => string[]
  cambiarBandeja: (dir: string) => void
  /** Avisa a la pantalla que cambió la lista (para recargar «Faltan o suenan mal»). */
  cambioLista: () => void
  /** Lo que dijo NAPIA cada vez que se mira (Sonido lo muestra arriba: ipc/sonido.ts). */
  alMirar?: (e: EnlaceNapia | null) => void
}

export function vigilarNapia(o: EnlaceOpts): () => void {
  let desde: number | null = null
  const mirar = () => {
    const e = leerEnlace(o.carpetasNapia())
    o.alMirar?.(e)
    // 1) la bajada, en la barra de trabajos
    if (vigente(e)) {
      desde ??= Date.now()
      o.jobs.externo('napia', T.bajando(e!.lista ?? 'NAPIA'), { done: e!.hechos, total: e!.total, current: T.bajados(e!.bajados), found: e!.bajados, startedAt: desde })
    } else { desde = null; o.jobs.externo('napia', '', null) }
    if (!e) return
    // 2) la Bandeja sigue la carpeta de NAPIA (si la puso NAPIA: una elegida a mano no se toca)
    const bandeja = o.setting('inbox_dir')
    if (e.carpeta && o.setting(SIGUE_NAPIA) === '1' && !bandejaCubre(bandeja, e.carpeta) && !o.raices().some((r) => bandejaCubre(r, e.carpeta!))) o.cambiarBandeja(e.carpeta)
    // 3) terminó una lista: se anota lo que no se consiguió y se avisa (una vez por cada fin)
    const f = e.fin
    if (!f || f.hora <= Number(o.setting(FIN_VISTO) ?? 0)) return
    o.setSetting(FIN_VISTO, String(f.hora))
    let marcados = 0
    try { marcados = marcarNoConseguidos(o.db, f.noConseguidos, new Date(f.hora).toISOString().slice(0, 10)) } catch { /* la base ocupada: queda sin marcar */ }
    if (marcados) o.cambioLista()
    if (!Notification.isSupported()) return
    const n = new Notification({ title: T.termino(f.lista), body: T.resumen(f.bajados, f.noConseguidos.length) })
    n.on('click', () => { const w = BrowserWindow.getAllWindows()[0]; w?.show(); w?.focus() })
    n.show()
  }
  // el primer fin que se ve al abrir PAILA cuenta (NAPIA pudo terminar con PAILA cerrada); el primer mirar, apenas abre
  const t = setInterval(mirar, 3000)
  setTimeout(mirar, 1500)
  return () => clearInterval(t)
}

/** Las carpetas de datos de NAPIA, a partir de dónde puede estar su napia.json. */
export const carpetasDe = (jsons: string[]) => jsons.map((f) => path.dirname(f))
