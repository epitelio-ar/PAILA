// Después de firmar (armado de GitHub, .github/workflows/version.yml): rehace latest.yml con la huella SHA-512 y el
// tamaño del instalador ya firmado, para que las actualizaciones automáticas lo acepten. Uso: … version-firmada.ts <carpeta>
import fs from 'node:fs'
import path from 'node:path'
import { parseLatestYml, rewriteLatestYml, sha512File } from '@paila/core/updates'

const dir = process.argv[2]
if (!dir) throw new Error('Uso: node scripts/run-ts.mjs scripts/version-firmada.ts <carpeta con latest.yml y el instalador>')
const ymlPath = path.join(dir, 'latest.yml')
const text = fs.readFileSync(ymlPath, 'utf8')
const info = parseLatestYml(text)
if (!info) throw new Error('latest.yml incompleto.')
const exe = path.join(dir, info.file)
const sha = await sha512File(exe)
fs.writeFileSync(ymlPath, rewriteLatestYml(text, sha, fs.statSync(exe).size))
// el .blockmap del instalador sin firmar ya no sirve (PAILA no lo usa: baja el instalador entero)
fs.rmSync(`${exe}.blockmap`, { force: true })
process.stdout.write(`latest.yml al día para ${info.file} (${info.version}).\n`)
