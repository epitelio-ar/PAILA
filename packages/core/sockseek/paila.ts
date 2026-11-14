// NAPIA y PAILA: qué carpeta vigila la Bandeja de PAILA (para que lo bajado le llegue solo). Se lee la base de PAILA en
// modo solo lectura; si no está, no se puede abrir o la Bandeja no tiene carpeta, se sigue sin ella.
// Y al revés: dónde guarda NAPIA (su napia.json, cuando la carpeta quedó confirmada), para que la Bandeja la ofrezca.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Dónde puede estar la base de PAILA: la de la portable (al lado del programa) primero y la instalada después. Con `datos`
 * (PAILA_USER_DATA: el modo prueba o una copia), solo esa: si no, la prueba caería en la Bandeja de la PAILA de verdad.
 */
export function pailaDbCandidates(appData: string | undefined, portableDir?: string, datos?: string): string[] {
  if (datos) return [path.join(datos, 'paila.db')]
  return [portableDir && path.join(portableDir, 'PAILA-datos', 'paila.db'), appData && path.join(appData, 'PAILA', 'paila.db')].filter((x): x is string => !!x)
}

/** Dónde puede estar el napia.json de NAPIA: el de la portable (NAPIA-datos, al lado del programa) primero. Con `datos` (NAPIA_USER_DATA), solo ese. */
export function napiaJsonCandidates(appData: string | undefined, portableDir?: string, datos?: string): string[] {
  if (datos) return [path.join(datos, 'napia.json')]
  return [portableDir && path.join(portableDir, 'NAPIA-datos', 'napia.json'), appData && path.join(appData, 'NAPIA', 'napia.json')].filter((x): x is string => !!x)
}

/** La carpeta donde NAPIA guarda lo bajado, si se confirmó (null si NAPIA no está o todavía no la eligió). */
export function napiaFolder(files: string[]): string | null {
  for (const f of files) {
    try {
      const d = (JSON.parse(fs.readFileSync(f, 'utf8')) as { destino?: unknown }).destino
      if (typeof d === 'string' && d.trim()) return d
    } catch { /* sin NAPIA o archivo roto */ }
  }
  return null
}

const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
/** ¿La Bandeja que vigila `bandeja` (con sus subcarpetas) recibe lo que llega a `carpeta`? */
export const bandejaCubre = (bandeja: string | null, carpeta: string) => !!bandeja && (norm(carpeta) === norm(bandeja) || norm(carpeta).startsWith(norm(bandeja) + '/'))

export function bandejaFolder(dbFiles: string[]): string | null {
  for (const f of dbFiles) {
    if (!fs.existsSync(f)) continue
    try {
      const db = new DatabaseSync(f, { readOnly: true })
      try {
        const v = (db.prepare("SELECT value FROM settings WHERE key = 'inbox_dir'").get() as { value?: string } | undefined)?.value
        if (v) return v
      } finally { db.close() }
    } catch { /* base ocupada o vieja: se sigue sin la Bandeja */ }
  }
  return null
}
