// Licencias (Fase H): AVISOS-DE-TERCEROS.txt y docs/licencias.md al día con package-lock.json, y nada que viaje con la app
// con una licencia que choque con AGPL-3.0 o con la firma gratuita de SignPath. Si falla: `npm run licencias`.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { AVISOS, REPORTE, avisos, clashes, packages, reporte } from '../scripts/licencias'

const plain = (s: string) => s.replace(/\r\n/g, '\n')

describe('licencias', () => {
  const list = packages()

  it('lo que viaja con la app tiene licencias compatibles (aprobadas por OSI y sin partes no comerciales)', () => {
    expect(clashes(list).map((p) => `${p.name} ${p.license}`)).toEqual([])
  })

  it('las piezas grandes están donde corresponde: Essentia, taglib y ffmpeg viajan; electron-builder no', () => {
    const shipped = new Set(list.filter((p) => !p.dev).map((p) => p.name))
    for (const n of ['essentia.js', 'node-taglib-sharp', 'ffmpeg-static', 'ffprobe-static', 'react', 'react-dom']) expect(shipped).toContain(n)
    for (const n of ['electron-builder', 'vite', 'typescript', 'onnxruntime-web']) expect(shipped).not.toContain(n)
  })

  it('AVISOS-DE-TERCEROS.txt y docs/licencias.md están al día (si no: npm run licencias)', () => {
    expect(plain(fs.readFileSync(AVISOS, 'utf8')) === plain(avisos(list))).toBe(true)
    expect(plain(fs.readFileSync(REPORTE, 'utf8')) === plain(reporte(list))).toBe(true)
  })

  it('el aviso dice dónde está el código fuente de ffmpeg y que Beat This! viaja con PAILA (MIT)', () => {
    const t = fs.readFileSync(AVISOS, 'utf8')
    expect(t).toContain('ffmpeg-6.1.1.tar.xz')
    expect(t).toContain('GNU GENERAL PUBLIC LICENSE')
    expect(t).toMatch(/BEAT THIS! \(VIAJA CON PAILA\)[\s\S]*instalador y en la portable[\s\S]*onnxruntime-web 1\.30\.0/)
    expect(t).toContain('Institute of Computational Perception')
    // mpv (la salida "bit perfect") viaja aparte, con su versión y dónde está su código fuente
    expect(t).toMatch(/1b\. MPV[\s\S]*mpv-x86_64-20261111-git-bcde6b93cc\.7z[\s\S]*github\.com\/mpv-player\/mpv\/tree\/bcde6b93cc/)
  })

  it('el instalador, la portable y el .dmg de Mac llevan el archivo', () => {
    const pkg = JSON.parse(fs.readFileSync('apps/paila/package.json', 'utf8'))
    expect(JSON.stringify(pkg.build.win.extraFiles)).toContain('AVISOS-DE-TERCEROS.txt')
    // en Mac va en Contents/Resources: un archivo suelto en Contents rompe la firma de la app
    expect(JSON.stringify(pkg.build.mac.extraResources)).toContain('AVISOS-DE-TERCEROS.txt')
  })
})
