// Interrupciones reales (prueba de usabilidad del 27/10/2026, enfoque 5): el disco se desenchufa en medio de Organizar y un archivo
// está abierto en otro programa mientras se aplican cambios. Lo que tiene que pasar: nada se pierde, lo que se pudo hacer queda
// hecho, lo que no dice por qué en palabras, y todo se puede deshacer o reintentar cuando el problema se va.
// (Cerrar PAILA en medio de un Aplicar u Organizar: tests/recovery.test.ts y scripts/corte.ts. Disco lleno: tests/ops-respaldo.test.ts.)
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { Organizer } from '@paila/core/organizer'
import { readTags } from '@paila/core/tagio'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const dirs: string[] = [], libs: Library[] = []
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function biblioteca(n: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-interrupciones-'))
  dirs.push(dir)
  const M = path.join(dir, 'M')
  for (let i = 0; i < n; i++) {
    const f = path.join(M, 'Bajados', `tema ${i}.mp3`)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 20}:duration=2`, '-metadata', `artist=Artista ${i % 3}`, '-metadata', `title=Tema ${i}`, f])
  }
  const lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M, [{ rel: '', kind: 'musica' }])
  await lib.scan()
  libs.push(lib)
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
  return { dir, M, lib, rootPath }
}
/** Todos los archivos de audio que hay en una carpeta (rutas relativas). */
const enDisco = (M: string) => (fs.readdirSync(M, { recursive: true }) as string[]).filter((f) => f.endsWith('.mp3')).map((f) => f.split(path.sep).join('/')).sort()

afterAll(() => { for (const l of libs) l.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) })

describe('el disco se desenchufa en medio de Organizar', () => {
  let b: Awaited<ReturnType<typeof biblioteca>>
  // Organizar avisa cada 20 temas: con 45, el disco se va a la mitad
  beforeAll(async () => { b = await biblioteca(45) }, 120_000)

  it('lo movido queda movido, lo demás no se pierde, y al volver el disco se deshace entero', async () => {
    const antes = enDisco(b.M)
    const org = new Organizer(b.lib.db, b.rootPath)
    const plan = org.plan({ rule: '%artista%/%titulo%', dest: 'Biblioteca' })
    const fuera = `${b.M}-desenchufado`
    let cortado = false
    const r = await org.apply(plan, { onProgress: (p) => { if (p.done === 20 && !cortado) { cortado = true; fs.renameSync(b.M, fuera) } } })
    expect(cortado).toBe(true)
    expect(r.failed.length).toBeGreaterThan(0) // avisa los que no pudo
    expect(r.failed[0].error).not.toMatch(/ENOENT|EPERM|errno/) // y por qué, en palabras
    fs.renameSync(fuera, b.M) // vuelve el disco
    // ningún tema quedó en dos lugares ni desapareció
    const ahora = enDisco(b.M)
    expect(ahora).toHaveLength(antes.length)
    // la base dice dónde está cada uno
    for (const f of b.lib.db.prepare('SELECT rel_path AS rel FROM files').all() as { rel: string }[]) expect(ahora).toContain(f.rel)
    // y deshacer lo vuelve todo a su lugar
    for (const t of org.batches()) await org.undo(t.batchId)
    expect(enDisco(b.M)).toEqual(antes)
  }, 60_000)
})

describe.runIf(process.platform === 'win32')('un archivo abierto en otro programa mientras se aplica', () => {
  let b: Awaited<ReturnType<typeof biblioteca>>
  beforeAll(async () => { b = await biblioteca(3) }, 60_000)

  it('ese solo falla, con un motivo en palabras; los demás se aplican; al cerrarlo, se reintenta y anda', async () => {
    const changes = new Changes(b.lib.db, (i) => b.lib.trackPath(i), ffmpeg, path.join(b.dir, 'resguardo'))
    const ids = b.lib.tracks().map((r) => r[0] as number)
    const bloqueado = b.lib.trackPath(ids[0])!, titulo = readTags(bloqueado).title
    // como un reproductor o un editor que lo tiene abierto sin compartir: PowerShell lo abre en exclusiva unos segundos
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', `$f=[IO.File]::Open('${bloqueado.replace(/'/g, "''")}','Open','ReadWrite','None'); 'listo'; Start-Sleep -Seconds 6; $f.Close()`], { windowsHide: true })
    await new Promise<void>((res) => ps.stdout.once('data', () => res()))
    changes.stage(ids, 'genre', 'Cumbia')
    const r = await changes.apply()
    expect(r.applied).toBe(2)
    expect(r.failed).toHaveLength(1)
    const motivo = r.failed[0].error
    expect(motivo).toMatch(/abierto|otro programa|en uso/i) // en palabras, no "EBUSY"
    expect(motivo).not.toMatch(/EBUSY|EPERM|errno/)
    // el archivo no quedó roto ni a medias
    await new Promise((res) => ps.on('exit', res))
    expect(readTags(bloqueado).title).toBe(titulo)
    // al cerrarlo, "Probar de nuevo" anda
    await espera(300)
    const otra = await changes.apply(changes.list().map((c) => c.id))
    expect(otra.failed).toEqual([])
    expect(readTags(bloqueado).genre).toBe('Cumbia')
  }, 60_000)
})
