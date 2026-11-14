// Escaneo incremental de la biblioteca: recorre las carpetas, lee formato y tags de lo nuevo o modificado, y nunca borra
// nada: lo que no aparece queda "desaparecido" y se reconecta solo si vuelve (movido o renombrado).
import path from 'node:path'
import fs from 'node:fs'
import type { CollectionKind, ScanStatus } from '@paila/shared/types'
import { listed, transaction } from './db'
import { kindFor } from './collections'
import { walkAudio } from './files'
import { findFfmpeg, probe, type ProbeResult } from './probe'
import { pcmHash } from './audiohash'
import type { Library } from './library'
import { syncArchives, type FoundArchive } from './archives'
import { cant, num, textos } from '@paila/shared/idioma'

// Lo que se ve mientras escanea y cómo terminó (solo se muestra: lo que se compara va en `status.outcome`).
const T = textos({
  buscando: { es: 'Buscando archivos…', en: 'Looking for files…' },
  noEncontrado: {
    es: (p: string, label: string | null) => `No se encontró ${p}${label ? ` (${label})` : ''}. ¿Está conectado el disco? Sus temas quedan guardados.`,
    en: (p: string, label: string | null) => `Couldn't find ${p}${label ? ` (${label})` : ''}. Is the drive connected? Its tracks stay saved.`,
  },
  leyendo: { es: 'Leyendo formato y tags…', en: 'Reading format and tags…' },
  sinCambios: { es: 'Sin cambios', en: 'No changes' },
  comprimidos: { es: 'Mirando adentro de los ZIP y RAR…', en: 'Looking inside the ZIP and RAR files…' },
  comprimidosError: { es: (m: string) => `No se pudieron revisar los ZIP y RAR: ${m}`, en: (m: string) => `Couldn't check the ZIP and RAR files: ${m}` },
  reconectados: { es: (n: number) => `${n} reconectados (estaban movidos o renombrados)`, en: (n: number) => `${num(n)} reconnected (they had been moved or renamed)` },
  desaparecidos: {
    es: (n: number) => `${n} no se encontraron: quedan como desaparecidos, con sus playlists`,
    en: (n: number) => `${num(n)} not found: they stay as missing, with their playlists`,
  },
  ilegibles: {
    es: 'hubo carpetas que no se pudieron leer: ahí no se marcó nada como desaparecido',
    en: "some folders couldn't be read: nothing in them was marked as missing",
  },
  detenido: {
    es: (n: number, de: number) => `Escaneo detenido: ${n} de ${de} leídos (lo leído quedó guardado)`,
    en: (n: number, de: number) => `Scan stopped: ${num(n)} of ${num(de)} read (what was read is saved)`,
  },
  listo: { es: (n: number) => `Listo: ${n} archivos nuevos o modificados`, en: (n: number) => `Done: ${cant(n, 'new or changed file', 'new or changed files')}` },
  listoSinCambios: { es: 'Listo: no había cambios', en: 'Done: there were no changes' },
  error: { es: (m: string) => `Error: ${m}`, en: (m: string) => `Error: ${m}` },
})

/** El escaneo en sí (ya con el candado de operaciones tomado): recorre las carpetas, lee lo nuevo y marca lo que falta. */
export async function scanLibrary(lib: Library, ffprobe: string, concurrency: number): Promise<ScanStatus> {
  lib.begin('scan', T.buscando)

  try {
    const known = new Map<string, { id: number; rel_path: string; size: number; mtime: number; duration: number | null; missing_at: string | null }>()
    // con los desaparecidos: si vuelven a aparecer, se reconectan
    for (const r of lib.db.prepare(`SELECT id, root_id, rel_path, size, mtime, duration, missing_at FROM files WHERE ${listed()}`).all() as
      { id: number; root_id: number; rel_path: string; size: number; mtime: number; duration: number | null; missing_at: string | null }[]) {
      known.set(`${r.root_id}|${r.rel_path}`, r)
    }
    const seen = new Set<string>()
    const todo: { rootId: number; rel: string; abs: string; size: number; mtime: number; kind: CollectionKind }[] = []
    const scannedRoots: number[] = []
    const unreadable = new Set<number>() // carpetas raíz donde algo no se pudo leer: ahí no se marca nada como desaparecido
    const archives: FoundArchive[] = [] // los ZIP y RAR (core/archives.ts): se anota qué tienen adentro, sin abrirlos

    for (const root of lib.roots()) {
      if (!root.available) {
        lib.status.warnings.push(T.noEncontrado(root.path, root.volumeLabel ?? null))
        continue
      }
      scannedRoots.push(root.id)
      const rules = root.rules
      const skip = (rel: string) => kindFor(rel, rules) === 'excluir'
      for await (const f of walkAudio(root.path, skip, (w) => { lib.status.warnings.push(w); unreadable.add(root.id) }, (d) => { lib.status.current = d; lib.emit(false) },
        (a) => archives.push({ ...a, rootId: root.id, kind: kindFor(a.rel, rules) }))) {
        if (lib.cancel) break
        const key = `${root.id}|${f.rel}`
        seen.add(key)
        lib.status.found++
        const k = known.get(key)
        if (!k || k.size !== f.size || k.mtime !== f.mtime) {
          todo.push({ rootId: root.id, rel: f.rel, abs: f.abs, size: f.size, mtime: f.mtime, kind: kindFor(f.rel, rules) })
        }
        lib.emit(false)
      }
      // Si el disco se desconectó en medio del recorrido, lo que faltó leer no "desapareció".
      if (!fs.existsSync(root.path)) unreadable.add(root.id)
      lib.reclassify(root.id)
    }

    // Lo que no se encontró NUNCA se borra de la base (se perderían sus playlists y su análisis): queda "desaparecido".
    // Si aparece un archivo nuevo con el mismo tamaño y el mismo nombre que uno desaparecido, es ese tema movido de
    // carpeta: se reconecta (mismo tema para PAILA, con sus playlists).
    let movedBack = 0
    const rootOf = (key: string) => Number(key.slice(0, key.indexOf('|')))
    if (!lib.cancel) {
      const now = new Date().toISOString()
      transaction(lib.db, () => {
        const back = lib.db.prepare('UPDATE files SET missing_at = NULL WHERE id = ?')
        for (const key of seen) { const k = known.get(key); if (k?.missing_at) { back.run(k.id); movedBack++ } }
        const gone = [...known].filter(([key]) => !seen.has(key) && scannedRoots.includes(rootOf(key)))
        const byName = new Map<string, number | null>() // tamaño|nombre → índice en gone (null si hay más de uno)
        gone.forEach(([, r], i) => { const k = `${r.size}|${path.posix.basename(r.rel_path).toLowerCase()}`; byName.set(k, byName.has(k) ? null : i) })
        const moved = new Set<number>()
        const relink = lib.db.prepare('UPDATE files SET root_id = ?, rel_path = ?, missing_at = NULL WHERE id = ?')
        for (let j = todo.length - 1; j >= 0; j--) {
          const t = todo[j]
          if (known.has(`${t.rootId}|${t.rel}`)) continue
          const i = byName.get(`${t.size}|${path.posix.basename(t.rel).toLowerCase()}`)
          if (i == null || moved.has(i)) continue
          const r = gone[i][1]
          relink.run(t.rootId, t.rel, r.id)
          moved.add(i); movedBack++
          if (r.mtime === t.mtime) todo.splice(j, 1) // mismo archivo, solo cambió de lugar: no hace falta volver a leerlo
        }
        const mark = lib.db.prepare('UPDATE files SET missing_at = ? WHERE id = ? AND missing_at IS NULL AND excluded_at IS NULL')
        gone.forEach(([key, r], i) => {
          if (moved.has(i) || unreadable.has(rootOf(key)) || r.missing_at) return
          mark.run(now, r.id); lib.status.removed++
        })
      })
    }
    // Renombrados en el lugar (otro nombre, mismo archivo): se reconocen después de leerlos, por tamaño y duración exactos.
    // Si además cambió el tamaño (le cambiaron los tags con otro programa y lo movieron o renombraron), se reconoce por la
    // huella del sonido: misma duración exacta que un desaparecido y el mismo audio, bit a bit. Solo se decodifica cuando
    // hay un desaparecido con esa misma duración, así que un escaneo común no se hace más lento.
    const missingBySize = new Map<number, { id: number; duration: number | null }[]>()
    const missingSound: { id: number; duration: number; md5: string }[] = []
    for (const r of lib.db.prepare(`SELECT f.id, f.size, f.duration,
        CASE WHEN a.audio_size = f.size AND ABS(a.audio_mtime - f.mtime) < 1 THEN a.audio_md5 END AS md5
        FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE f.missing_at IS NOT NULL AND f.trashed_at IS NULL`).all() as { id: number; size: number; duration: number | null; md5: string | null }[]) {
      missingBySize.set(r.size, [...(missingBySize.get(r.size) ?? []), r])
      if (r.md5 && r.duration != null) missingSound.push({ id: r.id, duration: r.duration, md5: r.md5 })
    }
    let ffmpeg: string | null | undefined
    /** ¿Es un desaparecido con otro tamaño? Misma duración (±0,05 s) y el mismo audio decodificado. */
    const soundTwin = async (abs: string, duration: number): Promise<number | null> => {
      const near = missingSound.filter((c) => !taken.has(c.id) && Math.abs(c.duration - duration) < 0.05)
      if (!near.length) return null
      if (ffmpeg === undefined) ffmpeg = findFfmpeg()
      if (!ffmpeg) return null
      let md5: string
      try { md5 = await pcmHash(ffmpeg, abs) } catch { return null }
      const same = near.filter((c) => c.md5 === md5)
      return same.length === 1 && !taken.has(same[0].id) ? same[0].id : null
    }
    const taken = new Set<number>()

    lib.status.toProbe = todo.length
    lib.status.phase = todo.length ? T.leyendo : T.sinCambios
    lib.emit()

    const upsert = lib.db.prepare(`
      INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, codec, sample_rate, bits, channels, kbps, duration,
                         artist, album_artist, title, album, track, year, genre, error, probed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_id, rel_path) DO UPDATE SET
        size = excluded.size, mtime = excluded.mtime, kind = excluded.kind, ext = excluded.ext, codec = excluded.codec,
        sample_rate = excluded.sample_rate, bits = excluded.bits, channels = excluded.channels, kbps = excluded.kbps,
        duration = excluded.duration, artist = excluded.artist, album_artist = excluded.album_artist, title = excluded.title,
        album = excluded.album, track = excluded.track, year = excluded.year, genre = excluded.genre,
        error = excluded.error, probed_at = excluded.probed_at`)

    const relinkRenamed = lib.db.prepare('UPDATE files SET root_id = ?, rel_path = ?, missing_at = NULL WHERE id = ?')
    let pending: (() => void)[] = []
    const flush = () => {
      if (!pending.length) return
      const batch = pending
      pending = []
      transaction(lib.db, () => { for (const save of batch) save() })
    }

    let next = 0
    const worker = async () => {
      while (next < todo.length && !lib.cancel) {
        if (lib.pauseWait) await lib.pauseWait
        if (lib.cancel) break
        const t = todo[next++]
        lib.status.current = t.abs
        let m: Partial<ProbeResult> = {}
        let error: string | null = null
        try { m = await probe(ffprobe, t.abs) } catch (e) { error = (e as Error).message; lib.status.errors++ }
        // ¿Es un tema desaparecido con otro nombre? Mismo tamaño exacto y misma duración: se reconecta (no se duplica).
        const twin = !known.has(`${t.rootId}|${t.rel}`) && m.duration != null
          ? (missingBySize.get(t.size) ?? []).filter((c) => !taken.has(c.id) && c.duration != null && Math.abs(c.duration - m.duration!) < 0.05)
          : []
        let relinkId = twin.length === 1 ? twin[0].id : null
        if (relinkId == null && !known.has(`${t.rootId}|${t.rel}`) && m.duration != null && missingSound.length) relinkId = await soundTwin(t.abs, m.duration)
        if (relinkId != null) { taken.add(relinkId); movedBack++ }
        const row = [
          t.rootId, t.rel, t.size, t.mtime, t.kind, path.extname(t.rel).slice(1).toLowerCase(),
          m.codec ?? null, m.sampleRate ?? null, m.bits ?? null, m.channels ?? null, m.kbps ?? null, m.duration ?? null,
          m.artist ?? null, m.albumArtist ?? null, m.title ?? null, m.album ?? null, m.track ?? null, m.year ?? null, m.genre ?? null,
          error, new Date().toISOString(),
        ]
        pending.push(() => {
          if (relinkId != null) relinkRenamed.run(t.rootId, t.rel, relinkId) // así el upsert de abajo actualiza ese mismo tema
          upsert.run(...(row as never[]))
        })
        if (pending.length >= 100) flush()
        lib.status.probed++
        lib.emit(false)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, todo.length)) }, worker))
    flush()
    if (!lib.cancel) {
      lib.status.phase = T.comprimidos
      lib.emit()
      try { syncArchives(lib.db, archives, scannedRoots, unreadable) } catch (e) { lib.status.warnings.push(T.comprimidosError((e as Error).message)) }
    }

    const extra = [
      movedBack ? T.reconectados(movedBack) : '',
      lib.status.removed ? T.desaparecidos(lib.status.removed) : '',
      unreadable.size ? T.ilegibles : '',
    ].filter(Boolean).join('; ')
    lib.status.phase = lib.cancel
      ? T.detenido(lib.status.probed, lib.status.toProbe)
      : (todo.length ? T.listo(todo.length) : T.listoSinCambios) + (extra ? `. ${extra}` : '')
  } catch (e) {
    lib.status.phase = T.error((e as Error).message)
    lib.status.outcome = 'error'
  } finally {
    lib.finish()
  }
  return lib.status
}
