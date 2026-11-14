// Tests del resumen de la pantalla Análisis (core/insights.ts): con los índices de la migración v18 da lo mismo que las
// consultas de antes (una por número, recorriendo la tabla entera), y las consultas usan los índices.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDb, transaction, visible, type Db } from '@paila/core/db'
import { insights } from '@paila/core/insights'
import { ANALYSIS_COUNT, ANALYSIS_VERSION, MISSING_PRINTS, pendingPrints } from '@paila/core/queue'
import { DJ_VERSION, MISSING_QUALITY, QUALITY_VERSION, pendingQuality } from '@paila/core/reanalysis'
import { MISSING_PRECISE, PRECISE_VERSION, pendingPrecise } from '@paila/core/precise'
import { MISSING_SILENCE, pendingSilence } from '@paila/core/silencepass'
import { SILENCE_VERSION } from '@paila/core/analysis/silence'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-insights-'))
let db: Db
afterAll(() => { db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

/** Una base chica con de todo: visibles y no, samples, con y sin análisis, versiones viejas, sin huellas, marcas, empates. */
function seed(db: Db) {
  let s = 7
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  transaction(db, () => {
    db.exec("INSERT INTO volumes (serial, label, last_mount) VALUES ('X', 'X', 'C:\\\\')")
    db.exec("INSERT INTO roots (volume_id, rel_path, added_at) VALUES (1, 'M', '2026-01-01')")
    const f = db.prepare(`INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, title, error, trashed_at, missing_at, excluded_at)
      VALUES (1, ?, ?, 5, ?, 'mp3', ?, ?, ?, ?, ?)`)
    const a = db.prepare(`INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, flags, bpm, lufs, camelot, error, prints_at)
      VALUES (?, ?, ?, 5, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const kinds = ['musica', 'musica', 'musica', 'produccion', 'sets', 'revisar']
    for (let i = 1; i <= 400; i++) {
      const hide = rnd()
      f.run(`t${i}.mp3`, 100 + (i % 3), kinds[i % kinds.length], rnd() < 0.2 ? null : `Tema ${i}`, rnd() < 0.05 ? 'roto' : null,
        hide < 0.05 ? '2026-01-02' : null, hide > 0.95 ? '2026-01-02' : null, hide > 0.9 && hide <= 0.95 ? '2026-01-02' : null)
      if (rnd() < 0.15) continue
      const recent = new Date(Date.now() - (rnd() < 0.3 ? 60_000 : 3600_000) - i * 1000).toISOString()
      a.run(i, rnd() < 0.1 ? 0 : ANALYSIS_VERSION, rnd() < 0.1 ? 999 : 100 + (i % 3), recent, ['A', 'B', 'C', 'D', 'F', null][i % 6],
        [null, null, 'fake_lossless', 'upscaled,bpm_doubtful', 'maybe_transcoded', 'reencoded', 'x_fake_losslessy'][i % 7],
        rnd() < 0.1 ? null : [60, 128, 128, 174, 219, 230, 40][i % 7], rnd() < 0.1 ? null : [-8, -8, -20, -75, -3][i % 5],
        rnd() < 0.2 ? null : `${(i % 12) + 1}${i % 2 ? 'A' : 'B'}`, rnd() < 0.05 ? 'no se pudo' : null, rnd() < 0.4 ? null : '2026-01-03')
    }
  })
}

/** El resumen como se calculaba antes de la v18 (solo los números que cambiaron de consulta). */
function before(db: Db) {
  const one = <T>(sql: string, ...p: (string | number)[]) => db.prepare(sql).get(...p) as T
  const since = new Date(Date.now() - 5 * 60_000).toISOString()
  const flagCount = (...flags: string[]) => one<{ n: number }>(`SELECT COUNT(*) n FROM analysis WHERE ${flags.map(() => "(',' || COALESCE(flags,'') || ',') LIKE ?").join(' OR ')}`, ...flags.map((f) => `%,${f},%`)).n
  return {
    total: one<{ n: number }>(`SELECT COUNT(*) n FROM files f WHERE f.error IS NULL AND f.kind != 'produccion' AND ${visible('f')}`).n,
    done: one<{ n: number }>(`SELECT COUNT(*) n FROM analysis a JOIN files f ON f.id = a.file_id WHERE f.kind != 'produccion' AND ${visible('f')} AND a.version >= ?`, ANALYSIS_VERSION).n,
    recentN: one<{ n: number }>(`SELECT COUNT(*) n FROM analysis a JOIN files f ON f.id = a.file_id WHERE f.kind != 'produccion' AND ${visible('f')} AND a.analyzed_at > ?`, since).n,
    prints: pendingPrints(db),
    fakeLossless: flagCount('fake_lossless', 'maybe_transcoded'), upscaled: flagCount('upscaled', 'reencoded'),
  }
}

describe('resumen de Análisis', () => {
  db = openDb(path.join(dir, 'paila.db'))
  seed(db)

  it('da lo mismo que las consultas de antes', () => {
    const now = insights(db), old = before(db)
    expect({ total: now.total, done: now.done, recentN: Math.round(now.perMinute * 5), prints: now.prints, fakeLossless: now.curiosities.fakeLossless, upscaled: now.curiosities.upscaled })
      .toEqual({ ...old, recentN: old.recentN })
    expect(now.total).toBeGreaterThan(100)
    expect(now.prints).toBeGreaterThan(0)
    // con empate de BPM gana siempre el mismo: el tema más nuevo
    const fastest = db.prepare(`SELECT f.title FROM analysis a JOIN files f ON f.id = a.file_id WHERE a.bpm < 220 AND f.kind = 'musica' ORDER BY a.bpm DESC, a.file_id DESC LIMIT 1`).get() as { title: string | null }
    expect(now.curiosities.fastest?.bpm).toBe(219)
    if (fastest.title) expect(now.curiosities.fastest?.title).toBe(fastest.title)
  })

  it('las consultas usan los índices (no recorren la tabla entera)', () => {
    const plan = (sql: string) => (db.prepare('EXPLAIN QUERY PLAN ' + sql).all() as { detail: string }[]).map((r) => r.detail).join(' | ')
    expect(plan(`SELECT f.id FROM analysis a CROSS JOIN files f ON f.id = a.file_id WHERE f.kind != 'produccion' AND ${visible('f')} ORDER BY a.analyzed_at DESC, a.file_id DESC LIMIT 12`)).toContain('analysis_analyzed_at')
    expect(plan("SELECT grade, COUNT(*) n FROM analysis WHERE grade IS NOT NULL GROUP BY grade")).toContain('analysis_grade')
    expect(plan("SELECT COUNT(*) n FROM analysis WHERE flags IS NOT NULL AND (',' || flags || ',') LIKE '%,x,%'")).toContain('analysis_flags')
    expect(plan("SELECT a.bpm FROM analysis a CROSS JOIN files f ON f.id = a.file_id WHERE a.bpm IS NOT NULL AND f.kind = 'musica' AND a.bpm < 220 ORDER BY a.bpm DESC, a.file_id DESC LIMIT 1")).toContain('analysis_bpm')
  })

  it('los conteos de pendientes usan el índice "resumen" (v41) y dan lo mismo que recorriendo la tabla', () => {
    const plan = (sql: string) => (db.prepare('EXPLAIN QUERY PLAN ' + sql).all() as { detail: string }[]).map((r) => r.detail).join(' | ')
    const sql = (from: string, where: string) => `SELECT COUNT(*) AS n FROM files f JOIN ${from} ON a.file_id = f.id WHERE ${visible('f')} AND ${where}`
    const count = (from: string, where: string, ...p: number[]) => (db.prepare(sql(from, where)).get(...p) as { n: number }).n
    const cases: [string, number[], number][] = [
      [`f.kind != 'produccion' AND ${MISSING_PRINTS}`, [ANALYSIS_VERSION], pendingPrints(db)],
      [MISSING_QUALITY, [ANALYSIS_VERSION, QUALITY_VERSION, DJ_VERSION], pendingQuality(db)],
      [MISSING_PRECISE, [ANALYSIS_VERSION, DJ_VERSION, PRECISE_VERSION], pendingPrecise(db)],
      [MISSING_SILENCE, [ANALYSIS_VERSION, SILENCE_VERSION], pendingSilence(db)],
    ]
    for (const [where, p, now] of cases) {
      expect(now).toBe(count('analysis a NOT INDEXED', where, ...p))
      expect(plan(sql(ANALYSIS_COUNT, where))).toContain('COVERING INDEX analysis_resumen')
    }
    // el resumen cuenta lo mismo que cada pendiente por separado
    const r = insights(db)
    expect([r.prints, r.quality, r.precise]).toEqual([cases[0][2], cases[1][2], cases[2][2]])
    // como lo cuenta el resumen: todos los temas, con o sin análisis
    expect(plan(`SELECT SUM(a.version >= 1), SUM(${MISSING_PRINTS.replace('?', '1')}) FROM files f LEFT JOIN ${ANALYSIS_COUNT} ON a.file_id = f.id WHERE ${visible('f')}`))
      .toContain('COVERING INDEX analysis_resumen')
  })
})
