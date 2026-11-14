// Colecciones: a qué tipo pertenece cada carpeta (música, producción, sets…) y sugerencias automáticas.
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { CollectionKind, FolderSuggestion } from '@paila/shared/types'
import { extOf, isAudio, isSystemDir } from './files'
import { textos } from '@paila/shared/idioma'

// Por qué se sugiere cada tipo de carpeta (se ve al agregar una carpeta; solo se muestra).
const T = textos({
  pioneer: { es: 'Es el export USB de Rekordbox (lo que leen las CDJ).', en: "It's Rekordbox's USB export (what the CDJs read)." },
  ableton: { es: 'Es un proyecto de Ableton: su audio es parte del proyecto.', en: "It's an Ableton project: its audio is part of the project." },
  contents: {
    es: 'Parece la carpeta "Contents" de un pendrive de Rekordbox: probablemente son copias de temas que ya tenés.',
    en: 'It looks like the "Contents" folder of a Rekordbox USB stick: they are probably copies of tracks you already have.',
  },
  produccion: { es: (n: string) => `El nombre sugiere material de producción ("${n}").`, en: (n: string) => `The name suggests production material ("${n}").` },
  proyectos: { es: 'El nombre sugiere inéditos: demos, promos o temas que todavía no salieron.', en: "The name suggests unreleased tracks: demos, promos or tracks that aren't out yet." },
  sets: { es: 'Tiene grabaciones largas (más de 150 MB por archivo en promedio).', en: 'It has long recordings (more than 150 MB per file on average).' },
})

export interface Rule { rel: string; kind: CollectionKind }

/** Tipo de un archivo o carpeta según la regla más específica. Sin regla: música. */
export function kindFor(rel: string, rules: Rule[]): CollectionKind {
  let best: Rule | null = null
  for (const r of rules) {
    const match = r.rel === '' || rel === r.rel || rel.startsWith(r.rel + '/')
    if (match && (!best || r.rel.length > best.rel.length)) best = r
  }
  return best ? best.kind : 'musica'
}

interface Node {
  rel: string
  name: string
  depth: number
  files: number
  audio: number
  bytes: number
  audioBytes: number
  hasAls: boolean
  childNames: string[]
  children: Node[]
}

async function readTree(abs: string, rel: string, name: string, depth: number): Promise<Node> {
  const node: Node = { rel, name, depth, files: 0, audio: 0, bytes: 0, audioBytes: 0, hasAls: false, childNames: [], children: [] }
  let entries
  try { entries = await fsp.readdir(abs, { withFileTypes: true }) } catch { return node }
  for (const e of entries) {
    const full = path.join(abs, e.name)
    if (e.isDirectory()) {
      if (isSystemDir(e.name)) continue
      node.childNames.push(e.name)
      const child = await readTree(full, rel ? `${rel}/${e.name}` : e.name, e.name, depth + 1)
      node.children.push(child)
      node.files += child.files; node.audio += child.audio; node.bytes += child.bytes
      node.audioBytes += child.audioBytes
    } else if (e.isFile()) {
      let size = 0
      try { size = (await fsp.stat(full)).size } catch { /* ignorar */ }
      node.files++; node.bytes += size
      if (extOf(e.name) === 'als') node.hasAls = true
      if (isAudio(e.name)) { node.audio++; node.audioBytes += size }
    }
  }
  return node
}

// "(?![a-z])" evita falsos positivos como "Momo sampler" (un disco) o "One Shot '80" (un compilado). "Pack", "loop", "stem" y
// "vocal" solos son nombres de música ("Pack Reggaeton 2010", "Rat Pack", "Closed Loop", "Vocal House", "Vocal Jazz"): cuentan en
// plural o con lo que los hace de producción ("Drum Pack", "Vocal Pack"); si no, la carpeta quedaba fuera de todo (repaso del 24/10).
const PRODUCTION = /\b(samples?|(?:sample|drum|loop|sound|fx|vocal|midi|preset|construction) ?(?:packs?|kits?)|loops|one.?shots|stems|acap+el+as?|a cap+el+as?|drum.?kits?|presets?|vocals)(?![a-z])/i
// Inéditos (la colección 'proyectos'): demos, promos, temas que todavía no salieron, y lo de amigos o proyectos propios.
// Palabras enteras, para que "Demon Hunter", "Promociones" o "Swipe" no caigan acá. "Proyecto" en singular solo si es el nombre
// entero, y "amigos" no detrás de "Los": "Proyecto Uno" y "Los Amigos Invisibles" son bandas (repaso de criterios del 24/10).
export const PROJECTS = /((?<!\p{L})proyectos(?!\p{L})|^\s*proyecto\s*$|(?<!\p{L})(?<!\b(?:los|las|les|lxs)\s)amig[oaex]s(?!\p{L})|(?<!\p{L})(demos?|promos?|unreleased|in[eé]dit[oa]s?|wip)(?!\p{L}))/iu
const SETS = /(\bsets?\b|grabaci|recordings?|live ?set)/i

/** Sugerencia para una carpeta según su nombre y contenido. null = hereda de la carpeta de arriba. */
function suggest(n: Node): { kind: CollectionKind; reason: string } | null {
  if (n.name.toUpperCase() === 'PIONEER') return { kind: 'excluir', reason: T.pioneer }
  if (n.hasAls || n.childNames.includes('Ableton Project Info')) return { kind: 'excluir', reason: T.ableton }
  if (/^contents$/i.test(n.name) && n.childNames.some((c) => /^unknownartist$/i.test(c))) {
    return { kind: 'revisar', reason: T.contents }
  }
  if (PRODUCTION.test(n.name)) return { kind: 'produccion', reason: T.produccion(n.name) }
  if (PROJECTS.test(n.name)) return { kind: 'proyectos', reason: T.proyectos }
  if (SETS.test(n.name) && n.audio > 0 && n.audioBytes / n.audio > 150e6) {
    return { kind: 'sets', reason: T.sets }
  }
  return null
}

/** Recorre una carpeta y propone cómo clasificar sus subcarpetas. */
export async function analyzeFolder(root: string): Promise<{ totals: { audio: number; files: number; bytes: number }; suggestions: FolderSuggestion[] }> {
  const tree = await readTree(root, '', path.basename(root) || root, 0)
  const suggestions: FolderSuggestion[] = []
  const visit = (n: Node, inherited: CollectionKind) => {
    const s = n.depth > 0 ? suggest(n) : null
    const kind = s ? s.kind : inherited
    // Se listan todas las carpetas de primer nivel, y las más profundas solo si cambian de tipo.
    if (n.depth === 1 || (s && s.kind !== inherited)) {
      suggestions.push({ rel: n.rel, name: n.name, depth: n.depth, kind, reason: s ? s.reason : '', audio: n.audio, files: n.files, bytes: n.bytes })
    }
    // Lo excluido o para revisar no se sigue subdividiendo.
    if (kind !== 'excluir' && kind !== 'revisar') for (const c of n.children) visit(c, kind)
  }
  visit(tree, 'musica')
  suggestions.sort((a, b) => a.rel.localeCompare(b.rel, 'es'))
  return { totals: { audio: tree.audio, files: tree.files, bytes: tree.bytes }, suggestions }
}
