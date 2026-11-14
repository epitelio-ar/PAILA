// "Exportar diagnóstico" (Fase H): el zip no lleva datos personales (rutas, nombres de temas, carpetas, discos, claves,
// usuario de Windows) y sí lo que sirve (versiones, conteos, tiempos y errores agrupados); el registro rota.
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb } from '@paila/core/db'
import { ErrorLog, scrub } from '@paila/core/errorlog'
import { diagnosticFiles, diagnosticZip, type DiagnosticEnv } from '@paila/core/diagnostic'
import { makeZip, readZip } from '@paila/core/zip'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-diag-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const env: DiagnosticEnv = {
  app: 'PAILA', version: '0.1.0', electron: '43.7.7', chrome: '140', node: '24', os: 'Windows 10.0.19045', arch: 'x64',
  cpu: 'Intel i7', cores: 8, ramGb: 16, freeRamGb: 5, locale: 'es-AR', portable: false, packaged: true, uptimeS: 30,
  startupMs: 1500, ffmpeg: String.raw`C:\Users\Rosa\AppData\Local\Programs\PAILA\ffmpeg.exe`, ffprobe: null, dbBytes: 1000,
}
const PRIVATE = ['Rosa', 'Mis Discos de Rosa', 'Cumbias de la Abuela', 'Los Palmeras - Bombón Asesino', 'Palmeras', 'BOMBÓN', 'SECRETOxyz123secretoXYZ987654321abc', 'rosa@correo.com', 'DISCO-ROSA']

describe('scrub', () => {
  it('saca rutas, comillas, archivos de audio, correos y claves, y deja el tipo de error', () => {
    const t = scrub(String.raw`No se pudo leer "D:\Música\Los Palmeras - Bombón.mp3": EBUSY (código 5) para «Cumbias» en \\NAS\musica\pista.flac, rosa@correo.com, clave SECRETOxyz123secretoXYZ987654321abc`)
    expect(t).toContain('EBUSY (código 5)')
    for (const s of ['Palmeras', 'Música', 'Cumbias', 'NAS', 'rosa@', 'SECRETO']) expect(t).not.toContain(s)
    expect(scrub('falló tema.flac y otro.mp3')).toBe('falló <archivo>.flac y <archivo>.mp3')
  })

  it('en las pilas deja el lugar del código de PAILA sin la carpeta de instalación', () => {
    const t = scrub('Error: x\n    at f (' + String.raw`C:\Users\Rosa\AppData\Local\Programs\PAILA\resources\app.asar\out\main\main.js:12:3)`)
    expect(t).toContain('out/main/main.js:12:3')
    expect(t).not.toContain('Rosa')
  })
})

describe('diagnóstico', () => {
  const db = openDb(path.join(dir, 'paila.db'))
  afterAll(() => db.close())
  db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X1', 'DISCO-ROSA', 'F:/')").run()
  db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'Mis Discos de Rosa', '')").run()
  const add = db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, title, error) VALUES (1, ?, 1, 1, 'musica', ?, 'Los Palmeras', 'BOMBÓN', ?)")
  add.run('Cumbias de la Abuela/Los Palmeras - Bombón Asesino.mp3', 'mp3', 'ffprobe: Invalid data found when processing input "F:/Mis Discos de Rosa/Cumbias de la Abuela/Los Palmeras - Bombón Asesino.mp3"')
  add.run('Cumbias de la Abuela/otro.flac', 'flac', null)
  db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, ms) VALUES (2, 1, 1, 1, '', 'A', 900)").run()
  db.prepare("INSERT INTO settings (key, value) VALUES ('inbox_dir', 'F:/Mis Discos de Rosa/Bandeja'), ('online.deezer', '1'), ('discogs.secret', 'SECRETOxyz123secretoXYZ987654321abc')").run()

  const log = new ErrorLog(path.join(dir, 'registro'))
  log.add('principal', new Error(String.raw`ENOENT: no such file, open 'F:\Mis Discos de Rosa\Cumbias de la Abuela\pista.mp3'`))
  log.add('interfaz', 'TypeError: no se pudo mostrar «Los Palmeras - Bombón Asesino» de rosa@correo.com')

  const files = diagnosticFiles(db, env, log.read())
  const all = files.map((f) => f.content).join('\n')

  it('no lleva nada personal', () => {
    for (const s of PRIVATE) expect(all, s).not.toContain(s)
    expect(all).not.toMatch(/[A-Z]:[\\/]/)
  })

  it('lleva lo que sirve: versión, conteos, tiempos, errores agrupados y el registro', () => {
    const get = (n: string) => files.find((f) => f.name === n)!.content
    expect(JSON.parse(get('programa-y-pc.json')).version).toBe('0.1.0')
    const lib = JSON.parse(get('biblioteca.json'))
    expect(lib.temas.visibles).toBe(2)
    expect(lib.porFormato).toEqual({ mp3: 1, flac: 1 })
    expect(JSON.parse(get('tiempos.json')).analisisPorFormato[0]).toMatchObject({ formato: 'flac', medianaMs: 900 })
    expect(JSON.parse(get('errores-agrupados.json')).alLeer[0]).toMatchObject({ temas: 1 })
    expect(get('errores-agrupados.json')).toContain('Invalid data found')
    expect(JSON.parse(get('ajustes.json'))).toEqual({ inbox_dir: '(guardado)', 'online.deezer': '1' })
    expect(get('registro-de-errores.txt')).toContain('ENOENT')
  })

  it('el zip se abre y tiene los mismos archivos', () => {
    const z = readZip(diagnosticZip(files))
    expect([...z.keys()]).toEqual(files.map((f) => f.name))
    expect(z.get('LEEME.txt')).toBe(files[0].content)
  })
})

describe('zip y registro', () => {
  it('el zip de Node se puede abrir con el de Windows (cabeceras correctas)', () => {
    const z = makeZip([{ name: 'ñandú.txt', data: 'hola '.repeat(1000) }])
    expect(z.readUInt32LE(0)).toBe(0x04034b50)
    expect(readZip(z).get('ñandú.txt')).toBe('hola '.repeat(1000))
  })

  it('el registro rota al pasar el tope y nunca falla', () => {
    const l = new ErrorLog(path.join(dir, 'rota'))
    for (let i = 0; i < 200; i++) l.add('principal', `error ${i} ${'x'.repeat(4000)}`)
    expect(fs.existsSync(path.join(dir, 'rota', 'errores.1.log'))).toBe(true)
    expect(l.read(5).at(-1)?.msg).toContain('error 199')
    expect(() => new ErrorLog('\u0000').add('x', 'y')).not.toThrow()
  })
})
