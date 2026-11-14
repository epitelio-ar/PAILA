// La nota de una versión para GitHub Releases, sacada de docs/NOVEDADES.md (castellano) y docs/NOVEDADES.en.md (inglés):
// la sección "## X.Y.Z · fecha: título" de cada uno, una abajo de la otra, y cómo comprobar los archivos. La usa el armado
// de GitHub (.github/workflows/version.yml) al crear el borrador; si falta la entrada de esa versión, corta (no se publica
// una versión sin su nota).
//
//   node scripts/notas-version.mjs <versión> [<archivo de salida>]
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** La sección de `version` en un NOVEDADES (sin el comentario de cómo se escribe), o null si no está. */
export function seccion(texto, version) {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n')
  const inicio = lineas.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`)
  if (inicio < 0) return null
  let fin = lineas.findIndex((l, i) => i > inicio && l.startsWith('## '))
  if (fin < 0) fin = lineas.length
  return lineas.slice(inicio, fin).join('\n').trim()
}

/** La nota entera: castellano, inglés y cómo comprobar los archivos con SHA256SUMS.txt. */
export function nota(raiz, version) {
  const es = seccion(fs.readFileSync(path.join(raiz, 'docs', 'NOVEDADES.md'), 'utf8'), version)
  const en = seccion(fs.readFileSync(path.join(raiz, 'docs', 'NOVEDADES.en.md'), 'utf8'), version)
  const faltan = [!es && 'docs/NOVEDADES.md', !en && 'docs/NOVEDADES.en.md'].filter(Boolean)
  if (faltan.length) throw new Error(`Falta la entrada "## ${version} · …" en ${faltan.join(' y ')}.`)
  // los títulos de las novedades pasan a ser subtítulos de la nota
  const bajar = (s) => s.replace(/^## /, '### ')
  return [
    bajar(es), '', '---', '', bajar(en), '', '---', '',
    '**Comprobar los archivos · Check the files:** `SHA256SUMS.txt` tiene la huella SHA-256 de cada uno · has the SHA-256 checksum of each one',
    '(Windows: `certutil -hashfile <archivo> SHA256`; Mac/Linux: `shasum -a 256 -c SHA256SUMS.txt`).',
    '',
  ].join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, salida] = process.argv.slice(2)
  if (!version) { console.error('Uso: node scripts/notas-version.mjs <versión> [<archivo de salida>]'); process.exit(2) }
  const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..')
  try {
    const t = nota(raiz, version.replace(/^v/, ''))
    if (salida) fs.writeFileSync(salida, t); else process.stdout.write(t)
  } catch (e) { console.error((e).message); process.exit(1) }
}
