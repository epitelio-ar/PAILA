// La nota de una versión para GitHub Releases, sacada de docs/NOVEDADES.md (castellano) y docs/NOVEDADES.en.md (inglés):
// arriba, el bloque "Descargar" con los links directos (GitHub ordena los archivos solo, alfabéticamente, y el instalador
// quedaba perdido entre el código fuente); después la sección "## X.Y.Z · fecha: título" de cada uno, una abajo de la
// otra, y cómo comprobar los archivos. Los nombres son los artifactName de apps/paila/package.json. La usa el armado
// de GitHub (.github/workflows/version.yml) al crear el borrador; si falta la entrada de esa versión, corta (no se publica
// una versión sin su nota).
//
//   node scripts/notas-version.mjs <versión> [<archivo de salida>] [<archivos que se suben>...]
// (con la lista de archivos, el bloque muestra solo los que están: sin el armado de Mac, no hay links rotos)
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

/** El bloque "Descargar · Download": instalador, portable y Mac, con el link directo de cada uno. `archivos` (nombres, sin
 *  carpeta) deja solo los que se suben de verdad; sin lista, van todos. */
export function descargas(version, { repo = 'epitelio-ar/PAILA', archivos } = {}) {
  const url = (n) => `https://github.com/${repo}/releases/download/v${version}/${n}`
  // Windows primero (instalador, después portable) y después Mac; cada uno dice ahí mismo si se actualiza solo
  const aviso = " — no se actualiza sola: PAILA avisa y la bajás de acá · doesn't update itself: PAILA lets you know and you download it here"
  const filas = [
    ['**Windows (instalador, recomendado · installer, recommended):**', `PAILA-instalador-${version}.exe`, ' — se actualiza sola · updates itself'],
    ['**Windows portable (sin instalar · no install):**', `PAILA-portable-${version}.exe`, aviso],
    ['**Mac (Apple Silicon, M1–M4):**', `PAILA-mac-arm64-${version}.dmg`, aviso],
    ['**Mac (Intel):**', `PAILA-mac-x64-${version}.dmg`, aviso],
  ].filter(([, n]) => !archivos || archivos.includes(n))
  return [
    '## ⬇️ Descargar · Download', '',
    ...filas.map(([q, n, extra]) => `- ${q} [${n}](${url(n)})${extra}`),
    '',
    "Los demás archivos son el código fuente de lo que PAILA trae adentro (por las licencias): no hacen falta para usarla · The other files are the source code of what PAILA bundles (for the licenses): you don't need them to use it.",
    '', '---', '',
  ].join('\n')
}

/** La nota entera: descargas, castellano, inglés y cómo comprobar los archivos con SHA256SUMS.txt. */
export function nota(raiz, version, opciones = {}) {
  const es = seccion(fs.readFileSync(path.join(raiz, 'docs', 'NOVEDADES.md'), 'utf8'), version)
  const en = seccion(fs.readFileSync(path.join(raiz, 'docs', 'NOVEDADES.en.md'), 'utf8'), version)
  const faltan = [!es && 'docs/NOVEDADES.md', !en && 'docs/NOVEDADES.en.md'].filter(Boolean)
  if (faltan.length) throw new Error(`Falta la entrada "## ${version} · …" en ${faltan.join(' y ')}.`)
  // los títulos de las novedades pasan a ser subtítulos de la nota
  const bajar = (s) => s.replace(/^## /, '### ')
  return [
    descargas(version, opciones), '',
    bajar(es), '', '---', '', bajar(en), '', '---', '',
    '**Comprobar los archivos · Check the files:** `SHA256SUMS.txt` tiene la huella SHA-256 de cada uno · has the SHA-256 checksum of each one',
    '(Windows: `certutil -hashfile <archivo> SHA256`; Mac/Linux: `shasum -a 256 -c SHA256SUMS.txt`).',
    '',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, salida, ...subidos] = process.argv.slice(2)
  if (!version) { console.error('Uso: node scripts/notas-version.mjs <versión> [<archivo de salida>]'); process.exit(2) }
  const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..')
  try {
    const t = nota(raiz, version.replace(/^v/, ''), {
      repo: process.env.GITHUB_REPOSITORY || undefined, archivos: subidos.length ? subidos.map((f) => path.basename(f)) : undefined,
    })
    if (salida) fs.writeFileSync(salida, t); else process.stdout.write(t)
  } catch (e) { console.error((e).message); process.exit(1) }
}
