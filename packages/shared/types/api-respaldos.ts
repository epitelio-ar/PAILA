// Los pedidos de la interfaz para el respaldo de archivos por paso (core/ops/backup.ts). Aparte de api.ts para que no crezca.
import type { BackupInfo, BackupPlan } from './cleanup'

export interface RespaldosApi {
  /** Cuánto ocupa y dónde va el respaldo de aplicar estos cambios pendientes (o todos). No toca nada. */
  backupPlan(changeIds?: number[]): Promise<BackupPlan>
  /** Los respaldos hechos (sin los que están en la papelera), del más nuevo al más viejo. */
  backups(): Promise<BackupInfo[]>
  /** Manda los respaldos elegidos a la papelera de PAILA (a mano: PAILA nunca lo hace sola). Lo único que borra es Vaciar papelera. */
  backupsDelete(ids: number[]): Promise<{ moved: number; bytes: number; failed: { rel: string; error: string }[] }>
  /** Los que están en la papelera de PAILA y todavía se pueden recuperar. */
  backupsTrashed(): Promise<BackupInfo[]>
  /** Saca uno de la papelera y lo vuelve a poner donde estaba. */
  backupRestore(id: number): Promise<void>
  /** La carpeta elegida para los respaldos (null = al lado de la música, en _PAILA/respaldos de cada disco). */
  backupDir(): Promise<string | null>
  /** Elegir otra carpeta (no puede estar adentro de tu Música). null si se canceló; `error` si no sirve. */
  backupDirPick(): Promise<{ dir: string | null; error: string | null } | null>
  /** Volver a la de fábrica (al lado de la música). */
  backupDirReset(): Promise<null>
}
