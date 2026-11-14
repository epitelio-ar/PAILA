// Dos pasos del asistente "Arreglar nombres y tags" que vienen de la Fase C:
// - "Tu diccionario de artistas" (regla `diccionario`): las correcciones que hizo el usuario, aplicadas solas;
// - "Nombres oficiales" (regla `oficial`, paso `official`): lo que dicen las fuentes de internet (ya buscado y guardado).
//   Lo seguro se propone; lo dudoso va a "para mirar a mano" con el motivo.
import { ArtistDict } from './artistdict'
import { artistParts, isSeparator } from './artists'
import { fold, loose } from './names'
import { officialFindings, type NameRow } from './official-findings'
import type { TidyCtx } from './tidy'
import { textos } from '@paila/shared/idioma'

const T = textos({
  oficial: { es: (why: string) => `Nombre oficial: ${why}`, en: (why: string) => `Official name: ${why}` },
  internet: { es: (why: string) => `Internet: ${why}`, en: (why: string) => `Internet: ${why}` },
})

export function applyDictionary(c: TidyCtx) {
  const dict = new ArtistDict(c.db).map()
  if (!dict.size) return
  for (const r of c.rows) {
    if (c.isSet.has(r.id)) continue
    const a = c.val(r.id, 'artist')
    if (!a) continue
    const v = ArtistDict.apply(a, dict)
    if (v !== a) c.setField(r, 'artist', v, 'style', undefined, 'diccionario')
  }
}

/**
 * Lo oficial con las mayúsculas del tema (el autor, 24/10: "COACH es COACH, y Mi Vecinita está bien con mayúscula en cada
 * palabra"). Si solo cambian mayúsculas, no se propone nada (null). Si cambian tildes o se completa un título cortado, la parte
 * que ya estaba conserva sus mayúsculas ("Nunca Sere Policia" → "Nunca Seré Policía"; "Voy A Bailar A La Nave Del Olv" →
 * "Voy A Bailar A La Nave Del Olvido"). Lo que de verdad es distinto (otras palabras, feat., errores) va como viene.
 */
export function keepCase(now: string | null, to: string): string | null {
  if (!now?.trim()) return to
  if (now === to || now.toLowerCase() === to.toLowerCase()) return null
  const plain = (ch: string) => ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const a = [...now.normalize('NFC')], b = [...to.normalize('NFC')]
  if (b.length < a.length || a.some((ch, i) => plain(ch) !== plain(b[i]))) return to
  const out = b.map((ch, i) => (i >= a.length ? ch : a[i] !== a[i].toLowerCase() ? ch.toUpperCase() : a[i] !== a[i].toUpperCase() ? ch.toLowerCase() : ch)).join('')
  return out === now ? null : out
}

/**
 * Con el tag vacío, las mayúsculas salen del nombre del archivo si dice lo mismo: MusicBrainz escribe "Casi un g", pero el autor
 * lo subió como "Casi un G" ("YSY A Casi un G.mp3"). Si el nombre no lo dice, va como viene.
 */
export function caseFromFile(file: string, to: string): string {
  const plain = (s: string) => [...s.normalize('NFC')].map((ch) => ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()).join('')
  const name = file.replace(/\.[^.]+$/, '').normalize('NFC'), at = plain(name).indexOf(plain(to))
  if (at < 0) return to
  return keepCase([...name].slice(at, at + [...to.normalize('NFC')].length).join(''), to) ?? [...name].slice(at, at + [...to.normalize('NFC')].length).join('')
}

export function applyOfficial(c: TidyCtx) {
  const dict = new ArtistDict(c.db).map()
  const print = c.db.prepare('SELECT chromaprint FROM analysis WHERE file_id = ?')
  const rows: NameRow[] = c.rows.filter((r) => !c.isSet.has(r.id)).map((r) => {
    const artist = c.val(r.id, 'artist'), title = c.val(r.id, 'title')
    const chromaprint = !artist?.trim() || !title?.trim() ? ((print.get(r.id) as { chromaprint: string | null } | undefined)?.chromaprint ?? null) : null
    return { id: r.id, artist, title, duration: r.duration, chromaprint, file: r.rel.split('/').pop() }
  })
  const byId = new Map(c.rows.map((r) => [r.id, r]))
  for (const [id, found] of officialFindings(c.db, rows)) {
    const r = byId.get(id)!
    for (const f of found) {
      const now = c.val(id, f.field)
      // lo que el usuario decidió en su diccionario manda (también "así está bien")
      if (f.field === 'artist' && now && artistParts(now).some((p) => !isSeparator(p) && dict.has(fold(p.trim())))) continue
      const to = now?.trim() ? keepCase(now, f.to) : caseFromFile(r.rel.slice(r.rel.lastIndexOf('/') + 1), f.to)
      if (to == null) continue
      if (f.conf === 'alta') {
        // un nombre que cambia (no solo acentos) se propone con su motivo, para que se vea en "se proponen con un aviso"
        const renamed = f.field === 'artist' && now != null && loose(now) !== loose(to)
        c.setField(r, f.field, to, 'official', renamed ? T.oficial(f.why) : undefined, 'oficial')
      } else c.doubt(r, f.field, to, T.internet(f.why), 'oficial')
    }
  }
}
