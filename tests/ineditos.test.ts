// Inéditos (la colección 'proyectos', decidido por el autor el 23/10): PAILA reconoce por el nombre las carpetas de demos,
// promos, temas sin salir y trabajos a medias, sin confundir carpetas comunes que se parecen.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PROJECTS, analyzeFolder } from '@paila/core/collections'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-ineditos-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('inéditos', () => {
  for (const nombre of ['Demos', 'demo', 'Mis demos 2024', 'Promos', 'Promo DJ', 'Unreleased', 'Inéditos', 'Ineditos', 'Canciones inéditas', 'Inédito', 'WIP', 'wip tracks', 'Proyectos', 'Temas de amigos']) {
    it(`"${nombre}" cae en Inéditos`, () => expect(PROJECTS.test(nombre)).toBe(true))
  }
  for (const nombre of ['Rock', 'Música', 'Electrónica', 'Demon Hunter', 'Promociones', 'Swipe', 'Wipeout', 'Edición especial', 'Demolición', 'Los Redondos']) {
    it(`"${nombre}" no cae en Inéditos`, () => expect(PROJECTS.test(nombre)).toBe(false))
  }
  // repaso de criterios del 24/10: nombres de bandas con esas palabras
  for (const nombre of ['Los Amigos Invisibles', 'Proyecto Uno', 'Proyecto Coyote', 'Las Amigas de Nadie']) {
    it(`"${nombre}" es una banda: no cae en Inéditos`, () => expect(PROJECTS.test(nombre)).toBe(false))
  }
  for (const nombre of ['Proyectos', 'Mis proyectos', 'Proyecto', 'Amigos', 'De amigas']) {
    it(`"${nombre}" sigue cayendo en Inéditos`, () => expect(PROJECTS.test(nombre)).toBe(true))
  }
  it('producción: "Vocal House", "Pack Reggaeton 2010" o "Rat Pack" son música; "Vocals", "Drum Pack" o "Loops", producción', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-produccion-'))
    try {
      const musica = ['Vocal House', 'Vocal Jazz', 'Pack Reggaeton 2010', 'Rat Pack', 'Closed Loop'], prod = ['Vocals', 'Drum Pack', 'Loops', 'Stems', 'Sample Pack Techno', 'Acapellas']
      for (const n of [...musica, ...prod]) { fs.mkdirSync(path.join(d, n)); fs.writeFileSync(path.join(d, n, 'nota.txt'), 'x') }
      const kind = Object.fromEntries((await analyzeFolder(d)).suggestions.map((s) => [s.name, s.kind]))
      for (const n of musica) expect(kind[n], n).toBe('musica')
      for (const n of prod) expect(kind[n], n).toBe('produccion')
    } finally { fs.rmSync(d, { recursive: true, force: true }) }
  })
  it('al analizar una carpeta, "Promos" sale como inéditos y "Rock" sigue siendo música', async () => {
    for (const d of ['Promos', 'Rock']) { fs.mkdirSync(path.join(dir, d)); fs.writeFileSync(path.join(dir, d, 'nota.txt'), 'x') }
    const { suggestions } = await analyzeFolder(dir)
    expect(Object.fromEntries(suggestions.map((s) => [s.name, s.kind]))).toEqual({ Promos: 'proyectos', Rock: 'musica' })
  })
})
