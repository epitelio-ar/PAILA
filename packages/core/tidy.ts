// Asistente "Arreglar nombres y tags": junta las acciones de tagactions en un recorrido guiado sobre toda la Música.
// Completa lo que falta, limpia basura obvia y unifica cómo se escriben los nombres. Lo que propone pasa por Cambios pendientes.
// Lo que no se puede decidir con seguridad (un nombre que parece al revés, un enganchado de una hora) NO se propone:
// queda en la lista "para mirar a mano" con el motivo. Las reglas de texto están en names.ts.
// Cómo se escriben los nombres depende del perfil elegido (Mínimo, Prolijo, Estricto: shared/tidy-profiles.ts); lo que
// completa desde el nombre del archivo lo completa siempre bien leído. Los sets largos no se tocan: se proponen para la
// colección "Sets y en vivo" (core/sets.ts). El último paso borra del tag el BPM y el tono que seguro están mal (core/tidy-djtag.ts).
import { allRows, transaction, visible, type Db } from './db'
import { setReason } from './sets'
import { DEFAULT_PROFILE, PROFILES, profileOf, rulesOf, type TidyRule } from '@paila/shared/tidy-profiles'
import type { Proposal } from './tagactions'
import { cantWrite, type TagField } from './tagio'
import { fillFromFilenames } from './tidy-filename'
import { applyStyle, blank, cleanFilenames, cleanJunk, fillFromFolders, fixBroken, fixExtensions, markUnderscores } from './tidy-steps'
import { applyDictionary, applyOfficial } from './tidy-official'
import { applyLearned, learnedFor } from './tidy-learned'
import { cleanDjTags } from './tidy-djtag'
import { inRekordbox } from './rbmoving'; import { dejadosDe } from './estado-dejar'
import { motivo, pisa, puestos, retenidos, type Origen } from './confianza'
import { sinApagarProp } from './revision-apagados'
import type { Completeness, LearnedWord, TidyProfileCount, TidyReview, TidySet } from '@paila/shared/types'
import { cant, fecha, textos } from '@paila/shared/idioma'

export type TidyStep = 'mojibake' | 'filename' | 'junk' | 'style' | 'official' | 'folder' | 'extension' | 'filenames' | 'djtags'
// lo que dice cada paso en la pantalla ("Varios Artistas" queda igual: es lo que se escribe en el tag)
const STEP_LABEL: Record<TidyStep, string> = textos({
  mojibake: { es: 'Arreglar caracteres rotos (GarcÃ­a → García)', en: 'Fix broken characters (GarcÃ­a → García)' },
  filename: { es: 'Sacar artista, título y n.º de tema del nombre del archivo (solo donde faltan)', en: 'Take the artist, title and track number from the file name (only where they are missing)' },
  junk: { es: 'Limpiar basura de YouTube y sitios de descarga ([HD], (Official Video), www.sitio.com) y el artista repetido en el título', en: 'Clean up junk from YouTube and download sites ([HD], (Official Video), www.site.com) and the artist repeated in the title' },
  style: { es: 'Cómo se escriben los nombres, según el perfil elegido (las reglas están arriba)', en: 'How names are written, according to the chosen profile (the rules are above)' },
  official: { es: 'Nombres oficiales de internet (perfil Oficial): artistas y títulos como figuran en MusicBrainz, Deezer y Discogs, y temas sin nombre reconocidos por el sonido (AcoustID)', en: 'Official names from the internet (Official profile): artists and titles as they appear in MusicBrainz, Deezer and Discogs, and tracks with no name recognized by their sound (AcoustID)' },
  folder: { es: 'Completar álbum, año y artista desde carpetas que son álbumes (solo donde faltan) y marcar los compilados como "Varios Artistas"', en: 'Fill in album, year and artist from folders that are albums (only where they are missing) and mark compilations as "Varios Artistas"' },
  extension: { es: 'Corregir extensiones equivocadas (un .mp3 que por dentro es WAV o M4A): sin esto no se le pueden escribir tags', en: 'Fix wrong extensions (an .mp3 that is really a WAV or M4A inside): without this, tags cannot be written to it' },
  filenames: { es: 'Limpiar los nombres de archivo: sacar la misma basura ([www.slider.kz], (Official Video)…) del nombre del archivo, sin tocar la extensión ni los sample packs', en: 'Clean up file names: remove the same junk ([www.slider.kz], (Official Video)…) from the file name, without touching the extension or sample packs' },
  djtags: { es: 'Borrar del tag el BPM y el tono que seguro están mal (un BPM de 0 o de 19188, el mismo BPM en todo un disco que no se parece a lo que mide PAILA, un tono que no se puede leer). No se escribe lo que mide PAILA: solo se saca lo que sobra', en: 'Remove from the tag the BPM and key that are surely wrong (a BPM of 0 or 19188, the same BPM across a whole album that does not look like what PAILA measures, a key that cannot be read). What PAILA measures is not written: only what does not belong is removed' },
})
const T = textos({
  enRekordbox: {
    es: (n: number) => `${n} de estos temas ya se exportaron a Rekordbox: después de renombrarlos, Rekordbox los va a mostrar como perdidos hasta que los relocalices o vuelvas a importar el rekordbox.xml.`,
    en: (n: number) => `${cant(n, 'of these tracks was', 'of these tracks were')} already exported to Rekordbox: after renaming them, Rekordbox will show them as missing until you relocate them or import the rekordbox.xml again.`,
  },
})

/** 'bpm' y 'key' = el BPM y el tono del tag (core/djtag.ts): el paso 'djtags' solo los borra (`to` vacío). */
export type TidyField = TagField | 'filename' | 'extension' | 'bpm' | 'key'
export interface TidyChange { id: number; rel: string; field: TidyField; from: string | null; to: string; step: TidyStep; note?: string; rules?: TidyRule[] }
type Example = { rel: string; field: TidyField; from: string | null; to: string }
export interface TidyReport {
  steps: { key: TidyStep; label: string; count: number; tracks: number; examples: Example[]; warning?: string; detail?: string }[]
  leftover: { count: number; sample: string[] }
  review: TidyReview[]
  /** Cuántos de "para mirar a mano" se dejaron como están (no se muestran). */
  kept: number
  sets: TidySet[]
  /** Cambios por regla del perfil (cuánto hace cada una, con ejemplos de la propia biblioteca). */
  byRule: Partial<Record<TidyRule, { count: number; examples: Example[] }>>
  before: Completeness
  after: Completeness
  changes: TidyChange[]
}

/** Un tema de Música tal como lo lee el asistente. */
export interface TidyRow { id: number; rel: string; ext: string; codec: string | null; duration: number | null; artist: string | null; albumArtist: string | null; title: string | null; album: string | null; track: string | null; year: string | null; genre: string | null }

/** Lo que comparten los pasos del asistente (core/tidy-steps.ts y core/tidy-filename.ts). */
export interface TidyCtx {
  db: Db
  rows: TidyRow[]
  steps: Set<TidyStep>
  on: Set<TidyRule>
  /** Los temas como estaban. */
  byId: Map<number, TidyRow>
  /** Los temas como van quedando con lo propuesto. */
  cur: Map<number, TidyRow>
  changes: TidyChange[]
  review: TidyReview[]
  /** Temas largos que parecen sets: no se les inventa "Artista - Título". */
  isSet: Set<number>
  /** Valor actual (con lo propuesto) de un campo. */
  val: (id: number, f: TagField) => string | null
  /** Propone un valor (si ya había uno propuesto para ese campo, lo reemplaza y junta las notas y las reglas). */
  setField: (r: TidyRow, f: TagField, v: string, step: TidyStep, note?: string, rule?: TidyRule | TidyRule[]) => void
  /** Algo dudoso: no se propone, solo se avisa en "para mirar a mano". */
  doubt: (r: TidyRow, f: TagField, v: string, why: string, origin?: 'oficial') => void
  /** Lo que completó PAILA en una tanda grande (clave "id|campo"). */
  authored: Map<string, { value: string; date: string }>
  /** ¿Ese campo lo completó PAILA y nadie lo cambió después? Entonces se recalcula. */
  pailas: (id: number, f: TagField) => boolean
  /** Las palabras que PAILA aprendió a sacar (regla `aprendidas`, core/junkwords.ts), prendidas. */
  learned: LearnedWord[]
  /** Temas de vinilo que encontró la regla `vinilo` (con la cara, si se sabe): tidy() los guarda en la tabla `vinyl`. */
  vinyl: Map<number, { side: string | null; foundIn: string }>
}

function complete(rows: TidyRow[]): Completeness {
  const c = (f: TagField) => rows.filter((r) => !blank(r[f as keyof TidyRow] as string | null)).length
  return { total: rows.length, artist: c('artist'), title: c('title'), album: c('album'), year: c('year'), genre: c('genre') }
}

/** Clave de algo "para mirar a mano" que la persona decidió dejar como está (se guarda en `settings`). */
export const keepKey = (x: { id: number; field: string; from: string | null }) => `${x.id}|${x.field}|${x.from ?? ''}`
const KEPT_SETTING = 'tidy.dejar'

/**
 * `pathOf` hace falta solo para el paso de extensiones (mira los primeros bytes de los archivos sospechosos).
 * `rules`: las reglas del perfil de nombres (por defecto, el perfil Prolijo, que respeta las mayúsculas).
 */
export function tidy(db: Db, onlySteps?: TidyStep[], pathOf?: (id: number) => string | null, rules?: Iterable<TidyRule>): TidyReport {
  // objetos comunes (allRows): cada paso los recorre entero y se copian una vez por pasada. Lo que dejaste como está (core/estado-dejar.ts)
  // y lo que va a la papelera (core/propuestas.ts) no se propone
  const fuera = new Set([...dejadosDe(db, 'nombres'), ...(db.prepare(`SELECT file_id AS id FROM propuestas p WHERE tipo = 'papelera' AND ${sinApagarProp('p')}`).all() as { id: number }[]).map((r) => r.id)])
  const rows = allRows<TidyRow>(db,
    `SELECT id, rel_path AS rel, ext, codec, duration, artist, album_artist AS albumArtist, title, album, track, year, genre FROM files WHERE ${visible()} AND error IS NULL AND kind = 'musica' ORDER BY rel_path`).filter((r) => !fuera.has(r.id))
  const steps = new Set<TidyStep>(onlySteps ?? ['mojibake', 'filename', 'junk', 'style', 'official', 'folder', 'extension', 'filenames', 'djtags'])
  const on = new Set<TidyRule>(rules ?? rulesOf(DEFAULT_PROFILE))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const cur = new Map(rows.map((r) => [r.id, { ...r }]))
  const changes: TidyChange[] = []
  const review: TidyReview[] = []
  // los sets largos ("ENGANCHADO PREVIA #19 _ SET LIVE", un recital de una hora): no se les inventa "Artista - Título"
  const sets: TidySet[] = []
  for (const r of rows) { const why = setReason(r.rel, r.duration, r); if (why) sets.push({ id: r.id, rel: r.rel, minutes: Math.round((r.duration ?? 0) / 60), why }) }
  const isSet = new Set(sets.map((x) => x.id))
  const val = (id: number, f: TagField) => (cur.get(id)![f as keyof TidyRow] as string | null) ?? null
  // dónde está en `changes` lo propuesto para cada "id|campo" (buscarlo en la lista entera era lento con 100.000 temas)
  const changeAt = new Map<string, number>()
  const setField = (r: TidyRow, f: TagField, v: string, step: TidyStep, note?: string, rule?: TidyRule | TidyRule[]) => {
    const add = rule == null ? [] : Array.isArray(rule) ? rule : [rule]
    const c = cur.get(r.id)!
    if (val(r.id, f) === v) return
    ;(c as Record<string, unknown>)[f] = v
    const key = `${r.id}|${f}`
    const prev = changeAt.get(key) ?? -1
    const rs = (old?: TidyRule[]) => (add.length ? [...new Set([...(old ?? []), ...add])] : old)
    if (prev >= 0) {
      const p = changes[prev], merged = rs(p.rules)
      // si el paso oficial lo toca, el cambio es oficial (más confianza que las reglas: core/confianza.ts)
      changes[prev] = { ...p, to: v, ...(step === 'official' ? { step } : {}), note: [p.note, note].filter(Boolean).join(' · ') || undefined, ...(merged ? { rules: merged } : {}) }
    } else changeAt.set(key, changes.push({ id: r.id, rel: r.rel, field: f, from: (byId.get(r.id)![f as keyof TidyRow] as string | null) ?? null, to: v, step, ...(note ? { note } : {}), ...(add.length ? { rules: add } : {}) }) - 1)
  }
  // lo dudoso no entra en los cambios (ni en lo que ven los pasos siguientes): solo se avisa
  const doubt = (r: TidyRow, f: TagField, v: string, why: string, origin?: 'oficial') => review.push({ id: r.id, rel: r.rel, field: f, from: val(r.id, f), to: v, why, staged: false, ...(origin ? { origin } : {}) })
  // Lo que completó PAILA misma en una tanda grande (este asistente, no una edición a mano), sobre un tag que estaba vacío y que
  // nadie cambió después, se vuelve a calcular: así se arreglan los errores que dejaron las reglas viejas (el 19/10/2026, "33"
  // en vez de "3.33" o "y2mate.com" como artista).
  const authored = byPaila(db)
  const pailas = (id: number, f: TagField) => { const a = authored.get(`${id}|${f}`); return !!a && a.value === val(id, f) }
  const learned = on.has('aprendidas') && (steps.has('junk') || steps.has('filenames')) ? learnedFor(db) : []
  const vinyl: TidyCtx['vinyl'] = new Map()
  const c: TidyCtx = { db, rows, steps, on, byId, cur, changes, review, isSet, val, setField, doubt, authored, pailas, learned, vinyl }

  if (steps.has('mojibake')) fixBroken(c)
  if (steps.has('filename')) fillFromFilenames(c)
  if (steps.has('junk')) cleanJunk(c)
  if (steps.has('junk')) applyLearned(c)
  if (steps.has('style')) applyStyle(c)
  if (steps.has('style') && on.has('diccionario')) applyDictionary(c) // después del estilo: lo que eligió el usuario manda
  if (steps.has('official') && on.has('oficial')) applyOfficial(c)
  if (steps.has('folder')) fillFromFolders(c)
  if (steps.has('extension') && pathOf) fixExtensions(c, pathOf)
  markUnderscores(c)
  const inRekordbox = steps.has('filenames') ? cleanFilenames(c) : 0
  const djDetail = steps.has('djtags') ? cleanDjTags(c) : undefined
  saveVinyl(db, vinyl)

  // se descartan cambios que terminan igual que el original (por ejemplo limpiar y volver). Y a un WMA o un WebM (aunque se llame
  // .mp3) no se le escriben tags: lo propuesto va a "para mirar a mano", trabado y con el motivo, en vez de fallar al aplicar
  // (punto 1 real del 24/10); cambiarle el nombre al archivo sí se puede
  const noWrite = new Map<number, string | null>()
  const cant = (id: number) => { if (!noWrite.has(id)) noWrite.set(id, cantWrite(byId.get(id)!, () => pathOf?.(id) ?? null)); return noWrite.get(id)! }
  // El orden de confianza (DECISIONES 27/10): lo que puso la persona a mano, Completar desde internet o el paso oficial no lo pisan
  // las reglas sin preguntar; va a "para mirar a mano" con quién lo puso. Se muestra aunque haya algo pendiente para ese dato.
  const origenes = puestos(db)
  const hoyDe = (id: number, f: string): string | null => {
    const r = byId.get(id)
    if (!r) return null
    return f === 'filename' ? r.rel.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, '') : ((r[f as keyof TidyRow] as string | null) ?? null)
  }
  const choques: TidyReview[] = []
  const final = changes.filter((c) => (c.from ?? '') !== c.to).filter((c) => {
    const no = c.field === 'filename' || c.field === 'extension' ? null : cant(c.id)
    if (no) review.push({ id: c.id, rel: c.rel, field: c.field, from: c.from, to: c.to, why: no, staged: false, blocked: true })
    if (no) return false
    const ya = origenes.get(`${c.id}|${c.field}`)
    if (ya && (ya.pendiente || (ya.valor ?? '') === (hoyDe(c.id, c.field) ?? '')) && (ya.valor ?? null) !== c.to && !pisa(origenDe(c), ya.origen)) {
      choques.push({ id: c.id, rel: c.rel, field: c.field, from: ya.valor, to: c.to, why: motivo(ya.origen, ya.valor), staged: false })
      return false
    }
    return true
  })
  for (const c of final) if (c.note) review.push({ id: c.id, rel: c.rel, field: c.field, from: c.from, to: c.to, why: c.note, staged: true })
  // de "para mirar a mano" se sacan los que la persona ya decidió: dejarlos como están, o aceptados (ya en Cambios pendientes)
  const kept = keptKeys(db)
  const pending = new Set((db.prepare('SELECT file_id AS id, field FROM pending_changes').all() as { id: number; field: string }[]).map((p) => `${p.id}|${p.field}`))
  const keptIds = new Set<number>()
  const shown = review.filter((x) => {
    if (x.staged) return true
    if (kept.has(keepKey(x))) { keptIds.add(x.id); return false }
    return !pending.has(`${x.id}|${x.field}`)
  })
  // lo que otras herramientas quisieron cambiar sobre un dato de más confianza (Completar desde internet, Géneros: core/confianza.ts)
  const retenido = retenidos(db, (id, f) => (byId.has(id) ? hoyDe(id, f) : undefined))
  const yaEsta = new Set(choques.map((x) => `${x.id}|${x.field}|${x.to}`))
  review.length = 0
  review.push(...shown, ...[...choques, ...retenido.filter((x) => !yaEsta.has(`${x.id}|${x.field}|${x.to}`))].filter((x) => !kept.has(keepKey(x))))
  const byRule: TidyReport['byRule'] = {}
  for (const c of final) for (const k of c.rules ?? []) {
    const e = byRule[k] ?? (byRule[k] = { count: 0, examples: [] })
    e.count++
    if (e.examples.length < 3) e.examples.push({ rel: c.rel, field: c.field, from: c.from, to: c.to })
  }
  const leftover = [...cur.values()].filter((c) => !isSet.has(c.id) && (blank(c.artist) || blank(c.title)))
  const afterRows = [...cur.values()]
  const stepReport = (Object.keys(STEP_LABEL) as TidyStep[]).filter((k) => steps.has(k) && (k !== 'official' || on.has('oficial'))).map((k) => {
    const cs = final.filter((c) => c.step === k)
    const warning = k === 'filenames' && inRekordbox
      ? T.enRekordbox(inRekordbox)
      : undefined
    const detail = k === 'djtags' ? djDetail : undefined
    return { key: k, label: STEP_LABEL[k], count: cs.length, tracks: new Set(cs.map((c) => c.id)).size, examples: cs.slice(0, 5).map((c) => ({ rel: c.rel, field: c.field, from: c.from, to: c.to })), ...(warning ? { warning } : {}), ...(detail ? { detail } : {}) }
  })
  review.sort((a, b) => Number(a.staged) - Number(b.staged) || a.rel.localeCompare(b.rel))
  return {
    steps: stepReport, leftover: { count: leftover.length, sample: leftover.slice(0, 12).map((c) => c.rel) }, review, kept: keptIds.size, sets, byRule,
    before: complete(rows), after: complete(afterRows), changes: final,
  }
}

/**
 * La marca "vinilo" (tabla `vinyl`): el dato que la regla `vinilo` saca del nombre no se pierde. Es un dato de PAILA, no un
 * cambio en el archivo: se guarda al mirar (antes de aplicar, que es cuando el nombre todavía lo dice). La cara que ya estaba
 * no se pisa con "no se sabe". Con la base de solo lectura (una corrida de prueba) no se guarda.
 */
export function saveVinyl(db: Db, marks: Map<number, { side: string | null; foundIn: string }>) {
  if (!marks.size) return
  try {
    const st = db.prepare(`INSERT INTO vinyl (file_id, side, found_in, at) VALUES (?, ?, ?, ?)
      ON CONFLICT (file_id) DO UPDATE SET side = COALESCE(excluded.side, vinyl.side)`)
    const at = new Date().toISOString()
    transaction(db, () => { for (const [id, m] of marks) st.run(id, m.side, m.foundIn, at) })
  } catch { /* base de solo lectura */ }
}

/** Temas de vinilo: la cara, o null si no se sabe; undefined si no es de vinilo (o no se sabe). */
export function vinylOf(db: Db, id: number): string | null | undefined {
  try { const r = db.prepare('SELECT side FROM vinyl WHERE file_id = ?').get(id) as { side: string | null } | undefined; return r ? r.side : undefined } catch { return undefined }
}

/** Lo que la persona dejó como está en "para mirar a mano" (claves de `keepKey`). */
export function keptKeys(db: Db): Set<string> {
  try {
    const v = (db.prepare('SELECT value FROM settings WHERE key = ?').get(KEPT_SETTING) as { value: string } | undefined)?.value
    return new Set(v ? (JSON.parse(v) as string[]) : [])
  } catch { return new Set() }
}
/** Guarda (o, con `keys` vacío, borra) lo que se dejó como está. */
export function setKept(db: Db, keys: Iterable<string>) {
  const all = [...new Set(keys)]
  if (!all.length) db.prepare('DELETE FROM settings WHERE key = ?').run(KEPT_SETTING)
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEPT_SETTING, JSON.stringify(all))
}

/**
 * Tags que completó PAILA en tandas grandes (20 cambios o más: el asistente, no una edición a mano) donde antes no había nada.
 * Clave "id|campo" → el último valor que escribió y la fecha. Si después alguien lo cambió, no vale (se compara con el actual).
 */
function byPaila(db: Db): Map<string, { value: string; date: string }> {
  const out = new Map<string, { value: string; date: string }>()
  try {
    const rows = db.prepare(
      `SELECT file_id AS id, field, after, applied_at AS at FROM journal
       WHERE undone_at IS NULL AND field IN ('artist', 'title', 'track') AND (before IS NULL OR trim(before) = '') AND after IS NOT NULL
         AND batch_id IN (SELECT batch_id FROM journal GROUP BY batch_id HAVING COUNT(*) >= 20)
       ORDER BY id`,
    ).all() as { id: number; field: string; after: string; at: string }[]
    // la fecha en palabras, una vez por tanda: armarla en cada fila llevaba más de medio segundo con 5.000 temas (Ordenar, 13/11)
    const dias = new Map<string, string>()
    const dia = (at: string) => dias.get(at) ?? dias.set(at, fecha(at, { day: 'numeric', month: 'numeric' })).get(at)!
    for (const r of rows) out.set(`${r.id}|${r.field}`, { value: r.after, date: dia(r.at) })
  } catch { /* base sin diario */ }
  return out
}

/**
 * Lo que muestra la pantalla apenas se abre: el informe con las reglas elegidas. De los perfiles, solo el elegido (sin los
 * ejemplos de lo que agrega): los demás los cuenta `tidyProfiles` después, en un hilo aparte (core/tidyworker.ts), porque
 * cada uno es una pasada entera (~6 s con 100.000 temas). `changes` es lo que propone el perfil elegido, para no recalcularlo.
 */
export function tidyFirst(db: Db, pathOf: (id: number) => string | null, chosen: TidyRule[]) {
  const { changes, ...r } = tidy(db, undefined, pathOf, chosen)
  const same = profileOf(chosen)
  const profiles: TidyProfileCount[] = same && !PROFILES.find((p) => p.key === same)?.soon ? [{ key: same, count: changes.length, tracks: new Set(changes.map((x) => x.id)).size, extra: [] }] : []
  // cuántas búsquedas de nombres oficiales hay guardadas (sin ninguna, el perfil Oficial no agrega nada)
  const searched = (db.prepare("SELECT COUNT(*) AS n FROM online_cache WHERE status = 'ok'").get() as { n: number }).n
  // los que cambian de nombre de archivo y vinieron del rekordbox.xml: Rekordbox los pierde hasta volver a importar (core/rbmoving.ts)
  const rb = inRekordbox(db, changes.filter((x) => x.field === 'filename' || x.field === 'extension').map((x) => x.id))
  return { screen: { ...r, total: changes.length, rules: chosen, profiles, searched, inRekordbox: rb }, changes }
}

/**
 * Cuánto propone cada perfil, con ejemplos de lo que agrega cada uno sobre el anterior. `chosenChanges`: lo que ya se
 * calculó para las reglas elegidas (ese perfil no se repite: con bibliotecas grandes es lo que más tarda).
 */
export function tidyProfiles(db: Db, pathOf: (id: number) => string | null, chosen: TidyRule[], chosenChanges?: TidyChange[]): TidyProfileCount[] {
  const key = (x: TidyChange) => `${x.id}|${x.field}|${x.to}`
  // cada perfil se compara con el anterior; Oficial, con Prolijo (se arma sobre él)
  const sets = new Map<string, Set<string>>()
  let prev = new Set<string>()
  const same = chosenChanges ? profileOf(chosen) : null
  return PROFILES.filter((p) => !p.soon).map((p) => {
    const pc = p.key === same ? chosenChanges! : tidy(db, undefined, pathOf, p.rules).changes
    const base = p.key === 'oficial' ? sets.get('prolijo') ?? prev : prev
    const extra = base.size ? pc.filter((x) => !base.has(key(x)) && (x.step === 'style' || x.step === 'official')).slice(0, 3).map(({ rel, field, from, to }) => ({ rel, field, from, to })) : []
    prev = new Set(pc.map(key))
    sets.set(p.key, prev)
    return { key: p.key, count: pc.length, tracks: new Set(pc.map((x) => x.id)).size, extra }
  })
}

/** La pantalla entera de una vez, con todos los perfiles (los tests y la medición de escala). */
export function tidyScreen(db: Db, pathOf: (id: number) => string | null, chosen: TidyRule[]) {
  const { screen, changes } = tidyFirst(db, pathOf, chosen)
  return { ...screen, profiles: tidyProfiles(db, pathOf, chosen, changes) }
}

/** Lo que va a Cambios pendientes. El BPM y el tono se borran solo si el archivo sigue diciendo lo que se miró (`expect`). */
/** Quién propone un cambio de Arreglar nombres: el paso oficial, o las reglas automáticas (core/confianza.ts). */
const origenDe = (c: TidyChange): Origen => (c.step === 'official' ? 'oficial' : 'reglas')
export const toProposals = (changes: TidyChange[]): Proposal[] => changes.map((c) => ({ id: c.id, field: c.field, value: c.to, source: origenDe(c), ...(c.field === 'bpm' || c.field === 'key' ? { expect: c.from } : {}) }))
