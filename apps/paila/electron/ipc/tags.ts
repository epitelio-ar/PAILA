// IPC de tags: cambios pendientes, acciones masivas, tapas, acciones guardadas, asistente de nombres y completar desde internet.
import fs from 'node:fs'
import path from 'node:path'
import { dialog, ipcMain, nativeImage } from 'electron'
import type { SavedAction, TagAction } from '@paila/shared/types'
import { coverFromBytes, readCover, type TagField } from '@paila/core/tagio'
import { caseAction, fileNameToTags, folderToTags, mojibakeAction, numberTracks, replaceText, tagsToFileName, youtubeClean } from '@paila/core/tagactions'
import { keepKey, keptKeys, setKept, tidy, tidyFirst, toProposals, type TidyChange, type TidyStep } from '@paila/core/tidy'
import { TidyProfilesRunner } from '@paila/core/tidyserver'
import { kindFor } from '@paila/core/collections'
import type { TidyRule } from '@paila/shared/tidy-profiles'
import { CLAVE_REGLAS_NOMBRES as RULES_SETTING, reglasGuardadas } from '@paila/core/tidy-reglas'
import { ArtistDict } from '@paila/core/artistdict'
import { mainArtist } from '@paila/core/official-findings'
import { junkWordsOf } from '@paila/core/tidy-learned'
import { pendingDjTags, refreshDjTags } from '@paila/core/djtag'
import { soltar } from '@paila/core/confianza'
import { dejarComoEsta } from '@paila/core/estado-dejar'
import { paraAplicar } from '@paila/core/aplicar'
import type { LearnedState } from '@paila/shared/types'
import { cant, idioma, num, textos } from '@paila/shared/idioma'

const T = textos({
  elegiTapa: { es: 'Elegí la tapa', en: 'Choose the cover' },
  imagenes: { es: 'Imágenes JPG o PNG', en: 'JPG or PNG images' },
  buscandoMb: { es: 'Buscando en MusicBrainz', en: 'Searching MusicBrainz' },
  buscados: {
    es: (looked: number, found: number, errors: number) => `Se buscaron ${looked} temas y se encontraron ${found}${errors ? `; ${errors} con error` : ''}`,
    en: (looked: number, found: number, errors: number) => `Looked up ${cant(looked, 'track', 'tracks')} and found ${num(found)}${errors ? `; ${num(errors)} with an error` : ''}`,
  },
  buscandoTapas: { es: 'Buscando tapas', en: 'Searching for covers' },
  leyendoBpm: { es: 'Leyendo el BPM y el tono de los tags', en: 'Reading the BPM and key from the tags' },
  leidosBpm: {
    es: (read: number, found: number) => `Se leyeron ${cant(read, 'tema', 'temas')}: ${num(found)} con BPM o tono en el tag`,
    en: (read: number, found: number) => `Read ${cant(read, 'track', 'tracks')}: ${num(found)} with a BPM or key in the tag`,
  },
  album: { es: (i: number, n: number) => `álbum ${i} de ${n}`, en: (i: number, n: number) => `album ${num(i)} of ${num(n)}` },
  tapas: {
    es: (releases: number, tracks: number, none: number) => `Tapas para ${releases} álbumes (${tracks} temas); ${none} sin tapa en internet`,
    en: (releases: number, tracks: number, none: number) => `Covers for ${cant(releases, 'album', 'albums')} (${cant(tracks, 'track', 'tracks')}); ${num(none)} with no cover on the internet`,
  },
})

import type { Ctx } from '../context'
import { servicios } from './albums'
import { registerAplicar } from './aplicar'
import { registerOrdenar } from './ordenar'

const NO_WRITE = ['wma', 'wmv', 'asf']

export function registerTags(c: Ctx) {
  const { lib, changes, musicbrainz } = c
  // diccionario de artistas: cada corrección de artista hecha a mano se recuerda (si parece el mismo nombre, ver core/artistdict.ts)
  const dict = new ArtistDict(lib.db)
  const artistOf = lib.db.prepare('SELECT artist FROM files WHERE id = ?')
  const learn = (ids: number[], value: string | null, origin: 'edicion' | 'aceptado') => {
    for (const id of ids) dict.learn((artistOf.get(id) as { artist: string | null } | undefined)?.artist ?? null, value, origin)
  }

  // ---- cambios pendientes ----
  ipcMain.handle('changes:stage', (_e, ids: number[], field: TagField, value: string | null) => {
    if (field === 'artist') learn(ids, value, 'edicion')
    changes.stage(ids, field, value, 'mano')
    return paraAplicar(lib.db, changes)
  })
  registerAplicar(c) // la lista única, descartar y aplicar todo en orden (ipc/aplicar.ts)
  registerOrdenar(c) // Ordenar, la revisión única (ipc/ordenar.ts)
  ipcMain.handle('changes:batches', () => changes.batches())
  ipcMain.handle('changes:undo', (_e, id: number) => c.withPaused(() => changes.undo(id)))

  // ---- acciones masivas ----
  ipcMain.handle('changes:action', (_e, ids: number[], a: TagAction) => {
    const ts = changes.tracksFor(ids)
    const props = a.type === 'replace' ? replaceText(ts, a.field, a.find, a.repl, { regex: a.regex })
      : a.type === 'case' ? caseAction(ts, a.field, a.mode)
      : a.type === 'number' ? numberTracks(ts, { pad: a.pad, start: a.start })
      : a.type === 'mojibake' ? mojibakeAction(ts, ['title', 'artist', 'albumArtist', 'album', 'genre'])
      : a.type === 'youtube' ? youtubeClean(ts)
      : a.type === 'filenameToTag' ? fileNameToTags(ts, a.pattern)
      : a.type === 'tagToFilename' ? tagsToFileName(ts, a.pattern)
      : a.type === 'refresh' ? []
      : folderToTags(ts)
    changes.stageMany(props, 'mano') // una acción que eligió la persona sobre los temas que marcó
    return props.length
  })

  // ---- acciones guardadas ----
  const savedActions = (): SavedAction[] => { try { return JSON.parse(c.setting('saved_actions') ?? '[]') } catch { return [] } }
  const putSaved = (list: SavedAction[]) => { c.setSetting('saved_actions', JSON.stringify(list)); return list }
  ipcMain.handle('saved:list', () => savedActions())
  ipcMain.handle('saved:save', (_e, name: string, action: TagAction) => putSaved([...savedActions().filter((s) => s.name !== name), { name, action }]))
  ipcMain.handle('saved:delete', (_e, name: string) => putSaved(savedActions().filter((s) => s.name !== name)))

  // ---- tapas ----
  ipcMain.handle('cover:get', (_e, id: number) => {
    const f = lib.trackPath(id)
    if (!f || !fs.existsSync(f) || NO_WRITE.includes(path.extname(f).slice(1).toLowerCase())) return null
    try { const cv = readCover(f); if (!cv) return null; const o = JSON.parse(cv) as { mime: string; data: string }; return `data:${o.mime};base64,${o.data}` } catch { return null }
  })
  ipcMain.handle('cover:set', async (_e, ids: number[], mode: 'pick' | 'remove') => {
    if (mode === 'remove') { changes.stageMany(ids.map((id) => ({ id, field: 'cover' as const, value: null }))); return true }
    const r = await dialog.showOpenDialog(c.win()!, { title: T.elegiTapa, properties: ['openFile'], filters: [{ name: T.imagenes, extensions: ['jpg', 'jpeg', 'png'] }] })
    if (r.canceled || !r.filePaths[0]) return false
    let bytes: Uint8Array = fs.readFileSync(r.filePaths[0])
    coverFromBytes(bytes) // valida que sea JPG o PNG
    // Para no inflar los archivos: las tapas de más de 1000 px se achican a 1000 px (JPG).
    const img = nativeImage.createFromBuffer(Buffer.from(bytes))
    const { width, height } = img.getSize()
    if (Math.max(width, height) > 1000) {
      const k = 1000 / Math.max(width, height)
      bytes = img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: 'best' }).toJPEG(90)
    }
    const cover = coverFromBytes(bytes)
    changes.stageMany(ids.map((id) => ({ id, field: 'cover' as const, value: cover })))
    return true
  })

  // ---- asistente "Arreglar nombres y tags" ----
  // las reglas elegidas (un perfil o "a medida") se guardan para la próxima vez
  const savedRules = (): TidyRule[] => reglasGuardadas((k) => c.setting(k)) // core/tidy-reglas.ts (también la usa Ordenar)
  const pathOf = (i: number) => lib.trackPath(i)
  // lo que propone el perfil elegido en el último análisis: el hilo de los perfiles no lo vuelve a calcular
  let lastTidy: { rules: TidyRule[]; changes: TidyChange[] } | null = null
  const profiles = new TidyProfilesRunner(path.join(__dirname, 'tidy-worker.js'))
  // el BPM y el tono del tag, para el paso que borra los que seguro están mal (core/tidy-djtag.ts): la primera vez se leen
  // todos (~20 s cada 6.000 temas, con su avance); después, solo lo nuevo o cambiado. Si no se pueden leer, el paso cuenta lo que hay.
  const readDjTags = async () => {
    if (!pendingDjTags(lib.db, pathOf)) return
    await c.jobs.run('djtags', T.leyendoBpm, (h) => refreshDjTags(lib.db, pathOf, (done, total) => h.update({ done, total }), h.cancelled),
      (r) => T.leidosBpm(r.read, r.found)).catch(() => { /* ya se está leyendo (otro Analizar) o se cortó */ })
  }
  ipcMain.handle('tidy:analyze', async (_e, rules?: TidyRule[]) => {
    await readDjTags()
    if (rules) { c.setSetting(RULES_SETTING, JSON.stringify(rules)); c.setSetting('tidy.reglas.dicc', '1'); c.setSetting('tidy.reglas.aprendidas', '1'); c.setSetting('tidy.reglas.vinilo', '1') }
    const chosen = rules ?? savedRules()
    const { screen, changes: ch } = tidyFirst(lib.db, pathOf, chosen)
    lastTidy = { rules: chosen, changes: ch }
    return screen
  })
  // los números de los demás perfiles, en un hilo aparte (cada uno es una pasada entera); null si ya se pidió otra cosa
  ipcMain.handle('tidy:profiles', (_e, rules: TidyRule[]) => {
    const same = lastTidy && JSON.stringify(lastTidy.rules) === JSON.stringify(rules) ? lastTidy.changes : undefined
    lastTidy = null
    const roots = Object.fromEntries(lib.roots().filter((r) => r.available).map((r) => [r.id, r.path]))
    return profiles.run({ file: path.join(c.userData, 'paila.db'), roots, idioma: idioma(), rules, changes: same })
  })
  ipcMain.handle('tidy:stage', (_e, steps: TidyStep[], rules: TidyRule[]) => { const p = toProposals(tidy(lib.db, steps, pathOf, rules).changes); changes.stageMany(p); return p.length })
  ipcMain.handle('tidy:accept', (_e, items: { id: number; field: TagField | 'filename'; value: string }[]) => {
    for (const it of items) if (it.field === 'artist') learn([it.id], it.value, 'aceptado')
    changes.stageMany(items, 'mano') // aceptado a mano (también lo de "para mirar a mano"): manda sobre lo demás
    return items.length
  })
  // palabras que sobran, aprendidas de la biblioteca (core/junkwords.ts): la lista con casillas y "No es basura"
  ipcMain.handle('learned:list', () => junkWordsOf(lib.db).report())
  ipcMain.handle('learned:set', (_e, key: string, state: LearnedState) => { junkWordsOf(lib.db).setState(key, state); return junkWordsOf(lib.db).report() })
  ipcMain.handle('tidy:keep', (_e, items: { id: number; field: string; from: string | null; origin?: 'oficial' }[], reset?: boolean) => {
    // "dejar como está" un nombre oficial que vino de internet: así está bien para todos los temas de ese artista
    for (const it of items) if (it.origin === 'oficial' && it.field === 'artist' && it.from) dict.set(mainArtist(it.from), mainArtist(it.from), 'aceptado')
    setKept(lib.db, reset ? [] : [...keptKeys(lib.db), ...items.map(keepKey)])
    // y cuenta para el estado de la colección y las demás pantallas: el nombre de ese tema queda como está (core/estado-dejar.ts)
    if (reset) dejarComoEsta(lib.db, 'nombres', 'todos', false); else dejarComoEsta(lib.db, 'nombres', [...new Set(items.map((it) => it.id))])
    for (const it of items) soltar(lib.db, it.id, it.field) // lo retenido por el orden de confianza: ya se decidió
  })
  // "Sets y en vivo": una regla por tema (no se mueve ningún archivo); volver = la colección de la carpeta de arriba
  ipcMain.handle('tidy:sets', (_e, ids: number[], back?: boolean) => {
    let n = 0
    for (const id of ids) {
      const f = lib.db.prepare('SELECT root_id AS rootId, rel_path AS rel FROM files WHERE id = ?').get(id) as { rootId: number; rel: string } | undefined
      if (!f) continue
      const parent = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : ''
      const kind = back ? kindFor(parent, lib.rules(f.rootId).filter((x) => x.rel !== f.rel)) : 'sets'
      if (kind === 'produccion' && !back) continue // los samples nunca
      lib.setRule(f.rootId, f.rel, kind)
      n++
    }
    return n
  })

  // ---- completar desde internet (MusicBrainz) ----
  ipcMain.handle('mb:status', () => {
    const cands = musicbrainz.candidates()
    let found = 0, none = 0, errors = 0, pending = 0
    for (const t of cands) { const k = musicbrainz.cached(t.id, t); if (!k) pending++; else if (k.status === 'ok') found++; else if (k.status === 'sin_resultado') none++; else errors++ }
    return { candidates: cands.length, pending, found, none, errors }
  })
  const correrMb = (retry: boolean) => c.jobs.run('mb', T.buscandoMb,
    (h) => musicbrainz.run((p) => h.update({ done: p.done, total: p.total, current: p.current, found: p.found }), h.cancelled, { retryFailed: retry }),
    (r) => T.buscados(r.looked, r.found, r.errors), servicios(false))
  ipcMain.handle('mb:run', (_e, retry: boolean) => correrMb(retry))
  c.internet = { ...c.internet, mb: () => correrMb(false) }
  ipcMain.handle('mb:proposals', () => musicbrainz.proposals())
  ipcMain.handle('mb:stage', (_e, items: { fileId: number; fields: string[] }[]) => {
    const props = new Map(musicbrainz.proposals().map((p) => [p.fileId, p]))
    const out: { id: number; field: 'album' | 'year' | 'genre' | 'track'; value: string }[] = []
    for (const it of items) for (const f of props.get(it.fileId)?.fills ?? []) if (it.fields.includes(f.field)) out.push({ id: it.fileId, field: f.field, value: f.value })
    const r = changes.stageMany(out, 'internet')
    return { staged: r.staged, held: r.held }
  })
  // Tapas: una por release (no sospechoso), para los temas que no tienen tapa embebida.
  ipcMain.handle('mb:covers', () => c.jobs.run('mbcovers', T.buscandoTapas, async (h) => {
    const byRelease = new Map<string, number[]>()
    for (const r of lib.db.prepare("SELECT file_id AS id, result FROM mb_lookup WHERE status = 'ok'").all() as { id: number; result: string }[]) {
      const res = JSON.parse(r.result) as { releaseId: string | null; suspicious: boolean }
      const f = lib.trackPath(r.id)
      if (!res.releaseId || res.suspicious || !f || NO_WRITE.includes(path.extname(f).slice(1).toLowerCase())) continue
      try { if (readCover(f)) continue } catch { continue }
      byRelease.set(res.releaseId, [...(byRelease.get(res.releaseId) ?? []), r.id])
    }
    let releases = 0, tracks = 0, none = 0, done = 0
    h.update({ total: byRelease.size })
    for (const [rel, ids] of byRelease) {
      if (h.cancelled()) break
      h.update({ done: done++, current: T.album(done, byRelease.size), found: releases, errors: none })
      try {
        const bytes = await musicbrainz.cover(rel)
        if (!bytes) { none++; continue }
        const cover = coverFromBytes(bytes)
        changes.stageMany(ids.map((id) => ({ id, field: 'cover' as const, value: cover })))
        releases++; tracks += ids.length
      } catch { none++ }
    }
    h.update({ done, found: releases, errors: none })
    return { releases, tracks, none }
  }, (r) => T.tapas(r.releases, r.tracks, r.none)))
}
