// "G + letra" (apps/paila/ui/src/atajos.ts): las mismas letras en castellano y en inglés (decisión del autor, 24/10/2026); los
// nombres sí se traducen. Las letras no se repiten, la G queda libre y la ayuda de Ctrl+/ las muestra con el nombre del idioma.
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ponerIdioma, type Idioma } from '@paila/shared/idioma'

async function atajos(i: Idioma) {
  // las letras se eligen al cargar el módulo, como en la ventana (que recarga al cambiar de idioma): el módulo de idioma
  // nuevo lo toma de pailaIdioma, como lo deja el preload
  (globalThis as { pailaIdioma?: Idioma }).pailaIdioma = i
  vi.resetModules()
  return import('../apps/paila/ui/src/atajos')
}
afterAll(() => { delete (globalThis as { pailaIdioma?: Idioma }).pailaIdioma; ponerIdioma('es') })

describe('G + letra en los dos idiomas', () => {
  for (const i of ['es', 'en'] as Idioma[]) {
    it(`${i}: una letra por pantalla, sin la G`, async () => {
      const { IR_A } = await atajos(i)
      const letras = IR_A.map((x) => x.tecla)
      expect(new Set(letras).size).toBe(letras.length)
      expect(letras).not.toContain('G')
      for (const l of letras) expect(l).toMatch(/^[A-Z]$/)
    })
  }

  it('las mismas letras en los dos idiomas; los nombres, traducidos', async () => {
    const es = (await atajos('es')).IR_A
    const { IR_A: en, ATAJOS } = await atajos('en')
    expect(en.map((x) => [x.page, x.tecla])).toEqual(es.map((x) => [x.page, x.tecla]))
    const de = (p: string) => en.find((x) => x.page === p)!
    expect(de('home')).toMatchObject({ tecla: 'I', nombre: 'Home' })
    expect(de('inbox')).toMatchObject({ tecla: 'T', nombre: 'Inbox' })
    expect(es.find((x) => x.page === 'home')?.nombre).toBe('Inicio')
    // la ayuda de Ctrl+/ muestra la letra con el nombre del idioma
    expect(ATAJOS.at(-1)!.items.find((x) => x.hace === 'Home')?.teclas).toBe('G  I')
  })
})
