// Regla de estilo de la etapa 6 del MASTERPLAN-5 (hallazgo 7 de la revisión del 02/11): todo lo que se toca tiene forma de botón.
//  1. Un <div>, <span>, <li>… con onClick tiene que decir que es un botón (role="button", que con conTeclado() también llega con Tab y
//     se abre con Enter) o no es un renglón tocable. Si no, el mouse lo toca y el teclado y el lector de pantalla no lo ven.
//  2. Los enlaces (.link) llevan su subrayado siempre, no solo al pasar el mouse (styles/base.css).
//  3. Un enlace no va adentro de un <button> como <span className="link"> sin teclado.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const UI = path.join(__dirname, '..', 'apps', 'paila', 'ui', 'src')
const TAGS = ['div', 'span', 'li', 'p', 'section', 'td', 'tr', 'img', 'h1', 'h2', 'h3', 'h4', 'label', 'header', 'article']
/** Lo que se puede tocar sin ser un botón, con su motivo. La clave es "archivo: clase del elemento". */
const SIN_ROL: Record<string, string> = {
  'CommandPalette.tsx: modal-back': 'el fondo que cierra la paleta al tocar afuera (Esc también cierra)',
  'CommandPalette.tsx: palette': 'solo frena el clic para que no llegue al fondo',
  'toast.tsx: toast': 'el aviso se cierra solo; tocarlo es un atajo',
  // Estas pantallas son de la Etapa 5 (Sonido), que corre en paralelo: se arreglan ahí.
  'Silencios.tsx: box-head': 'Etapa 5 (Sonido)',
  'TrackTable.tsx: tr': 'la tabla entera se maneja con el teclado (flechas, Enter y Espacio en el cuerpo de la tabla)',
}

/** Las etiquetas que abren, enteras: terminan en el primer ">" fuera de llaves. */
function aperturas(src: string): string[] {
  const out: string[] = []
  for (const tag of TAGS) {
    for (let i = src.indexOf(`<${tag}`); i >= 0; i = src.indexOf(`<${tag}`, i + 1)) {
      if (/\w/.test(src[i + tag.length + 1] ?? '')) continue
      let j = i, hondo = 0
      for (; j < src.length; j++) { const c = src[j]; if (c === '{') hondo++; else if (c === '}') hondo--; else if (c === '>' && hondo === 0 && src[j - 1] !== '=') break }
      out.push(src.slice(i, j + 1))
    }
  }
  return out
}
const clase = (a: string) => /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(a)?.slice(1).find(Boolean)?.split(/\s+/)[0] ?? ''

describe('estilo: lo que se toca parece botón (MASTERPLAN-5, etapa 6)', () => {
  const archivos = fs.readdirSync(UI).filter((f) => f.endsWith('.tsx'))
  const tocables = archivos.flatMap((f) => aperturas(fs.readFileSync(path.join(UI, f), 'utf8')).filter((a) => /\sonClick=/.test(a)).map((a) => ({ f, a })))

  it('encuentra los elementos con onClick (si no, la regla no mira nada)', () => {
    expect(tocables.length).toBeGreaterThan(15)
  })
  it('ningún <div>, <span>, <li>… con onClick deja de ser un botón (role="button" o conTeclado)', () => {
    const malos = tocables.filter(({ a }) => !/role="button"|role=\{[^}]*'button'|conTeclado\(/.test(a)).map(({ f, a }) => `${f}: ${clase(a)}`).filter((k) => !(k in SIN_ROL))
    expect(malos).toEqual([])
  })
  it('las excepciones siguen existiendo (si una se arregló, se saca de la lista)', () => {
    const hoy = new Set(tocables.filter(({ a }) => !/role="button"|role=\{[^}]*'button'|conTeclado\(/.test(a)).map(({ f, a }) => `${f}: ${clase(a)}`))
    expect(Object.keys(SIN_ROL).filter((k) => !hoy.has(k))).toEqual([])
  })
  it('los enlaces llevan su subrayado siempre', () => {
    const css = fs.readFileSync(path.join(UI, 'styles', 'base.css'), 'utf8')
    expect(css).toMatch(/\.link\s*\{[^}]*text-decoration:\s*underline/)
  })
})
