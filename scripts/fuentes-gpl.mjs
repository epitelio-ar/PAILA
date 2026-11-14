// El código fuente de los programas GPL que viajan con PAILA, para subirlo junto a cada versión (docs/compartir.md, sección 1,
// "Código fuente con cada versión"): FFmpeg (ffmpeg y ffprobe, en Windows y en Mac), mpv (Windows y Mac) y el sockseek con
// freno de NAPIA. Lo usa el armado de GitHub (.github/workflows/version.yml), que adjunta la carpeta al borrador de la versión.
// Los tar.xz de ffmpeg.org van revisados con su huella; los de GitHub (codeload) no tienen una huella fija, así que se anota
// la de lo bajado en SHA256SUMS-codigo-fuente.txt. Las versiones salen de los mismos lugares que el armado (mpv-bajar.mjs, mpv-mac.mjs),
// así que si se cambia una versión ahí, el código fuente la sigue solo.
// Uso: node scripts/fuentes-gpl.mjs <carpeta de salida>
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MPV } from './mpv-bajar.mjs'
import { MPV_MAC } from './mpv-mac.mjs'

const raiz = path.resolve(import.meta.dirname, '..')

/** Las versiones de FFmpeg que viajan con PAILA (AVISOS-DE-TERCEROS, punto 1), con la huella del tar.xz de ffmpeg.org. */
export const FFMPEG = [
  { version: '6.1.1', para: 'ffmpeg.exe y ffprobe.exe de Windows (gyan.dev 6.1.1) y ffmpeg de Mac Intel', sha256: '8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968' },
  { version: '6.0', para: 'ffmpeg de Mac Apple Silicon', sha256: '57be87c22d9b49c112b6d24bc67d42508660e6b718b3db89c44e47e289137082' },
  { version: '4.4', para: 'ffprobe de Mac Apple Silicon', sha256: '06b10a183ce5371f915c6bb15b7b1fffbe046e8275099c96affc29e17645d909' },
  { version: '4.0.2', para: 'ffprobe de Mac Intel (ffprobe-static)', sha256: 'a95c0cc9eb990e94031d2183f2e6e444cc61c99f6f182d1575c433d62afb2f97' },
]
/** La configuración del armado de gyan.dev (opciones y versión de cada biblioteca): el README que baja ffmpeg-static. */
const GYAN_README = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.README'
const codeload = (repo, ref) => `https://codeload.github.com/${repo}/tar.gz/${ref}`

/** Todo lo que se baja: nombre del archivo, de dónde, para qué y (si hay) su huella fija. */
export function lista() {
  return [
    ...FFMPEG.map((f) => ({ archivo: `ffmpeg-${f.version}.tar.xz`, url: `https://ffmpeg.org/releases/ffmpeg-${f.version}.tar.xz`, para: `FFmpeg ${f.version}: ${f.para}`, sha256: f.sha256 })),
    { archivo: 'mpv-' + MPV.commit + '.tar.gz', url: codeload('mpv-player/mpv', MPV.commit), para: `mpv de Windows (armado de shinchiro ${MPV.tag}, commit ${MPV.commit})` },
    { archivo: `mpv-winbuild-cmake-${MPV.tag}.tar.gz`, url: codeload('shinchiro/mpv-winbuild-cmake', `refs/tags/${MPV.tag}`), para: `cómo se armó el mpv de Windows (shinchiro, versión ${MPV.tag}): las bibliotecas y sus versiones` },
    { archivo: `mpv-${MPV_MAC.tag.replace(/^v/, '')}.tar.gz`, url: codeload('mpv-player/mpv', `refs/tags/${MPV_MAC.tag}`), para: `mpv de Mac (armado oficial ${MPV_MAC.tag}; cómo se arma: su carpeta ci/)` },
  ]
}

// Las huellas del código fuente van con su propio nombre: el borrador de la versión ya lleva un SHA256SUMS.txt de todo lo
// que se reparte, y GitHub no deja subir dos archivos con el mismo nombre (falló así el 14/11).
export const SUMAS = 'SHA256SUMS-codigo-fuente.txt'
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')

async function bajar(url, dest) {
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`No se pudo bajar ${url} (${r.status})`)
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
}

/** El tar del sistema (en Windows, el de Windows: el de Git toma "C:" como si fuera otra compu). */
const tar = () => (process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar')

/** El sockseek con freno: sockseek 3.0.6 y Soulseek.NET 10.0.2 tal cual, más el parche y cómo se arma, en un solo .tar.gz. */
async function sockseek(salida) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-sockseek-fuente-'))
  try {
    const dir = path.join(tmp, 'sockseek-napia-fuente')
    fs.mkdirSync(dir)
    await bajar(codeload('fiso64/sockseek', 'refs/tags/v3.0.6'), path.join(dir, 'sockseek-3.0.6.tar.gz'))
    await bajar(codeload('jpdillingham/Soulseek.NET', 'refs/tags/10.0.2'), path.join(dir, 'Soulseek.NET-10.0.2.tar.gz'))
    const freno = path.join(raiz, 'apps', 'napia', 'sockseek-freno')
    for (const f of ['freno.patch', 'armar.ps1', 'armar.sh', 'LEEME.md']) fs.copyFileSync(path.join(freno, f), path.join(dir, f))
    for (const f of fs.readdirSync(path.join(raiz, 'apps', 'napia', 'recursos', 'sockseek')).filter((f) => f.endsWith('.txt'))) {
      fs.copyFileSync(path.join(raiz, 'apps', 'napia', 'recursos', 'sockseek', f), path.join(dir, f))
    }
    const out = path.join(salida, 'sockseek-napia-fuente.tar.gz')
    const t = spawnSync(tar(), ['-czf', out, '-C', tmp, 'sockseek-napia-fuente'], { encoding: 'utf8', timeout: 300_000 })
    if (t.status !== 0) throw new Error(`No se pudo armar ${path.basename(out)}: ${(t.stderr ?? '').trim()}`)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

/** El texto que acompaña: qué es cada archivo. */
export function leeme(items) {
  return `CÓDIGO FUENTE DE LOS PROGRAMAS GPL QUE VIAJAN CON ESTA VERSIÓN DE PAILA
=========================================================================
PAILA lleva programas aparte bajo la GPL (los ejecuta, no los enlaza): ffmpeg y ffprobe (FFmpeg), mpv (la salida "bit
perfect") y el sockseek con freno de NAPIA. Acá está su código fuente, el de las versiones exactas de esta versión de PAILA.
Qué es cada programa y su licencia: AVISOS-DE-TERCEROS.txt, en la carpeta del programa.

${items.map((i) => `${i.archivo}\n  ${i.para}\n  de ${i.url}`).join('\n\n')}

ffmpeg-6.1.1-gyan-configuracion.txt
  Cómo se armaron ffmpeg.exe y ffprobe.exe de Windows (gyan.dev 6.1.1 "essentials"): las opciones de configuración y la
  versión de cada biblioteca que llevan adentro. De ${GYAN_README}

sockseek-napia-fuente.tar.gz
  El sockseek con freno de NAPIA (versión 3.0.6-napia.2): sockseek 3.0.6 y Soulseek.NET 10.0.2 sin tocar, el parche
  freno.patch que les aplica PAILA, los scripts que lo arman (armar.ps1 en Windows, armar.sh en Mac) y sus licencias.

${SUMAS}: la huella de cada archivo.
`
}

async function main() {
  const salida = process.argv[2]
  if (!salida) { console.error('Uso: node scripts/fuentes-gpl.mjs <carpeta de salida>'); process.exit(1) }
  fs.mkdirSync(salida, { recursive: true })
  const items = lista()
  for (const i of items) {
    const f = path.join(salida, i.archivo)
    console.log(`Bajando ${i.archivo}…`)
    await bajar(i.url, f)
    if (i.sha256 && sha(f) !== i.sha256) throw new Error(`${i.archivo} no es el archivo esperado (huella distinta): no se usa.`)
  }
  const readme = path.join(raiz, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe.README')
  const conf = path.join(salida, 'ffmpeg-6.1.1-gyan-configuracion.txt')
  if (fs.existsSync(readme)) fs.copyFileSync(readme, conf)
  else await bajar(GYAN_README, conf)
  if (!fs.readFileSync(conf, 'utf8').includes('6.1.1-essentials_build-www.gyan.dev')) throw new Error('La configuración del armado de ffmpeg no es la de gyan.dev 6.1.1.')
  console.log('Armando sockseek-napia-fuente.tar.gz…')
  await sockseek(salida)
  fs.writeFileSync(path.join(salida, 'LEEME-codigo-fuente.txt'), leeme(items).replace(/\n/g, '\r\n'))
  const sumas = fs.readdirSync(salida).filter((f) => f !== SUMAS).sort().map((f) => `${sha(path.join(salida, f))}  ${f}`)
  fs.writeFileSync(path.join(salida, SUMAS), sumas.join('\n') + '\n')
  const mb = fs.readdirSync(salida).reduce((s, f) => s + fs.statSync(path.join(salida, f)).size, 0) / 1048576
  console.log(`Listo: ${salida} (${sumas.length} archivos, ${mb.toFixed(0)} MB).`)
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main().catch((e) => { console.error(e.message); process.exit(1) })
