// Reglas de nombres de Duplicados: texto comparable, el "núcleo" de un título (para juntar versiones), copias "(1)" del
// navegador, y cuándo los nombres de archivo o los títulos dicen temas distintos aunque el resto coincida.
import { versionRe } from './versionwords'

/** Lo mínimo de un tema que miran estas reglas. */
export interface NamedFile { rel: string; artist: string | null; title: string | null }

/** Texto comparable: sin mayúsculas, tildes, signos, ni cosas como "(Original Mix)". */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\((original|radio|extended)( mix| edit| version)?\)|\[(hd|hq)\]|\(official[^)]*\)/g, ' ')
    .replace(/\b(feat|ft)\.?\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Títulos que repiten muchos artistas en distintos discos: no alcanzan para decir que son versiones del mismo tema. */
export const GENERIC_TITLES = new Set(['intro', 'outro', 'interludio', 'interlude', 'skit', 'bonus track', 'untitled', 'sin titulo', 'track', 'tema'])

// Las palabras de versión (core/versionwords.ts). Sin "club": se borraría de títulos como "Fight Club" o "Club Tropicana".
const VERSION_WORDS = versionRe(['mezcla', 'vivo', 'grabacion', 'remaster'], { except: ['club'] })

/**
 * El "núcleo" del título, para juntar versiones: sin nada entre paréntesis o corchetes ni un " - Radio Edit" (o remix, en
 * vivo, extended…) al final. "Hola (Swing-Ya-Mix) (Diego Ro-K)" y "Hola" dan lo mismo. Si el título repite el artista
 * adelante ("Tan Bionica - Ella"), se saca; pero lo que va después de " - " sin palabras de versión es parte del título:
 * "Tan Bionica - Ella" y "Tan Bionica - Ciudad Mágica" son temas distintos.
 */
export function titleCore(title: string, artist?: string | null): string {
  let t = title
  const parts = t.split(/\s+[-–]\s+/)
  if (artist && parts.length > 1 && normalize(parts[0]) === normalize(artist)) t = parts.slice(1).join(' - ')
  t = t.replace(/\s*[([{][^)\]}]*[)\]}]/g, ' ')
  t = t.replace(/\s+[-–]\s+([^-–]*)$/, (whole, rest: string) => (VERSION_WORDS.test(rest) ? ' ' : whole))
  // si el título es solo palabras de versión ("Karaoke", "Live"), esas palabras son el título
  return normalize(t.replace(new RegExp(VERSION_WORDS.source, 'gi'), ' ')) || normalize(t)
}

// Palabras de otra grabación que la huella puede no distinguir: un instrumental o una acapella separados del original, otra
// letra sobre la misma base ("Don't Cry [Alternate Lyrics]"), un demo. Con los nombres de los stems de Demucs ("NO_VOCALS_…",
// "VOCALS_…"; los "_" se leen como espacios). Punto 1 real, 24/10: las dos se iban a la papelera como "mismo audio".
const RECORDING = versionRe([], { extra: ['instrumental', 'acapella', 'acappella', 'accapella', 'a cappella', 'cappella', 'karaoke', 'demo', 'alternate', 'outtake', 'alt take', 'no vocals', 'vocals', 'stem', 'stems'], flags: 'g' })

function recordingWords(r: NamedFile): string {
  const text = `${r.title ?? ''} ${(r.rel.split('/').pop() ?? r.rel).replace(/\.[^.]+$/, '')}`.replace(/_/g, ' ')
  return [...new Set((text.match(RECORDING) ?? []).map(normalize))].sort().join('|')
}

/** ¿El título o el nombre dicen otra grabación (instrumental, acapella, otra letra, demo) que el otro no dice? Entonces no son copias, aunque la huella diga que suenan igual. */
export const otherRecording = (a: NamedFile, b: NamedFile) => recordingWords(a) !== recordingWords(b)

/** "Tema (1).mp3", "Tema - copia.mp3": la copia que hizo el navegador o Windows al bajar o copiar dos veces lo mismo. */
export const isCopyName = (rel: string) => /(\s*\(\d\))+$|\s-\s(copia|copy)(\s*\(\d+\))?$/i.test((rel.split('/').pop() ?? rel).replace(/\.[^.]+$/, ''))

// Palabras que no dicen qué tema es (relleno de descargas, versiones, artículos).
const FILLER = new Set(['www', 'com', 'slider', 'kz', 'official', 'oficial', 'video', 'audio', 'letra', 'lyrics', 'hd', 'hq', 'mp3', 'flac',
  'feat', 'ft', 'remix', 'mix', 'version', 'vivo', 'live', 'en', 'original', 'remaster', 'remastered', 'edit', 'extended', 'radio',
  'the', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'and'])

/** Lo que dice el nombre del archivo además del artista y el título de los tags (sin números ni relleno). */
function nameRest(r: NamedFile): string {
  const tagged = new Set(normalize(`${r.artist ?? ''} ${r.title ?? ''}`).split(' '))
  return normalize((r.rel.split('/').pop() ?? r.rel).replace(/\.[^.]+$/, '')).split(' ')
    .filter((w) => w && !tagged.has(w) && !FILLER.has(w) && !/^\d+$/.test(w)).join('')
}

/**
 * ¿Los nombres de archivo dicen temas distintos aunque los tags coincidan? Pasa con discos que tienen los mismos tags
 * rotos en todos los temas (el AL046 de KASST: artista "AL046" y título "KAS:ST" en cada uno). "07 - Jijiji" y
 * "13 - Jijiji" no: fuera del título solo cambia el número.
 */
export function namesSayDifferent(a: NamedFile, b: NamedFile): boolean {
  let x = nameRest(a), y = nameRest(b)
  // lo que tienen en común al principio o al final (el artista escrito en el nombre, "KASST") no dice nada (si es una
  // palabra: una letra suelta en común no cuenta)
  let p = 0
  while (p < x.length && p < y.length && x[p] === y[p]) p++
  if (p >= 3) { x = x.slice(p); y = y.slice(p) }
  let q = 0
  while (q < x.length && q < y.length && x[x.length - 1 - q] === y[y.length - 1 - q]) q++
  if (q >= 3) { x = x.slice(0, x.length - q); y = y.slice(0, y.length - q) }
  return x.length >= 4 && y.length >= 4 && dice(x, y) < 0.5
}

/**
 * ¿Los tags dicen temas distintos? ("Conjure Drama" y "Conjure Balearia" con el mismo audio: uno de los dos está mal
 * nombrado, y quizás el tema que querías no lo tenés.) No cuentan un título que contiene al otro ("Funkytown (Single
 * Version)") ni los que se escriben casi igual ("El juicio del ganso" / "Ganzo", "Atrévete-Te-Te" / "Atréve-Te-Te").
 */
export function titlesDisagree(items: NamedFile[]): boolean {
  const cores = items.filter((i) => i.title).map((i) => titleCore(i.title!, i.artist).replace(/ /g, '')).filter((c) => c.length >= 3)
  return cores.some((a) => cores.some((b) => !a.includes(b) && !b.includes(a) && dice(a, b) < 0.7))
}

/** Parecido entre dos textos por pares de letras (0 a 1): tolera una letra cambiada o de más. */
function dice(a: string, b: string): number {
  const pairs = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1); return m }
  const x = pairs(a), y = pairs(b)
  let same = 0
  for (const [k, n] of x) same += Math.min(n, y.get(k) ?? 0)
  return (2 * same) / Math.max(1, a.length - 1 + b.length - 1)
}
