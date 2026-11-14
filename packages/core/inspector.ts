// Inspector de un tema: todo lo que PAILA ve y decide de él, en bloques (tags, calidad, BPM y tono, grilla, huellas, playlists,
// duplicados). `npm run tema` y la ventana "Inspeccionar un tema" de la app muestran lo mismo. Solo lee: abre la base en modo
// de solo lectura, nunca escribe ni toca archivos. Historial y asistentes: core/inspector-historia.ts. Los textos, en
// castellano y en inglés: core/inspector.textos.ts (las claves del JSON no cambian con el idioma).
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import type { InspectSection, TrackInspection, TrackLookup } from '@paila/shared/types'
import { visible, type Db } from './db'
import { ANALYSIS_VERSION } from './queue'
import { DJ_VERSION, QUALITY_VERSION } from './reanalysis'
import { PRECISE_VERSION } from './precise'
import { normalize, titleCore } from './dupnames'
import { dash, json, oneOf, row, rowsOf, show, type Rec } from './inspector-base'
import { historySections, assistantSections } from './inspector-historia'
import { T } from './inspector.textos'
import { notaEnIdioma } from './textosidioma'

/** Abre una base solo para mirar: aunque algo intente escribir, falla. */
export const openReadOnly = (file: string): Db => new DatabaseSync(file, { readOnly: true })

const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`)
const clock = (s: number | null) => (s == null ? dash : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const slash = (p: string) => p.replace(/\\/g, '/')

/** Dónde está un tema ahora, mirando solo la base (el disco puede estar conectado en otra letra: es una pista, no una promesa). */
export function absOf(db: Db, id: number): string | null {
  const r = oneOf(db, 'SELECT f.rel_path AS rel, r.rel_path AS root, v.last_mount AS mount FROM files f JOIN roots r ON r.id = f.root_id JOIN volumes v ON v.id = r.volume_id WHERE f.id = ?', id)
  return r ? path.join(String(r.mount), String(r.root || ''), String(r.rel)) : null
}

/**
 * Busca un tema por lo que escribió la persona: su número, la ruta completa (aunque la base apunte a otra copia de la carpeta:
 * alcanza con que el final coincida) o un pedazo del nombre. Si hay varios parecidos, los devuelve para elegir.
 */
export function findTrack(db: Db, ref: string): TrackLookup {
  const text = ref.trim()
  if (!text) return null
  if (/^\d+$/.test(text) && oneOf(db, 'SELECT id FROM files WHERE id = ?', Number(text))) return { found: Number(text) }
  const norm = slash(text).toLowerCase()
  const all = rowsOf(db, 'SELECT f.id, f.rel_path AS rel, r.rel_path AS root, v.last_mount AS mount FROM files f JOIN roots r ON r.id = f.root_id JOIN volumes v ON v.id = r.volume_id')
  const abs = (x: Rec) => slash(path.join(String(x.mount), String(x.root || ''), String(x.rel))).toLowerCase()
  const exact = all.filter((x) => abs(x) === norm)
  if (exact.length === 1) return { found: Number(exact[0].id) }
  // la base puede apuntar a una copia de la carpeta: el final de la ruta tiene que coincidir con la ruta guardada
  const tail = all.filter((x) => norm === String(x.rel).toLowerCase() || norm.endsWith('/' + String(x.rel).toLowerCase()))
  if (tail.length === 1) return { found: Number(tail[0].id) }
  const pool = tail.length ? tail : all.filter((x) => String(x.rel).toLowerCase().includes(norm) || norm.endsWith('/' + path.posix.basename(String(x.rel)).toLowerCase()))
  if (pool.length === 1) return { found: Number(pool[0].id) }
  return pool.length ? { choices: pool.slice(0, 20).map((x) => ({ id: Number(x.id), rel: String(x.rel) })) } : null
}

function estado(f: Rec): string {
  if (f.trashed_at) return T.papelera(String(f.trashed_at))
  if (f.missing_at) return T.desaparecido(String(f.missing_at))
  if (f.excluded_at) return T.excluida(String(f.excluded_at))
  return T.aLaVista
}

function temaSection(db: Db, f: Rec): InspectSection {
  const root = oneOf(db, 'SELECT r.rel_path AS rel, r.removed_at AS removed, v.label, v.serial, v.last_mount AS mount FROM roots r JOIN volumes v ON v.id = r.volume_id WHERE r.id = ?', Number(f.root_id))
  return {
    key: 'tema', title: T.archivo, help: T.archivoAyuda,
    rows: [
      row(T.numBase, f.id), row(T.ruta, f.rel_path), row(T.carpeta, root ? T.carpetaValor(slash(path.join(String(root.mount), String(root.rel || ''))), show(root.label), show(root.serial)) : dash),
      row(T.coleccion, f.kind), row(T.estado, estado(f)),
      row(T.formato, [f.ext, f.codec].filter(Boolean).join(' / ')), row(T.tamano, bytes(Number(f.size))), row(T.duracion, clock(f.duration as number | null)),
      row('Bitrate', f.kbps ? `${f.kbps} kbps` : null), row(T.frecuencia, f.sample_rate ? `${f.sample_rate} Hz` : null), row(T.bits, f.bits), row(T.canales, f.channels),
      row(T.modificado, f.mtime ? new Date(Number(f.mtime)).toISOString() : null), row(T.errorLectura, f.error), row(T.ultimaLectura, f.probed_at),
    ],
  }
}

function tagsSection(db: Db, f: Rec): InspectSection {
  const isrc = oneOf(db, 'SELECT isrc FROM file_isrc WHERE file_id = ?', Number(f.id))
  const vinilo = oneOf(db, 'SELECT side, found_in FROM vinyl WHERE file_id = ?', Number(f.id))
  const pend = rowsOf(db, 'SELECT field, before, after FROM pending_changes WHERE file_id = ?', Number(f.id))
  return {
    key: 'tags', title: 'Tags', help: T.tagsAyuda,
    rows: [row(T.artista, f.artist), row(T.artistaAlbum, f.album_artist), row(T.titulo, f.title), row(T.album, f.album), row(T.nTema, f.track), row(T.anio, f.year), row(T.genero, f.genre),
      row('ISRC', isrc?.isrc), row(T.vinilo, vinilo ? T.viniloValor(vinilo.side ? String(vinilo.side) : '', String(vinilo.found_in)) : null)],
    items: pend.map((p) => T.pendiente(String(p.field), show(p.before), show(p.after))),
  }
}

/** Qué tan vigente está el análisis: el archivo no cambió desde que se analizó y el motor es el de hoy. */
function vigencia(a: Rec, f: Rec): string {
  const partes: string[] = []
  if (Number(a.src_size) !== Number(f.size) || Number(a.src_mtime) !== Number(f.mtime)) partes.push(T.cambioArchivo)
  if (Number(a.version) < ANALYSIS_VERSION) partes.push(T.motorViejo)
  if (a.quality_v != null && Number(a.quality_v) < QUALITY_VERSION) partes.push(T.calidadEspera)
  if (a.grade && a.quality_v == null) partes.push(T.calidadPrimera)
  return partes.length ? partes.join('; ') : T.alDia
}

function calidadSection(a: Rec | undefined, f: Rec): InspectSection[] {
  if (!a) return [{ key: 'calidad', title: T.calidad, help: T.calidadAyudaCorta, rows: [], empty: T.sinAnalizar }]
  // en el idioma de ahora aunque la base esté en el otro (npm run tema -- --en): core/textosidioma.ts
  const n = notaEnIdioma(a, typeof a.otro_textos === 'string' ? a.otro_textos : null), why = n.why, sound = n.sound
  return [{
    key: 'calidad', title: T.calidad, help: T.calidadAyuda,
    rows: [row(T.nota, a.grade), row(T.queDice, n.says), row(T.etiqueta, n.is), row(T.confianza, a.confidence ? T.confianzaValor(String(a.confidence)) : null), row(T.marcas, a.flags), row(T.bitrateReal, a.eff_kbps ? `${a.eff_kbps} kbps` : null),
      row(T.corteAgudos, a.cutoff ? T.corteValor(String(a.cutoff), show(a.cutoff_drop)) : null), row(T.volumen, a.lufs), row(T.rango, a.lra), row(T.pico, a.true_peak),
      row(T.recortes, a.clip_events), row(T.correlacion, a.stereo_corr), row(T.bitsReales, a.eff_bits), row(T.codificador, a.encoder), row('VBR', a.vbr_method), row(T.corteLame, a.lame_lowpass),
      row(T.analizado, a.analyzed_at), row(T.tardo, a.ms != null ? `${a.ms} ms` : null), row(T.error, n.error),
      row(T.versiones, T.versionesValor(show(a.version), show(a.quality_v), String(QUALITY_VERSION), show(a.dj_v), String(DJ_VERSION), show(a.precise_v), String(PRECISE_VERSION))), row(T.vigencia, vigencia(a, f))],
    items: [...why.map((w) => T.porQue(w)), ...sound.map((s) => T.sonido(s))],
  }]
}

function djSection(a: Rec | undefined, f: Rec): InspectSection {
  return {
    key: 'bpm', title: T.bpmTono, help: T.bpmAyuda,
    rows: a ? [row('BPM', a.bpm), row(T.bpmBase, a.bpm_base), row(T.deDonde, a.bpm_source), row(T.bpmRapido, a.bpm_fast), row(T.tono, a.music_key), row('Camelot', a.camelot),
      row(T.fuerzaTono, a.key_strength), row(T.energia, a.energy), row(T.bailable, a.danceability)] : [row(T.bpmTono, f.kind === 'produccion' ? T.delNombre : null)],
    empty: a ? undefined : T.sinAnalisis,
  }
}

function grillaSection(db: Db, id: number): InspectSection {
  const grids = rowsOf(db, 'SELECT g.method, g.bpm, g.variable, g.error_ms, g.segments, g.made_at, t.lo, t.hi FROM dj_grid g LEFT JOIN dj_tempo t ON t.file_id = g.file_id AND t.method = g.method WHERE g.file_id = ? ORDER BY g.method', id)
  const cues = rowsOf(db, 'SELECT source, kind, num, start, end_at, name FROM dj_cues WHERE file_id = ? ORDER BY source, start', id)
  const meta = oneOf(db, 'SELECT * FROM dj_meta WHERE file_id = ?', id)
  const rb = oneOf(db, 'SELECT track_id, source FROM rb_ids WHERE file_id = ?', id)
  const exp = oneOf(db, 'SELECT exported_at FROM rb_exports WHERE file_id = ?', id)
  const bySource = new Map<string, number>()
  for (const c of cues) bySource.set(String(c.source), (bySource.get(String(c.source)) ?? 0) + 1)
  return {
    key: 'grilla', title: T.grilla, help: T.grillaAyuda,
    rows: [
      ...grids.map((g) => row(T.grillaDe(String(g.method)), T.grillaValor(show(g.bpm), g.variable ? `${show(g.lo)}–${show(g.hi)}` : null, json(g.segments).length, show(g.error_ms), String(g.made_at)))),
      row('Cues', bySource.size ? [...bySource].map(([s, n]) => T.cuesDe(n, s)).join(', ') : null),
      row(T.deRekordbox, meta ? T.rekordboxValor(show(meta.stars), show(meta.colour), show(meta.play_count), show(meta.my_tags)) : null),
      row(T.trackId, rb ? `${rb.track_id} (${rb.source})` : null), row(T.exportado, exp?.exported_at),
    ],
    items: cues.slice(0, 12).map((c) => T.cue(`${c.source} ${c.kind}${Number(c.num) >= 0 ? ' ' + show(c.num) : ''}`, show(c.start), c.end_at != null ? show(c.end_at) : null, c.name ? String(c.name) : '')),
  }
}

function huellasSection(a: Rec | undefined, f: Rec): InspectSection {
  if (!a) return { key: 'huellas', title: T.huellas, help: T.huellasAyudaCorta, rows: [], empty: T.sinAnalizar }
  const chroma = a.chromaprint ? String(a.chromaprint) : null
  const vigente = a.audio_size === f.size && Math.abs(Number(a.audio_mtime) - Number(f.mtime)) < 1
  return {
    key: 'huellas', title: T.huellas, help: T.huellasAyuda,
    rows: [row(T.md5, a.audio_md5), row(T.vale, a.audio_md5 ? (vigente ? T.si : T.noCambio) : null), row(T.acustica, chroma ? T.chromaValor(chroma.slice(0, 40), chroma.length) : null), row(T.calculadas, a.prints_at)],
  }
}

function playlistsSection(db: Db, id: number): InspectSection {
  const ps = rowsOf(db, 'SELECT p.name, p.kind, i.position FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id WHERE i.file_id = ? ORDER BY p.name', id)
  return { key: 'playlists', title: T.playlists, help: T.playlistsAyuda, rows: [], items: ps.map((p) => T.enPlaylist(String(p.name), String(p.kind), Number(p.position) + 1)), empty: T.sinPlaylist }
}

/** Duplicados a la vista, sin recorrer toda la biblioteca: el mismo sonido y el mismo nombre. La búsqueda completa (huella acústica) es la pantalla Duplicados. */
function duplicadosSection(db: Db, f: Rec, a: Rec | undefined): InspectSection {
  const items: string[] = []
  const id = Number(f.id)
  const vigente = a && a.audio_md5 && a.audio_size === f.size
  if (vigente) for (const d of rowsOf(db, `SELECT f.id, f.rel_path rel FROM analysis a JOIN files f ON f.id = a.file_id WHERE a.audio_md5 = ? AND a.file_id != ? AND ${visible('f')} LIMIT 20`, String(a.audio_md5), id)) items.push(T.mismoSonido(String(d.id), String(d.rel)))
  if (f.artist && f.title) {
    const key = `${normalize(String(f.artist))}|${titleCore(String(f.title), String(f.artist))}`
    const mismos = rowsOf(db, `SELECT id, rel_path rel, artist, title FROM files WHERE id != ? AND ${visible()} AND lower(artist) = lower(?) AND kind IN ('musica','revisar')`, id, String(f.artist))
    for (const d of mismos) if (d.artist && d.title && `${normalize(String(d.artist))}|${titleCore(String(d.title), String(d.artist))}` === key) items.push(T.mismoNombre(String(d.id), String(d.rel)))
  }
  const sizeMates = rowsOf(db, `SELECT id, rel_path rel FROM files WHERE size = ? AND id != ? AND ${visible()} LIMIT 5`, Number(f.size), id)
  for (const d of sizeMates) items.push(T.mismoTamano(String(d.id), String(d.rel)))
  return { key: 'duplicados', title: T.duplicados, help: T.duplicadosAyuda, rows: [], items: [...new Set(items)], empty: T.sinRepetidos }
}

/** Todo lo que PAILA sabe y decide de un tema. `assistants: false` saltea lo que propondrían los asistentes (recorren toda la biblioteca). */
export function inspectTrack(db: Db, id: number, opts: { assistants?: boolean } = {}): TrackInspection | null {
  const f = oneOf(db, 'SELECT * FROM files WHERE id = ?', id)
  if (!f) return null
  // con la nota en el otro idioma (analysis_otro); una base de antes de la v42 no tiene esa tabla
  let a: Rec | undefined
  try { a = oneOf(db, 'SELECT a.*, o.textos AS otro_textos FROM analysis a LEFT JOIN analysis_otro o ON o.file_id = a.file_id WHERE a.file_id = ?', id) } catch { a = oneOf(db, 'SELECT * FROM analysis WHERE file_id = ?', id) }
  const sections: InspectSection[] = [
    temaSection(db, f), tagsSection(db, f), ...calidadSection(a, f), djSection(a, f), grillaSection(db, id), huellasSection(a, f),
    playlistsSection(db, id), duplicadosSection(db, f, a), ...historySections(db, f), ...(opts.assistants === false ? [] : assistantSections(db, f, a)),
  ]
  return { id, rel: String(f.rel_path), abs: absOf(db, id), title: [f.artist, f.title].filter(Boolean).join(' - ') || path.posix.basename(String(f.rel_path)), sections }
}
