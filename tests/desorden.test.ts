// Desorden a propósito (prueba de usabilidad del 27/10/2026, enfoque 4): cada par de herramientas que mueven o cambian archivos, en
// los dos órdenes y a la vez, sobre una biblioteca de laboratorio nueva para cada combinación. Después se aplica lo pendiente, se
// deshace lo último del Historial y se mira que PAILA haya quedado sana. No importa qué gana: importa que nada se rompa ni se pierda.
// Las herramientas son las de la matriz de choques (docs/pruebas/2026-10-27-repaso-experiencia.md, sección 2).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Changes } from '@paila/core/changes'
import { Replacer } from '@paila/core/replace'
import { Trash } from '@paila/core/trash'
import { Organizer } from '@paila/core/organizer'
import { Improver } from '@paila/core/improve'
import { History } from '@paila/core/history'
import { applyTrim, planTrims, trimValue } from '@paila/core/trim'
import { readTags } from '@paila/core/tagio'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
let molde: string
const raices: string[] = []

const conMeta = (meta: Record<string, string>) => Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`])
/** Un MP3 con 3 s de silencio, 10 de tono y 8 de silencio: tiene recorte para proponer. */
const conSilencios = (file: string, meta: Record<string, string>) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const pedazos = ['anullsrc=r=44100:cl=stereo:d=3', 'sine=frequency=440:sample_rate=44100:duration=10', 'anullsrc=r=44100:cl=stereo:d=8']
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...pedazos.flatMap((p) => ['-f', 'lavfi', '-i', p]), '-filter_complex',
    '[0:a]aformat=channel_layouts=stereo[a];[1:a]aformat=channel_layouts=stereo[b];[2:a]aformat=channel_layouts=stereo[c];[a][b][c]concat=n=3:v=0:a=1[o]',
    '-map', '[o]', ...conMeta(meta), '-c:a', 'libmp3lame', '-b:a', '192k', file])
}
const tono = (file: string, meta: Record<string, string>, hz = 440) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=3`, ...conMeta(meta), file])
}

/** Una biblioteca nueva (copia del molde), con todas las herramientas armadas como en la app. */
async function biblioteca() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-desorden-'))
  raices.push(dir)
  fs.cpSync(molde, path.join(dir, 'M'), { recursive: true })
  const lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
  const pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  const replacer = new Replacer(lib.db, rootPath, ffprobe, ffmpeg)
  const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
  changes.trimmer = (fid, v, batch) => applyTrim(lib.db, replacer, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'recortes'), fid, v, batch)
  const trash = new Trash(lib.db, rootPath, pl), organizer = new Organizer(lib.db, rootPath)
  const hist = new History(lib.db, { changes, trash, organizer, replacer, improver: new Improver(lib.db), rootPath })
  // los temas se conocen por su número desde el principio: Organizar les cambia el nombre y la papelera los saca de la lista
  const ids = new Map(lib.tracks().map((r) => [path.basename(String(r[2])), r[0] as number]))
  const id = (n: string) => ids.get(n)!
  // una playlist con todo, para ver que ningún tema quede colgado
  const lista = pl.create('Para la fiesta')
  pl.addTracks(lista, lib.tracks().map((r) => r[0] as number))
  return { dir, lib, pl, lista, replacer, changes, trash, organizer, hist, id, rootPath }
}
type B = Awaited<ReturnType<typeof biblioteca>>

/** Las herramientas, como las usa la persona. Todas tocan "video.mp3" (el tema con silencios), para que choquen de verdad. */
const HERRAMIENTAS: Record<string, (b: B) => Promise<unknown>> = {
  nombres: async (b) => b.changes.stage([b.id('video.mp3')], 'title', 'Video (versión prolija)'),
  generos: async (b) => b.changes.stage([b.id('video.mp3'), b.id('Madonna - Vogue.mp3')], 'genre', 'Cumbia'),
  volumen: async (b) => b.changes.stageMany([{ id: b.id('video.mp3'), field: 'replaygain', value: JSON.stringify({ tg: -3.2, tp: 0.9, ag: null, ap: null }) }]),
  recortar: async (b) => {
    const plan = await planTrims(b.lib.db, (i) => b.lib.trackPath(i), ffmpeg)
    b.changes.stageMany(plan.items.map((i) => ({ id: i.fileId, field: 'trim' as const, value: trimValue(i) })))
  },
  aplicar: (b) => b.changes.apply(),
  duplicados: (b) => b.trash.trash([b.id('video.mp3')], 'duplicado'),
  organizar: (b) => b.organizer.apply(b.organizer.plan({ rule: '%artista%/%titulo%', dest: 'Biblioteca' })),
  reemplazar: async (b) => {
    const nuevo = path.join(b.dir, 'bajado', 'video.mp3')
    conSilencios(nuevo, { artist: 'Fulana', title: 'Video' })
    const fid = b.id('video.mp3')
    // si otra herramienta ya lo mandó a la papelera, reemplazar tiene que negarse con un motivo, no romper
    return b.replacer.replace(fid, nuevo, { keepTags: true, keepCover: true, sameName: true })
  },
  deshacer: async (b) => { const e = b.hist.list().find((x) => x.canUndo && !x.undone); return e ? b.hist.undo(e.kind, e.id) : null },
}

/** Lo que tiene que valer siempre, haya pasado lo que haya pasado. */
async function sana(b: B, que: string) {
  const fallas: string[] = []
  // 1. todo tema que PAILA cree que está, está en el disco
  const vivos = b.lib.db.prepare('SELECT id, root_id AS r, rel_path AS rel, title FROM files WHERE trashed_at IS NULL AND missing_at IS NULL').all() as { id: number; r: number; rel: string; title: string | null }[]
  for (const f of vivos) {
    const abs = path.join(b.rootPath(f.r)!, ...f.rel.split('/'))
    if (!fs.existsSync(abs)) { fallas.push(`${que}: la base dice que ${f.rel} está, pero no está en el disco`); continue }
    // 2. la base y el archivo dicen el mismo título (no quedó un tag escrito a medias ni un deshacer que no volvió la base)
    const t = readTags(abs).title ?? null
    if ((t ?? '') !== (f.title ?? '')) fallas.push(`${que}: ${f.rel} dice «${t}» en el archivo y «${f.title}» en la base`)
  }
  // 3. lo que está en la papelera de PAILA está en su carpeta, no perdido
  const tirados = b.lib.db.prepare('SELECT t.trash_rel AS rel, f.root_id AS r FROM trash_log t JOIN files f ON f.id = t.file_id WHERE f.trashed_at IS NOT NULL AND t.restored_at IS NULL AND t.purged_at IS NULL').all() as { rel: string; r: number }[]
  for (const t of tirados) if (!fs.existsSync(path.join(b.rootPath(t.r)!, ...t.rel.split('/')))) fallas.push(`${que}: ${t.rel} no está en la papelera`)
  // 4. nada pendiente para un tema que ya no está, ni un pendiente que falle sin motivo
  for (const c of b.changes.list()) {
    const f = b.lib.db.prepare('SELECT trashed_at AS t FROM files WHERE id = ?').get(c.fileId) as { t: string | null } | undefined
    if (!f || f.t) fallas.push(`${que}: queda pendiente «${c.field}» de un tema en la papelera`)
  }
  // 5. Aplicar de nuevo no repite fallas: lo que no se pudo queda aparte, con su motivo
  const otra = await b.changes.apply()
  if (otra.failed.length) fallas.push(`${que}: Aplicar otra vez vuelve a fallar: ${otra.failed.map((x) => x.error).join(' · ')}`)
  // 6. la playlist no apunta a temas que no existen
  const colgados = b.lib.db.prepare('SELECT COUNT(*) AS n FROM playlist_items i LEFT JOIN files f ON f.id = i.file_id WHERE i.playlist_id = ? AND f.id IS NULL').get(b.lista) as { n: number }
  if (colgados.n) fallas.push(`${que}: la playlist quedó con ${colgados.n} temas que no existen`)
  return fallas
}

beforeAll(() => {
  molde = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-desorden-molde-'))
  conSilencios(path.join(molde, 'Bajados', 'video.mp3'), { artist: 'Fulana', title: 'Video' })
  tono(path.join(molde, 'Madonna - Vogue.mp3'), { artist: 'Madonna', title: 'Vogue' })
  tono(path.join(molde, 'Sueltos', 'b.mp3'), { artist: 'Duran Duran', title: 'Ordinary World' }, 330)
}, 60_000)
afterAll(() => { for (const d of [molde, ...raices]) fs.rmSync(d, { recursive: true, force: true }) })

const nombres = Object.keys(HERRAMIENTAS)
const pares = nombres.flatMap((a) => nombres.filter((b) => b !== a).map((b) => [a, b] as const))

describe('desorden: dos herramientas en cualquier orden', () => {
  it.each(pares)('%s y después %s: queda sana', async (a, b) => {
    const lib = await biblioteca()
    const errores: string[] = []
    for (const h of [a, b]) {
      try { await HERRAMIENTAS[h](lib) } catch (e) {
        // negarse está bien si dice por qué en castellano (no un error de programa)
        const m = (e as Error).message
        if (/undefined|null|Cannot|is not|TypeError|SQLITE/.test(m)) errores.push(`${h}: ${m}`)
      }
    }
    await lib.changes.apply().catch((e) => errores.push(`aplicar al final: ${(e as Error).message}`))
    await HERRAMIENTAS.deshacer(lib).catch((e) => errores.push(`deshacer al final: ${(e as Error).message}`))
    errores.push(...await sana(lib, `${a} → ${b}`))
    lib.lib.close()
    expect(errores).toEqual([])
  }, 120_000)
})

describe('desorden: dos herramientas a la vez', () => {
  const juntos = pares.filter(([a, b]) => a < b)
  it.each(juntos)('%s ⇄ %s: queda sana', async (a, b) => {
    const lib = await biblioteca()
    const errores: string[] = []
    const r = await Promise.allSettled([HERRAMIENTAS[a](lib), HERRAMIENTAS[b](lib)])
    for (const [i, x] of r.entries()) if (x.status === 'rejected' && /undefined|null|Cannot|is not|TypeError|SQLITE/.test(String(x.reason?.message))) errores.push(`${[a, b][i]}: ${x.reason.message}`)
    await lib.changes.apply().catch((e) => errores.push(`aplicar al final: ${(e as Error).message}`))
    errores.push(...await sana(lib, `${a} ⇄ ${b}`))
    lib.lib.close()
    expect(errores).toEqual([])
  }, 120_000)
})
