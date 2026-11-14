// Inspector de un tema (core/inspector.ts, `npm run tema` y la ventana del modo avanzado): encuentra el tema por número, ruta o
// nombre, junta todo lo que PAILA sabe, lo muestra en texto y NUNCA escribe (la base se abre en solo lectura).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ponerIdioma } from '@paila/shared/idioma'
import { openDb, type Db } from '@paila/core/db'
import { findTrack, inspectTrack, openReadOnly } from '@paila/core/inspector'
import { inspectionText } from '@paila/core/inspector-texto'
import { QUALITY_VERSION } from '@paila/core/reanalysis'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-inspector-'))
const file = path.join(dir, 'paila.db')
let db: Db
afterAll(() => { db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

beforeAll(() => {
  const w = openDb(file)
  w.exec(`
    INSERT INTO volumes (serial, label, last_mount) VALUES ('AAAA-1111', 'SSD', 'D:\\');
    INSERT INTO roots (volume_id, rel_path, added_at) VALUES (1, 'Música', '2026-01-01');
    INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, codec, kbps, duration, artist, title, album, year, genre)
      VALUES (1, 1, 'Daft Punk/One More Time.flac', 30000000, 1700000000000, 'musica', 'flac', 'flac', 900, 320.5, 'Daft Punk', 'Daft Punk - One More Time', 'Discovery', '2001', 'House'),
             (2, 1, 'Daft Punk/One More Time (copia).flac', 30000000, 1700000000000, 'musica', 'flac', 'flac', 900, 320.5, 'Daft Punk', 'One More Time', 'Discovery', '2001', 'House'),
             (3, 1, 'Otros/Sin nada.mp3', 4000000, 1700000000000, 'musica', 'mp3', 'mp3', 320, 200, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, says, is_label, why, confidence, flags, eff_kbps, sound, cutoff, cutoff_drop, lufs, lra, true_peak, bpm, bpm_base, bpm_source, music_key, camelot, key_strength, energy,
        audio_md5, audio_size, audio_mtime, chromaprint, prints_at, quality_v, dj_v, precise_v)
      VALUES (1, 1, 30000000, 1700000000000, '2026-10-01T10:00:00Z', 'A', 'FLAC sin pérdida', 'Sin pérdida', '["Llega hasta 22 kHz"]', 'alta', 'dj_precise', 900, '["Sin recortes"]', 22000, 3, -9.5, 5.1, -0.4, 123, 123, 'mixto', 'F#m', '11A', 0.8, 7,
        'abc123', 30000000, 1700000000000, 'AQADtCqTJEpCBnaPP-GR', '2026-10-01T10:01:00Z', ${QUALITY_VERSION}, 2, 1),
             (2, 1, 30000000, 1700000000000, '2026-10-01T10:00:00Z', 'A', 'FLAC', 'Sin pérdida', '[]', 'alta', NULL, 900, '[]', 22000, 3, -9.5, 5.1, -0.4, 123, 123, 'mixto', 'F#m', '11A', 0.8, 7,
        'abc123', 30000000, 1700000000000, NULL, NULL, ${QUALITY_VERSION}, 2, 1);
    INSERT INTO playlists (id, parent_id, name, kind, position, created_at) VALUES (1, NULL, 'Para bailar', 'normal', 0, '2026-01-01');
    INSERT INTO playlist_items (playlist_id, file_id, position) VALUES (1, 1, 0);
    INSERT INTO journal (batch_id, file_id, rel_path, field, before, after, applied_at) VALUES (7, 1, 'Daft Punk/One More Time.flac', 'title', 'One More Time', 'Daft Punk - One More Time', '2026-10-02T09:00:00Z');
    INSERT INTO moves_log (batch_id, root_id, file_id, from_rel, to_rel, created_at, undone_at) VALUES (3, 1, 1, 'One More Time.flac', 'Daft Punk/One More Time.flac', '2026-10-03T09:00:00Z', NULL);
    INSERT INTO pending_changes (file_id, field, before, after, created_at) VALUES (3, 'title', NULL, 'Sin nada', '2026-10-04T00:00:00Z');
  `)
  w.close()
  db = openReadOnly(file)
})

describe('inspector: buscar el tema', () => {
  it('por número, por la ruta completa y por el final de la ruta (aunque la base apunte a otra copia)', () => {
    expect(findTrack(db, '1')).toEqual({ found: 1 })
    expect(findTrack(db, 'D:\\Música\\Daft Punk\\One More Time.flac')).toEqual({ found: 1 })
    expect(findTrack(db, 'd:/música/daft punk/one more time.flac')).toEqual({ found: 1 })
    expect(findTrack(db, 'G:\\Copia\\Música\\Otros\\Sin nada.mp3')).toEqual({ found: 3 })
  })
  it('con un pedazo del nombre: uno solo se encuentra, varios se ofrecen para elegir, ninguno es null', () => {
    expect(findTrack(db, 'sin nada')).toEqual({ found: 3 })
    const varios = findTrack(db, 'one more time')
    expect(varios && 'choices' in varios && varios.choices.map((c) => c.id).sort()).toEqual([1, 2])
    expect(findTrack(db, 'no existe esto')).toBeNull()
    expect(findTrack(db, '')).toBeNull()
  })
})

describe('inspector: lo que muestra', () => {
  const i = () => inspectTrack(db, 1, { assistants: false })!
  const sec = (k: string) => i().sections.find((s) => s.key === k)!
  const val = (k: string, label: string) => sec(k).rows.find((r) => r.label === label)?.value

  it('tags, calidad con su porqué, BPM, tono y huellas tal cual están guardados', () => {
    expect(val('tags', 'Artista')).toBe('Daft Punk')
    expect(val('calidad', 'Nota')).toBe('A')
    expect(sec('calidad').items).toContain('Por qué: Llega hasta 22 kHz')
    expect(val('calidad', 'Vigencia')).toBe('al día')
    expect(val('bpm', 'BPM')).toBe('123')
    expect(val('bpm', 'Camelot')).toBe('11A')
    expect(val('huellas', 'Huella del sonido (MD5)')).toBe('abc123')
    expect(val('huellas', 'Vale para este archivo')).toBe('sí')
  })
  it('en qué playlists está, los duplicados que se ven rápido y el historial', () => {
    expect(sec('playlists').items![0]).toMatch(/Para bailar/)
    expect(sec('duplicados').items!.some((x) => /Mismo sonido exacto: #2/.test(x))).toBe(true)
    expect(sec('duplicados').items!.some((x) => /Mismo artista y título: #2/.test(x))).toBe(true)
    const h = sec('historial').items!.join('\n')
    expect(h).toMatch(/title «One More Time» → «Daft Punk - One More Time»/)
    expect(h).toMatch(/movido \(tanda 3\)/)
  })
  it('un tema sin analizar dice que falta, y los cambios pendientes aparecen en los tags', () => {
    const t = inspectTrack(db, 3, { assistants: false })!
    expect(t.sections.find((s) => s.key === 'calidad')!.empty).toMatch(/Todavía no se analizó/)
    expect(t.sections.find((s) => s.key === 'tags')!.items![0]).toMatch(/Cambio pendiente de title/)
  })
  it('con los asistentes: qué propondría Arreglar nombres (el artista repetido en el título)', () => {
    const t = inspectTrack(db, 1)!
    const a = t.sections.find((s) => s.key === 'asist-nombres')!
    expect(a.items!.join('\n')).toMatch(/Propone cambiar title: «Daft Punk - One More Time» → «One More Time»/)
    expect(t.sections.find((s) => s.key === 'asist-volumen')!.rows[0].value).toBe('-8.5 dB')
  })
  it('el texto de pantalla lleva título, ruta, bloques con su explicación y no muestra las líneas vacías', () => {
    const txt = inspectionText(i())
    expect(txt).toMatch(/^TEMA #1: Daft Punk - Daft Punk - One More Time/)
    expect(txt).toMatch(/── Calidad ─/)
    expect(txt).toMatch(/\(La nota A\+…F/)
    expect(txt).not.toMatch(/ISRC/)
    expect(inspectTrack(db, 99)).toBeNull()
  })
})

describe('inspector: en inglés', () => {
  afterEach(() => ponerIdioma('es'))
  it('los textos para leer cambian; las claves del JSON y lo que viene de la base, no', () => {
    const es = inspectTrack(db, 1)!
    ponerIdioma('en')
    const en = inspectTrack(db, 1)!
    expect(en.sections.map((s) => s.key)).toEqual(es.sections.map((s) => s.key))
    const calidad = en.sections.find((s) => s.key === 'calidad')!
    expect(calidad.title).toBe('Quality')
    expect(calidad.rows.find((r) => r.label === 'Grade')?.value).toBe('A')
    expect(calidad.rows.find((r) => r.label === 'Freshness')?.value).toBe('up to date')
    expect(calidad.items).toContain('Why: Llega hasta 22 kHz') // el porqué viene guardado en la base: sale tal cual
    expect(en.sections.find((s) => s.key === 'historial')!.items!.join('\n')).toMatch(/batch 7: title “One More Time” → “Daft Punk - One More Time”/)
    expect(inspectionText(en)).toMatch(/^TRACK #1: Daft Punk/)
  })
})

describe('inspector: nunca escribe', () => {
  it('la base se abre en solo lectura: una escritura falla y no cambia nada', () => {
    const antes = fs.statSync(file).mtimeMs
    expect(() => db.exec("UPDATE files SET title = 'x'")).toThrow(/readonly|read-only/i)
    inspectTrack(db, 1) // con los asistentes, que intentan guardar la marca "vinilo" si la encuentran
    expect((db.prepare('SELECT title FROM files WHERE id = 1').get() as { title: string }).title).toBe('Daft Punk - One More Time')
    expect(fs.statSync(file).mtimeMs).toBe(antes)
  })
  it('una base más vieja, sin alguna tabla, igual se puede mirar', () => {
    const vieja = path.join(dir, 'vieja.db')
    const w = openDb(vieja)
    w.exec("INSERT INTO volumes (serial, label, last_mount) VALUES ('B', 'B', 'C:\\'); INSERT INTO roots (volume_id, rel_path, added_at) VALUES (1, '', 'x'); INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext) VALUES (1, 1, 'a.mp3', 1, 1, 'musica', 'mp3'); DROP TABLE dj_cues; DROP TABLE playlist_items")
    w.close()
    const r = openReadOnly(vieja)
    expect(inspectTrack(r, 1, { assistants: false })!.sections.length).toBeGreaterThan(8)
    r.close()
  })
})

describe('npm run tema (scripts/tema.ts)', () => {
  const tema = (...args: string[]) => spawnSync(process.execPath, ['scripts/run-ts.mjs', 'scripts/tema.ts', ...args, '--base', file], { encoding: 'utf8', timeout: 170_000 })
  it('muestra la pantalla de un tema, en JSON si se pide, y no escribe la base', () => {
    const antes = fs.statSync(file).mtimeMs
    const r = tema('D:/Música/Daft Punk/One More Time.flac', '--sin-asistentes')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/TEMA #1: Daft Punk/)
    expect(r.stdout).toMatch(/Nota {2,}A/)
    const j = tema('1', '--json', '--sin-asistentes')
    expect(JSON.parse(j.stdout).sections.map((s: { key: string }) => s.key)).toContain('historial')
    expect(fs.statSync(file).mtimeMs).toBe(antes)
  }, 300_000)
  it('con varios parecidos los lista y sale con error; sin nada, también', () => {
    const varios = tema('one more time')
    expect(varios.status).toBe(1)
    expect(varios.stderr).toMatch(/varios|parecidos/)
    expect(varios.stderr).toMatch(/#1 /)
    expect(tema('no-existe-este-tema').status).toBe(1)
  }, 300_000)
})
