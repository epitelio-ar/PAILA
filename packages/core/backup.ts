// Respaldos de la base de PAILA (playlists, análisis, historial, cambios pendientes). La música no se copia: solo la base.
// Uno por día al abrir la app, y uno antes de cada tanda grande que toca archivos. Se guardan los últimos.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from './db'

export interface BackupInfo { file: string; name: string; size: number; createdAt: string }

const p2 = (n: number) => String(n).padStart(2, '0')
const day = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

/**
 * Copia consistente de la base (VACUUM INTO: sirve aunque la app esté escribiendo) a `dir`.
 * `why` va en el nombre ("diario", "antes-de-organizar"…). Después borra los más viejos y deja `keep` de cada tipo.
 */
export function backupNow(db: Db, dir: string, why = 'diario', keep = 14): BackupInfo {
  fs.mkdirSync(dir, { recursive: true })
  const d = new Date()
  const name = `paila_${day(d)}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}_${why}.db`
  const file = path.join(dir, name)
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  prune(dir, why, keep)
  return { file, name, size: fs.statSync(file).size, createdAt: d.toISOString() }
}

/** El respaldo del día, si todavía no se hizo hoy. Devuelve null si ya había uno. */
export function backupDaily(db: Db, dir: string, keep = 14): BackupInfo | null {
  const today = day(new Date())
  if (list(dir).some((b) => b.name.startsWith(`paila_${today}_`) && b.name.endsWith('_diario.db'))) return null
  return backupNow(db, dir, 'diario', keep)
}

export function list(dir: string): BackupInfo[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => /^paila_.*\.db$/.test(f)).map((name) => {
    const st = fs.statSync(path.join(dir, name))
    return { file: path.join(dir, name), name, size: st.size, createdAt: st.mtime.toISOString() }
  }).sort((a, b) => b.name.localeCompare(a.name))
}

function prune(dir: string, why: string, keep: number) {
  const mine = list(dir).filter((b) => b.name.endsWith(`_${why}.db`)) // ya vienen del más nuevo al más viejo
  // Son copias de la base de PAILA hechas por PAILA (no música ni nada del usuario): las viejas sí se borran.
  for (const b of mine.slice(keep)) fs.rmSync(b.file, { force: true })
}
