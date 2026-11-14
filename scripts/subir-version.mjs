// `npm run version:subir -- 0.3.0`: sube el número de versión de PAILA y NAPIA juntos (van en el mismo instalador).
// Antes hay que escribir lo nuevo en docs/NOVEDADES.md ("## 0.3.0 · fecha: título") y en inglés en docs/NOVEDADES.en.md: si falta, no sube nada.
import fs from 'node:fs'
import path from 'node:path'

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..')
export const APPS = ['apps/paila', 'apps/napia']

const leer = (raiz, f) => JSON.parse(fs.readFileSync(path.join(raiz, f), 'utf8'))
// package-lock.json lo escribe npm (2 espacios y un salto al final): se respeta, así el cambio en git es solo el número
const escribir = (raiz, f, j) => fs.writeFileSync(path.join(raiz, f), JSON.stringify(j, null, 2) + '\n')
/** En los package.json se cambia solo el renglón de la versión: están acomodados a mano y no se tocan. */
function cambiarVersion(raiz, f, nueva) {
  const p = path.join(raiz, f)
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${nueva}$2`))
}

/** -1, 0 o 1 entre dos versiones "1.2.3". */
export function comparar(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

/** Sube la versión en `raiz`. Devuelve qué hizo, o tira un error en castellano que dice qué falta. */
export function subirVersion(raiz, nueva) {
  if (!/^\d+\.\d+\.\d+$/.test(nueva ?? '')) throw new Error('Decime la versión nueva, así: npm run version:subir -- 0.3.0')
  const actual = leer(raiz, `${APPS[0]}/package.json`).version
  if (comparar(nueva, actual) <= 0) throw new Error(`La versión nueva (${nueva}) tiene que ser mayor que la actual (${actual}).`)
  const md = fs.readFileSync(path.join(raiz, 'docs', 'NOVEDADES.md'), 'utf8')
  const tiene = (texto) => new RegExp(`^##\\s+${nueva.replace(/\./g, '\\.')}\\b`, 'm').test(texto)
  if (!tiene(md)) throw new Error(`Falta la entrada de ${nueva} en docs/NOVEDADES.md ("## ${nueva} · día/mes/año: título" y qué cambió). Escribila y repetí.`)
  // la de inglés (docs/NOVEDADES.en.md), si el proyecto la tiene: la app muestra la del idioma elegido
  const en = path.join(raiz, 'docs', 'NOVEDADES.en.md')
  if (fs.existsSync(en) && !tiene(fs.readFileSync(en, 'utf8'))) throw new Error(`Falta la entrada de ${nueva} en docs/NOVEDADES.en.md (la misma, en inglés: "## ${nueva} · día/mes/año: title"). Escribila y repetí.`)
  for (const app of APPS) cambiarVersion(raiz, `${app}/package.json`, nueva)
  const lock = 'package-lock.json'
  if (fs.existsSync(path.join(raiz, lock))) {
    const j = leer(raiz, lock)
    for (const app of APPS) if (j.packages?.[app]) j.packages[app].version = nueva
    escribir(raiz, lock, j)
  }
  return `PAILA y NAPIA pasan de ${actual} a ${nueva}. Falta: commit, npm run dist y el instalador.`
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  try { console.log(subirVersion(RAIZ, process.argv[2])) } catch (e) { console.error(e.message); process.exitCode = 1 }
}
