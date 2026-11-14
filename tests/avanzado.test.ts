// Modo avanzado (core/advanced.ts): la cola del análisis con lo que espera cada pasada, el registro de operaciones (diario + Historial)
// y "reanalizar este tema" (solo marca el análisis como vencido; no toca archivos y no corre solo para mirar).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { analysisQueue, operationLog, reanalyzeTrack } from '@paila/core/advanced'
import { pendingAnalysis } from '@paila/core/queue'
import { QUALITY_VERSION } from '@paila/core/reanalysis'
import type { HistoryEntry } from '@paila/shared/types'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-avanzado-'))
let db: Db
afterAll(() => { db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })
afterEach(() => { delete process.env.PAILA_SOLO_LECTURA })

const parado = { running: false, job: null, phase: 'Listo', probed: 0, toProbe: 0, current: '', paused: false } as const

beforeAll(() => {
  db = openDb(path.join(dir, 'paila.db'))
  db.exec(`
    INSERT INTO volumes (serial, label, last_mount) VALUES ('X', 'X', 'C:\\');
    INSERT INTO roots (volume_id, rel_path, added_at) VALUES (1, 'M', '2026-01-01');
    INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, error) VALUES
      (1, 1, 'nuevo.mp3', 100, 5, 'musica', 'mp3', NULL),
      (2, 1, 'analizado.mp3', 100, 5, 'musica', 'mp3', NULL),
      (3, 1, 'sin-huella.mp3', 100, 5, 'musica', 'mp3', NULL),
      (4, 1, 'roto.mp3', 100, 5, 'musica', 'mp3', 'No se pudo leer el encabezado'),
      (5, 1, 'motor-viejo.flac', 100, 5, 'musica', 'flac', NULL);
    INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, bpm, dj_v, quality_v, prints_at, audio_md5, precise_v) VALUES
      (2, 1, 100, 5, '2026-10-01T00:00:00Z', 'A', 120, 2, ${QUALITY_VERSION}, '2026-10-01', 'h', 1),
      (3, 1, 100, 5, '2026-10-01T00:00:00Z', 'B', 120, 2, ${QUALITY_VERSION}, NULL, NULL, 1),
      (5, 1, 100, 5, '2026-10-01T00:00:00Z', 'C', 120, 2, 1, '2026-10-01', 'h', 1);
    INSERT INTO op_journal (op, phase, file_id, src_rel, dst_rel, started_at, result, message) VALUES
      ('mover', 'inicio', 1, 'a.mp3', 'b.mp3', '2026-10-05T10:00:00Z', NULL, NULL),
      ('tags', 'fin', 2, 'c.mp3', NULL, '2026-10-04T10:00:00Z', 'completado', 'ya estaba hecho');
  `)
})

describe('cola del análisis', () => {
  it('cuenta lo que espera cada pasada y muestra los primeros con su motivo', () => {
    const v = analysisQueue(db, parado)
    const lane = (k: string) => v.lanes.find((l) => l.key === k)!
    expect(lane('analisis').count).toBe(1) // solo "nuevo.mp3": el roto tiene error y no se reintenta
    expect(lane('analisis').next[0]).toMatchObject({ id: 1, rel: 'nuevo.mp3', why: 'nunca se analizó' })
    expect(lane('analisis').count).toBe(pendingAnalysis(db))
    expect(lane('huellas').next.map((t) => t.rel)).toEqual(['sin-huella.mp3'])
    expect(lane('calidad').next.map((t) => t.rel)).toEqual(['motor-viejo.flac'])
    expect(lane('calidad').next[0].why).toBe('la calidad es de un motor viejo')
    expect(lane('precisa').count).toBe(0)
    expect(v.failed).toEqual([{ id: 4, rel: 'roto.mp3', why: 'No se pudo leer el encabezado' }])
    expect(v.running).toBe('')
  })
  it('dice qué está haciendo el análisis ahora', () => {
    const v = analysisQueue(db, { running: true, job: 'analysis', phase: 'Analizando…', probed: 3, toProbe: 10, current: 'C:\\M\\x.mp3', paused: true })
    expect(v).toMatchObject({ running: 'analysis', phase: 'Analizando…', probed: 3, toProbe: 10, paused: true })
  })
})

describe('registro de operaciones', () => {
  it('junta el diario y el Historial, del más nuevo al más viejo', () => {
    const h: HistoryEntry[] = [{ kind: 'organizar', id: 9, at: '2026-10-06T10:00:00Z', files: 40, summary: 'Se organizaron 40 temas', undone: false, canUndo: true, whyNot: null, note: null }]
    const r = operationLog(db, h)
    expect(r.map((x) => `${x.source}:${x.op}`)).toEqual(['historial:organizar', 'diario:mover', 'diario:tags'])
    expect(r[1]).toMatchObject({ state: 'en curso (inicio)', detail: 'a.mp3 → b.mp3' })
    expect(r[2]).toMatchObject({ state: 'completado', detail: 'c.mp3 — ya estaba hecho' })
    expect(r[0]).toMatchObject({ state: 'hecha', files: 40 })
  })
})

describe('reanalizar este tema', () => {
  it('vence el análisis, borra el error y el tema vuelve a la cola, sin tocar nada más', () => {
    expect(pendingAnalysis(db)).toBe(1)
    const msg = reanalyzeTrack(db, 2)
    expect(msg).toMatch(/quedó en la cola/)
    expect(pendingAnalysis(db)).toBe(2)
    expect((db.prepare('SELECT grade, bpm FROM analysis WHERE file_id = 2').get() as { grade: string }).grade).toBe('A') // lo medido se conserva hasta el nuevo análisis
    reanalyzeTrack(db, 4)
    expect((db.prepare('SELECT error FROM files WHERE id = 4').get() as { error: string | null }).error).toBeNull()
    expect(reanalyzeTrack(db, 1)).toMatch(/todavía no se había analizado/)
  })
  it('un tema que no existe, o abierta solo para mirar, no hace nada', () => {
    expect(() => reanalyzeTrack(db, 999)).toThrow(/ya no está/)
    process.env.PAILA_SOLO_LECTURA = '1'
    expect(() => reanalyzeTrack(db, 3)).toThrow(/solo para mirar/)
    expect((db.prepare('SELECT version FROM analysis WHERE file_id = 3').get() as { version: number }).version).toBe(1)
  })
})
