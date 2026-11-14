// El inspector de un tema (core/inspector.ts) como texto de pantalla: bloques con su explicación, líneas "rótulo: valor"
// alineadas y listas. Lo usa `npm run tema`; la app arma lo mismo con componentes.
import type { InspectSection, TrackInspection } from '@paila/shared/types'
import { T } from './inspector.textos'

const ANCHO = 78

function ajustar(texto: string, sangria: string): string[] {
  const out: string[] = []
  let linea = ''
  for (const palabra of texto.split(/\s+/)) {
    if (linea && (sangria + linea + ' ' + palabra).length > ANCHO) { out.push(sangria + linea); linea = palabra } else linea = linea ? `${linea} ${palabra}` : palabra
  }
  if (linea) out.push(sangria + linea)
  return out
}

export function sectionText(s: InspectSection): string[] {
  const out = ['', `── ${s.title} ${'─'.repeat(Math.max(2, ANCHO - s.title.length - 4))}`]
  if (s.help) out.push(...ajustar(`(${s.help})`, '  '))
  const rows = s.rows.filter((r) => r.value !== '—')
  const w = Math.min(28, Math.max(0, ...rows.map((r) => r.label.length)))
  for (const r of rows) {
    const pedazos = ajustar(r.value, '')
    out.push(`  ${r.label.padEnd(w)}  ${pedazos[0] ?? ''}`, ...pedazos.slice(1).map((p) => `  ${''.padEnd(w)}  ${p}`))
  }
  for (const i of s.items ?? []) { const p = ajustar(i, ''); out.push(`  · ${p[0]}`, ...p.slice(1).map((x) => `    ${x}`)) }
  if (!rows.length && !(s.items ?? []).length) out.push(`  ${s.empty ?? T.sinDatos}`)
  return out
}

/** La pantalla entera de un tema. */
export function inspectionText(i: TrackInspection): string {
  return [T.temaN(i.id, i.title), T.archivoRuta(i.abs || i.rel), ...i.sections.flatMap(sectionText), ''].join('\n')
}
