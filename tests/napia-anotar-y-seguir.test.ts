// NAPIA (24/10/2026, pedido del autor): el botón "Anotar" también en NAPIA (las notas van a la carpeta de notas de PAILA, y se ven
// juntas en Configuración → Notas de uso) y la lista de la bajada que sigue sola el avance sin arrastrar a quien subió a mirar.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { listarNotas } from '@paila/core/notasdeuso'
import { carpetaDeNotas } from '../apps/napia/electron/notas'
import { alFinal, scrollParaSeguir } from '../apps/napia/ui/src/seguirAvance'

const ROOT = path.join(__dirname, '..')
const leer = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('Anotar en NAPIA', () => {
  it('guarda en la carpeta de notas de PAILA (al lado de su base); sin PAILA, en la de NAPIA', () => {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-notas-'))
    try {
      fs.mkdirSync(path.join(t, 'PAILA'))
      expect(carpetaDeNotas(t, undefined, path.join(t, 'NAPIA'))).toBe(path.join(t, 'PAILA', 'notas-de-uso'))
      expect(carpetaDeNotas(path.join(t, 'otro'), undefined, path.join(t, 'NAPIA'))).toBe(path.join(t, 'NAPIA', 'notas-de-uso'))
      // la portable: PAILA-datos al lado del programa
      fs.mkdirSync(path.join(t, 'portable', 'PAILA-datos'), { recursive: true })
      expect(carpetaDeNotas(t, path.join(t, 'portable'), path.join(t, 'NAPIA'))).toBe(path.join(t, 'portable', 'PAILA-datos', 'notas-de-uso'))
    } finally { fs.rmSync(t, { recursive: true, force: true }) }
  })
  it('el botón, el atajo y las dos puntas están conectados, con textos en los dos idiomas', () => {
    const ui = leer('apps/napia/ui/src/Anotar.tsx')
    expect(ui).toContain("e.shiftKey && e.key.toLowerCase() === 'n'")
    expect(ui).toContain('window.napia.notaCapturar()')
    expect(ui).toContain("pantalla: pantalla.current")
    expect(leer('apps/napia/ui/src/App.tsx')).toContain('<Anotar vista={vista} />')
    expect(leer('apps/napia/electron/preload.ts')).toContain("notaGuardar: (n) => ipcRenderer.invoke('notas:guardar', n)")
    expect(leer('apps/napia/electron/notas.ts')).toContain('`NAPIA · ${n.pantalla}`') // se distingue en la lista de PAILA
    expect(listarNotas('no-existe')).toEqual([])
  })
})

describe('la lista de la bajada sigue sola el avance', () => {
  it('lleva la primera fila en curso a un poco más de la mitad de la caja (lo ya bajado queda arriba)', () => {
    expect(scrollParaSeguir(1000, 460, 0, 4000)).toBe(1000 - Math.round(460 * 0.55))
    expect(scrollParaSeguir(100, 460, 0, 4000)).toBeNull() // ya se ve: no se mueve (destino 0 = scroll actual)
    expect(scrollParaSeguir(9000, 460, 0, 4000)).toBe(4000) // nunca más allá del final
    expect(scrollParaSeguir(-1, 460, 0, 4000)).toBeNull() // sin fila en curso
    expect(scrollParaSeguir(1000, 460, 747, 4000)).toBeNull() // ya está ahí
  })
  it('si subís, no te arrastra; si bajás hasta el final, vuelve a seguir', () => {
    expect(alFinal(3540, 460, 4000)).toBe(true)
    expect(alFinal(3000, 460, 4000)).toBe(false)
    const h = leer('apps/napia/ui/src/seguirAvance.ts')
    expect(h).toContain('setSigue(alFinal(c.scrollTop, c.clientHeight, c.scrollHeight))')
    expect(h).toContain('Date.now() - propio.current < 150') // el scroll que hace la lista sola no cuenta como "subiste"
    const b = leer('apps/napia/ui/src/Bajada.tsx')
    expect(b).toContain('useSeguirAvance(cajaRef, primeraEnCurso, filas.length, running)')
    expect(b).toContain('{running && !sigue &&') // el botón "Seguir" solo mientras corre y no se la sigue
  })
})
