// Lo que llega entra al Aplicar único (MASTERPLAN-5, 2.4 y etapa 5): una copia mejor que la Bandeja reconoció y verificó (la misma vara de
// siempre: core/inboxflow.ts) queda propuesta sola, "PAILA propone → vos aplicás → podés deshacer". Va en la barra de arriba con todo
// lo demás y se aplica al final del Aplicar (core/aplicar.ts): la copia nueva hereda los nombres, los tags, el lugar y la tapa que ese
// mismo Aplicar le acaba de poner al tema. Cada reemplazo es el de siempre (papelera, tags, tapa, nombre, playlists); juntos son una
// parte de la tanda del Historial y se deshacen con ella (core/history-cadena.ts). Tests: tests/sonido-reemplazos.test.ts.
import fs from 'node:fs'
import type { Db } from './db'
import { USED_DIR, type InboxFlow } from './inboxflow'
import type { Replacer } from './replace'
import type { Wanted } from './wanted'
import { proponerReemplazos, sacarPropuestas, type Propuesta } from './propuestas'
import { fraseLlegada } from '@paila/shared/frases-calidad'
import type { InboxResult } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

const T = textos({
  yaNoEsta: { es: 'El archivo que llegó ya no está en la Bandeja', en: "The file that arrived isn't in the Inbox anymore" },
  cambio: { es: 'El archivo que llegó cambió desde que PAILA lo revisó: se revisa de nuevo', en: 'The file that arrived changed since PAILA checked it: it gets checked again' },
  sinBandeja: { es: 'No hay carpeta de Bandeja', en: "There's no Inbox folder" },
})

/** Lo que la Bandeja dice hoy que se puede reemplazar (la simulación de "Reemplazar todos") queda propuesto; lo que ya no, sale. */
export function proponerDeLaBandeja(db: Db, flow: InboxFlow, carpeta: string | null): number {
  if (!carpeta) return proponerReemplazos(db, [])
  const plan = flow.plan(carpeta)
  return proponerReemplazos(db, plan.replace.map((p) => {
    const r = flow.cached(p.path)
    return { fileId: p.fileId, archivo: p.path, despues: p.newRel, frase: fraseLlegada(r ?? { decision: 'reemplazar', check: null, ext: p.newRel.split('.').pop() ?? '' }) }
  }))
}

/** ¿El archivo que llegó sigue siendo el que se revisó y para ese tema? (Sin mirar el tema de la biblioteca: lo pudo cambiar este Aplicar.) */
function sigueValiendo(db: Db, p: Propuesta): string | null {
  const archivo = p.dato.archivo ?? ''
  let st: fs.Stats
  try { st = fs.statSync(archivo) } catch { return T.yaNoEsta }
  const r = db.prepare('SELECT size, mtime, result FROM inbox_items WHERE path = ?').get(archivo) as { size: number; mtime: number; result: string } | undefined
  if (!r || r.size !== st.size || r.mtime !== Math.round(st.mtimeMs)) return T.cambio
  const res = JSON.parse(r.result) as InboxResult
  return res.decision === 'reemplazar' && res.match?.fileId === p.fileId ? null : T.cambio
}

export interface ReemplazarDeps { db: Db; flow: InboxFlow; replacer: Replacer; wanted: Wanted; carpeta: () => string | null }
type Avance = { done: number; total: number; current: string; errors: number }
export interface ResultadoReemplazos { hechos: number; tanda: number | null; failed: { p: Propuesta; error: string }[] }

/**
 * Aplica los reemplazos propuestos (llamar con el candado tomado y el análisis en pausa, como todo el Aplicar). Todos van a la misma tanda
 * del Historial (`sonido-<hora>`); `tanda` es el número del primero, el que usa el Historial para nombrar la tanda.
 */
export async function aplicarReemplazos(d: ReemplazarDeps, props: Propuesta[], avance?: (p: Avance) => void, isCancelled?: () => boolean): Promise<ResultadoReemplazos> {
  const out: ResultadoReemplazos = { hechos: 0, tanda: null, failed: [] }
  const carpeta = d.carpeta()
  const batch = `sonido-${Date.now()}`
  for (const [i, p] of props.entries()) {
    if (isCancelled?.()) break
    avance?.({ done: i, total: props.length, current: p.rel, errors: out.failed.length })
    if (!carpeta) { out.failed.push({ p, error: T.sinBandeja }); continue }
    const motivo = sigueValiendo(d.db, p)
    if (motivo) { out.failed.push({ p, error: motivo }); continue }
    try {
      const r = await d.replacer.replace(p.fileId, p.dato.archivo!, { keepTags: true, keepCover: true, sameName: true, batch })
      out.tanda ??= r.replacementId
      const usado = await d.flow.moveDone(carpeta, p.dato.archivo!, USED_DIR)
      d.wanted.replaced(p.fileId, r.replacementId, usado)
      sacarPropuestas(d.db, { ids: [p.id] })
      out.hechos++
    } catch (e) { out.failed.push({ p, error: (e as Error).message }) }
  }
  return out
}
