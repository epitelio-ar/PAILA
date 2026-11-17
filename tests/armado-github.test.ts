// El armado de una versión en GitHub (.github/workflows/version.yml, MASTERPLAN-3 punto 10): que use los mismos scripts que
// el armado en la PC, que las claves salgan de los secretos (y sin secretos no haya claves), que el código fuente GPL
// adjunto siga a las versiones que viajan, y que AVISOS-DE-TERCEROS diga dónde está.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
// @ts-expect-error el script es .mjs sin tipos
import { SECRETOS, claves } from '../scripts/claves-ci.mjs'
// @ts-expect-error el script es .mjs sin tipos
import { FFMPEG, SUMAS, leeme, lista } from '../scripts/fuentes-gpl.mjs'
// @ts-expect-error el script es .mjs sin tipos
import { MPV } from '../scripts/mpv-bajar.mjs'
// @ts-expect-error el script es .mjs sin tipos
import { MPV_MAC } from '../scripts/mpv-mac.mjs'

const raiz = path.join(__dirname, '..')
const leer = (f: string) => fs.readFileSync(path.join(raiz, f), 'utf8')
const version = leer('.github/workflows/version.yml')
const mac = leer('.github/workflows/mac.yml')
const pkg = JSON.parse(leer('package.json')) as { scripts: Record<string, string> }

describe('claves desde los secretos de GitHub', () => {
  it('sin secretos no hay claves', () => {
    expect(claves({})).toEqual({})
    expect(claves({ DISCOGS_KEY: '  ', ACOUSTID: '' })).toEqual({})
  })
  it('toma solo las que tienen algo, sin espacios', () => {
    expect(claves({ DISCOGS_KEY: ' k ', DISCOGS_SECRET: 's', LASTFM: 'l', OTRA: 'x' })).toEqual({ discogsKey: 'k', discogsSecret: 's', lastfm: 'l' })
  })
  it('el workflow pasa cada secreto con el nombre que lee el script', () => {
    for (const s of Object.values(SECRETOS) as string[]) expect(version).toContain(`${s}: \${{ secrets.${s} }}`)
  })
})

describe('version.yml arma lo de hoy', () => {
  it('usa los scripts del armado en la PC', () => {
    for (const s of ['mpv:bajar', 'modelos:armar', 'sockseek:freno', 'pack']) {
      expect(version).toContain(`npm run ${s}`)
      expect(pkg.scripts[s]).toBeTruthy()
    }
    for (const f of ['scripts/claves-ci.mjs', 'scripts/fuentes-gpl.mjs', 'scripts/version-firmada.ts', 'apps/napia/sockseek-freno/armar.ps1']) {
      expect(version).toContain(f)
      expect(fs.existsSync(path.join(raiz, f))).toBe(true)
    }
  })
  it('Beat This! se guarda con la misma llave que en Mac (una sola bajada)', () => {
    const llave = (t: string) => [...t.matchAll(/key: (beat-this-\S+)/g)].map((m) => m[1])
    expect(new Set([...llave(version), ...llave(mac)]).size).toBe(1)
  })
  it('los .dmg salen de mac.yml, que se deja llamar', () => {
    expect(version).toContain('uses: ./.github/workflows/mac.yml')
    expect(mac).toMatch(/^ {2}workflow_call:/m)
  })
  it('los .dmg traen las claves de aplicación, como el armado de Windows (hasta la 1.0.1 salían sin claves)', () => {
    expect(mac).toContain('node scripts/claves-ci.mjs')
    for (const s of Object.values(SECRETOS) as string[]) expect(mac).toContain(`${s}: \${{ secrets.${s} }}`)
    // llamado desde version.yml, mac.yml solo ve los secretos si se los pasan
    expect(version).toMatch(/uses: \.\/\.github\/workflows\/mac\.yml\n {4}secrets: inherit/)
  })
  it('mac.yml deja elegir la Mac (Apple Silicon o Intel) y prueba la app de ese procesador', () => {
    expect(mac).toContain("runs-on: ${{ inputs.maquina || 'macos-15' }}")
    expect(mac).toContain('options: [macos-15, macos-15-intel]')
    expect(mac).toMatch(/if \[ "\$ARCH" = arm64 \]; then A=apps\/paila\/dist\/mac-arm64\/PAILA\.app; else A=apps\/paila\/dist\/mac\/PAILA\.app; fi/)
  })
  it('el borrador lleva lo de Windows, los .dmg y el código fuente, en el commit armado', () => {
    expect(version).toMatch(/armado\/PAILA-"\$V"\*/)
    expect(version).toContain('PAILA-mac-sin-firmar/*.dmg')
    expect(version).toContain('armado/codigo-fuente-gpl/*')
    expect(version).toContain('--target "$GITHUB_SHA"')
    expect(version).toContain('--draft')
  })
  it('el borrador lleva SHA256SUMS.txt y la nota de las novedades, y espera el OK del entorno "publicar"', () => {
    expect(version).toContain('sha256sum')
    expect(version).toMatch(/gh release create .* SHA256SUMS\.txt/)
    expect(version).toContain('node repo/scripts/notas-version.mjs "$V" nota.md')
    expect(version).toContain('--notes-file nota.md')
    expect(version).toMatch(/^ {4}environment: publicar$/m)
  })
  it('las huellas del código fuente no se llaman SHA256SUMS.txt, que ya es el nombre de las del borrador (GitHub rechaza dos iguales)', () => {
    expect(SUMAS).not.toBe('SHA256SUMS.txt')
    expect(leeme(lista())).toContain(SUMAS)
  })
})

describe('ffprobe del mismo armado que ffmpeg (gyan.dev 6.1.1)', () => {
  const app = JSON.parse(leer('apps/paila/package.json')).build
  it('en Windows viaja el de recursos/ffprobe y ninguno de ffprobe-static', () => {
    expect(app.win.extraResources).toContainEqual({ from: 'recursos/ffprobe', to: 'ffprobe' })
    expect(app.files).toContain('!node_modules/ffprobe-static/bin/win32/**')
  })
  it('el armado de GitHub y la revisión lo bajan antes de los tests', () => {
    expect(version).toContain('npm run ffprobe:bajar')
    expect(leer('.github/workflows/check.yml')).toContain('npm run ffprobe:bajar')
    expect(pkg.scripts['ffprobe:bajar']).toBe('node scripts/ffprobe-bajar.mjs')
  })
  const exe = path.join(raiz, 'apps/paila/recursos/ffprobe/ffprobe.exe')
  it.skipIf(process.platform !== 'win32' || !fs.existsSync(exe))('en Windows, PAILA lo usa en vez del de ffprobe-static', async () => {
    const { findFfprobe } = await import('@paila/core/probe')
    expect(path.resolve(findFfprobe()!)).toBe(path.resolve(exe))
    const { execFileSync } = await import('node:child_process')
    expect(execFileSync(exe, ['-hide_banner', '-version'], { encoding: 'utf8' })).toMatch(/^ffprobe version 6\.1\.1-essentials_build-www\.gyan\.dev/)
  })
})

describe('código fuente GPL con cada versión', () => {
  const items = lista() as { archivo: string; url: string; sha256?: string }[]
  it('trae cada FFmpeg que viaja, revisado con su huella', () => {
    for (const f of FFMPEG as { version: string; sha256: string }[]) {
      const i = items.find((x) => x.archivo === `ffmpeg-${f.version}.tar.xz`)
      expect(i?.url).toBe(`https://ffmpeg.org/releases/ffmpeg-${f.version}.tar.xz`)
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
  it('el de mpv sigue a las versiones que se bajan para el armado', () => {
    expect(items.map((i) => i.archivo)).toEqual(expect.arrayContaining([`mpv-${MPV.commit}.tar.gz`, `mpv-winbuild-cmake-${MPV.tag}.tar.gz`, `mpv-${MPV_MAC.tag.slice(1)}.tar.gz`]))
  })
  it('el LEEME nombra cada archivo', () => {
    const t = leeme(items) as string
    for (const i of items) expect(t).toContain(i.archivo)
    expect(t).toContain('ffmpeg-6.1.1-gyan-configuracion.txt')
    expect(t).toContain('sockseek-napia-fuente.tar.gz')
  })
  it('AVISOS-DE-TERCEROS dice que va adjunto a cada versión', () => {
    const avisos = leer('apps/paila/build/AVISOS-DE-TERCEROS.txt')
    for (const a of ['ffmpeg-6.1.1-gyan-configuracion.txt', 'LEEME-codigo-fuente.txt', 'mpv-winbuild-cmake-', 'mpv-0.41.0.tar.gz', 'sockseek-napia-fuente.tar.gz']) expect(avisos).toContain(a)
  })
})
