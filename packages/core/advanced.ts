// Modo avanzado: la cola del análisis (qué espera y por qué), el registro de operaciones (lo que PAILA hizo o dejó a medias sobre
// archivos) y "reanalizar este tema". Las dos primeras solo leen; la tercera solo marca el análisis del tema como vencido en la base
// (no toca ningún archivo): el análisis lo vuelve a hacer en la próxima pasada. Los textos, en castellano y en inglés: `T`
// (las claves `key`, `source` y `op` no cambian con el idioma; lo que viene de la base, como el resultado del diario, sale tal cual).
import type { AnalysisQueueView, HistoryEntry, OpLogEntry, QueueItem, QueueLane, ScanStatus } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'
import { visible, type Db } from './db'
import { soloLectura } from './journal'
import { ANALYSIS_COUNT, ANALYSIS_VERSION, MISSING_PRINTS, PENDING } from './queue'
import { DJ_VERSION, MISSING_QUALITY, QUALITY_VERSION } from './reanalysis'
import { MISSING_PRECISE, PRECISE_VERSION } from './precise'
import { MISSING_SILENCE } from './silencepass'
import { SILENCE_VERSION } from './analysis/silence'

const T = textos({
  analisis: { es: 'Análisis de cero', en: 'Analysis from scratch' },
  analisisAyuda: {
    es: 'Temas nuevos, que cambiaron desde que se analizaron, o analizados con un motor viejo. Una sola lectura saca la calidad, el BPM, el tono y las dos huellas.',
    en: 'New tracks, tracks that changed since they were analyzed, or tracks analyzed with an old engine. A single read gets the quality, the BPM, the key and both fingerprints.',
  },
  nunca: { es: 'nunca se analizó', en: 'never analyzed' },
  cambio: { es: 'cambió o su análisis es de un motor viejo', en: 'it changed, or its analysis is from an old engine' },
  huellas: { es: 'Huellas', en: 'Fingerprints' },
  huellasAyuda: {
    es: 'Temas ya analizados a los que les falta la huella del sonido y la acústica (sirven para encontrar repetidos y reconocer temas).',
    en: 'Tracks already analyzed that are missing the audio fingerprint and the acoustic fingerprint (they help find duplicates and recognize tracks).',
  },
  faltaHuella: { es: 'le falta la huella', en: 'missing the fingerprint' },
  calidad: { es: 'Calidad, BPM y tono con el motor nuevo', en: 'Quality, BPM and key with the new engine' },
  calidadAyuda: {
    es: 'Temas cuya nota de calidad (o BPM y tono) viene de una versión vieja del motor: se vuelven a medir sin repetir todo.',
    en: 'Tracks whose quality grade (or BPM and key) comes from an old version of the engine: they get measured again without redoing everything.',
  },
  calidadVieja: { es: 'la calidad es de un motor viejo', en: 'the quality is from an old engine' },
  faltaBpm: { es: 'falta el BPM y el tono', en: 'the BPM and key are missing' },
  silencios: { es: 'Silencios al principio y al final', en: 'Silence at the start and at the end' },
  silenciosAyuda: {
    es: 'Temas ya analizados a los que les falta medir si tienen un silencio largo al empezar o al terminar: se lee solo el principio y el final.',
    en: "Tracks already analyzed that haven't been checked for a long silence at the start or at the end: only the start and the end are read.",
  },
  sinMedir: { es: 'sin medir', en: 'not measured' },
  precisa: { es: 'Pasada precisa de BPM y tono', en: 'Precise pass for BPM and key' },
  precisaAyuda: {
    es: 'En segundo plano y con menos apuro: vuelve a escuchar el BPM y el tono con otros métodos para confirmarlos (no cambia valores).',
    en: "In the background and with less hurry: it listens to the BPM and the key again with other methods to confirm them (it doesn't change any values).",
  },
  sinConfirmar: { es: 'sin confirmar', en: 'not confirmed' },
  trabajando: { es: 'trabajando', en: 'working' },
  recuperada: { es: 'recuperada', en: 'recovered' },
  enCurso: { es: (fase: string) => `en curso (${fase})`, en: (fase: string) => `in progress (${fase})` },
  deshecha: { es: 'deshecha', en: 'undone' },
  hecha: { es: 'hecha', en: 'done' },
  soloMirar: { es: 'PAILA está abierta solo para mirar (PAILA_SOLO_LECTURA): no se reanaliza nada.', en: "PAILA is open just for looking (PAILA_SOLO_LECTURA): nothing gets analyzed again." },
  yaNoEsta: { es: 'Ese tema ya no está en la base.', en: "That track isn't in the database anymore." },
  enCola: { es: 'Listo: el tema quedó en la cola y se analiza de nuevo en la próxima pasada del análisis.', en: "Done: the track is in the queue and gets analyzed again in the analysis's next pass." },
  noAnalizado: { es: 'Ese tema todavía no se había analizado: ya está en la cola.', en: "That track hadn't been analyzed yet: it's already in the queue." },
})

const NEXT = 8
const nameOf = (r: { rel: string }) => r.rel

/** Cada pasada del análisis, en el orden en que corren: cuántos temas espera y los primeros. */
export function analysisQueue(db: Db, status: Pick<ScanStatus, 'running' | 'job' | 'phase' | 'probed' | 'toProbe' | 'current' | 'paused'>): AnalysisQueueView {
  const q = <R>(sql: string, ...p: number[]) => { try { return db.prepare(sql).all(...p) as unknown as R[] } catch { return [] as R[] } }
  const lane = (key: string, label: string, help: string, from: string, where: string, params: number[], why: (r: Record<string, unknown>) => string, extra = ''): QueueLane => {
    const count = q<{ n: number }>(`SELECT COUNT(*) n ${from} WHERE ${where}`, ...params)[0]?.n ?? 0
    const next = count ? q<{ id: number; rel: string } & Record<string, unknown>>(`SELECT f.id, f.rel_path rel${extra} ${from} WHERE ${where} ORDER BY f.id LIMIT ${NEXT}`, ...params).map((r): QueueItem => ({ id: r.id, rel: nameOf(r), why: why(r) })) : []
    return { key, label, help, count, next }
  }
  const lanes: QueueLane[] = [
    lane('analisis', T.analisis, T.analisisAyuda,
      `FROM files f LEFT JOIN ${ANALYSIS_COUNT} ON a.file_id = f.id`, PENDING, [ANALYSIS_VERSION],
      (r) => (r.has == null ? T.nunca : T.cambio), ', a.file_id AS has'),
    lane('huellas', T.huellas, T.huellasAyuda,
      `FROM files f JOIN ${ANALYSIS_COUNT} ON a.file_id = f.id`, `${visible('f')} AND f.kind != 'produccion' AND ${MISSING_PRINTS}`, [ANALYSIS_VERSION], () => T.faltaHuella),
    lane('calidad', T.calidad, T.calidadAyuda,
      `FROM files f JOIN ${ANALYSIS_COUNT} ON a.file_id = f.id`, `${visible('f')} AND ${MISSING_QUALITY}`, [ANALYSIS_VERSION, QUALITY_VERSION, DJ_VERSION],
      (r) => (Number(r.quality_v ?? 1) < QUALITY_VERSION ? T.calidadVieja : T.faltaBpm), ', a.quality_v AS quality_v'),
    lane('silencios', T.silencios, T.silenciosAyuda,
      `FROM files f JOIN ${ANALYSIS_COUNT} ON a.file_id = f.id`, `${visible('f')} AND ${MISSING_SILENCE}`, [ANALYSIS_VERSION, SILENCE_VERSION], () => T.sinMedir),
    lane('precisa', T.precisa, T.precisaAyuda,
      `FROM files f JOIN ${ANALYSIS_COUNT} ON a.file_id = f.id`, `${visible('f')} AND ${MISSING_PRECISE}`, [ANALYSIS_VERSION, DJ_VERSION, PRECISE_VERSION], () => T.sinConfirmar),
  ]
  const failed = q<{ id: number; rel: string; fe: string | null; ae: string | null }>(
    `SELECT f.id, f.rel_path rel, f.error fe, a.error ae FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND (f.error IS NOT NULL OR a.error IS NOT NULL) ORDER BY f.id LIMIT 25`,
  ).map((r) => ({ id: r.id, rel: r.rel, why: String(r.fe ?? r.ae ?? '').slice(0, 200) }))
  return { running: status.running ? (status.job ?? T.trabajando) : '', phase: status.phase, probed: status.probed, toProbe: status.toProbe, current: status.current, paused: status.paused, lanes, failed }
}

/** Lo que PAILA hizo (el Historial) y lo que está en el diario de operaciones, del más nuevo al más viejo. */
export function operationLog(db: Db, history: HistoryEntry[], limit = 200): OpLogEntry[] {
  let diario: OpLogEntry[] = []
  try {
    diario = (db.prepare('SELECT id, op, phase, result, message, src_rel, dst_rel, started_at, recovered_at FROM op_journal ORDER BY id DESC LIMIT ?').all(limit) as {
      id: number; op: string; phase: string; result: string | null; message: string | null; src_rel: string | null; dst_rel: string | null; started_at: string; recovered_at: string | null }[])
      .map((r) => ({
        id: r.id, source: 'diario' as const, op: r.op, state: r.result ?? (r.recovered_at ? T.recuperada : T.enCurso(r.phase)), at: r.started_at,
        detail: [r.src_rel && r.dst_rel ? `${r.src_rel} → ${r.dst_rel}` : r.src_rel ?? r.dst_rel, r.message].filter(Boolean).join(' — '), files: 1,
      }))
  } catch { /* base sin diario */ }
  const hechas = history.map((h): OpLogEntry => ({ id: h.id, source: 'historial', op: h.kind, state: h.undone ? T.deshecha : T.hecha, at: h.at, detail: h.summary, files: h.files }))
  return [...diario, ...hechas].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit)
}

/**
 * Marca el análisis de un tema como vencido para que el análisis lo haga de nuevo en la próxima pasada (conserva todo lo medido
 * hasta que el nuevo análisis lo reemplace) y borra su error de lectura, si tenía. No toca el archivo. Devuelve una frase para la interfaz.
 */
export function reanalyzeTrack(db: Db, id: number): string {
  if (soloLectura()) throw new Error(T.soloMirar)
  const f = db.prepare('SELECT id, rel_path AS rel FROM files WHERE id = ?').get(id) as { id: number; rel: string } | undefined
  if (!f) throw new Error(T.yaNoEsta)
  db.prepare('UPDATE files SET error = NULL WHERE id = ?').run(id)
  const had = db.prepare('UPDATE analysis SET version = 0 WHERE file_id = ?').run(id).changes
  return had ? T.enCola : T.noAnalizado
}
