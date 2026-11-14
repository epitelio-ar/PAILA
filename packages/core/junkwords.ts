// Palabras que sobran, aprendidas de la biblioteca (MASTERPLAN-2, 4.5; idea del 20/10/2026). Además de la
// lista fija de basura (core/tagactions.ts), PAILA aprende de los temas identificados con seguridad qué palabras traen
// los nombres de archivo y no tiene el nombre oficial. Barandas, tal cual el plan:
// - solo temas identificados con seguridad: la huella acústica (AcoustID) y la duración (±3 s) coinciden, y el título
//   oficial está en el nombre del archivo;
// - una palabra cuenta si sobra en muchos temas de artistas y carpetas distintas (6 temas, 5 artistas, 3 carpetas; ninguna
//   carpeta ni artista junta más del 60 %) y en el 90 % o más de los temas identificados que la llevan;
// - solo entre corchetes, entre paréntesis, al final del nombre o con forma de página web;
// - nunca palabras de versión (Remix, Live, Edit, feat.…), nunca lo que está en un nombre oficial ("Official Secrets"
//   es un título real) y nunca lo que la persona marcó "No es basura".
// Nada se aplica solo: el asistente lo propone en Cambios pendientes con el motivo (core/tidy-learned.ts).
import { tr } from '@paila/shared/idioma'
import path from 'node:path'
import { visible, type Db } from './db'
import { OnlineCache } from './online/http'
import { printKey } from './official-findings'
import { bareTitle, creditText, type ArtistHit, type RecHit } from './online/hits'
import type { AcoustHit } from './online/sources'
import { fold, loose } from './names'
import { stripJunk } from './tagactions'
import { ALL_VERSION_GROUPS, versionRe } from './versionwords'
import type { LearnedReport, LearnedState, LearnedWhere, LearnedWord } from '@paila/shared/types'

export const LEARN = { tracks: 6, artists: 5, folders: 3, ratio: 0.9, dominance: 0.6, seconds: 3, score: 0.9 }

/** Datos de versión y créditos: nunca son basura (cambian qué grabación es o quién la hizo). */
export const VERSION = versionRe(ALL_VERSION_GROUPS) // todas las de core/versionwords.ts
const TLD = 'com|net|org|ru|kz|info|me|tv|fm|io|co|ar|biz|cc|to|app|uk|de|es|mx|br|pl|in|xyz|su|ua|eu|club|online|site|top|pro'
const WEB = new RegExp(String.raw`(?:https?:\/\/|www\.)[^\s\])]+|\b[\w-]+(?:\.[\w-]+)*\.(?:${TLD})\b(?:\.[a-z]{2}\b)?`, 'gi')
const plain = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const domain = (s: string) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '')
const GROUP = /([[(])([^)\]]*)[)\]]/g
/** ¿Ya la saca la lista fija? En el medio o al final del nombre (el sello entre corchetes, "[Taapion Records]", solo al final). */
export const fixed = (shown: string) => [`x ${shown} y`, `x ${shown}`].some((t) => !stripJunk(t).includes(shown.trim()))

interface Occ { key: string; shown: string; where: LearnedWhere }
/** Lo que podría ser basura en un nombre: lo entre corchetes o paréntesis, las páginas web y las palabras del final que no son del nombre oficial. */
export function candidates(base: string, officialWords: Set<string>): Occ[] {
  const out: Occ[] = []
  let rest = base.replace(GROUP, (m, open: string, inner: string) => {
    const web = inner.match(WEB)
    if (web && plain(inner) === plain(web[0])) out.push({ key: domain(web[0]), shown: m, where: 'web' })
    else if (plain(inner)) out.push({ key: plain(inner), shown: m, where: open === '[' ? 'corchetes' : 'parentesis' })
    return ' '
  })
  rest = rest.replace(WEB, (m) => { out.push({ key: domain(m), shown: m, where: 'web' }); return ' ' })
  // al final: las palabras que no son del nombre oficial (hasta 3), si antes hay alguna que sí
  const words = rest.split(/[\s_\-–.]+/).filter(Boolean)
  const tail: string[] = []
  for (let i = words.length - 1; i >= 0 && tail.length < 3; i--) {
    const w = words[i]
    if (officialWords.has(plain(w)) || /^\d+$/.test(w)) break
    tail.unshift(w)
  }
  if (tail.length && tail.length < words.length && words.slice(0, words.length - tail.length).some((w) => officialWords.has(plain(w)))) out.push({ key: plain(tail.join(' ')), shown: tail.join(' '), where: 'final' })
  return out.filter((o) => o.key)
}

/** Saca de un texto las palabras aprendidas (solo donde se aprendieron: corchetes, paréntesis, web o al final). */
export function stripLearned(text: string, words: Pick<LearnedWord, 'key' | 'where'>[]): { text: string; used: string[] } {
  const used = new Set<string>()
  const byKey = new Map(words.map((w) => [`${w.where}|${w.key}`, w]))
  let t = text.replace(GROUP, (m, open: string, inner: string) => {
    const web = inner.match(WEB)
    const k = web && plain(inner) === plain(web[0]) ? `web|${domain(web[0])}` : `${open === '[' ? 'corchetes' : 'parentesis'}|${plain(inner)}`
    if (byKey.has(k)) { used.add(byKey.get(k)!.key); return ' ' }
    return m
  })
  t = t.replace(WEB, (m) => { const w = byKey.get(`web|${domain(m)}`); if (w) { used.add(w.key); return ' ' } return m })
  for (const w of words) {
    if (w.where !== 'final') continue
    const n = w.key.split(' ').length
    const parts = t.trimEnd().split(/([\s_\-–.]+)/)
    const tailWords = parts.filter((_, i) => i % 2 === 0).filter(Boolean)
    if (tailWords.length > n && plain(tailWords.slice(-n).join(' ')) === w.key) {
      const re = new RegExp(String.raw`[\s_\-–.]*${tailWords.slice(-n).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(String.raw`[\s_\-–.]+`)}\s*$`)
      t = t.trimEnd().replace(re, '')
      used.add(w.key)
    }
  }
  return { text: used.size ? t.replace(/\s{2,}/g, ' ').replace(/[\s\-–_]+$/, '').trim() : text, used: [...used] }
}

interface Ident { id: number; rel: string; base: string; artist: string; title: string; words: Set<string>; full: string }

export class JunkWords {
  constructor(private db: Db) {}

  private states(): Map<string, LearnedState> {
    return new Map((this.db.prepare('SELECT word, state FROM junk_words').all() as { word: string; state: LearnedState }[]).map((r) => [r.word, r.state]))
  }
  setState(key: string, state: LearnedState) {
    this.db.prepare('INSERT INTO junk_words (word, state, updated_at) VALUES (?, ?, ?) ON CONFLICT (word) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at').run(key, state, new Date().toISOString())
    this.memo = null
  }

  /** Los temas identificados con seguridad: AcoustID con la huella, la duración ±3 s y el título oficial dentro del nombre del archivo. */
  private identified(): Ident[] {
    const cache = new OnlineCache(this.db)
    // sin nada reconocido por AcoustID no hay de dónde aprender: no hace falta leer las huellas (con 100.000 temas, ~3 s)
    if (!cache.known('acoustid').size) return []
    const rows = this.db.prepare(
      `SELECT f.id, f.rel_path AS rel, f.duration, a.chromaprint AS cp FROM files f JOIN analysis a ON a.file_id = f.id
       WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica' AND a.chromaprint IS NOT NULL AND f.duration > 0`,
    ).all() as { id: number; rel: string; duration: number; cp: string }[]
    const out: Ident[] = []
    for (const r of rows) {
      const hits = cache.get<AcoustHit[]>('acoustid', printKey(r.cp))
      if (hits?.status !== 'ok' || !hits.data) continue
      const base = path.posix.basename(r.rel, path.posix.extname(r.rel))
      const lb = loose(base)
      const rec = hits.data.filter((h) => h.score >= LEARN.score).flatMap((h) => h.recordings)
        .find((x) => x.length != null && Math.abs(x.length - r.duration) <= LEARN.seconds && loose(bareTitle(x.title)).length >= 2 && lb.includes(loose(bareTitle(x.title))))
      if (!rec) continue
      const artist = creditText(rec.credit), title = rec.title
      const words = new Set(plain(`${artist} ${title} ${rec.credit.map((c) => c.name).join(' ')}`).split(' ').filter(Boolean))
      out.push({ id: r.id, rel: r.rel, base, artist, title, words, full: loose(`${artist} ${title}`) })
    }
    return out
  }

  /** Todo lo que dicen las fuentes de internet (títulos y artistas): una palabra que está ahí nunca es basura. */
  private officialText(): { words: Set<string>; texts: string[] } {
    const rows = this.db.prepare("SELECT source, query, data FROM online_cache WHERE status = 'ok' AND data IS NOT NULL").all() as { source: string; query: string; data: string }[]
    const texts = new Set<string>()
    for (const r of rows) {
      try {
        const d = JSON.parse(r.data) as unknown
        if (!Array.isArray(d)) continue
        if (r.source === 'acoustid') for (const h of d as AcoustHit[]) for (const x of h.recordings ?? []) texts.add(`${creditText(x.credit)} ${x.title}`)
        else if (r.query.startsWith('a:')) for (const a of d as ArtistHit[]) texts.add([a.name, ...(a.aliases ?? [])].join(' '))
        else for (const x of d as RecHit[]) texts.add(`${creditText(x.credit ?? [])} ${x.title}`)
      } catch { /* respuesta vieja */ }
    }
    const words = new Set<string>()
    for (const t of texts) for (const w of plain(t).split(' ')) if (w) words.add(w)
    return { words, texts: [...texts].map(plain) }
  }

  private memo: { stamp: string; report: LearnedReport } | null = null

  /**
   * Lo aprendido (se recalcula cuando cambian los temas, lo buscado en internet o lo que dijo la persona). Las huellas
   * importan solo si hay algo de AcoustID (sin eso no se aprende nada): contarlas recorre todo el análisis (~0,5 s con
   * 100.000 temas) y se cuentan solo en ese caso.
   */
  report(): LearnedReport {
    const s = this.db.prepare(`SELECT (SELECT COUNT(*) FROM online_cache) AS c, (SELECT MAX(looked_at) FROM online_cache) AS l, (SELECT COUNT(*) FROM files) AS n,
      (SELECT MAX(probed_at) FROM files) AS p, (SELECT MAX(updated_at) FROM junk_words) AS j,
      CASE WHEN EXISTS (SELECT 1 FROM online_cache WHERE source = 'acoustid') THEN (SELECT COUNT(chromaprint) FROM analysis) END AS a`).get() as Record<string, unknown>
    const stamp = JSON.stringify(s)
    if (this.memo?.stamp === stamp) return this.memo.report
    const report = this.learn()
    this.memo = { stamp, report }
    return report
  }

  private learn(): LearnedReport {
    const ids = this.identified()
    const off = this.officialText()
    type Acc = { shown: Map<string, number>; where: LearnedWhere; tracks: Ident[] }
    const acc = new Map<string, Acc>()
    for (const t of ids) {
      for (const o of candidates(t.base, t.words)) {
        if (t.full.includes(loose(o.key))) continue // está en el nombre oficial de este tema: no sobra
        const k = `${o.where}|${o.key}`
        const a: Acc = acc.get(k) ?? { shown: new Map(), where: o.where, tracks: [] }
        if (a.tracks.includes(t)) continue
        a.shown.set(o.shown, (a.shown.get(o.shown) ?? 0) + 1); a.tracks.push(t)
        acc.set(k, a)
      }
    }
    const states = this.states()
    const words: LearnedWord[] = [], rejected: (LearnedReport['rejected'][number] & { n: number })[] = []
    // toda la Música, recién cuando hay una palabra que pasó las barandas (para contar dónde se aplica)
    let all: { rel: string; artist: string | null; title: string | null }[] | null = null
    const library = () => (all ??= this.db.prepare(`SELECT rel_path AS rel, artist, title FROM files WHERE ${visible()} AND error IS NULL AND kind = 'musica'`).all() as { rel: string; artist: string | null; title: string | null }[])
    for (const [k, a] of acc) {
      const key = k.slice(k.indexOf('|') + 1)
      if (a.tracks.length < 3) continue
      const shown = [...a.shown.entries()].sort((x, y) => y[1] - x[1])[0][0]
      const by = (f: (t: Ident) => string) => { const m = new Map<string, number>(); for (const t of a.tracks) m.set(f(t), (m.get(f(t)) ?? 0) + 1); return m }
      const artists = by((t) => fold(t.artist.split(/ feat\. |, | & /)[0])), folders = by((t) => path.posix.dirname(t.rel))
      const lk = loose(key)
      const carrying = ids.filter((t) => loose(t.base).includes(lk)).length
      const ratio = a.tracks.length / Math.max(carrying, a.tracks.length)
      const single = key.includes(' ') ? null : key
      const why = fixed(shown) ? 'ya la saca la lista fija'
        : VERSION.test(key) ? 'es un dato de versión o un crédito'
        : (single ? off.words.has(single) : off.texts.some((x) => x.includes(key))) ? 'aparece en un nombre oficial'
        : a.tracks.length < LEARN.tracks ? `sobra en pocos temas (${a.tracks.length})`
        : artists.size < LEARN.artists ? `es de pocos artistas (${artists.size})`
        : folders.size < LEARN.folders ? `es de pocas carpetas (${folders.size})`
        : Math.max(...folders.values()) / a.tracks.length > LEARN.dominance ? 'casi todos los temas están en la misma carpeta (es de un disco)'
        : Math.max(...artists.values()) / a.tracks.length > LEARN.dominance ? 'casi todos los temas son del mismo artista'
        : ratio < LEARN.ratio ? `solo sobra en el ${Math.round(ratio * 100)} % de los temas que la llevan`
        : null
      if (why) { if (a.tracks.length >= 3) rejected.push({ shown, why, n: a.tracks.length }); continue }
      const w: LearnedWord = { key, shown, where: a.where, tracks: a.tracks.length, artists: artists.size, folders: folders.size, ratio, applies: 0, examples: [], state: states.get(key) ?? 'on' }
      for (const f of library()) {
        const base = path.posix.basename(f.rel, path.posix.extname(f.rel))
        const r = stripLearned(base, [w])
        const hit = r.used.length || stripLearned(f.title ?? '', [w]).used.length || stripLearned(f.artist ?? '', [w]).used.length
        if (!hit) continue
        w.applies++
        if (r.used.length && w.examples.length < 3) w.examples.push({ from: base, to: r.text })
      }
      words.push(w)
    }
    words.sort((a, b) => b.tracks - a.tracks || a.key.localeCompare(b.key))
    rejected.sort((a, b) => b.n - a.n || a.shown.localeCompare(b.shown))
    return { words, identified: ids.length, rejected: rejected.slice(0, 60).map(({ shown, why }) => ({ shown, why })) }
  }

  /** Las palabras que se sacan (prendidas). */
  active(): LearnedWord[] { return this.report().words.filter((w) => w.state === 'on') }
}

/** El motivo que se ve en Cambios pendientes: "palabra aprendida: «[xyz]» vista de más en 37 temas de 25 artistas". */
// lo que se ve al lado del nombre propuesto (la lista de palabras de arriba es dato: no se traduce)
export const learnedNote = (w: LearnedWord) => tr({
  es: `palabra aprendida: «${w.shown}» vista de más en ${w.tracks} temas de ${w.artists} artistas`,
  en: `learned word: “${w.shown}” seen too often in ${w.tracks} tracks by ${w.artists} artists`,
})
