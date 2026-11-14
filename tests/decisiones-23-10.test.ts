// Decisiones del autor del 23/10 (docs/DECISIONES.md, "Decidido el 23/10") que viven en los textos de la interfaz:
// la casilla de la Bandeja se llama "Reemplazar solo cuando no hay dudas" (y el nombre viejo no aparece en ninguna pantalla,
// ni en NAPIA), y la pantalla de ZIP y RAR ofrece mandar el comprimido a la papelera solo cuando todo está afuera.
// El resto (la papelera de comprimidos, Géneros) se prueba en comprimidos-papelera.test.ts y genres.test.ts.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { T as BANDEJA } from '../apps/paila/ui/src/Inbox.textos'
import { T as ZIP } from '../apps/paila/ui/src/Comprimidos.textos'
import { T as BANDEJA } from '../apps/paila/ui/src/Inbox.textos'
import { T as ZIP } from '../apps/paila/ui/src/Comprimidos.textos'

const ROOT = path.join(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
/** Todos los .ts y .tsx de las interfaces y de NAPIA (sin node_modules ni lo armado). */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'out' || e.name === 'dist') continue
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) sources(rel, out); else if (/\.tsx?$/.test(e.name)) out.push(rel)
  }
  return out
}

describe('Bandeja: la casilla del reemplazo automático', () => {
  it('se llama "Reemplazar solo cuando no hay dudas", con su ⓘ', () => {
    // los textos van en pares (Inbox.textos.ts): los tests corren en castellano, así que T da el castellano
    const src = read('apps/paila/ui/src/Inbox.tsx')
    expect(BANDEJA.autoLabel.trim()).toBe('Reemplazar solo cuando no hay dudas')
    expect(src).toMatch(/checked=\{!!st\.auto\}[^\n]*\{T\.autoLabel\}/)
    expect(src).toContain('<Info tip={T.autoTip(')
    const tip = BANDEJA.autoTip('')
    expect(tip).toMatch(/^Modo automático/)
    expect(tip).toContain('cuando no hay dudas')
    expect(tip).toContain('se puede deshacer')
    expect(tip).toContain('Viene apagado')
  })

  it('el nombre viejo ("Reemplazar solo lo seguro") no queda en ninguna pantalla, ni en NAPIA', () => {
    const files = [...sources('apps/paila/ui/src'), ...sources('apps/napia'), ...sources('packages/diseno')]
    expect(files.length).toBeGreaterThan(20)
    for (const f of files) expect(read(f), f).not.toMatch(/[Rr]eemplazar solo lo seguro/)
  })
})

describe('ZIP y RAR: mandar el comprimido a la papelera', () => {
  it('la pantalla lo ofrece solo con todo afuera y nunca para un sample pack', () => {
    const src = read('apps/paila/ui/src/Comprimidos.tsx')
    expect(ZIP.mandarComprimido).toMatch(/^Mandar el comprimido a la papelera/)
    // el botón vive dentro del bloque que ya excluye los sample packs, y pide que todo esté afuera
    const bloque = src.slice(src.indexOf('!a.samplePack && a.status'), src.indexOf('archiveShow'))
    expect(bloque).toContain('{T.mandarComprimido}')
    expect(bloque).toContain('a.outside === a.audio')
  })
})
