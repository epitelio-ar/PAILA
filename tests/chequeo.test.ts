// El Chequeo (core/chequeo.ts y chequeo-sondas.ts): cada control con sus casos, el orden y las sondas inventadas, qué
// error lleva a qué control, y las pruebas de verdad que no usan internet (escribir, lugar, la base en un hilo, ffmpeg).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { chequear, controlBase, controlMusicBrainz, controlCarpetas, controlClave, controlDelError, controlEspacio, controlFirewall, controlProgramas, controlPuerto, discoDe, gb, type Sondas } from '@paila/core/chequeo'
import { escribir, libre, musicbrainz, responde, revisarBase } from '@paila/core/chequeo-sondas'
import { diagnosticar, parseReglas } from '@paila/core/sockseek/firewall'
import { textoFirewall } from '@paila/shared/firewall'
import { ponerIdioma } from '@paila/shared/idioma'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chequeo-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
afterEach(() => ponerIdioma('es'))

describe('cada control', () => {
  it('ffmpeg y ffprobe: están, falta uno, uno no contesta', () => {
    expect(controlProgramas(true, true).estado).toBe('ok')
    const c = controlProgramas(null, true)
    expect(c).toMatchObject({ estado: 'mal', resumen: 'Falta ffmpeg.' })
    expect(c.detalle.join(' ')).toContain('instalando PAILA de nuevo')
    expect(controlProgramas(true, false).resumen).toBe('ffprobe no responde.')
  })
  it('escribir en tu Música: no se puede, un disco desconectado, solo mirar, todo bien', () => {
    expect(controlCarpetas([{ nombre: 'D:\\Música', available: true, error: 'EROFS' }], false)).toMatchObject({ estado: 'mal', resumen: 'No se puede escribir en D:\\Música (el disco es de solo lectura).' })
    expect(controlCarpetas([{ nombre: 'E:\\Viejos', available: false, error: null }], false)).toMatchObject({ estado: 'atencion', resumen: 'No está conectado: E:\\Viejos.' })
    expect(controlCarpetas([{ nombre: 'D:\\Música', available: true, error: null }], true).estado).toBe('nose')
    expect(controlCarpetas([{ nombre: 'a', available: true, error: null }, { nombre: 'b', available: true, error: null }], false)).toMatchObject({ estado: 'ok', resumen: 'Se puede escribir en las 2 carpetas de música.' })
    expect(controlCarpetas([], false).estado).toBe('nose')
  })
  it('lugar en el disco: menos de 1 GB es un problema, menos de 5 GB para mirar; con los botones a Espacio y la Papelera', () => {
    expect(controlEspacio([{ disco: 'C:', libre: 120e9 }, { disco: 'D:', libre: 300e9 }])).toMatchObject({ estado: 'ok', resumen: 'Hay lugar: C: 120 GB libres y D: 300 GB libres.' })
    const poco = controlEspacio([{ disco: 'C:', libre: 3.25e9 }, { disco: 'D:', libre: 300e9 }])
    expect(poco).toMatchObject({ estado: 'atencion', resumen: 'Queda poco lugar: C: 3,2 GB libres.' })
    expect(poco.arreglos.map((a) => a.tipo === 'ir' && a.pagina)).toEqual(['space', 'trash'])
    expect(controlEspacio([{ disco: 'C:', libre: 400e6 }]).estado).toBe('mal')
    expect(gb(400e6)).toBe('400 MB')
    expect(discoDe('D:\\Música\\Rock')).toBe('D:')
  })
  it('las claves: sin clave (opcional), anda, sin internet, rechazada; nunca llevan el valor', () => {
    expect(controlClave('lastfm', { hay: false })).toMatchObject({ estado: 'info', resumen: 'Sin clave (es opcional): PAILA busca sin Last.fm.' })
    expect(controlClave('discogs', { hay: true, ok: true }).estado).toBe('ok')
    expect(controlClave('acoustid', { hay: true, ok: false, sinInternet: true }).estado).toBe('atencion')
    const mal = controlClave('discogs', { hay: true, ok: false, msg: 'Discogs no aceptó la clave (respondió 401)' })
    expect(mal).toMatchObject({ id: 'clave-discogs', estado: 'mal', resumen: 'Discogs no aceptó la clave.' })
    expect(mal.arreglos[0]).toMatchObject({ tipo: 'ir', pagina: 'settings', seccion: 'cfg-internet' })
  })
  it('la base: sana, dañada (con el diagnóstico), o no se pudo revisar', () => {
    expect(controlBase({ problemas: [] }).estado).toBe('ok')
    expect(controlBase({ problemas: ['row 3 missing from index'] })).toMatchObject({ estado: 'mal', arreglos: [{ seccion: 'cfg-diagnostico' }] })
    expect(controlBase({ error: 'database is locked' }).estado).toBe('nose')
  })
  it('MusicBrainz: anda, en uso, ocupado (pide ir más despacio: no es un problema), no contesta', () => {
    expect(controlMusicBrainz(null).estado).toBe('ok')
    expect(controlMusicBrainz('enUso').estado).toBe('ok')
    expect(controlMusicBrainz('ocupado')).toMatchObject({ estado: 'info', resumen: 'Contesta, pero ahora está ocupado.' })
    expect(controlMusicBrainz('ENOTFOUND').estado).toBe('atencion')
  })
  it('el firewall de NAPIA dice lo mismo que NAPIA, con sus botones', () => {
    const exe = 'C:\\NAPIA\\sockseek.exe'
    const d = diagnosticar(parseReglas(['Rule Name: x', 'Enabled: Yes', 'Profiles: Private', `Program: ${exe}`, 'Action: Allow'].join('\n'), exe), { redes: [{ perfil: 'publica', nombre: null, internet: true }], firewall: [] }, exe)!
    const c = controlFirewall(d)
    expect(c.resumen).toBe(textoFirewall(d).titulo)
    expect(c.estado).toBe('atencion')
    expect(c.arreglos.map((a) => a.tipo)).toEqual(['windows', 'firewall'])
    expect(c.aMano).toContain('netsh advfirewall')
    expect(controlFirewall(null).estado).toBe('nose')
  })
  it('el puerto de NAPIA: el router lo abre, no deja (anda igual), NAPIA bajando; sin NAPIA no hay control', () => {
    expect(controlPuerto('ok')?.estado).toBe('ok')
    expect(controlPuerto('no')?.estado).toBe('info')
    expect(controlPuerto('bajando')?.estado).toBe('ok')
    expect(controlPuerto(null)).toBeNull()
  })
  it('en inglés también', () => {
    ponerIdioma('en')
    expect(controlEspacio([{ disco: 'C:', libre: 3.25e9 }]).resumen).toBe('Little room left: C: 3.2 GB free.')
    expect(controlClave('discogs', { hay: true, ok: false }).resumen).toBe("Discogs didn't accept the key.")
  })
})

describe('qué error lleva a qué control (los avisos sin abrir el Chequeo)', () => {
  it('disco lleno, base dañada, disco de solo lectura; un archivo ocupado no', () => {
    expect(controlDelError('ENOSPC: no space left on device, write')).toBe('espacio')
    expect(controlDelError('database or disk is full')).toBe('espacio')
    expect(controlDelError('No hay lugar para el respaldo: hacen falta 2 GB')).toBe('espacio')
    expect(controlDelError('SqliteError: database disk image is malformed')).toBe('base')
    expect(controlDelError("EROFS: read-only file system, open 'x'")).toBe('carpetas')
    expect(controlDelError('EBUSY: resource busy or locked')).toBeNull()
    expect(controlDelError('EPERM: operation not permitted')).toBeNull()
  })
})

describe('todo junto, con sondas inventadas', () => {
  const sondas = (napia: Awaited<ReturnType<Sondas['napia']>>, veces = { napia: 0 }): Sondas => ({
    responde: async () => true, escribir: async (d) => (d.startsWith('D:') ? 'EACCES' : null), libre: async () => 50e9,
    clave: async (s) => (s === 'lastfm' ? { hay: false } : { hay: true, ok: true }), musicbrainz: async () => null, base: async () => ({ problemas: [] }),
    napia: async () => { veces.napia++; return napia },
  })
  const entrada = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', datos: 'C:\\datos', soloMirar: false, raices: [{ path: 'D:\\Música', nombre: 'D:\\Música', available: true }] }
  it('en su orden, cada uno apenas termina, y NAPIA se mira una sola vez para sus dos controles', async () => {
    const veces = { napia: 0 }, llegaron: string[] = []
    const r = await chequear(entrada, sondas({ firewall: null, router: 'no' }, veces), (c) => llegaron.push(c.id))
    expect(r.map((c) => c.id)).toEqual(['programas', 'datos', 'carpetas', 'espacio', 'base', 'musicbrainz', 'clave-discogs', 'clave-acoustid', 'clave-lastfm', 'napia-firewall', 'napia-puerto'])
    expect(llegaron.sort()).toEqual(r.map((c) => c.id).sort())
    expect(veces.napia).toBe(1)
    expect(r.find((c) => c.id === 'carpetas')?.estado).toBe('mal')
  })
  it('sin NAPIA no hay controles de NAPIA; una sonda que revienta queda como "no se pudo probar"', async () => {
    const s = { ...sondas(null), musicbrainz: async () => { throw new Error('se cortó') } }
    const r = await chequear(entrada, s)
    expect(r.some((c) => c.id.startsWith('napia'))).toBe(false)
    expect(r.find((c) => c.id === 'musicbrainz')).toMatchObject({ estado: 'nose', resumen: 'se cortó' })
  })
})

describe('las pruebas de verdad (sin internet)', () => {
  it('escribir: deja la carpeta como estaba; una carpeta que no existe da su código', async () => {
    expect(await escribir(tmp)).toBeNull()
    expect(fs.readdirSync(tmp)).toEqual([])
    fs.mkdirSync(path.join(tmp, '_PAILA'))
    expect(await escribir(tmp)).toBeNull()
    expect(fs.readdirSync(path.join(tmp, '_PAILA'))).toEqual([])
    expect(await escribir(path.join(tmp, 'no-existe'))).toBe('ENOENT')
  })
  it('el lugar libre', async () => {
    expect(await libre(tmp)).toBeGreaterThan(0)
    expect(await libre(path.join(tmp, 'no-existe'))).toBeNull()
  })
  it('la base en un hilo aparte: sana, o un archivo que no es una base', async () => {
    const f = path.join(tmp, 'sana.db')
    const db = new DatabaseSync(f); db.exec('CREATE TABLE t (a); INSERT INTO t VALUES (1)'); db.close()
    expect(await revisarBase(f)).toEqual({ problemas: [] })
    const roto = path.join(tmp, 'rota.db')
    fs.writeFileSync(roto, Buffer.alloc(8192, 7))
    const r = await revisarBase(roto)
    expect('problemas' in r && r.problemas.length).toBeTruthy()
  })
  it('ffmpeg contesta; un programa que no existe, no', async () => {
    const ffmpeg = (createRequire(import.meta.url)('ffmpeg-static') as string)
    expect(await responde(ffmpeg)).toBe(true)
    expect(await responde(path.join(tmp, 'no-existe.exe'))).toBe(false)
  })
  it('MusicBrainz: cualquier respuesta es que se llega; 503 o sin red, no', async () => {
    const con = (status: number) => (async () => ({ status }) as Response) as unknown as typeof fetch
    expect(await musicbrainz('PAILA/test', con(200))).toBeNull()
    expect(await musicbrainz('PAILA/test', con(404))).toBeNull()
    expect(await musicbrainz('PAILA/test', con(503))).toBe('ocupado')
    expect(await musicbrainz('PAILA/test', con(500))).toBe('HTTP 500')
    const sinRed = (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }) }) as unknown as typeof fetch
    expect(await musicbrainz('PAILA/test', sinRed)).toBe('ENOTFOUND')
  })
})
