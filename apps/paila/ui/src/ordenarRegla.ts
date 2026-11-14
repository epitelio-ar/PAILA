// La forma de las carpetas en bloques, sin códigos con % (el autor, 02/11: "esa cosa de editar con los % no tiene goyete"): los
// niveles elegidos de una lista, el nombre del archivo y dos tildes (el número del tema y el año del disco, adelante). Se pasa a
// la regla con códigos que entiende Organizar (core/organizer.ts) y de vuelta, para abrir el editor como estaba.
import type { OrganizeOptions } from '@paila/shared/types'

export type Nivel = 'artista' | 'disco' | 'anio' | 'genero'
export const NIVELES: readonly Nivel[] = ['artista', 'disco', 'anio', 'genero']
export interface Forma { niveles: Nivel[]; archivo: 'titulo' | 'artistaTitulo'; numero: boolean; anio: boolean; dest: string; soloCarpetas: boolean }

export type FormaArmada = 'discos' | 'artistas' | 'generos'
export const FORMAS: Record<FormaArmada, Pick<Forma, 'niveles' | 'archivo'>> = {
  discos: { niveles: ['artista', 'disco'], archivo: 'titulo' },
  artistas: { niveles: ['artista'], archivo: 'titulo' },
  generos: { niveles: ['genero', 'artista'], archivo: 'titulo' },
}
export const DEST_DE_FABRICA = 'Biblioteca' // idioma-ok: la carpeta que PAILA crea (no se traduce)
// sin número en el nombre del archivo (el autor, 13/11): la tilde "El número del tema adelante" arranca apagada
export const FORMA_DE_FABRICA: Forma = { ...FORMAS.discos, numero: false, anio: true, dest: DEST_DE_FABRICA, soloCarpetas: false }

const CODIGO: Record<Nivel, (f: Forma) => string> = {
  artista: () => '%artista%',
  disco: (f) => (f.anio ? '%año% - %album%' : '%album%'), // idioma-ok: los códigos de la regla
  anio: () => '%año%', // idioma-ok
  genero: () => '%genero%',
}

export function aRegla(f: Forma): OrganizeOptions {
  const archivo = (f.numero ? '%n% - ' : '') + (f.archivo === 'artistaTitulo' ? '%artista% - %titulo%' : '%titulo%')
  return { rule: [...f.niveles.map((n) => CODIGO[n](f)), archivo].join('/'), dest: f.dest.trim(), ...(f.soloCarpetas ? { soloCarpetas: true } : {}) }
}

/** De la regla con códigos a los bloques; null si tiene algo que los bloques no saben armar (se queda en el modo avanzado). */
export function deRegla(o: OrganizeOptions): Forma | null {
  const partes = o.rule.split('/')
  const ultimo = partes.pop() ?? ''
  const m = ultimo.match(/^(%n% - )?(%artista% - )?%titulo%$/)
  if (!m) return null
  let anio = false
  const niveles: Nivel[] = []
  for (const p of partes) {
    if (p === '%artista%') niveles.push('artista')
    else if (p === '%año% - %album%' || p === '%anio% - %album%') { niveles.push('disco'); anio = true } else if (p === '%album%') niveles.push('disco')
    else if (p === '%año%' || p === '%anio%') niveles.push('anio')
    else if (p === '%genero%' || p === '%género%') niveles.push('genero')
    else return null
  }
  return { niveles, archivo: m[2] ? 'artistaTitulo' : 'titulo', numero: !!m[1], anio: anio || !niveles.includes('disco'), dest: o.dest, soloCarpetas: !!o.soloCarpetas }
}

/** ¿Esta forma armada es la regla de ahora (con cualquier tilde)? Para marcar la elegida. */
export const esForma = (o: OrganizeOptions, k: FormaArmada) => { const f = deRegla(o); return !!f && f.niveles.join() === FORMAS[k].niveles.join() && f.archivo === FORMAS[k].archivo }

/**
 * Los temas de ejemplo para mostrar una forma: los que la muestran entera (con todos sus niveles), con nombre de letras (no
 * "@RemixRemixes" ni "#Ysya2020"), de carpetas distintas y salteados con una cuenta fija sobre su número, no los primeros por
 * orden alfabético (salían dos temas del mismo disco de Almafuerte, 13/11). Con la misma cuenta, las tres formas tienden a
 * mostrar los mismos temas, para compararlas.
 */
export function elegirEjemplos<M extends { fileId: number; to: string }>(moves: M[], cuantos: number, dest: string): M[] {
  const desde = dest ? 1 : 0
  const niveles = (m: M) => m.to.split('/').length
  const hondo = Math.max(0, ...moves.map(niveles))
  // y nunca uno que quedaría "(2)": un choque no es un buen ejemplo (13/11)
  const prolijo = (m: M) => niveles(m) === hondo && !/ \(\d+\)\.[^./]+$/.test(m.to) && m.to.split('/').slice(desde).every((p) => /^[\p{L}\p{N}]/u.test(p))
  const candidatos = moves.filter(prolijo).length >= cuantos ? moves.filter(prolijo) : moves
  const mezcla = (id: number) => Math.imul(id ^ 0x5bd1e995, 2654435761) >>> 0
  const out: M[] = [], vistas = new Set<string>()
  for (const m of [...candidatos].sort((a, b) => mezcla(a.fileId) - mezcla(b.fileId))) {
    const grupo = m.to.split('/')[desde] ?? ''
    if (vistas.has(grupo)) continue
    vistas.add(grupo); out.push(m)
    if (out.length >= cuantos) break
  }
  return out
}

/** "Lola (2).mp3" → "Lola.mp3": el lugar donde chocan dos temas, sin el número que PAILA le pondría a uno (la carta decía "(2)"). */
export const sinNumero = (rel: string) => rel.replace(/ \(\d+\)(\.[^./]+)$/, '$1')
