// Lo que acompaña a cada disco cuando Organizar lo mueve (tapas, .cue, .log…) y la letra de cada tema (.lrc): se arma con la
// vista previa (core/organizer.ts). Va en la misma tanda que los temas, así Deshacer lo devuelve junto con ellos.
import fs from 'node:fs'
import path from 'node:path'
import { visible, type Db } from './db'
import type { TagRow } from './organizer'
import type { OrganizePlan, PlannedMove } from '@paila/shared/types'

const EXTRA_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'cue', 'log', 'm3u', 'm3u8', 'nfo', 'txt', 'pdf', 'sfv', 'accurip'])
/**
 * Las miniaturas que arma solo el Reproductor de Windows ("AlbumArt_{…}_Large.jpg", "AlbumArt_{…}_Small.jpg", "AlbumArtSmall.jpg")
 * no acompañan al disco: son copias chicas de la tapa, y el reproductor las vuelve a hacer donde haga falta (pedido del autor
 * del 24/10). Folder.jpg y cover.jpg sí van.
 */
export const isWmpThumb = (name: string) => /^AlbumArt(?:_\{[0-9a-f-]+\}_(?:Large|Small)|Small)\.jpg$/i.test(name)
/** ¿Acompaña al disco? Tapas, .cue, .log y los demás de EXTRA_EXT; ni los ocultos ni las miniaturas del Reproductor de Windows. */
const isExtra = (name: string) => EXTRA_EXT.has(path.extname(name).slice(1).toLowerCase()) && !name.startsWith('.') && !isWmpThumb(name)
/** La letra de un tema: "Tema.lrc" (y "Tema.txt", que leen algunos reproductores) junto al tema, con su mismo nombre. */
const LYRICS_EXT = new Set(['lrc', 'txt'])

/**
 * La letra viaja con su tema y toma su nombre nuevo: los reproductores la buscan con el mismo nombre que el tema ("Kase.O - El
 * círculo - 01 - Intro (El círculo).lrc" se quedaba atrás cuando el tema pasaba a "01 - Intro (El círculo).flac": punto 1 real del
 * 24/10). Una letra que no es de ningún tema que se mueve no se toca.
 */
function lyricsFor(rootPath: (rootId: number) => string | null, moves: PlannedMove[]): OrganizePlan['extras'] {
  const out: OrganizePlan['extras'] = [], listed = new Map<string, string[]>()
  const base = (rel: string) => path.posix.basename(rel, path.posix.extname(rel))
  for (const m of moves) {
    const dir = path.posix.dirname(m.from), root = rootPath(m.rootId), k = `${m.rootId}|${dir}`
    if (!root) continue
    if (!listed.has(k)) { try { listed.set(k, fs.readdirSync(path.join(root, ...(dir === '.' ? [] : dir.split('/'))))) } catch { listed.set(k, []) } }
    for (const n of listed.get(k)!) {
      const ext = path.extname(n).slice(1)
      if (!LYRICS_EXT.has(ext.toLowerCase()) || n.slice(0, n.length - ext.length - 1).toLowerCase() !== base(m.from).toLowerCase()) continue
      const to = `${path.posix.dirname(m.to)}/${base(m.to)}.${ext}`, from = dir === '.' ? n : `${dir}/${n}`
      if (!out.some((x) => x.rootId === m.rootId && x.from === from)) out.push({ rootId: m.rootId, from, to: to.startsWith('./') ? to.slice(2) : to })
    }
  }
  return out
}

/** Los archivos que acompañan al disco viajan solo si TODOS los temas de su carpeta van a la misma carpeta nueva. */
export function extrasFor(db: Db, raiz: (rootId: number) => string | null, moves: PlannedMove[], rows: TagRow[]): OrganizePlan['extras'] {
  // la carpeta de cada raíz, una vez por cuenta: preguntarla por tema lee el disco (200 ms con 5.000 temas, Ordenar 13/11)
  const raices = new Map<number, string | null>()
  const rootPath = (id: number) => (raices.has(id) ? raices.get(id)! : raices.set(id, raiz(id)).get(id)!)
  const lyrics = lyricsFor(rootPath, moves), isLyric = new Set(lyrics.map((x) => `${x.rootId}|${x.from}`))
  const extras: OrganizePlan['extras'] = [...lyrics]
  const dirOf = (rel: string) => path.posix.dirname(rel)
  const bySrc = new Map<string, { total: number; dest: Set<string>; moving: number }>()
  for (const r of rows) {
    const k = `${r.rootId}|${dirOf(r.rel)}`
    const e = bySrc.get(k) ?? { total: 0, dest: new Set(), moving: 0 }
    e.total++
    bySrc.set(k, e)
  }
  for (const m of moves) {
    const e = bySrc.get(`${m.rootId}|${dirOf(m.from)}`)!
    e.moving++
    e.dest.add(dirOf(m.to))
  }
  for (const [k, e] of bySrc) {
    if (e.moving !== e.total || e.dest.size !== 1) continue
    const [rootIdStr, srcDir] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)]
    const rootId = Number(rootIdStr)
    const root = rootPath(rootId)
    if (!root) continue
    const abs = path.join(root, ...(srcDir === '.' ? [] : srcDir.split('/')))
    let names: string[] = []
    try { names = fs.readdirSync(abs) } catch { continue }
    const dest = [...e.dest][0]
    for (const n of names) {
      if (!isExtra(n)) continue
      const from = srcDir === '.' ? n : `${srcDir}/${n}`
      if (!isLyric.has(`${rootId}|${from}`)) extras.push({ rootId, from, to: `${dest}/${n}` }) // la letra ya va con su tema
    }
  }
  // dos carpetas que van enteras a la misma (dos simples de un artista, cada uno con su Folder.jpg): viaja el primero, el otro se
  // queda donde está (antes los dos se proponían al mismo lugar y el motor frenaba el segundo como "falla"). Y lo que ya tiene
  // ocupado su lugar nuevo no se propone: al aplicar no se movería (no pisa), y la vista previa lo seguía contando cada vez
  const seen = new Set<string>()
  return [...extras, ...leftBehind(db, rootPath, bySrc)].filter((x) => {
    const k = `${x.rootId}|${x.to.toLowerCase()}`
    const root = rootPath(x.rootId)
    if (seen.has(k) || (root && fs.existsSync(path.join(root, ...x.to.split('/'))))) return false
    seen.add(k)
    return true
  })
}

/**
 * Lo que quedó solo en una carpeta vieja: un Organizar cortado o cancelado ya había movido todos sus temas, pero las tapas y
 * los .cue van al final de la tanda y no llegaron (corrida supervisada del motor único, 23/10). Si todos los temas que salieron
 * de esa carpeta están hoy juntos en una misma carpeta, lo que los acompañaba va con ellos (sin pisar nada).
 */
function leftBehind(db: Db, rootPath: (rootId: number) => string | null, bySrc: Map<string, unknown>): OrganizePlan['extras'] {
  const rows = db.prepare(
    `SELECT m.root_id AS rootId, m.from_rel AS fromRel, f.rel_path AS rel FROM moves_log m JOIN files f ON f.id = m.file_id
     WHERE m.undone_at IS NULL AND m.file_id IS NOT NULL AND ${visible('f')}`,
  ).all() as { rootId: number; fromRel: string; rel: string }[]
  const byOld = new Map<string, Set<string>>()
  for (const r of rows) {
    const k = `${r.rootId}|${path.posix.dirname(r.fromRel)}`
    if (!byOld.has(k)) byOld.set(k, new Set())
    byOld.get(k)!.add(path.posix.dirname(r.rel))
  }
  const out: OrganizePlan['extras'] = []
  for (const [k, dests] of byOld) {
    if (bySrc.has(k) || dests.size !== 1) continue // todavía tiene temas, o se repartieron en varias carpetas
    const rootId = Number(k.slice(0, k.indexOf('|'))), srcDir = k.slice(k.indexOf('|') + 1), dest = [...dests][0]
    const root = rootPath(rootId)
    if (!root || dest === srcDir) continue
    let names: string[] = []
    try { names = fs.readdirSync(path.join(root, ...(srcDir === '.' ? [] : srcDir.split('/')))) } catch { continue }
    for (const n of names) {
      if (!isExtra(n)) continue
      out.push({ rootId, from: srcDir === '.' ? n : `${srcDir}/${n}`, to: `${dest}/${n}` })
    }
  }
  return out
}
