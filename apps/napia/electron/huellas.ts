// NAPIA: lo que necesita la comparación por el sonido (core/sockseek/huella.ts). La huella de tu copia sale de la base de
// PAILA, abierta solo para leer; para los temas que no tenés se le pregunta a AcoustID con la clave de fábrica de PAILA (la
// misma del instalador, claves.local.json). Sin base o sin clave, no se compara y todo sigue como antes.
import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { pailaDbCandidates } from '@paila/core/sockseek/paila'
import { AcoustId } from '@paila/core/online/sources'
import { esElPedido } from '@paila/core/sockseek/huella'

declare const __NAPIA_ACOUSTID__: string | undefined
const CLAVE = typeof __NAPIA_ACOUSTID__ !== 'undefined' ? __NAPIA_ACOUSTID__ : undefined

let db: DatabaseSync | null | undefined
function base(): DatabaseSync | null {
  if (db !== undefined) return db
  const f = pailaDbCandidates(app.getPath('appData'), process.env.PORTABLE_EXECUTABLE_DIR, process.env.PAILA_USER_DATA).find((x) => fs.existsSync(x))
  try { db = f ? new DatabaseSync(f, { readOnly: true }) : null } catch { db = null }
  return db
}
app.once('will-quit', () => { try { db?.close() } catch { /* ya cerrada */ } })

/** La huella de un tema de PAILA (comprimida), o null. */
export function huellaTuya(id: number): string | null {
  try { return (base()?.prepare('SELECT chromaprint FROM analysis WHERE file_id = ?').get(id) as { chromaprint: string | null } | undefined)?.chromaprint ?? null } catch { return null }
}

let ac: AcoustId | null | undefined
/** ¿AcoustID dice que el audio es ese tema? null: sin clave, sin internet o no lo conoce. */
export async function reconocer(huella: string, duracion: number, fila: { artist: string; title: string }): Promise<boolean | null> {
  if (ac === undefined) ac = CLAVE ? new AcoustId(CLAVE, `NAPIA/${app.getVersion()}`) : null
  if (!ac) return null
  return esElPedido(await ac.lookup(huella, duracion), fila.artist, fila.title)
}
