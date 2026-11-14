// Regla de estilo de la etapa 2 del MASTERPLAN-5 (3.3, "un solo modelo"): en los botones no quedan los verbos viejos para lo mismo
// ("Proponer", "Pasar a Cambios pendientes", "Mandar a la papelera", "Aplicar: mover"). Proponer lo hace PAILA; en las herramientas
// sueltas el botón dice "Sumar … a lo que vas a aplicar", y para hacer está "Aplicar", uno solo, en la barra de arriba.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const UI = path.join(__dirname, '..', 'apps', 'paila', 'ui', 'src')
const VIEJOS = /^\s*(Proponer\b|Pasar\b.*Cambios pendientes|Mandar\b.*papelera|Aplicar: )|Cambios pendientes/i
/**
 * Lo que todavía aplica aparte, con su motivo: no son temas de tu Música que se repiten o se mueven (archivos que no son música en
 * Espacio, un comprimido ya abierto). Entran a la lista única con la revisión (etapa 3).
 */
const APARTE: Record<string, string[]> = {
  'Space.tsx': ['mandar'],
  'Comprimidos.tsx': ['mandarComprimido', 'mandarPapelera'],
}

/** El texto en castellano de cada clave de textos() de un archivo (y de su .textos.ts al lado). */
function textosDe(file: string): Map<string, string> {
  const fuentes = [file, file.replace(/\.tsx$/, '.textos.ts')].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8'))
  const m = new Map<string, string>()
  for (const s of fuentes) for (const x of s.matchAll(/^\s+(\w+): \{\s*es: (?:\([^)]*\) => )?(['"`])((?:\\.|(?!\2).)*)\2/gm)) m.set(x[1], x[3])
  return m
}

/**
 * Lo que va entre la etiqueta que abre y la que cierra. La que abre termina en el primer ">" fuera de llaves: los de "=>" en un onClick
 * no cuentan (están adentro de {…}).
 */
function contenidos(src: string, tag: string): string[] {
  const out: string[] = []
  for (let i = src.indexOf(`<${tag}`); i >= 0; i = src.indexOf(`<${tag}`, i + 1)) {
    if (/\w/.test(src[i + tag.length + 1] ?? '')) continue // <Botones, <buttonGroup
    let j = i, hondo = 0
    for (; j < src.length; j++) { const c = src[j]; if (c === '{') hondo++; else if (c === '}') hondo--; else if (c === '>' && hondo === 0) break }
    if (src[j - 1] === '/') continue // <Boton … /> sin contenido
    const fin = src.indexOf(`</${tag}>`, j)
    if (fin > j) out.push(src.slice(j + 1, fin))
  }
  return out
}

/** Los textos que se ven en cada botón: las claves T.algo dentro de <Boton>, <ConfirmarBoton> y <button>. */
function etiquetasDeBotones(): { file: string; key: string; es: string }[] {
  const out: { file: string; key: string; es: string }[] = []
  for (const name of fs.readdirSync(UI).filter((f) => f.endsWith('.tsx'))) {
    const file = path.join(UI, name)
    const src = fs.readFileSync(file, 'utf8'), es = textosDe(file)
    for (const tag of ['Boton', 'ConfirmarBoton', 'button']) for (const b of contenidos(src, tag)) {
      for (const k of b.matchAll(/\bT\.(\w+)/g)) if (es.has(k[1])) out.push({ file: name, key: k[1], es: es.get(k[1])! })
    }
  }
  return out
}

describe('estilo: los verbos de los botones (MASTERPLAN-5, etapa 2)', () => {
  const etiquetas = etiquetasDeBotones()
  it('encuentra los botones de las pantallas (si no, la regla no mira nada)', () => {
    expect(etiquetas.length).toBeGreaterThan(200)
    expect(etiquetas.some((e) => e.file === 'Duplicates.tsx' && e.es.startsWith('Sumar'))).toBe(true)
  })
  it('ningún botón dice "Proponer", "Pasar a Cambios pendientes", "Mandar a la papelera" ni "Aplicar: mover"', () => {
    const malos = etiquetas.filter((e) => VIEJOS.test(e.es) && !APARTE[e.file]?.includes(e.key))
    expect(malos.map((e) => `${e.file} ${e.key}: ${e.es}`)).toEqual([])
  })
  it('las excepciones siguen existiendo (si una se arregló, se saca de la lista)', () => {
    const faltan = Object.entries(APARTE).flatMap(([file, keys]) => keys.filter((k) => !etiquetas.some((e) => e.file === file && e.key === k && VIEJOS.test(e.es))).map((k) => `${file} ${k}`))
    expect(faltan).toEqual([])
  })
})
