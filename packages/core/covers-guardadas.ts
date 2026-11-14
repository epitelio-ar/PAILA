// Lo que encontró "Buscar tapas" (core/covers.ts) queda en la base (MASTERPLAN-5, 3.2): salís de la pestaña, volvés o cerrás PAILA, y
// las tapas encontradas siguen ahí, sin buscar de nuevo. Al leerlas se ponen al día con la música de hoy: lo que ya está para aplicar,
// lo que ya se puso, los discos que se movieron (Organizar) y los que dejaste como están ("Dejar como está", core/estado-dejar.ts).
import type { Db } from './db'
import { albumGroups } from './albums'
import { dejadosDe } from './estado-dejar'
import { guardarResultado, leerResultado } from './propuestas'
import type { CoverProposal } from '@paila/shared/types'

interface Guardadas { props: CoverProposal[]; sides: [number, number][] }

export function guardarTapas(db: Db, props: CoverProposal[], sides: Map<number, number>) {
  guardarResultado(db, 'tapas', { props, sides: [...sides] } satisfies Guardadas)
}

/** Lo último encontrado (con el lado de la tapa de cada tema, para saber dónde va), o null si nunca se buscó. */
export function tapasGuardadas(db: Db): { props: CoverProposal[]; sides: Map<number, number>; at: string } | null {
  const r = leerResultado<Guardadas>(db, 'tapas')
  return r ? { props: r.datos.props ?? [], sides: new Map(r.datos.sides ?? []), at: r.at } : null
}

/**
 * Las tapas encontradas, al día: cada disco con sus temas de hoy (aunque Organizar lo haya movido), si ya está para aplicar o ya se
 * puso después de buscar, y sin los discos que dejaste como están.
 */
export function tapasAlDia(db: Db, props: CoverProposal[], desde: string): CoverProposal[] {
  const temas = new Map<string, number[]>()
  for (const g of albumGroups(db, 2)) temas.set(g.key, [...(temas.get(g.key) ?? []), ...g.tracks.map((t) => t.id)])
  const dejados = dejadosDe(db, 'tapas')
  const pendiente = db.prepare("SELECT 1 FROM pending_changes WHERE file_id = ? AND field IN ('cover', 'folderCover') LIMIT 1")
  const puesta = db.prepare("SELECT 1 FROM journal WHERE file_id = ? AND field IN ('cover', 'folderCover') AND undone_at IS NULL AND applied_at >= ? LIMIT 1")
  const out: CoverProposal[] = []
  for (const p of props) {
    const ids = temas.get(p.key) ?? []
    if (ids.length && ids.every((id) => dejados.has(id))) continue
    const staged = !!p.proposed && ids.some((id) => pendiente.get(id))
    out.push({ ...p, ids, staged, puesta: !!p.proposed && !staged && ids.some((id) => puesta.get(id, desde)) })
  }
  return out
}
