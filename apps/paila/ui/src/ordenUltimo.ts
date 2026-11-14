// La regla y la carpeta con que se ordenó la última vez, para que Organizar arranque así en esta ventana. Cuántos temas quedaron
// fuera de su carpeta ya no sale de acá: lo cuenta el estado de la colección (core/estado.ts) con la regla guardada en la base.
const CLAVE = 'paila.organizar.ultima'

/** La regla de fábrica de Organizar (la primera de la lista). */
export const REGLA_DE_FABRICA = '%artista%/%año% - %album%/%n% - %titulo%' // idioma-ok: la regla la entiende el programa, en castellano
export const CARPETA_DE_FABRICA = 'Biblioteca' // idioma-ok: nombre de la carpeta que PAILA crea

export interface Orden { rule: string; dest: string; soloCarpetas?: boolean }

export function recordarOrden(o: Orden) {
  try { localStorage.setItem(CLAVE, JSON.stringify(o)) } catch { /* sin almacenamiento: se usa la de fábrica */ }
}

/** La última con que se ordenó en esta ventana; null si no hay. */
export function ordenRecordado(): Orden | null {
  try { const o = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as Orden | null; if (o?.rule && o.dest) return o } catch { /* rota */ }
  return null
}
/** La última con que se ordenó; si no se sabe (se ordenó antes de que se anotara), la de fábrica. */
export const ultimoOrden = (): Orden => ordenRecordado() ?? { rule: REGLA_DE_FABRICA, dest: CARPETA_DE_FABRICA }
