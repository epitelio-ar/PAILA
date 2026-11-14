// Los grupos de repetidos quedan en la base (MASTERPLAN-5, 3.2): los arma Duplicados al buscar, o el estado de la colección cuando el
// análisis termina (core/estado.ts). Salís de Duplicados y volvés, y la lista sigue ahí, sin buscar de nuevo. Al leerla se pone al día:
// lo que ya se fue a la papelera o ya no está sale; un grupo con un archivo que cambió desde la búsqueda (lo editaste, se reemplazó)
// no se muestra, porque esa comparación ya no vale (se cuenta en `cambiaron`, para buscar de nuevo); los grupos que dejaste como
// están no vuelven; y cada grupo dice qué copia se queda en lo que ya está para aplicar.
import type { Db } from './db'
import { dejadosDe } from './estado-dejar'
import { guardarResultado, leerResultado, propuestas } from './propuestas'
import type { DupGroup } from '@paila/shared/types'

interface Guardados { grupos: DupGroup[]; versiones: Record<number, [number, number]> }

export function guardarRepetidos(db: Db, grupos: DupGroup[]) {
  const ver = db.prepare('SELECT size, mtime FROM files WHERE id = ?')
  const versiones: Guardados['versiones'] = {}
  for (const g of grupos) for (const i of g.items) { const v = ver.get(i.id) as { size: number; mtime: number } | undefined; if (v) versiones[i.id] = [v.size, v.mtime] }
  guardarResultado(db, 'repetidos', { grupos, versiones } satisfies Guardados)
}

/** Lo último encontrado, al día con la música de hoy; null si nunca se buscó. */
export function repetidosAlDia(db: Db): { grupos: DupGroup[]; at: string; cambiaron: number } | null {
  const r = leerResultado<Guardados>(db, 'repetidos')
  if (!r) return null
  const hoy = db.prepare('SELECT size, mtime, trashed_at AS t, missing_at AS m FROM files WHERE id = ?')
  const escribio = db.prepare('SELECT 1 FROM journal WHERE file_id = ? AND applied_at >= ? LIMIT 1')
  const dejados = dejadosDe(db, 'repetidos')
  const queda = new Map(propuestas(db, 'papelera').map((p) => [p.fileId, p.dato.kept ?? null]))
  const grupos: DupGroup[] = []
  let cambiaron = 0
  for (const g of r.datos.grupos ?? []) {
    let cambio = false
    const items = g.items.filter((i) => {
      const f = hoy.get(i.id) as { size: number; mtime: number; t: string | null; m: string | null } | undefined
      if (!f || f.t || f.m) return false
      const v = r.datos.versiones?.[i.id]
      // lo que escribió PAILA misma (nombres, tags, tapas) no cambia el sonido: la comparación sigue valiendo
      if (v && (v[0] !== f.size || Math.abs(v[1] - f.mtime) > 2000) && !escribio.get(i.id, r.at)) cambio = true
      return true
    })
    if (cambio) { cambiaron++; continue }
    if (items.length < 2 || items.every((i) => dejados.has(i.id))) continue
    // si la copia que se quedaba ya no está, el grupo pasa a decidirlo vos
    const keep = g.keep != null && items.some((i) => i.id === g.keep) ? g.keep : null
    const elegido = items.map((i) => queda.get(i.id)).find((k) => k != null)
    grupos.push({ ...g, items, keep, ...(g.keep != null && keep == null ? { decidir: true } : {}), ...(elegido != null ? { propuesto: elegido } : {}) })
  }
  return { grupos, at: r.at, cambiaron }
}
