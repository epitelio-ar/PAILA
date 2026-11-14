// "Deshacer lo último" de la barra de arriba (punto 1 real, 24/10/2026): después de mandar 1.039 duplicados a la papelera seguía
// diciendo "Deshacer lo último (2 cambios)" por una tapa de ayer. Ahora es lo último del Historial, de cualquier tipo, y dice
// qué deshace y cuándo (apps/paila/ui/src/ChangesBar.tsx, hooks/useChanges.ts).
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { HistoryEntry } from '@paila/shared/types'
import { ponerIdioma } from '@paila/shared/idioma'
import { claveDe, cuando, puedeDeshacer } from '../apps/paila/ui/src/ChangesBar'
import { comoDeshacer } from '../apps/paila/ui/src/History'

const ROOT = path.join(__dirname, '..')
const entrada = (e: Partial<HistoryEntry>): HistoryEntry => ({ kind: 'tags', id: 7, at: '2026-10-23T18:05:00', files: 2, summary: 'Se cambió la tapa de 2 temas', undone: false, canUndo: true, whyNot: null, ...e } as HistoryEntry)
afterAll(() => ponerIdioma('es'))

describe('Deshacer lo último', () => {
  it('sale de lo último del Historial (cualquier tipo), no de la última tanda de tags', () => {
    const hook = fs.readFileSync(path.join(ROOT, 'apps/paila/ui/src/hooks/useChanges.ts'), 'utf8')
    expect(hook).toContain('window.paila.history()')
    expect(hook).not.toContain('changeBatches')
    // lo que va a la papelera (los duplicados) también lo pone al día
    expect(hook).toContain("'paila:papelera'")
    expect(fs.readFileSync(path.join(ROOT, 'apps/paila/ui/src/App.tsx'), 'utf8')).toContain('window.paila.historyUndo(e.kind, e.id)')
    // el cuándo va aparte del resumen: si el resumen es largo y se corta, el cuándo se sigue viendo
    expect(fs.readFileSync(path.join(ROOT, 'apps/paila/ui/src/ChangesBar.tsx'), 'utf8')).toMatch(/className="small muted ultimo-cuando">\{cuando\(ultimo\.at\)\}/)
  })

  it('dice cuándo fue: hoy, ayer o el día, en los dos idiomas', () => {
    const ahora = new Date('2026-10-24T12:00:00')
    ponerIdioma('es')
    expect(cuando('2026-10-24T10:42:00', ahora)).toBe('hoy a las 10:42')
    expect(cuando('2026-10-23T18:05:00', ahora)).toBe('ayer a las 18:05')
    expect(cuando('2026-10-20T09:30:00', ahora)).toBe('el 20/10 a las 09:30')
    ponerIdioma('en')
    expect(cuando('2026-10-23T18:05:00', ahora)).toMatch(/^yesterday at 6:05\sPM$/)
    expect(cuando('2026-10-20T09:30:00', ahora)).toMatch(/^on 10\/20 at 9:30\sAM$/)
    ponerIdioma('es')
  })

  it('se ofrece solo si lo último se puede deshacer y no se ocultó', () => {
    expect(puedeDeshacer(null, null)).toBe(false)
    expect(puedeDeshacer(entrada({}), null)).toBe(true)
    expect(puedeDeshacer(entrada({ undone: true }), null)).toBe(false)
    // vaciar la papelera no se deshace: el cartel no ofrece algo más viejo
    expect(puedeDeshacer(entrada({ kind: 'vaciado' as HistoryEntry['kind'], canUndo: false }), null)).toBe(false)
    expect(puedeDeshacer(entrada({}), claveDe(entrada({})))).toBe(false)
    expect(puedeDeshacer(entrada({ id: 8 }), claveDe(entrada({})))).toBe(true) // ocultar una tanda no oculta la próxima
    // con cambios pendientes no se ofrece: se confundía con descartar lo propuesto (prueba de la persona 1, 31/10)
    expect(puedeDeshacer(entrada({}), null, 5)).toBe(false)
  })

  it('la papelera se restaura; los tags se deshacen (lo mismo que en el Historial)', () => {
    ponerIdioma('es')
    expect(comoDeshacer(entrada({ kind: 'papelera', summary: 'Se mandaron 1.039 temas a la papelera' }))).toMatchObject({ boton: 'Restaurar', restaura: true })
    expect(comoDeshacer(entrada({}))).toMatchObject({ boton: 'Deshacer', restaura: false })
  })
})
