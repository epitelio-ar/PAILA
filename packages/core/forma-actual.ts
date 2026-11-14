// La forma que ya tienen tus carpetas (corrida supervisada de Ordenar, 13/11): la primera vez, Ordenar propone como elegida la forma
// en que ya está ordenada la música, no la de fábrica. El autor ordenó en octubre "Artista / Año - Disco / Título" (sin número) y
// con la de fábrica se renombraban 948 temas ya ordenados para sumarles "NN - ". Se lee de cómo están las carpetas: la carpeta
// principal donde vive casi toda la música, si las carpetas de disco llevan el año adelante y si los archivos llevan el número.
// Solo lee la base. null = no hay una forma clara (pocos discos ordenados): queda la de fábrica.
import { visible, type Db } from './db'
import { loose } from './names'
import type { OrganizeOptions } from '@paila/shared/types'

/**
 * La forma de entrada de Ordenar cuando la música no tiene una clara: por artista y disco con el año, SIN número en el nombre del
 * archivo (decisión del autor, 13/11, docs/DECISIONES.md). Organizar sola sigue con la suya (DEFAULT_RULE).
 */
export const REGLA_ORDENAR: OrganizeOptions = { rule: '%artista%/%año% - %album%/%titulo%', dest: 'Biblioteca' } // idioma-ok: la regla y la carpeta que PAILA crea

/** Discos ordenados que hacen falta para decir "así está tu música" (con menos, cualquier forma sale de casualidad). */
const MINIMO = 20
const CON_ANIO = /^(1[89]|20)\d\d - (.+)$/
const CON_NUMERO = /^(\d{1,3}|[A-Za-z]\d{1,2})\s*[-.]\s+/

export function formaDeLaBiblioteca(db: Db): OrganizeOptions | null {
  const filas = db.prepare(`SELECT rel_path AS rel, album FROM files WHERE ${visible()} AND error IS NULL AND kind = 'musica'`).all() as { rel: string; album: string | null }[]
  if (!filas.length) return null
  // la carpeta principal: la de arriba que tiene la mitad de la música o más ("Biblioteca"); si no hay, directo en la raíz
  const arriba = new Map<string, number>()
  for (const f of filas) if (f.rel.includes('/')) arriba.set(f.rel.split('/')[0], (arriba.get(f.rel.split('/')[0]) ?? 0) + 1)
  const [top, n] = [...arriba.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  const dest = n * 2 >= filas.length ? top : ''
  // los temas que están en "Artista / Disco / archivo" con la carpeta del disco que dice su disco (con o sin el año adelante)
  const discos = new Map<string, { anio: boolean }>()
  let conNumero = 0, archivos = 0
  for (const f of filas) {
    const p = f.rel.split('/')
    if (dest && p[0] !== dest) continue
    const partes = dest ? p.slice(1) : p
    if (partes.length !== 3 || !f.album?.trim()) continue
    const carpeta = partes[1], m = carpeta.match(CON_ANIO)
    if (loose(m ? m[2] : carpeta) !== loose(f.album)) continue
    discos.set(`${partes[0]}/${carpeta}`, { anio: !!m })
    archivos++
    if (CON_NUMERO.test(partes[2])) conNumero++
  }
  if (discos.size < MINIMO) return null
  const anio = [...discos.values()].filter((d) => d.anio).length * 2 > discos.size
  const numero = conNumero * 2 > archivos
  return { rule: `%artista%/${anio ? '%año% - %album%' : '%album%'}/${numero ? '%n% - ' : ''}%titulo%`, dest } // idioma-ok: los códigos de la regla
}
