// Deshacer Ordenar después de cerrar y reabrir PAILA cuando una carpeta estaba escrita con otras mayúsculas (core/mayusculas-disco.ts).
// En Windows y la Mac "La esquina del infinito" y "La Esquina del Infinito" son la misma carpeta: el tema cae en la que ya existe,
// al reabrir el escaneo anota cómo está en el disco y deshacer decía "cambió de lugar o de nombre después" (video, 13/11: 11 de 106).
// Linux sí distingue mayúsculas: acá se arma a mano lo que deja Windows (la carpeta en el disco escrita distinto que en la base).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { DEFAULT_RULE, Organizer } from '@paila/core/organizer'
import { moveEntries } from '@paila/core/history-files'
import { carpetasDelDisco, mismaRuta } from '@paila/core/mayusculas-disco'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const REGLA = { rule: DEFAULT_RULE, dest: '' }
const DISCO = { artist: 'La Renga', album: 'La esquina del infinito', date: '2000' }
let cerrar: (() => void) | null = null
afterEach(() => { cerrar?.(); cerrar = null })

async function armar(temas: [string, Record<string, string>][], vacias: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-mayus-'))
  const M = (rel = '') => path.join(dir, 'M', ...rel.split('/').filter(Boolean))
  fs.mkdirSync(M(), { recursive: true })
  temas.forEach(([rel, meta], i) => {
    fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 50}:duration=1`, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), M(rel)])
  })
  for (const v of vacias) fs.mkdirSync(M(v), { recursive: true })
  let lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M(), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
  const org = () => new Organizer(lib.db, rootPath)
  /** Cerrar y volver a abrir PAILA: base nueva sobre el mismo archivo, y el escaneo de cada vez que abre. */
  const reabrir = async () => { lib.close(); lib = new Library(path.join(dir, 'paila.db'), ffprobe); await lib.scan() }
  const rels = () => (lib.db.prepare('SELECT rel_path AS r FROM files WHERE missing_at IS NULL ORDER BY rel_path').all() as { r: string }[]).map((x) => x.r)
  cerrar = () => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  return { M, org, reabrir, rels, db: () => lib.db }
}

describe('deshacer Ordenar después de reabrir, con una carpeta escrita con otras mayúsculas', () => {
  it('los temas vuelven todos, aunque al reabrir la carpeta figure como está en el disco', async () => {
    const b = await armar([['Descargas/uno.mp3', { ...DISCO, title: 'Uno', track: '1' }], ['Descargas/dos.mp3', { ...DISCO, title: 'Dos', track: '2' }]])
    const plan = b.org().plan(REGLA)
    expect(plan.moves.map((m) => m.to).sort()).toEqual(['La Renga/2000 - La esquina del infinito/01 - Uno.mp3', 'La Renga/2000 - La esquina del infinito/02 - Dos.mp3'])
    const hecho = await b.org().apply(plan, { vaciar: true })
    expect(hecho.moved).toBe(2)
    // lo que pasa en Windows cuando ya había una "La Esquina del Infinito": los temas quedan ahí adentro
    fs.renameSync(b.M('La Renga/2000 - La esquina del infinito'), b.M('La Renga/2000 - La Esquina del Infinito'))
    await b.reabrir()
    expect(b.rels()).toEqual(['La Renga/2000 - La Esquina del Infinito/01 - Uno.mp3', 'La Renga/2000 - La Esquina del Infinito/02 - Dos.mp3'])
    // el Historial no avisa que "cambiaron después" y deja deshacer la tanda entera
    const e = moveEntries(b.db(), () => true).find((x) => x.id === hecho.batchId)!
    expect(e.canUndo).toBe(true)
    expect(e.note).toBeNull()
    const r = await b.org().undo(hecho.batchId!)
    expect(r.failed).toEqual([])
    expect(r.moved).toBe(2)
    expect(b.rels()).toEqual(['Descargas/dos.mp3', 'Descargas/uno.mp3'])
    expect(fs.existsSync(b.M('Descargas/uno.mp3')) && fs.existsSync(b.M('Descargas/dos.mp3'))).toBe(true)
  })

  it('el destino se escribe como la carpeta que ya está en el disco, y lo que solo cambiaría de mayúsculas no se mueve', async () => {
    const b = await armar([
      ['La Renga/2000 - LA ESQUINA DEL INFINITO/03 - Tres.mp3', { ...DISCO, title: 'Tres', track: '3' }],
      ['Descargas/uno.mp3', { ...DISCO, title: 'Uno', track: '1' }],
      ['Descargas/dos.mp3', { ...DISCO, title: 'Dos', track: '2' }],
      ['Descargas/suelto.mp3', { artist: 'El Bordo', title: 'Suelto' }],
    ], ['el bordo']) // una carpeta que está en el disco pero sin temas (la base no la conoce)
    const plan = b.org().plan(REGLA)
    expect(plan.moves.map((m) => m.to).sort()).toEqual([
      'La Renga/2000 - LA ESQUINA DEL INFINITO/01 - Uno.mp3', 'La Renga/2000 - LA ESQUINA DEL INFINITO/02 - Dos.mp3', 'el bordo/Suelto.mp3',
    ])
    expect(plan.alreadyOk).toBe(1) // "Tres" ya está en su carpeta: antes era un movimiento de ruido
    const hecho = await b.org().apply(plan, { vaciar: true })
    await b.reabrir()
    const r = await b.org().undo(hecho.batchId!)
    expect(r.failed).toEqual([])
    expect(r.moved).toBe(3)
  })
})

describe('cómo se escribe cada carpeta (core/mayusculas-disco.ts)', () => {
  it('dos destinos de la misma vista previa que solo cambian de mayúsculas van a una sola carpeta; el archivo no se toca', async () => {
    const b = await armar([])
    const en = carpetasDelDisco(b.db(), () => null)
    expect(en(1, 'Biblioteca/Soda Stereo/Signos/01 - Signos.mp3')).toBe('Biblioteca/Soda Stereo/Signos/01 - Signos.mp3')
    expect(en(1, 'biblioteca/SODA STEREO/signos/02 - EL RITO.mp3')).toBe('Biblioteca/Soda Stereo/Signos/02 - EL RITO.mp3')
    expect(en(2, 'biblioteca/x.mp3')).toBe('biblioteca/x.mp3') // otra carpeta de música: no se mezcla
  })
  it('una tilde escrita separada (como la deja a veces la Mac) es la misma carpeta', async () => {
    const separada = 'La Mona Jime\u0301nez'
    const b = await armar([], [separada])
    const en = carpetasDelDisco(b.db(), () => b.M())
    expect(en(1, 'La Mona Jiménez/Tema.mp3')).toBe(`${separada}/Tema.mp3`)
    expect(mismaRuta(`${separada}/Tema.mp3`, 'la mona jiménez/TEMA.mp3')).toBe(true)
    expect(mismaRuta('La Renga/Tema.mp3', 'La Renga/Otro/Tema.mp3')).toBe(false)
  })
})
