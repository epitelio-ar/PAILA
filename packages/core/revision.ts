// La revisión única, "Ordenar" (MASTERPLAN-5, 2.2 y etapa 3): lee todo lo que está para aplicar y lo junta en grupos (repetidos,
// nombres y datos, de internet, tapas, a su carpeta), con lo destildado a la vista, y arma "Para decidir vos": los repetidos que se
// parecen solo por el nombre, los que irían al mismo lugar y los temas sin artista o título. Solo lee: lo suma core/revision-armar.ts.
import { visible, type Db } from './db'
import { isPlaceholder, isSite } from './names'
import type { Changes } from './changes'
import type { Organizer } from './organizer'
import { pendingRows } from './changes-meta'
import { propuestas } from './propuestas'
import { repetidosAlDia } from './repetidos-guardados'
import { dejadosDe, hayRegla, reglaElegida } from './estado-dejar'
import { formaDeLaBiblioteca, REGLA_ORDENAR } from './forma-actual'
import { apagados, claveCambio, claveProp } from './revision-apagados'
import { delNombre, idPorLugar, modoCarpetas, parPendiente, planOrdenar } from './revision-armar'
import { inRekordbox } from './rbmoving'
import { internetElegido } from './revision-internet'
import { GRUPOS_REVISION, type CartaRevision, type FilaRevision, type GrupoRevision, type OrganizePlan, type RevisionOrdenar } from '@paila/shared/types'

const TAPAS = new Set(['cover', 'folderCover'])
/** Lo que vino de internet (MusicBrainz, nombres oficiales): su propio grupo, para verlo aparte. */
const DE_INTERNET = new Set(['internet', 'oficial'])
/** Lo que no es de Ordenar (volumen, recortes, BPM…): sigue en la barra de arriba, pero no en estos grupos. */
const NOMBRES = new Set(['artist', 'title', 'album', 'albumArtist', 'year', 'genre', 'track', 'filename', 'extension', 'comment'])
/** Cuántas cartas de cada tipo se muestran de una (las demás aparecen al resolver estas). */
const TOPE_CARTAS = 60

/** `plan`: la cuenta de las carpetas que se acaba de hacer al armar (así no se hace dos veces: ~1 s con 5.000 temas). */
export function leerRevision(db: Db, changes: Changes, organizer: Organizer, plan?: OrganizePlan | null): RevisionOrdenar {
  const off = apagados(db)
  const grupos = Object.fromEntries(GRUPOS_REVISION.map((g) => [g, [] as FilaRevision[]])) as Record<GrupoRevision, FilaRevision[]>
  const rel = db.prepare('SELECT rel_path AS r FROM files WHERE id = ?')

  for (const p of propuestas(db)) {
    if (p.tipo === 'reemplazo') continue // las copias mejores (Sonido) van en la barra de arriba y en Sonido, no en estos grupos
    const clave = claveProp(p.fileId, p.tipo)
    const queda = p.dato.kept != null ? (rel.get(p.dato.kept) as { r: string } | undefined)?.r ?? null : null
    grupos[p.tipo === 'papelera' ? 'rep' : 'mov'].push({ clave, fileId: p.fileId, rel: p.rel, campo: p.tipo, antes: p.tipo === 'mover' ? p.rel : queda,
      despues: p.despues, on: !off.has(clave), ...(p.error ? { error: p.error } : {}) })
  }
  // los cambios de tags: el texto de la lista (las tapas, en palabras) y de dónde vino cada uno
  const origen = new Map(pendingRows(db).map((r) => [r.id, r.source]))
  for (const c of changes.list()) {
    const g: GrupoRevision | null = TAPAS.has(c.field) ? 'tap' : !NOMBRES.has(c.field) ? null : DE_INTERNET.has(origen.get(c.id) ?? '') ? 'net' : 'nom'
    if (!g) continue
    const clave = claveCambio(c.fileId, c.field)
    grupos[g].push({ clave, fileId: c.fileId, rel: c.rel, campo: c.field, antes: c.before, despues: c.after, on: !off.has(clave), ...(c.error ? { error: c.error } : {}) })
  }

  const carpetas = modoCarpetas(db)
  // la primera vez se propone la forma que ya tienen tus carpetas, no la de fábrica (948 temas se renombraban, 13/11)
  const formaHoy = carpetas === null && !hayRegla(db) ? formaDeLaBiblioteca(db) : null
  const regla = formaHoy ?? (hayRegla(db) ? reglaElegida(db) : REGLA_ORDENAR)
  const pares = cartasPar(db)
  // dos que irían al mismo lugar y ya están como "¿son el mismo tema?": se pregunta una vez (al decidir el par se resuelve el choque)
  const enPar = new Set(pares.flatMap((c) => (c.tipo === 'par' ? c.items.map((i) => c.clave + '|' + i.id) : [])))
  const yaPreguntado = (c: CartaRevision) => c.tipo === 'choque' && c.conId != null && pares.some((p) => enPar.has(p.clave + '|' + c.fileId) && enPar.has(p.clave + '|' + c.conId))
  const cuenta = carpetas === 'regla' ? plan ?? planOrdenar({ db, organizer }) : null
  const choques = cuenta ? cartasChoque(db, cuenta).filter((c) => !yaPreguntado(c)) : []
  const decidir = [...pares, ...choques, ...cartasQuien(db, cuenta)]
  const listos = GRUPOS_REVISION.reduce((n, g) => n + grupos[g].filter((f) => f.on && !f.error).length, 0)
  const enRekordbox = carpetas === 'regla' ? inRekordbox(db, grupos.mov.filter((f) => f.on).map((f) => f.fileId)) : 0
  return { grupos, decidir, carpetas, regla, formaHoy, listos, enRekordbox, internet: { elegido: internetElegido(db), buscando: false } }
}

/** Repetidos que se parecen solo por el nombre (o perdieron la copia que se quedaba): se escuchan y se decide. */
function cartasPar(db: Db): CartaRevision[] {
  const out: CartaRevision[] = []
  for (const g of repetidosAlDia(db)?.grupos ?? []) {
    if (!parPendiente(g)) continue
    out.push({ tipo: 'par', clave: `par|${g.items.map((i) => i.id).join(',')}`, keep: g.keep, porQue: g.warning ?? g.why,
      items: g.items.map((i) => ({ id: i.id, rel: i.rel, kbps: i.kbps, duration: i.duration, grade: i.grade })) })
    if (out.length >= TOPE_CARTAS) break
  }
  return out
}

/** Dos temas que irían al mismo lugar: ninguno se mueve hasta decidir (riesgo 3). Lo ya resuelto ("los dos, con (2)") no vuelve. */
function cartasChoque(db: Db, plan: OrganizePlan): CartaRevision[] {
  const resueltos = new Set(propuestas(db, 'mover').filter((p) => p.dato.choque).map((p) => p.fileId))
  const dejados = dejadosDe(db, 'carpetas')
  return (plan.clashes ?? []).filter((c) => !resueltos.has(c.fileId) && !dejados.has(c.fileId)).slice(0, TOPE_CARTAS)
    .map((c) => ({ tipo: 'choque', clave: `choque|${c.fileId}`, fileId: c.fileId, rel: c.from, conId: idPorLugar(db, c.with), con: c.with, destino: c.to }))
}

/** Los stems sueltos de otro programa ("VOCALS_130BPM_CMajor_DEM4_….mp3", de Demucs): no son temas para preguntar de quién son. */
const STEM = /^(?:no_)?(?:vocals|drums|bass|other|instrumental|acapella|piano|guitar)_\d{2,3}bpm_/i
/** Un artista o título que no sirve: vacío, "Unknown Artist", "Track11" o una página ("y2mate.com"), como para Organizar. */
const noSirve = (v: string | null) => !v?.trim() || isSite(v) || isPlaceholder(v)

/**
 * Lo que Organizar no puede ordenar y nada de lo que está para aplicar arregla: sin artista o título que sirvan, o varios temas con
 * los mismos tags (`cuenta.skipped`, "AL046" / "KAS:ST"). El nombre del archivo puede decir quién es (corrida supervisada, 13/11).
 */
function cartasQuien(db: Db, cuenta: OrganizePlan | null): CartaRevision[] {
  const dejados = dejadosDe(db, 'nombres')
  const mismos = new Set((cuenta?.skipped ?? []).filter((s) => s.motivo === 'mismosTags').map((s) => s.fileId))
  const filas = db.prepare(`SELECT f.id, f.rel_path AS rel, f.artist, f.title FROM files f WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica'
      AND NOT EXISTS (SELECT 1 FROM pending_changes p WHERE p.file_id = f.id AND p.field IN ('artist', 'title'))
      AND NOT EXISTS (SELECT 1 FROM propuestas p WHERE p.file_id = f.id AND p.tipo = 'papelera')
    ORDER BY f.rel_path`).all() as { id: number; rel: string; artist: string | null; title: string | null }[]
  return filas.filter((f) => !dejados.has(f.id) && !STEM.test(f.rel.slice(f.rel.lastIndexOf('/') + 1)) && (noSirve(f.artist) || noSirve(f.title) || mismos.has(f.id)))
    .slice(0, TOPE_CARTAS)
    .map((f) => ({ tipo: 'quien', clave: `quien|${f.id}`, fileId: f.id, rel: f.rel, sugerido: delNombre(f.rel) }))
}
