// Tests de PAILA para Mac (MASTERPLAN-4, 4A.2) que corren en cualquier sistema: discos en /Volumes, rutas de Traktor,
// Serato y VirtualDJ en Mac, atajos con Cmd, el menú de arriba, el armado (qué falta, dónde está mpv.app).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { macLabelOf, macMountCandidates, macMountOf, macSerialOf, plistString } from '@paila/core/volumes-mac'
import { traktorLocation } from '@paila/core/traktor'
import { seratoPath } from '@paila/core/seratofmt'
import { buildList } from '@paila/core/virtualdj'
import { DjExport, driveOf, vdjHomeOf } from '@paila/core/djexport'
import { teclas } from '@paila/shared/teclas'
import { abrirNapiaLabel, macMenu, type MacMenuItem } from '@paila/shared/menumac'
import { ponerIdioma, textos, tr } from '@paila/shared/idioma'
import { buscarApp, mpvMacExe } from '../scripts/mpv-mac.mjs'
import { archivoConfigMac, archivosMac, comprimir, configMac, faltan, sockseekMac } from '../scripts/armar-mac.mjs'
import { createRequire } from 'node:module'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-mac-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const PLIST = '<plist><dict><key>VolumeName</key>\n<string>SSD &amp; Música</string><key>VolumeUUID</key>\n\t<string>1a2b3c4d-0000-1111-2222-333344445555</string></dict></plist>'

describe('discos en Mac', () => {
  it('el disco de una ruta: /Volumes/<nombre> para los de afuera, "/" para el de la Mac', () => {
    expect(macMountOf('/Volumes/SSD EXTERNO/Música/a.mp3')).toBe('/Volumes/SSD EXTERNO')
    expect(macMountOf('/Volumes/SSD')).toBe('/Volumes/SSD')
    expect(macMountOf('/Users/yo/Music/a.mp3')).toBe('/')
    expect(macMountOf('/Volumes/../Users/yo')).toBe('/')
  })

  it('reconoce cada disco por su número propio (VolumeUUID), y lo recuerda', () => {
    expect(plistString(PLIST, 'VolumeUUID')).toBe('1a2b3c4d-0000-1111-2222-333344445555')
    expect(plistString(PLIST, 'VolumeName')).toBe('SSD & Música')
    let calls = 0
    const run = () => { calls++; return PLIST }
    expect(macSerialOf(dir, run)).toBe('1A2B3C4D-0000-1111-2222-333344445555')
    expect(macSerialOf(dir, run)).toBe('1A2B3C4D-0000-1111-2222-333344445555')
    expect(calls).toBe(1)
    // sin diskutil: el número de dispositivo, como antes
    const otro = fs.mkdtempSync(path.join(dir, 'b-'))
    expect(macSerialOf(otro, () => '')).toMatch(/^[0-9A-F]{8,}$/)
    // el disco de la Mac se pregunta por su parte de datos (la del sistema cambia con cada actualización de macOS)
    const pedidos: string[] = []
    macSerialOf('/', (m) => { pedidos.push(m); return PLIST }, dir)
    expect(pedidos).toEqual([dir])
  })

  it('el nombre del disco y dónde buscarlo si cambió de lugar', () => {
    expect(macLabelOf('/Volumes/SSD', () => '')).toBe('SSD')
    expect(macLabelOf('/', () => PLIST)).toBe('SSD & Música')
    expect(macMountCandidates('/Volumes/Viejo', '/Volumes', () => ['.Trashes', 'Macintosh HD', 'SSD', 'Viejo']))
      .toEqual(['/Volumes/Viejo', '/', '/Volumes/Macintosh HD', '/Volumes/SSD'])
    expect(macMountCandidates('/', '/Volumes', () => { throw new Error('sin /Volumes') })).toEqual(['/'])
  })
})

describe('Traktor, Serato y VirtualDJ en Mac', () => {
  it('Traktor: el volumen es el nombre del disco (el de la Mac, "Macintosh HD")', () => {
    expect(traktorLocation('/Volumes/SSD/Música/a b.mp3')).toEqual({ volume: 'SSD', dir: '/:Música/:', file: 'a b.mp3', key: 'SSD/:Música/:a b.mp3' })
    expect(traktorLocation('/Users/yo/Music/x.flac', 'Macintosh HD')).toEqual({ volume: 'Macintosh HD', dir: '/:Users/:yo/:Music/:', file: 'x.flac', key: 'Macintosh HD/:Users/:yo/:Music/:x.flac' })
    // Windows, igual que siempre
    expect(traktorLocation('C:\\Users\\yo\\a.mp3', 'Macintosh HD').volume).toBe('C:')
  })

  it('Serato: en un disco de afuera, la ruta desde su raíz; en el de la Mac, desde /', () => {
    expect(seratoPath('/Volumes/SSD/Música/a.mp3')).toBe('Música/a.mp3')
    expect(seratoPath('/Users/yo/Music/a.mp3')).toBe('Users/yo/Music/a.mp3')
    expect(seratoPath('D:\\Música\\a.mp3')).toBe('Música/a.mp3')
  })

  it('cada disco de afuera tiene su _Serato_ y su VirtualDJ; el de la Mac, los de la carpeta del usuario', () => {
    expect(driveOf('/Volumes/SSD/Música/a.mp3')).toBe('/Volumes/SSD')
    expect(driveOf('/Users/yo/a.mp3')).toBe('')
    expect(driveOf('f:\\a.mp3')).toBe('F:')
    const dj = new DjExport(null as never, '/Users/yo', '/Users/yo/Library/Application Support/VirtualDJ')
    expect(dj.seratoDir('/Volumes/SSD')).toBe('/Volumes/SSD/_Serato_')
    expect(dj.vdjDir('/Volumes/SSD')).toBe('/Volumes/SSD/VirtualDJ')
    expect(dj.seratoDir('').replace(/\\/g, '/')).toBe('/Users/yo/Music/_Serato_')
    expect(dj.vdjDir('')).toBe('/Users/yo/Library/Application Support/VirtualDJ')
    expect(new DjExport(null as never, 'C:\\Users\\yo', 'C:\\L\\VirtualDJ').seratoDir('F:')).toBe('F:\\_Serato_')
  })

  it('VirtualDJ: en Mac la ruta va tal cual; en Windows, con "\\"', () => {
    const t = (abs: string) => ({ abs, size: 1, duration: null, artist: '', title: 'x' }) as never
    expect(buildList([t('/Volumes/SSD/a/x.mp3')])).toContain('path="/Volumes/SSD/a/x.mp3"')
    expect(buildList([t('F:/a/x.mp3')])).toContain('path="F:\\a\\x.mp3"')
    // la carpeta nueva de VirtualDJ en Mac (~/Library/Application Support) gana si ya tiene su base
    const has = (f: string) => (p: string) => p.replace(/\\/g, '/') === f
    expect(vdjHomeOf('/Users/yo/Library/Application Support', '/Users/yo/Documents', has('/Users/yo/Documents/VirtualDJ/database.xml')).replace(/\\/g, '/')).toBe('/Users/yo/Documents/VirtualDJ')
    expect(vdjHomeOf('/Users/yo/Library/Application Support', '/Users/yo/Documents', () => false).replace(/\\/g, '/')).toBe('/Users/yo/Library/Application Support/VirtualDJ')
  })
})

describe('atajos y menú en Mac', () => {
  it('en Mac los textos dicen Cmd; en Windows, Ctrl', () => {
    expect(teclas('Ctrl+K: ir a cualquier pantalla', true)).toBe('Cmd+K: ir a cualquier pantalla')
    expect(teclas('Ctrl + ← · Ctrl+Mayús+C · Ctrl+clic', true)).toBe('Cmd + ← · Cmd+Mayús+C · Cmd+clic')
    expect(teclas('Ctrl+K', false)).toBe('Ctrl+K')
  })

  it('los textos en pares pasan solos por ahí (también los que llevan datos y las listas): en la Mac de GitHub dicen Cmd', () => {
    const T = textos({ buscar: { es: 'Buscar (Ctrl+K)', en: 'Search (Ctrl+K)' }, con: { es: (n: number) => `${n} con Ctrl+clic`, en: (n: number) => `${n} with Ctrl+click` } })
    const k = process.platform === 'darwin' ? 'Cmd' : 'Ctrl'
    expect(T.buscar).toBe(`Buscar (${k}+K)`)
    expect(T.con(2)).toBe(`2 con ${k}+clic`)
    expect(tr({ es: ['Ctrl + →: siguiente', 'Espacio'], en: ['Ctrl + →: next', 'Space'] })).toEqual([`${k} + →: siguiente`, 'Espacio'])
  })

  it('el menú tiene Edición (copiar y pegar en los campos), Salir y el renglón para abrir NAPIA', () => {
    let abierta = false
    const m = macMenu('PAILA', { label: 'Abrir NAPIA', click: () => { abierta = true } })
    const roles = (items: MacMenuItem[]): string[] => items.flatMap((i) => [i.role ?? '', ...roles(i.submenu ?? [])])
    for (const r of ['copy', 'paste', 'cut', 'selectAll', 'undo', 'quit', 'hide']) expect(roles(m)).toContain(r)
    expect(m.map((x) => x.label)).toEqual(['PAILA', 'Edición', 'Ver', 'Ventana'])
    m[0].submenu!.find((x) => x.label === 'Abrir NAPIA')!.click!()
    expect(abierta).toBe(true)
    expect(JSON.stringify(macMenu('NAPIA'))).not.toContain('Abrir')
    // en inglés, si PAILA está en inglés
    ponerIdioma('en')
    try {
      expect(macMenu('PAILA').map((x) => x.label)).toEqual(['PAILA', 'Edit', 'View', 'Window'])
      expect(macMenu('PAILA')[0].submenu!.at(-1)!.label).toBe('Quit PAILA')
      expect(abrirNapiaLabel()).toBe('Open NAPIA')
    } finally { ponerIdioma('es') }
  })
})

describe('armado para Mac', () => {
  it('encuentra mpv.app adentro de lo que trae el .zip', () => {
    fs.mkdirSync(path.join(dir, 'zip', 'mpv-v0.41.0', 'mpv.app', 'Contents', 'MacOS'), { recursive: true })
    expect(buscarApp(path.join(dir, 'zip'))).toBe(path.join(dir, 'zip', 'mpv-v0.41.0', 'mpv.app'))
    expect(mpvMacExe('x64', '/r')).toBe(path.join('/r', 'x64', 'mpv.app', 'Contents', 'MacOS', 'mpv'))
  })

  it('la lista de archivos de la app es una sola, entera (una de solo exclusiones copiaba la carpeta entera)', () => {
    const pkg = JSON.parse(fs.readFileSync('apps/paila/package.json', 'utf8')).build
    expect(pkg.win.files).toBeUndefined()
    expect(pkg.mac.files).toBeUndefined()
    expect(pkg.files).toContain('out/**')
    expect(pkg.files).toContain('!node_modules/ffprobe-static/bin/darwin/**')
    const mac = archivosMac(pkg.files, 'arm64')
    expect(mac).toContain('out/**')
    expect(mac).toContain('!node_modules/ffprobe-static/bin/win32/**')
    expect(mac).toContain('!node_modules/ffprobe-static/bin/darwin/x64/**')
    expect(mac).not.toContain('!node_modules/ffprobe-static/bin/darwin/**')
  })

  it('electron-builder arma Mac con la lista de Mac sola, sin la exclusión de ffprobe de Windows (las .dmg 1.0.0 y 1.0.1 salieron sin él)', async () => {
    const pkg = JSON.parse(fs.readFileSync('apps/paila/package.json', 'utf8')).build
    const cfg = configMac(pkg, 'x64')
    expect(cfg.appId).toBe(pkg.appId)
    expect(cfg.mac).toEqual(pkg.mac)
    // la configuración que de verdad ve electron-builder (su propio getConfig), leyendo el archivo que le pasa armar-mac
    const req = createRequire(path.resolve('apps/paila/package.json'))
    const { getConfig } = req(path.join(path.dirname(req.resolve('app-builder-lib/package.json')), 'out', 'util', 'config', 'config.js'))
    // electron-builder deja la lista como [{ filter: [...] }]: se aplana para mirarla
    const lista = (c: { files: unknown[] }) => c.files.flatMap((x) => (typeof x === 'string' ? [x] : (x as { filter: string[] }).filter))
    const efectiva = await getConfig(path.resolve('apps/paila'), archivoConfigMac('arm64', dir), null)
    expect(lista(efectiva)).not.toContain('!node_modules/ffprobe-static/bin/darwin/**')
    expect(lista(efectiva)).toContain('!node_modules/ffprobe-static/bin/darwin/x64/**')
    expect(lista(efectiva)).toContain('out/**')
    expect(efectiva.asarUnpack).toContain('node_modules/ffprobe-static/**')
    // pasada como objeto, electron-builder la sumaba a la de package.json y la exclusión seguía: esto es lo que pasaba
    const sumada = await getConfig(path.resolve('apps/paila'), null, { files: archivosMac(pkg.files, 'arm64') })
    expect(lista(sumada)).toContain('!node_modules/ffprobe-static/bin/darwin/**')
  })

  it('pasa el .dmg a LZMA (ULMO) en su lugar y saca el .blockmap', () => {
    const dmg = path.join(dir, 'PAILA-mac-arm64-1.0.0.dmg')
    fs.writeFileSync(dmg, 'zlib'); fs.writeFileSync(`${dmg}.blockmap`, 'x')
    let pedido: string[] = []
    comprimir(dmg, ((cmd: string, args: string[]) => { pedido = [cmd, ...args]; fs.writeFileSync(args[5], 'lzma'); return { status: 0 } }) as never)
    expect(pedido.slice(0, 5)).toEqual(['hdiutil', 'convert', dmg, '-format', 'ULMO'])
    expect(fs.readFileSync(dmg, 'utf8')).toBe('lzma')
    expect(fs.existsSync(`${dmg}.blockmap`)).toBe(false)
    expect(() => comprimir(dmg, (() => ({ status: 1 })) as never)).toThrow(/LZMA/)
  })

  it('dice qué falta antes de armar (NAPIA y PAILA armadas, el sockseek con freno de ese procesador)', () => {
    expect(faltan('arm64', () => true)).toEqual([])
    const mal = faltan('x64', (f: string) => f !== sockseekMac('x64'))
    expect(mal).toHaveLength(1)
    expect(mal[0]).toContain('armar.sh osx-x64')
  })
})
