// "Exportar diagnóstico" (Fase H): lo que va en el zip para cuando alguien tiene un problema, SIN datos personales:
// versión y sistema, conteos de la biblioteca, tiempos del análisis, errores agrupados y el registro de errores, todo
// pasado por `scrub`. Nunca van rutas, nombres de temas, carpetas o playlists, claves, ni la base. La pantalla muestra
// el contenido exacto antes de guardar (`diagnosticFiles` arma lo mismo para la vista previa y para el zip).
import type { Db } from './db'
import { visible } from './db'
import { scrub, type LogLine } from './errorlog'
import { makeZip } from './zip'
import { cant, textos } from '@paila/shared/idioma'

// Lo que dice cada archivo en la vista previa (se ve en la ventana). Lo que va ADENTRO del zip queda en castellano: es para
// quien programa PAILA.
const T = textos({
  leeme: { es: 'Qué es este archivo y qué no incluye.', en: "What this file is and what it doesn't include." },
  programa: { es: 'Versión de PAILA, Windows, procesador, memoria y si ffmpeg está.', en: 'PAILA version, Windows, processor, memory and whether ffmpeg is there.' },
  biblioteca: {
    es: 'Cuántos temas hay, por formato, nota y colección, y cuántas filas tiene cada tabla. Sin nombres.',
    en: 'How many tracks there are, by format, grade and collection, and how many rows each table has. No names.',
  },
  tiempos: { es: 'Cuánto tarda el análisis por formato y cuánto tardó en abrir.', en: 'How long the analysis takes per format and how long PAILA took to open.' },
  errores: { es: 'Los errores al leer y al analizar temas, agrupados (sin el nombre de los temas).', en: 'Errors when reading and analyzing tracks, grouped (without the track names).' },
  ajustes: { es: 'Qué ajustes están puestos (el valor solo de los que no pueden tener datos tuyos).', en: "Which settings are on (the value only for those that can't hold your data)." },
  registro: {
    es: (n: number) => `Los últimos ${n} errores del programa, sin rutas ni nombres.`,
    en: (n: number) => `The last ${cant(n, 'error', 'errors')} from the program, without paths or names.`,
  },
})

/** Lo que el proceso principal sabe del programa y de la PC (sin el nombre del usuario ni de la PC). */
export interface DiagnosticEnv {
  app: string; version: string; electron: string; chrome: string; node: string
  os: string; arch: string; cpu: string; cores: number; ramGb: number; freeRamGb: number; locale: string
  portable: boolean; packaged: boolean; uptimeS: number; startupMs: number | null
  ffmpeg: string | null; ffprobe: string | null; dbBytes: number; gpu?: string | null
}

export interface DiagnosticFile { name: string; what: string; content: string }

/** Ajustes cuyo valor se puede mostrar (de los demás va solo el nombre: pueden tener carpetas). */
const SAFE_SETTINGS = new Set(['online.deezer', 'online.audd', 'analysis_intensity', 'use_profile', 'dj_tools', 'ui.cabina', 'ui.densidad'])

const rows = <T>(db: Db, sql: string, ...p: (string | number)[]) => db.prepare(sql).all(...p) as T[]
const one = (db: Db, sql: string) => (db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0
const tableExists = (db: Db, t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)

/** Textos que hay que tapar además de las rutas: las carpetas raíz y los nombres de los discos. */
export function privateStrings(db: Db): string[] {
  const r = rows<{ s: string }>(db, 'SELECT rel_path AS s FROM roots UNION SELECT label FROM volumes')
  return r.flatMap((x) => [x.s, ...x.s.split(/[\\/]/)]).filter((s) => s && s.length > 2)
}

/** Conteos de la biblioteca: solo números y categorías que pone PAILA (formato, nota, tipo de colección). */
export function libraryCounts(db: Db) {
  const count = (sql: string) => Object.fromEntries(rows<{ k: string | null; n: number }>(db, sql).map((r) => [r.k ?? 'sin dato', r.n]))
  const tables = rows<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  return {
    esquema: (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    carpetasRaiz: one(db, 'SELECT COUNT(*) AS n FROM roots'),
    discos: one(db, 'SELECT COUNT(*) AS n FROM volumes'),
    temas: {
      visibles: one(db, `SELECT COUNT(*) AS n FROM files WHERE ${visible()}`),
      enPapelera: one(db, 'SELECT COUNT(*) AS n FROM files WHERE trashed_at IS NOT NULL'),
      desaparecidos: one(db, 'SELECT COUNT(*) AS n FROM files WHERE missing_at IS NOT NULL AND trashed_at IS NULL'),
      excluidos: one(db, 'SELECT COUNT(*) AS n FROM files WHERE excluded_at IS NOT NULL'),
      conErrorAlLeer: one(db, `SELECT COUNT(*) AS n FROM files WHERE error IS NOT NULL AND ${visible()}`),
    },
    porColeccion: count(`SELECT kind AS k, COUNT(*) AS n FROM files WHERE ${visible()} GROUP BY kind ORDER BY n DESC`),
    porFormato: count(`SELECT lower(ext) AS k, COUNT(*) AS n FROM files WHERE ${visible()} GROUP BY lower(ext) ORDER BY n DESC LIMIT 30`),
    analisis: {
      hechos: one(db, `SELECT COUNT(*) AS n FROM analysis a JOIN files f ON f.id = a.file_id WHERE ${visible('f')}`),
      conError: one(db, `SELECT COUNT(*) AS n FROM analysis a JOIN files f ON f.id = a.file_id WHERE a.error IS NOT NULL AND ${visible('f')}`),
      conHuellaAcustica: one(db, `SELECT COUNT(*) AS n FROM analysis a JOIN files f ON f.id = a.file_id WHERE a.chromaprint IS NOT NULL AND ${visible('f')}`),
      porNota: count(`SELECT a.grade AS k, COUNT(*) AS n FROM analysis a JOIN files f ON f.id = a.file_id WHERE ${visible('f')} GROUP BY a.grade ORDER BY a.grade`),
    },
    filasPorTabla: Object.fromEntries(tables.map((t) => [t.name, one(db, `SELECT COUNT(*) AS n FROM "${t.name}"`)])),
  }
}

/** Tiempos del análisis por formato (milisegundos por tema: mediana y el 90 % más rápido). */
export function analysisTimes(db: Db) {
  const all = rows<{ ext: string; ms: number }>(db, `SELECT lower(f.ext) AS ext, a.ms FROM analysis a JOIN files f ON f.id = a.file_id WHERE a.ms > 0 AND ${visible('f')}`)
  const by = new Map<string, number[]>()
  for (const r of all) (by.get(r.ext) ?? by.set(r.ext, []).get(r.ext)!).push(r.ms)
  const q = (v: number[], p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))]
  return [...by].map(([ext, v]) => { v.sort((a, b) => a - b); return { formato: ext, temas: v.length, medianaMs: q(v, 0.5), p90Ms: q(v, 0.9) } }).sort((a, b) => b.temas - a.temas)
}

/** Errores de lectura y de análisis, agrupados por mensaje ya sin datos personales. */
export function groupedErrors(db: Db, extra: string[]) {
  const group = (sql: string) => {
    const m = new Map<string, number>()
    for (const r of rows<{ e: string; n: number }>(db, sql)) { const k = scrub(r.e, extra).slice(0, 300); m.set(k, (m.get(k) ?? 0) + r.n) }
    return [...m].map(([error, temas]) => ({ error, temas })).sort((a, b) => b.temas - a.temas).slice(0, 60)
  }
  return {
    alLeer: group(`SELECT error AS e, COUNT(*) AS n FROM files WHERE error IS NOT NULL AND ${visible()} GROUP BY error`),
    alAnalizar: group(`SELECT a.error AS e, COUNT(*) AS n FROM analysis a JOIN files f ON f.id = a.file_id WHERE a.error IS NOT NULL AND ${visible('f')} GROUP BY a.error`),
  }
}

/** Qué ajustes hay: el valor solo de los seguros; de los demás, que existen. */
export function settingsSummary(db: Db) {
  if (!tableExists(db, 'settings')) return {}
  return Object.fromEntries(rows<{ key: string; value: string }>(db, 'SELECT key, value FROM settings ORDER BY key')
    .filter((r) => /^[a-z0-9_.]{1,40}$/i.test(r.key) && !/clave|key|secret|token/i.test(r.key))
    .map((r) => [r.key, SAFE_SETTINGS.has(r.key) ? r.value.slice(0, 60) : '(guardado)']))
}

const json = (x: unknown) => `${JSON.stringify(x, null, 2)}\n`

/** Los archivos del diagnóstico, con lo que dice cada uno. Lo mismo para la vista previa y para el zip. */
export function diagnosticFiles(db: Db, env: DiagnosticEnv, log: LogLine[], now = new Date()): DiagnosticFile[] {
  const extra = privateStrings(db)
  const cleanLog = log.map((l) => ({ at: l.at, where: scrub(l.where, extra), msg: scrub(l.msg, extra) }))
  return [
    { name: 'LEEME.txt', what: T.leeme, content: leeme(env, now) },
    { name: 'programa-y-pc.json', what: T.programa, content: json({ ...env, ffmpeg: env.ffmpeg && scrub(env.ffmpeg, extra), ffprobe: env.ffprobe && scrub(env.ffprobe, extra) }) },
    { name: 'biblioteca.json', what: T.biblioteca, content: json(libraryCounts(db)) },
    { name: 'tiempos.json', what: T.tiempos, content: json({ abrirMs: env.startupMs, abiertaHaceS: env.uptimeS, analisisPorFormato: analysisTimes(db) }) },
    { name: 'errores-agrupados.json', what: T.errores, content: json(groupedErrors(db, extra)) },
    { name: 'ajustes.json', what: T.ajustes, content: json(settingsSummary(db)) },
    { name: 'registro-de-errores.txt', what: T.registro(cleanLog.length), content: cleanLog.length ? cleanLog.map((l) => `[${l.at}] ${l.where}: ${l.msg}`).join('\n') + '\n' : '(sin errores anotados)\n' },
  ]
}

function leeme(env: DiagnosticEnv, now: Date) {
  return `Diagnóstico de ${env.app} ${env.version}, armado el ${now.toISOString()}.

Sirve para que quien programa PAILA entienda un problema. Lo mandás vos, si querés.

Qué tiene: la versión de PAILA y de Windows, el procesador y la memoria, cuántos temas hay por formato y nota, cuánto
tarda el análisis, los errores agrupados y el registro de errores del programa.

Qué NO tiene: tu música, los nombres de tus temas, carpetas o playlists, las rutas de tus archivos, tus claves de
internet, tu usuario de Windows ni la base de PAILA. Donde un error decía una ruta o un nombre, dice <ruta>, «…» o
<archivo>. Podés abrir cada archivo con el Bloc de notas para comprobarlo.
`
}

/** El zip listo para guardar. */
export function diagnosticZip(files: DiagnosticFile[], now = new Date()): Buffer {
  return makeZip(files.map((f) => ({ name: f.name, data: f.content })), now)
}
