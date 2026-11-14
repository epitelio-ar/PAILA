// Reglas de estilo mínimas, revisadas en cada `npm test` (y en GitHub): que el código siga fácil de leer y de cambiar.
// 1) cada archivo empieza diciendo qué hace; 2) ningún archivo crece sin control; 3) el núcleo (packages/core) no escribe en la consola;
// 4) ningún texto suelto en las pantallas: van en pares castellano/inglés (@paila/shared/idioma), salvo las que se están pasando.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { archivosDePantalla, textosSueltos } from '../scripts/textos-sueltos'
import { NO_SE_TRADUCEN, SIN_PASAR_TODAVIA } from './idioma-pendientes'

const ROOT = path.join(__dirname, '..')
const DIRS = ['packages', 'apps/paila/electron', 'apps/paila/ui/src', 'apps/napia/electron', 'apps/napia/ui/src', 'scripts', 'tests']
const CORE = 'packages/core/'
/** Tope de líneas por archivo. La meta es menos de 300: el que se acerca al tope se parte por tarea. */
const MAX_LINES = 350

const files = DIRS.flatMap((d) => fs.readdirSync(path.join(ROOT, d), { recursive: true }).map(String)
  .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !f.split(path.sep).includes('node_modules')).map((f) => path.join(d, f).split(path.sep).join('/')))
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')

describe('estilo', () => {
  it('cada archivo de código empieza con un comentario que dice qué hace', () => {
    expect(files.filter((f) => !/^\/\/ \S/.test(read(f)))).toEqual([])
  })

  it(`ningún archivo pasa de ${MAX_LINES} líneas`, () => {
    expect(files.map((f) => [f, read(f).split('\n').length] as const).filter(([, n]) => n > MAX_LINES)).toEqual([])
  })

  it('App.tsx elige la pantalla de una tabla, no de una cadena de "page === …" en una línea gigante', () => {
    expect(read('apps/paila/ui/src/App.tsx').split('\n').filter((l) => l.length > 500 || (l.match(/page === '/g) ?? []).length > 3)).toEqual([])
  })

  it('la interfaz usa el juego de íconos de @paila/diseno, no emoji ni símbolos sueltos (alerta, tilde, cruz, flechas)', () => {
    const SUELTOS = /[\u{1F300}-\u{1FAFF}☀-➿■-◿⏸⬀-⯿]/u
    const ui = files.filter((f) => /^(apps\/(paila|napia)\/ui\/src|packages\/diseno\/src)\//.test(f))
    const lineas = (f: string) => read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    expect(ui.filter((f) => lineas(f).some((l) => SUELTOS.test(l)))).toEqual([])
  })

  it('packages/core/ no escribe en la consola (avisa con onProgress, onWarn o un error en castellano)', () => {
    expect(files.filter((f) => f.startsWith(CORE) && /\bconsole\.(log|warn|error|info)\(/.test(read(f)))).toEqual([])
  })

  it('ninguna consulta repite a mano el filtro de tema visible (va con visible() o listed() de packages/core/db.ts)', () => {
    expect(files.filter((f) => f.startsWith(CORE) && f !== `${CORE}db.ts` && /trashed_at IS NULL AND (\w+\.)?missing_at IS NULL/.test(read(f)))).toEqual([])
  })

  it('ningún texto suelto en las pantallas: cada uno va en un par castellano/inglés con textos() (npm run textos -- <archivo>)', () => {
    const pantallas = archivosDePantalla(ROOT)
    const sueltos = (f: string) => textosSueltos(read(f), f)
    const revisadas = pantallas.filter((f) => !SIN_PASAR_TODAVIA.includes(f) && !(f in NO_SE_TRADUCEN))
    expect(revisadas.flatMap((f) => sueltos(f).map((x) => `${f}:${x.linea} ${x.texto}`))).toEqual([])
    // la lista solo se achica: la que ya quedó en pares (o ya no existe) se saca
    expect(SIN_PASAR_TODAVIA.filter((f) => !pantallas.includes(f) || !sueltos(f).length)).toEqual([])
  })
})
