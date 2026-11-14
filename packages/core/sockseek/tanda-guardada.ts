// La tanda de NAPIA queda guardada (tanda.json, en sus datos): si NAPIA se cierra mientras baja (a mano, porque se instala una
// versión nueva o porque se apagó la compu), al volver a abrirla las listas siguen en la tanda y la que estaba bajando sigue
// sola, donde quedó: sockseek saltea lo que ya bajó (su índice), así que no se repite ni se desordena nada (el autor, 1/11).
// Si la tanda se había frenado a propósito (Parar) o por un problema, vuelve frenada: no arranca sola.
import fs from 'node:fs'
import path from 'node:path'
import type { TandaItem } from '@paila/shared/napia'
import type { Tanda } from './tanda'

interface Guardada { items: TandaItem[]; frenada: { motivo: string } | null }

const congeladas = new WeakSet<Tanda>()

/** Guarda lo que falta de la tanda (lo que espera y lo que está bajando), entero o nada. */
export function guardarTanda(file: string, t: Tanda) {
  if (congeladas.has(t)) return
  const g: Guardada = { items: t.items.filter((i) => i.estado === 'espera' || i.estado === 'bajando'), frenada: t.frenada }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file + '.tmp', JSON.stringify(g))
    fs.renameSync(file + '.tmp', file)
  } catch { /* sin permiso: la próxima vez arranca vacía, como antes */ }
}

/**
 * NAPIA se está cerrando: se guarda la tanda como está ahora (la lista que baja, bajando) y ya no se toca más. Cerrar corta
 * sockseek y marca la lista como cortada, pero eso es por cerrar, no un Parar: la próxima vez tiene que seguir sola.
 */
export function congelarTanda(file: string, t: Tanda) { guardarTanda(file, t); congeladas.add(t) }

/**
 * Carga la tanda guardada en `t`. Devuelve true si hay que seguir sola: una lista estaba bajando cuando NAPIA se cerró y la
 * tanda no estaba frenada. La que estaba bajando vuelve primera, en espera.
 */
export function retomarTanda(t: Tanda, file: string): boolean {
  let g: Guardada
  try { g = JSON.parse(fs.readFileSync(file, 'utf8')) as Guardada } catch { return false }
  if (!Array.isArray(g.items) || !g.items.length) return false
  const corto = g.items.some((i) => i.estado === 'bajando')
  t.items = [...g.items.filter((i) => i.estado === 'bajando'), ...g.items.filter((i) => i.estado === 'espera')]
    .map((i) => ({ ...i, estado: 'espera' as const, resumen: null, problema: null }))
  t.frenada = g.frenada ?? null
  return corto && !t.frenada
}
